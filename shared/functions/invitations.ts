/** Expiring, single-use invitations. Secrets are only returned at issuance. */
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, ROLES, type Role } from "./access";
import { ensureCurrentMembershipPortable, requireMembershipManager } from "./users";
import { findInvitation, hashInvitationToken, invitationAvailability, invitationIssuerAuthorized, isShareLinkInvitation, LINK_INVITATION_ROLES } from "./invitationTokens";

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireMembershipManager(ctx, societyId, undefined, undefined);
  const rows = await ctx.db.query("invitations").withIndex("by_society", (q) => q.eq("societyId", societyId)).order("desc").take(200);
  return Promise.all(rows.map(async ({ token: _token, tokenHash: _hash, ...row }) => {
    // Share links admit whoever opens them, so show administrators who did.
    const acceptedBy = row.acceptedByUserId ? await ctx.db.get(String(row.acceptedByUserId), "users") : null;
    return { ...row, ...(acceptedBy?.societyId === societyId ? { acceptedBy: { displayName: acceptedBy.displayName, email: acceptedBy.email } } : {}) };
  }));
}

export async function createPortable(ctx: PortableMutationCtx, args: {
  societyId: string; email?: string; role: string; expiresInDays?: number; kind?: "email" | "link"; label?: string; targetUserId?: string;
}) {
  const shareLink = args.kind === "link";
  const email = (args.email ?? "").trim();
  if (shareLink) {
    if (email) throw new Error("A share link isn't tied to an email address; send an email invitation instead.");
    if (!(LINK_INVITATION_ROLES as readonly string[]).includes(args.role)) {
      throw new Error("Share links can grant Director, Member or Viewer. Invite Owners and Admins by email, or promote after they join.");
    }
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid email is required.");
  const label = args.label?.trim();
  if (label && label.length > 120) throw new Error("Keep the share link label under 120 characters.");
  if (!ROLES.includes(args.role as Role)) throw new Error("Invalid invitation role.");
  const days = args.expiresInDays ?? 7;
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error("Invitation expiry must be between 1 and 30 days.");
  const inviter = await requireMembershipManager(ctx, args.societyId, undefined, args.role);
  if (args.targetUserId) {
    const target = await ctx.db.get(args.targetUserId, "users");
    if (shareLink || !target || target.societyId !== args.societyId || String(target.email).trim().toLowerCase() !== email.toLowerCase() || target.authSubject || target.authIssuer || target.externalIdentityId || target.role !== args.role) throw new Error("Only an unbound user record with this email can be invited to join.");
    await requireMembershipManager(ctx, args.societyId, String(target.role), args.role);
    if (["Disabled", "Suspended"].includes(String(target.status))) throw new Error("Restore the user record before inviting it.");
  }
  const token = `inv_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
  const expiresAtISO = new Date(Date.now() + days * 86_400_000).toISOString();
  const id = await ctx.db.insert("invitations", {
    societyId: args.societyId, email: email.toLowerCase(), role: args.role,
    ...(args.targetUserId ? { targetUserId: args.targetUserId } : {}),
    ...(shareLink ? { kind: "link", ...(label ? { label } : {}) } : {}),
    tokenHash: await hashInvitationToken(token), expiresAtISO,
    invitedByUserId: inviter._id, createdAtISO: new Date().toISOString(), emailRequestedAtMs: Date.now(),
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
  const society = await ctx.db.get(invitation.societyId, "societies");
  return { societyId: invitation.societyId, workspaceName: String(society?.name ?? "this workspace"), role: invitation.role, expiresAtISO: invitation.expiresAtISO, kind: invitation.kind ?? "email", ...(invitation.email ? { email: invitation.email } : {}) };
}

export async function acceptPortable(ctx: PortableMutationCtx, { token }: { token: string }) {
  const invitation = await findInvitation(ctx, token);
  if (!invitation) return { status: "invalid-invitation" } as const;
  const unavailable = invitationAvailability(invitation);
  if (unavailable) return { status: unavailable };
  const principal = ctx.principal;
  if (principal.kind !== "user" || principal.assurance !== "verified-jwt" || !principal.issuer || !principal.subject) return { status: "unauthenticated" } as const;
  if (!await invitationIssuerAuthorized(ctx, invitation)) return { status: "invitation-issuer-unavailable" } as const;
  const shareLink = isShareLinkInvitation(invitation);
  if (!shareLink) {
    if (!principal.emailVerified) return { status: "invitation-email-unverified" } as const;
    if (!principal.email || principal.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()) return { status: "invitation-email-mismatch" } as const;
  }
  const result = await ensureCurrentMembershipPortable(ctx, { societyId: invitation.societyId, invitationToken: token });
  // A current member opening a share link leaves it unused for the person it was meant for.
  if (result.status === "bound" && shareLink) return result;
  if (result.status === "bound") {
    // Existing memberships never gain a new role merely by presenting an invitation.
    await ctx.db.patch(invitation._id, { acceptedAtISO: new Date().toISOString(), acceptedByUserId: result.userId });
    return { ...result, status: "invitation-accepted" } as const;
  }
  return result;
}

/** Account-level inbox: no workspace membership is needed, but the mailbox must be verified. */
export async function pendingForAccountPortable(ctx: PortableQueryCtx) {
  const p = ctx.principal;
  if (p.kind !== "user" || p.assurance !== "verified-jwt" || !p.issuer || !p.subject || !p.emailVerified || !p.email) return [];
  const rows = await ctx.db.query("invitations").withIndex("by_email", q => q.eq("email", p.email!.trim().toLowerCase())).order("desc").take(100);
  const available: Array<{ id: string; societyId: string; workspaceName: string; role: string; expiresAtISO: string }> = [];
  for (const row of rows) {
    if (isShareLinkInvitation(row as any) || invitationAvailability(row as any) || !await invitationIssuerAuthorized(ctx, row as any)) continue;
    const society = await ctx.db.get(String(row.societyId), "societies");
    if (society) available.push({ id: row._id, societyId: String(row.societyId), workspaceName: String(society.name), role: String(row.role), expiresAtISO: String(row.expiresAtISO) });
  }
  return available;
}

export async function acceptForAccountPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const p = ctx.principal;
  if (p.kind !== "user" || p.assurance !== "verified-jwt" || !p.issuer || !p.subject) return { status: "unauthenticated" } as const;
  const row = await ctx.db.get(id, "invitations");
  if (!row || isShareLinkInvitation(row as any)) return { status: "invalid-invitation" } as const;
  if (!p.emailVerified) return { status: "invitation-email-unverified" } as const;
  if (!p.email || p.email.trim().toLowerCase() !== String(row.email).trim().toLowerCase()) return { status: "invitation-email-mismatch" } as const;
  const unavailable = invitationAvailability(row as any);
  if (unavailable) return { status: unavailable };
  if (!await invitationIssuerAuthorized(ctx, row as any)) return { status: "invitation-issuer-unavailable" } as const;
  const result = await ensureCurrentMembershipPortable(ctx, { societyId: String(row.societyId), invitationId: id });
  if (result.status === "bound") {
    await ctx.db.patch(id, { acceptedAtISO: new Date().toISOString(), acceptedByUserId: result.userId });
    return { ...result, status: "invitation-accepted" } as const;
  }
  return result;
}

/** Rotate a link before re-emailing; old email links stop working. */
export async function resendPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const row = await ctx.db.get(id, "invitations");
  if (!row || isShareLinkInvitation(row as any)) throw new Error("Email invitation not found.");
  const actor = await requireMembershipManager(ctx, String(row.societyId), String(row.role), String(row.role));
  if (row.acceptedAtISO || row.revokedAtISO) throw new Error("Only an unused invitation can be resent.");
  if (typeof row.emailRequestedAtMs === "number" && Date.now() - row.emailRequestedAtMs < 60_000) throw new Error("Wait one minute before sending this invitation again.");
  const token = `inv_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
  const expiresAtISO = new Date(Date.now() + 7 * 86_400_000).toISOString();
  await ctx.db.patch(id, { token: undefined, tokenHash: await hashInvitationToken(token), invitedByUserId: actor._id, expiresAtISO, emailStatus: "queued", emailError: undefined, emailAcceptedAtISO: undefined, emailProvider: undefined, emailRequestedAtMs: Date.now() });
  return { id, token, expiresAtISO };
}
