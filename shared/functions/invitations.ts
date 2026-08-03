/**
 * PORTABLE FUNCTIONS: the invitations domain
 * (list / create / revoke / getByToken / accept).
 *
 * Reads/writes the `invitations` table over `ctx.db`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { ROLES, canActAs, resolvePrincipalUser, type Role } from "./access";
import { ensureCurrentMembershipPortable } from "./users";

async function requireInvitationManager(
  ctx: PortableQueryCtx,
  societyId: string,
) {
  const user = await resolvePrincipalUser(ctx, societyId);
  if (!user || user.status === "Disabled") throw new Error("Authentication required.");
  if (!canActAs(user.role as Role, "Admin")) throw new Error("Role Admin required.");
  return user;
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireInvitationManager(ctx, societyId);
  return ctx.db
    .query("invitations")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .order("desc")
    .collect();
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    email: string;
    role: string;
  },
) {
  if (!args.email.trim()) throw new Error("Email is required");
  if (!ROLES.includes(args.role as Role)) throw new Error("Invalid invitation role.");
  const invitingUser = await requireInvitationManager(ctx, args.societyId);
  const token = `inv_${crypto.randomUUID().replace(/-/g, "")}`;
  return ctx.db.insert("invitations", {
    ...args,
    email: args.email.trim().toLowerCase(),
    token,
    invitedByUserId: invitingUser._id,
    createdAtISO: new Date().toISOString(),
  });
}

export async function revokePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const invitation = await ctx.db.get(id);
  if (!invitation) throw new Error("Invitation not found.");
  await requireInvitationManager(ctx, String(invitation.societyId));
  await ctx.db.patch(id, { revokedAtISO: new Date().toISOString() });
}

export async function getByTokenPortable(ctx: PortableQueryCtx, { token }: { token: string }) {
  return ctx.db
    .query("invitations")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
}

export async function acceptPortable(
  ctx: PortableMutationCtx,
  { token }: { token: string },
) {
  const invitations = await ctx.db
    .query("invitations")
    .withIndex("by_token", (q) => q.eq("token", token))
    .collect();
  if (invitations.length !== 1) return { status: "invalid-invitation" } as const;
  const invitation = invitations[0];
  if (invitation.revokedAtISO) return { status: "invitation-revoked" } as const;
  if (invitation.acceptedAtISO) return { status: "invitation-already-accepted" } as const;

  const principal = ctx.principal;
  if (
    principal.kind !== "user" ||
    principal.assurance !== "verified-jwt" ||
    !principal.issuer ||
    !principal.subject
  ) {
    return { status: "unauthenticated" } as const;
  }
  if (
    !principal.email ||
    principal.email.toLowerCase() !== String(invitation.email).toLowerCase()
  ) {
    return { status: "invitation-email-mismatch" } as const;
  }

  const societyId = String(invitation.societyId);
  const existing = await ensureCurrentMembershipPortable(ctx, { societyId });
  if (existing.status === "bound") {
    const now = new Date().toISOString();
    await ctx.db.patch(invitation._id, {
      acceptedAtISO: now,
      acceptedByUserId: existing.userId,
    });
    return {
      status: "invitation-accepted",
      societyId,
      userId: existing.userId,
    } as const;
  }
  if (existing.status !== "needs-invitation") return existing;
  return ensureCurrentMembershipPortable(ctx, { societyId, invitationToken: token });
}
