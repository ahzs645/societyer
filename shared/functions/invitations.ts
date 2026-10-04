/** Expiring, single-use invitations. Secrets are only returned at issuance. */
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, ROLES, type Role } from "./access";
import { ensureCurrentMembershipPortable, requireMembershipManager } from "./users";
import { findInvitation, hashInvitationToken, invitationAvailability, invitationIssuerAuthorized } from "./invitationTokens";

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireMembershipManager(ctx, societyId, undefined, undefined);
  const rows = await ctx.db.query("invitations").withIndex("by_society", (q) => q.eq("societyId", societyId)).order("desc").collect();
  return rows.map(({ token: _token, tokenHash: _hash, ...row }) => row);
}

export async function createPortable(ctx: PortableMutationCtx, args: { societyId: string; email: string; role: string; expiresInDays?: number }) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email.trim())) throw new Error("A valid email is required.");
  if (!ROLES.includes(args.role as Role)) throw new Error("Invalid invitation role.");
  const days = args.expiresInDays ?? 7;
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error("Invitation expiry must be between 1 and 30 days.");
  const inviter = await requireMembershipManager(ctx, args.societyId, undefined, args.role);
  const token = `inv_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
  const expiresAtISO = new Date(Date.now() + days * 86_400_000).toISOString();
  const id = await ctx.db.insert("invitations", {
    societyId: args.societyId, email: args.email.trim().toLowerCase(), role: args.role,
    tokenHash: await hashInvitationToken(token), expiresAtISO,
    invitedByUserId: inviter._id, createdAtISO: new Date().toISOString(),
  });
  return { id, token, expiresAtISO };
}

export async function revokePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const invitation = await ctx.db.get(id, "invitations");
  if (!invitation) throw new Error("Invitation not found.");
  await getOwned(ctx, "invitations", id, String(invitation.societyId));
  await requireMembershipManager(ctx, String(invitation.societyId), String(invitation.role), undefined);
  await ctx.db.patch(id, { revokedAtISO: new Date().toISOString() });
}

export async function getByTokenPortable(ctx: PortableQueryCtx, { token }: { token: string }) {
  const invitation = await findInvitation(ctx, token);
  if (!invitation || invitationAvailability(invitation)) return null;
  // Token lookup is only a preview; it never returns the stored credential or inviter identity.
  return { societyId: invitation.societyId, role: invitation.role, expiresAtISO: invitation.expiresAtISO };
}

export async function acceptPortable(ctx: PortableMutationCtx, { token }: { token: string }) {
  const invitation = await findInvitation(ctx, token);
  if (!invitation) return { status: "invalid-invitation" } as const;
  const unavailable = invitationAvailability(invitation);
  if (unavailable) return { status: unavailable };
  const principal = ctx.principal;
  if (principal.kind !== "user" || principal.assurance !== "verified-jwt" || !principal.issuer || !principal.subject) return { status: "unauthenticated" } as const;
  if (!await invitationIssuerAuthorized(ctx, invitation)) return { status: "invitation-issuer-unavailable" } as const;
  if (!principal.emailVerified) return { status: "invitation-email-unverified" } as const;
  if (!principal.email || principal.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()) return { status: "invitation-email-mismatch" } as const;
  const result = await ensureCurrentMembershipPortable(ctx, { societyId: invitation.societyId, invitationToken: token });
  if (result.status === "bound") {
    // Existing memberships never gain a new role merely by presenting an invitation.
    await ctx.db.patch(invitation._id, { acceptedAtISO: new Date().toISOString(), acceptedByUserId: result.userId });
    return { ...result, status: "invitation-accepted" } as const;
  }
  return result;
}
