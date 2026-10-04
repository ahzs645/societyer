import { isActiveMembership } from "./access";
import type { PortableDoc, PortableQueryCtx } from "../portable/ctx";

export type InvitationRow = PortableDoc & {
  societyId: string;
  email: string;
  role: string;
  token?: string;
  tokenHash?: string;
  invitedByUserId?: string;
  expiresAtISO?: string;
  acceptedAtISO?: string;
  revokedAtISO?: string;
};

export async function hashInvitationToken(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function findInvitation(ctx: PortableQueryCtx, token: string): Promise<InvitationRow | null> {
  if (!token || token.length > 256) return null;
  const tokenHash = await hashInvitationToken(token);
  const rows = await ctx.db.query<InvitationRow>("invitations")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .collect();
  // Existing plaintext invitations have no reviewed expiry and must be reissued.
  return rows.length === 1 ? rows[0] : null;
}

export function invitationAvailability(invitation: InvitationRow): string | null {
  if (invitation.revokedAtISO) return "invitation-revoked";
  if (invitation.acceptedAtISO) return "invitation-already-accepted";
  if (!invitation.expiresAtISO || !Number.isFinite(Date.parse(invitation.expiresAtISO)) || Date.parse(invitation.expiresAtISO) <= Date.now()) return "invitation-expired";
  return null;
}

export async function invitationIssuerAuthorized(ctx: PortableQueryCtx, invitation: InvitationRow): Promise<boolean> {
  const inviter = invitation.invitedByUserId ? await ctx.db.get(invitation.invitedByUserId, "users") : null;
  return Boolean(inviter && inviter.societyId === invitation.societyId && isActiveMembership(inviter) &&
    (inviter.role === "Owner" || (inviter.role === "Admin" && !["Owner", "Admin"].includes(invitation.role))));
}
