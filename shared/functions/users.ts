/**
 * PORTABLE FUNCTIONS: the users domain (list / get / getByEmail /
 * getByAuthSubject / ensureCurrentMembership / recordLogin).
 *
 * Pure `ctx.db` reads and writes over the `users`/`members` tables. Each handler
 * runs unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. `setRole` is role-gated through the portable `requireRolePortable`.
 */

import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, ROLES, requireRolePortable, requireSocietyMembership, type Role } from "./access";
import { matchesAuthBinding, normalizeAuthIssuer } from "./identity";

export type MembershipResolution =
  | { status: "bound"; societyId: string; userId: string }
  | { status: "invitation-accepted"; societyId: string; userId: string }
  | { status: "needs-invitation" }
  | { status: "unauthenticated" }
  | { status: "membership-disabled" }
  | { status: "ambiguous-binding" }
  | { status: "invalid-invitation" }
  | { status: "invitation-society-mismatch" }
  | { status: "invitation-revoked" }
  | { status: "invitation-already-accepted" }
  | { status: "invitation-email-unverified" }
  | { status: "invitation-email-mismatch" };

type UserRow = PortableDoc & {
  societyId: string;
  email: string;
  displayName: string;
  status: string;
  authProvider?: string;
  authSubject?: string;
  authIssuer?: string;
};

type InvitationRow = PortableDoc & {
  societyId: string;
  email: string;
  role: string;
  acceptedAtISO?: string;
  revokedAtISO?: string;
};

/** Refuse to demote the society's last Owner (FilterBuilder rewritten as a JS predicate). */
async function assertNotLastOwnerPortable(ctx: PortableMutationCtx, target: any) {
  if (target.role !== "Owner" || (target.status && target.status !== "Active")) return;
  const otherOwner = await ctx.db
    .query("users")
    .withIndex("by_society", (q) => q.eq("societyId", target.societyId))
    .filter((row) => String(row._id) !== String(target._id) && row.role === "Owner" && (!row.status || row.status === "Active"))
    .first();
  if (!otherOwner) {
    throw new Error("Can't remove the last Owner — promote another active user to Owner first.");
  }
}

export type UserUpsertArgs = {
  id?: string;
  societyId: string;
  email: string;
  displayName: string;
  role: string;
  memberId?: string;
  directorId?: string;
  status: string;
  avatarColor?: string;
  actingUserId?: string;
};

export async function userUpsertPortable(ctx: PortableMutationCtx, args: UserUpsertArgs) {
  if (!ROLES.includes(args.role as Role)) throw new Error("Unknown workspace role.");
  if (!["Active", "Invited", "Disabled"].includes(args.status)) throw new Error("Unknown workspace user status.");
  await requireSocietyMembership(ctx, args.societyId);
  const peers = await ctx.db.query("users").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).first();
  // A trusted local file with no users may create its first active Owner.
  // Hosted callers still need an existing authenticated Admin membership.
  if (peers || ctx.principal.assurance !== "trusted-workspace") {
    await requireRolePortable(ctx, { societyId: args.societyId, actingUserId: args.actingUserId, required: "Admin" });
  }
  const { id } = args;
  // Keep auth bindings operator-only even when a portable caller sends extra keys.
  const fields = {
    societyId: args.societyId,
    email: args.email,
    displayName: args.displayName,
    role: args.role,
    status: args.status,
    ...(Object.hasOwn(args, "memberId") ? { memberId: args.memberId } : {}),
    ...(Object.hasOwn(args, "directorId") ? { directorId: args.directorId } : {}),
    ...(Object.hasOwn(args, "avatarColor") ? { avatarColor: args.avatarColor } : {}),
  };
  if (args.memberId) await getOwned(ctx, "members", args.memberId, args.societyId);
  if (args.directorId) await getOwned(ctx, "directors", args.directorId, args.societyId);
  if (id) {
    const target = await getOwned(ctx, "users", id, args.societyId);
    if (args.role !== "Owner" || args.status !== "Active") await assertNotLastOwnerPortable(ctx, target);
    await ctx.db.patch(id, fields);
    return id;
  }
  return ctx.db.insert("users", {
    ...fields,
    role: peers ? fields.role : "Owner",
    status: peers ? fields.status : "Active",
    createdAtISO: new Date().toISOString(),
  });
}

export async function userRemovePortable(
  ctx: PortableMutationCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const target = await requireOwnedRow(ctx, "users", id);
  await requireRolePortable(ctx, { societyId: target.societyId, actingUserId, required: "Owner" });
  await assertNotLastOwnerPortable(ctx, target);
  await ctx.db.delete(id);
}

export async function setRolePortable(
  ctx: PortableMutationCtx,
  { id, role, actingUserId }: { id: string; role: string; actingUserId?: string },
) {
  if (!ROLES.includes(role as Role)) throw new Error("Unknown workspace role.");
  const target = await requireOwnedRow(ctx, "users", id);
  const societyId = String(target.societyId);
  await requireRolePortable(ctx, { actingUserId, societyId, required: "Admin" });
  if (role !== "Owner") await assertNotLastOwnerPortable(ctx, target);
  await ctx.db.patch(id, { role });
}

export async function usersList(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("users")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function userGet(ctx: PortableQueryCtx, { id }: { id: string }) {
  return requireOwnedRow(ctx, "users", id);
}

export async function userGetByEmail(ctx: PortableQueryCtx, { email }: { email: string }) {
  const rows = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .collect();
  for (const row of rows) {
    try {
      return await requireOwnedRow(ctx, "users", row._id);
    } catch {
      // The same email may have memberships in societies the caller cannot access.
    }
  }
  return null;
}

export async function userGetByAuthSubject(ctx: PortableQueryCtx, { authSubject }: { authSubject: string }) {
  const rows = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", authSubject))
    .collect();
  for (const row of rows) {
    if (ctx.principal.kind === "user" && ctx.principal.assurance === "verified-jwt" &&
      !matchesAuthBinding(row, ctx.principal)) continue;
    try {
      return await requireOwnedRow(ctx, "users", row._id);
    } catch {
      // One auth subject can have memberships in more than one society.
    }
  }
  return null;
}

export async function ensureCurrentMembershipPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; invitationToken?: string },
): Promise<MembershipResolution> {
  const principal = ctx.principal;
  if (
    principal.kind !== "user" ||
    principal.assurance !== "verified-jwt" ||
    !principal.issuer ||
    !principal.subject
  ) {
    return { status: "unauthenticated" };
  }
  if (principal.societyId && principal.societyId !== args.societyId) {
    throw new Error("Society membership not found.");
  }

  const existingByAuth = await ctx.db
    .query<UserRow>("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", principal.subject))
    .collect();
  const matchingBindings = existingByAuth.filter(
    (row) => row.societyId === args.societyId && matchesAuthBinding(row, principal),
  );
  if (matchingBindings.length > 1) return { status: "ambiguous-binding" };

  const existing = matchingBindings[0];
  const now = new Date().toISOString();
  if (existing) {
    if (existing.status === "Disabled") return { status: "membership-disabled" };
    const profilePatch: Record<string, string> = { lastLoginAtISO: now };
    if (principal.email) profilePatch.email = principal.email;
    if (principal.name?.trim()) profilePatch.displayName = principal.name.trim();
    if (principal.emailVerified) profilePatch.emailVerifiedAtISO = now;
    await ctx.db.patch(existing._id, profilePatch);
    return { status: "bound", societyId: args.societyId, userId: existing._id };
  }

  if (!args.invitationToken) return { status: "needs-invitation" };
  const invitations = await ctx.db
    .query<InvitationRow>("invitations")
    .withIndex("by_token", (q) => q.eq("token", args.invitationToken))
    .collect();
  if (invitations.length !== 1) return { status: "invalid-invitation" };

  const invitation = invitations[0];
  if (invitation.societyId !== args.societyId) {
    return { status: "invitation-society-mismatch" };
  }
  if (invitation.revokedAtISO) return { status: "invitation-revoked" };
  if (invitation.acceptedAtISO) return { status: "invitation-already-accepted" };
  if (!ROLES.includes(invitation.role as Role)) return { status: "invalid-invitation" };
  if (!principal.emailVerified) return { status: "invitation-email-unverified" };
  if (
    !principal.email ||
    principal.email.toLowerCase() !== invitation.email.toLowerCase()
  ) {
    return { status: "invitation-email-mismatch" };
  }

  const userId = await ctx.db.insert("users", {
    societyId: invitation.societyId,
    email: principal.email,
    displayName: principal.name?.trim() || principal.email,
    role: invitation.role,
    authProvider: principal.authProvider || principal.issuer,
    authSubject: principal.subject,
    authIssuer: principal.issuer,
    status: "Active",
    createdAtISO: now,
    emailVerifiedAtISO: principal.emailVerified ? now : undefined,
    lastLoginAtISO: now,
  });
  await ctx.db.patch(invitation._id, {
    acceptedAtISO: now,
    acceptedByUserId: userId,
  });
  return {
    status: "invitation-accepted",
    societyId: invitation.societyId,
    userId,
  };
}

/**
 * Internal operator-only primitive for reconciling a pre-existing unbound row.
 * It is intentionally absent from the portable registry; the sole hosted
 * wrapper authenticates the API-platform service token before invoking it.
 */
export async function bootstrapUserIdentityPortable(
  ctx: PortableMutationCtx,
  args: { userId: string; authSubject: string; authProvider: string; authIssuer?: string },
): Promise<string> {
  const authSubject = args.authSubject.trim();
  if (!authSubject) throw new Error("Auth subject is required.");

  const target = await ctx.db.get<UserRow>(args.userId, "users");
  if (!target) throw new Error("users not found.");
  if (target.authSubject && target.authSubject !== authSubject) {
    throw new Error("User is already bound to a different auth subject.");
  }
  if (target.authProvider && target.authProvider !== args.authProvider) {
    throw new Error("User is already bound to a different auth provider.");
  }
  if (target.authIssuer && (!args.authIssuer || normalizeAuthIssuer(target.authIssuer) !== normalizeAuthIssuer(args.authIssuer))) {
    throw new Error("User is already bound to a different auth issuer.");
  }
  if (args.authProvider === "clerk" && !args.authIssuer) throw new Error("Clerk auth issuer is required.");

  const subjectBindings = await ctx.db
    .query<UserRow>("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", authSubject))
    .collect();
  if (subjectBindings.some((row) => row._id !== target._id && row.societyId === target.societyId &&
    (args.authIssuer ? matchesAuthBinding(row, {
      kind: "user", runtime: "test", assurance: "verified-jwt", subject: authSubject,
      issuer: args.authIssuer, authProvider: args.authProvider,
    }) : !row.authIssuer && row.authProvider === args.authProvider))) {
    throw new Error("Auth subject is already bound to another user.");
  }
  if (target.authSubject === authSubject && target.authProvider === args.authProvider && target.authIssuer === args.authIssuer) {
    return target._id;
  }

  const now = new Date().toISOString();
  await ctx.db.patch(target._id, {
    authProvider: args.authProvider,
    authSubject,
    ...(args.authIssuer ? { authIssuer: args.authIssuer } : {}),
  });
  await ctx.db.insert("activity", {
    societyId: target.societyId,
    actor: "API platform operator",
    entityType: "user",
    subjectId: target._id,
    entityId: target._id,
    action: "identity-bound",
    summary: `Bound ${args.authProvider} subject ${authSubject} to ${target.displayName}`,
    createdAtISO: now,
  });
  return target._id;
}

export async function recordLoginPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await requireOwnedRow(ctx, "users", id);
  await ctx.db.patch(id, { lastLoginAtISO: new Date().toISOString() });
}

/** Operator-only migration; the hosted wrapper validates the destination issuer. */
export async function migrateUserToClerkPortable(
  ctx: PortableMutationCtx,
  args: {
    userId: string;
    expectedAuthSubject: string;
    expectedAuthProvider?: string;
    expectedAuthIssuer?: string;
    authSubject: string;
    authIssuer: string;
  },
): Promise<string> {
  const target = await ctx.db.get<UserRow>(args.userId, "users");
  if (!target) throw new Error("users not found.");
  if (target.authSubject !== args.expectedAuthSubject ||
    target.authProvider !== args.expectedAuthProvider || target.authIssuer !== args.expectedAuthIssuer) {
    throw new Error("User identity changed; expected binding does not match.");
  }
  if (!args.authSubject.trim() || !args.authIssuer.trim()) throw new Error("Destination identity is required.");
  const identity = {
    kind: "user", runtime: "test", assurance: "verified-jwt",
    issuer: args.authIssuer, subject: args.authSubject.trim(), authProvider: "clerk",
  } as const;
  const peers = await ctx.db.query<UserRow>("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", identity.subject)).collect();
  if (peers.some((row) => row._id !== target._id && row.societyId === target.societyId && matchesAuthBinding(row, identity))) {
    throw new Error("Clerk identity is already bound within this society.");
  }
  await ctx.db.patch(target._id, {
    authProvider: "clerk", authIssuer: args.authIssuer, authSubject: identity.subject,
    emailVerifiedAtISO: undefined,
  });
  await ctx.db.insert("activity", {
    societyId: target.societyId, actor: "API platform operator", entityType: "user",
    subjectId: target._id, entityId: target._id, action: "identity-migrated",
    summary: `Migrated ${target.displayName} from ${target.authProvider || "legacy"} subject ${target.authSubject} to Clerk subject ${identity.subject}`,
    createdAtISO: new Date().toISOString(),
  });
  return target._id;
}
