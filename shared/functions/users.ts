/**
 * PORTABLE FUNCTIONS: the users domain (list / get / getByEmail /
 * getByAuthSubject / ensureCurrentMembership / recordLogin).
 *
 * Pure `ctx.db` reads and writes over the `users`/`members` tables. Each handler
 * runs unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. `setRole` is role-gated through the portable `requireRolePortable`.
 */

import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, ROLES, requireRolePortable, requireSocietyMembership, type Role } from "./access";

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
  | { status: "invitation-email-mismatch" };

type UserRow = PortableDoc & {
  societyId: string;
  email: string;
  displayName: string;
  status: string;
  authProvider?: string;
  authSubject?: string;
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
  if (target.role !== "Owner") return;
  const otherOwner = await ctx.db
    .query("users")
    .withIndex("by_society", (q) => q.eq("societyId", target.societyId))
    .filter((row) => String(row._id) !== String(target._id) && row.role === "Owner")
    .first();
  if (!otherOwner) {
    throw new Error("Can't remove the last Owner — promote another user to Owner first.");
  }
}

export async function setRolePortable(
  ctx: PortableMutationCtx,
  { id, role, actingUserId }: { id: string; role: string; actingUserId?: string },
) {
  const societyId = ctx.principal.kind === "anonymous" ? undefined : ctx.principal.societyId;
  if (!societyId) throw new Error("Society membership not found.");
  const target = await getOwned(ctx, "users", id, societyId);
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
  const societyId = ctx.principal.kind === "anonymous" ? undefined : ctx.principal.societyId;
  if (!societyId) throw new Error("Society membership not found.");
  return getOwned(ctx, "users", id, societyId);
}

export async function userGetByEmail(ctx: PortableQueryCtx, { email }: { email: string }) {
  const societyId = ctx.principal.kind === "anonymous" ? undefined : ctx.principal.societyId;
  if (!societyId) throw new Error("Society membership not found.");
  await requireSocietyMembership(ctx, societyId);
  const rows = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .collect();
  return rows.find((row) => row.societyId === societyId) ?? null;
}

export async function userGetByAuthSubject(ctx: PortableQueryCtx, { authSubject }: { authSubject: string }) {
  const societyId = ctx.principal.kind === "anonymous" ? undefined : ctx.principal.societyId;
  if (!societyId) throw new Error("Society membership not found.");
  await requireSocietyMembership(ctx, societyId);
  const rows = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", authSubject))
    .collect();
  return rows.find((row) => row.societyId === societyId) ?? null;
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
    (row) => row.societyId === args.societyId,
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
  args: { userId: string; authSubject: string; authProvider: string },
): Promise<string> {
  const authSubject = args.authSubject.trim();
  if (!authSubject) throw new Error("Auth subject is required.");

  const societyId = ctx.principal.kind === "anonymous" ? undefined : ctx.principal.societyId;
  if (!societyId) throw new Error("Society membership not found.");
  const target = await getOwned<UserRow>(ctx, "users", args.userId, societyId);
  if (target.authSubject && target.authSubject !== authSubject) {
    throw new Error("User is already bound to a different auth subject.");
  }
  if (target.authProvider && target.authProvider !== args.authProvider) {
    throw new Error("User is already bound to a different auth provider.");
  }

  const subjectBindings = await ctx.db
    .query<UserRow>("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", authSubject))
    .collect();
  if (subjectBindings.some((row) => row._id !== target._id)) {
    throw new Error("Auth subject is already bound to another user.");
  }
  if (target.authSubject === authSubject && target.authProvider === args.authProvider) {
    return target._id;
  }

  const now = new Date().toISOString();
  await ctx.db.patch(target._id, {
    authProvider: args.authProvider,
    authSubject,
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
  const societyId = ctx.principal.kind === "anonymous" ? undefined : ctx.principal.societyId;
  if (!societyId) throw new Error("Society membership not found.");
  await getOwned(ctx, "users", id, societyId);
  await ctx.db.patch(id, { lastLoginAtISO: new Date().toISOString() });
}
