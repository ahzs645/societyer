/**
 * PORTABLE FUNCTIONS: the users domain (list / get / getByEmail /
 * getByAuthSubject / ensureCurrentMembership / recordLogin).
 *
 * Pure `ctx.db` reads and writes over the `users`/`members` tables. Each handler
 * runs unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. `setRole` is role-gated through the portable `requireRolePortable`.
 */

import { assertValid, validateWorkspaceUserInput } from "../recordValidation";
import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, isActiveMembership, requireOwnedRow, ROLES, requireRolePortable, requireSocietyMembership, type Role } from "./access";
import { requirePermissionPortable } from "./permissions";
import { findInvitation, invitationAvailability, invitationIssuerAuthorized } from "./invitationTokens";
import { matchesAuthBinding, normalizeAuthIssuer, matchesVerifiedIdentity, ensureExternalIdentityPortable, assertExternalIdentityActive } from "./identity";

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
  | { status: "invitation-email-mismatch" }
  | { status: "invitation-email-unverified" }
  | { status: "invitation-expired" }
  | { status: "invitation-issuer-unavailable" };

type UserRow = PortableDoc & {
  societyId: string;
  email: string;
  displayName: string;
  status: string;
  authProvider?: string;
  authSubject?: string;
  authIssuer?: string;
  externalIdentityId?: string;
};

export const MEMBERSHIP_STATUSES = ["Active", "Invited", "Disabled", "Suspended", "Pending"] as const;

export function assertRoleAndStatus(role: string, status: string) {
  if (!ROLES.includes(role as Role)) throw new Error("Invalid workspace role.");
  if (!(MEMBERSHIP_STATUSES as readonly string[]).includes(status)) throw new Error("Invalid membership status.");
}

/** Ordinary transitions preserve an active Owner; security disabling bypasses only this invariant. */
export async function assertActiveOwnerRemains(ctx: PortableMutationCtx, target: any, nextRole?: string, nextStatus?: string) {
  if (target.role !== "Owner" || !isActiveMembership(target)) return;
  if (nextRole === "Owner" && nextStatus === "Active") return;
  const peers = await ctx.db.query("users")
    .withIndex("by_society", (q) => q.eq("societyId", target.societyId)).collect();
  if (!peers.some((peer) => peer._id !== target._id && peer.role === "Owner" && isActiveMembership(peer))) {
    throw new Error("Can't remove the last Active Owner — promote another active user to Owner first.");
  }
}

export async function requireMembershipManager(ctx: PortableQueryCtx, societyId: string, targetRole: string | undefined, nextRole: string | undefined, actingUserId?: string) {
  const { user } = await requireRolePortable(ctx, { societyId, required: "Admin", actingUserId });
  if (!user) throw new Error("Society membership not found.");
  if (user.role !== "Owner" && [targetRole, nextRole].some((role) => role === "Owner" || role === "Admin")) {
    throw new Error("Only an Owner can manage Owner or Admin authority.");
  }
  return user;
}

async function recordMembershipChange(ctx: PortableMutationCtx, societyId: string, actorId: string, targetId: string, action: string, detail?: string) {
  // The audit log shows `actor` verbatim, so store the person's name, not a row id.
  const localOwner = actorId.startsWith("local-workspace-owner:");
  const actorRow: any = localOwner ? null : await ctx.db.get(actorId, "users").catch(() => null);
  const actor = String(actorRow?.displayName || actorRow?.email || (localOwner ? "Workspace owner" : actorId));
  await ctx.db.insert("activity", { societyId, actor, entityType: "user", subjectId: targetId,
    entityId: targetId, action, summary: detail || `Workspace membership ${action}`, createdAtISO: new Date().toISOString() });
}

export async function setRolePortable(ctx: PortableMutationCtx, { id, role, actingUserId }: { id: string; role: string; actingUserId?: string }) {
  if (!ROLES.includes(role as Role)) throw new Error("Invalid workspace role.");
  const target = await requireOwnedRow(ctx, "users", id);
  const actor = await requireMembershipManager(ctx, target.societyId, target.role, role, actingUserId);
  await assertActiveOwnerRemains(ctx, target, role, target.status || "Active");
  await ctx.db.patch(id, { role });
  await recordMembershipChange(ctx, target.societyId, actor._id, id, "role-changed");
}

export async function upsertUserPortable(ctx: PortableMutationCtx, args: {
  id?: string; societyId: string; email: string; displayName: string; role: string; status: string;
  memberId?: string; directorId?: string; avatarColor?: string; actingUserId?: string;
}) {
  assertRoleAndStatus(args.role, args.status);
  const target = args.id ? await getOwned(ctx, "users", args.id, args.societyId) : undefined;
  const actor = await requireMembershipManager(ctx, args.societyId, target?.role, args.role, args.actingUserId);
  const roster = await ctx.db.query("users").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect();
  assertValid(validateWorkspaceUserInput(args, roster as any, target?._id));
  args = { ...args, email: args.email.trim(), displayName: args.displayName.trim() };
  if (args.memberId) await getOwned(ctx, "members", args.memberId, args.societyId);
  if (args.directorId) await getOwned(ctx, "directors", args.directorId, args.societyId);
  const fields = {
    societyId: args.societyId, email: args.email, displayName: args.displayName,
    role: args.role, status: args.status,
    ...(Object.hasOwn(args, "memberId") ? { memberId: args.memberId } : {}),
    ...(Object.hasOwn(args, "directorId") ? { directorId: args.directorId } : {}),
    ...(Object.hasOwn(args, "avatarColor") ? { avatarColor: args.avatarColor } : {}),
  };
  if (target) {
    await assertActiveOwnerRemains(ctx, target, args.role, args.status);
    await ctx.db.patch(target._id, fields);
    await recordMembershipChange(ctx, args.societyId, actor._id, target._id, "updated");
    return target._id;
  }
  const peers = await ctx.db.query("users").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).first();
  const localBootstrap = !peers && ctx.principal.assurance === "trusted-workspace";
  const userId = await ctx.db.insert("users", { ...fields,
    role: localBootstrap ? "Owner" : fields.role, status: localBootstrap ? "Active" : fields.status,
    createdAtISO: new Date().toISOString() });
  await recordMembershipChange(ctx, args.societyId, actor._id, userId, "created");
  return userId;
}

export async function removeUserPortable(ctx: PortableMutationCtx, { id, actingUserId }: { id: string; actingUserId?: string }) {
  const target = await requireOwnedRow(ctx, "users", id);
  await requireRolePortable(ctx, { societyId: target.societyId, required: "Owner", actingUserId });
  const actor = await requireMembershipManager(ctx, target.societyId, target.role, undefined, actingUserId);
  await assertActiveOwnerRemains(ctx, target);
  await ctx.db.delete(id);
  await recordMembershipChange(ctx, target.societyId, actor._id, id, "removed");
}

/** Explicit incident action: disabling a compromised sole Owner must take effect immediately. */
export async function securityDisableUserPortable(ctx: PortableMutationCtx, { id, reason }: { id: string; reason: string }) {
  if (!reason.trim()) throw new Error("A security incident reason is required.");
  const target = await requireOwnedRow(ctx, "users", id);
  const actor = await requireMembershipManager(ctx, target.societyId, target.role, undefined);
  await ctx.db.patch(id, { status: "Disabled" });
  const peers = await ctx.db.query("users").withIndex("by_society", (q) => q.eq("societyId", target.societyId)).collect();
  if (!peers.some((peer) => peer.role === "Owner" && isActiveMembership(peer))) {
    await ctx.db.patch(target.societyId, { accessRecoveryRequired: true });
  }
  await recordMembershipChange(ctx, target.societyId, actor._id, id, "security-disabled", `Security incident: ${reason.trim().slice(0, 1000)}`);
}

/**
 * Name shown for a workspace user. Workspaces created locally without a
 * privacy-officer name stored an empty displayName, which left the sidebar
 * user button, the Users table and per-row labels ("Role for ") blank.
 */
export function userDisplayName(row: { displayName?: unknown; email?: unknown }): string {
  return String(row.displayName ?? "").trim() || String(row.email ?? "").trim() || "Unnamed user";
}

function withDisplayName<T extends { displayName?: unknown; email?: unknown }>(row: T): T & { displayName: string } {
  return { ...row, displayName: userDisplayName(row) };
}

export async function usersList(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const rows = await ctx.db
    .query("users")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return rows.map(withDisplayName);
}

export async function userGet(ctx: PortableQueryCtx, { id }: { id: string }) {
  const target = await requireOwnedRow(ctx, "users", id);
  const actor = await requireSocietyMembership(ctx, target.societyId);
  if (actor._id !== target._id) await requirePermissionPortable(ctx, target.societyId, "users:read");
  return withDisplayName(target);
}

export async function userGetByEmail(ctx: PortableQueryCtx, { email }: { email: string }) {
  const rows = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .collect();
  for (const row of rows) {
    try {
      return await userGet(ctx, { id: row._id });
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
    if (!matchesVerifiedIdentity(row, ctx.principal)) continue;
    try {
      return await userGet(ctx, { id: row._id });
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
    (row) => row.societyId === args.societyId && matchesVerifiedIdentity(row, principal),
  );
  if (matchingBindings.length > 1) return { status: "ambiguous-binding" };

  const existing = matchingBindings[0];
  const now = new Date().toISOString();
  if (existing) {
    await assertExternalIdentityActive(ctx.db, existing);
    if (!isActiveMembership(existing)) return { status: "membership-disabled" };
    const profilePatch: Record<string, string> = { lastLoginAtISO: now };
    if (principal.email) profilePatch.email = principal.email;
    if (principal.name?.trim()) profilePatch.displayName = principal.name.trim();
    if (principal.emailVerified) profilePatch.emailVerifiedAtISO = now;
    await ctx.db.patch(existing._id, profilePatch);
    return { status: "bound", societyId: args.societyId, userId: existing._id };
  }

  if (!args.invitationToken) return { status: "needs-invitation" };
  const invitation = await findInvitation(ctx, args.invitationToken);
  if (!invitation) return { status: "invalid-invitation" };
  const unavailable = invitationAvailability(invitation);
  if (unavailable) return { status: unavailable } as MembershipResolution;
  if (!principal.emailVerified) return { status: "invitation-email-unverified" };
  if (!await invitationIssuerAuthorized(ctx, invitation)) return { status: "invitation-issuer-unavailable" };
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

  const externalIdentityId = await ensureExternalIdentityPortable(ctx, principal.issuer, principal.subject);
  const userId = await ctx.db.insert("users", {
    societyId: invitation.societyId,
    email: principal.email,
    displayName: principal.name?.trim() || principal.email,
    role: invitation.role,
    authProvider: principal.authProvider || principal.issuer,
    authSubject: principal.subject,
    authIssuer: principal.issuer,
    externalIdentityId,
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
  args: { userId: string; authSubject: string; authProvider: string; authIssuer: string },
): Promise<string> {
  const authSubject = args.authSubject;
  const authIssuer = args.authIssuer;
  if (!authIssuer?.trim()) throw new Error("Auth issuer is required.");
  if (!authSubject) throw new Error("Auth subject is required.");

  const target = await ctx.db.get<UserRow>(args.userId, "users");
  if (!target) throw new Error("users not found.");
  if (target.authSubject && target.authSubject !== authSubject) {
    throw new Error("User is already bound to a different auth subject.");
  }
  if (target.authIssuer && target.authIssuer !== authIssuer) throw new Error("User is already bound to a different auth issuer.");
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
  if (subjectBindings.some((row) => row._id !== target._id && row.societyId === target.societyId && row.authIssuer === authIssuer)) {
    throw new Error("Auth subject is already bound to another user.");
  }
  if (target.authSubject === authSubject && target.authIssuer === authIssuer && target.authProvider === args.authProvider && target.externalIdentityId) {
    return target._id;
  }

  const now = new Date().toISOString();
  const externalIdentityId = await ensureExternalIdentityPortable(ctx, authIssuer, authSubject);
  await ctx.db.patch(target._id, {
    authProvider: args.authProvider,
    authSubject,
    authIssuer,
    externalIdentityId,
  });
  await ctx.db.insert("activity", {
    societyId: target.societyId,
    actor: "API platform operator",
    entityType: "user",
    subjectId: target._id,
    entityId: target._id,
    action: "identity-bound",
    summary: `Bound ${args.authProvider} issuer ${authIssuer} subject ${authSubject} to ${target.displayName}`,
    createdAtISO: now,
  });
  return target._id;
}

export async function recordLoginPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const target = await requireOwnedRow(ctx, "users", id);
  const actor = await requireSocietyMembership(ctx, target.societyId);
  if (actor._id !== id) throw new Error("Authenticated actor does not match the current principal.");
  await ctx.db.patch(id, { lastLoginAtISO: new Date().toISOString() });
}

/** Operator-only migration with explicit mapping and provider-policy evidence. */
export async function migrateUserToClerkPortable(
  ctx: PortableMutationCtx,
  args: {
    userId: string;
    expectedAuthSubject: string;
    expectedAuthProvider?: string;
    expectedAuthIssuer?: string;
    authSubject: string;
    authIssuer: string;
    mappingEvidenceRef: string;
    identityPolicyEvidenceRef: string;
  },
): Promise<string> {
  const target = await ctx.db.get<UserRow>(args.userId, "users");
  if (!target) throw new Error("users not found.");
  if (target.authSubject !== args.expectedAuthSubject || target.authProvider !== args.expectedAuthProvider || target.authIssuer !== args.expectedAuthIssuer) {
    throw new Error("User identity changed; expected binding does not match.");
  }
  if (!args.authSubject.trim() || !args.authIssuer.trim()) throw new Error("Destination identity is required.");
  const identity = {
    kind: "user", runtime: "test", assurance: "verified-jwt",
    issuer: args.authIssuer, subject: args.authSubject, authProvider: "clerk",
  } as const;
  const peers = await ctx.db.query<UserRow>("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", identity.subject)).collect();
  if (peers.some((row) => row._id !== target._id && row.societyId === target.societyId && matchesAuthBinding(row, identity))) {
    throw new Error("Clerk identity is already bound within this society.");
  }
  if (!args.mappingEvidenceRef?.trim() || !args.identityPolicyEvidenceRef?.trim()
      || args.mappingEvidenceRef.length > 500 || args.identityPolicyEvidenceRef.length > 500) {
    throw new Error("Reviewed immutable identity mapping and Clerk account-linking policy evidence references are required.");
  }
  const externalIdentityId = await ensureExternalIdentityPortable(ctx, identity.issuer, identity.subject);
  await ctx.db.patch(target._id, {
    authProvider: "clerk", authIssuer: identity.issuer, authSubject: identity.subject, externalIdentityId,
    emailVerifiedAtISO: undefined,
  });
  await ctx.db.insert("activity", {
    societyId: target.societyId, actor: "API platform operator", entityType: "user",
    subjectId: target._id, entityId: target._id, action: "identity-migrated",
    summary: `Migrated ${target.displayName} from issuer ${target.authIssuer || "operator-reviewed legacy"} subject ${target.authSubject} to Clerk issuer ${identity.issuer} subject ${identity.subject}; mapping ${args.mappingEvidenceRef}; identity policy ${args.identityPolicyEvidenceRef}`,
    createdAtISO: new Date().toISOString(),
  });
  return target._id;
}

// Compatibility names used by the main workspace-access workflow.
export const userUpsertPortable = upsertUserPortable;
export const userRemovePortable = removeUserPortable;
