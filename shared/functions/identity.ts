import type { PortableDoc, PortableMutationCtx, PortablePrincipal } from "../portable/ctx";

export type IdentityBinding = Record<string, unknown> & { authIssuer?: string; authSubject?: string };

/** Email and provider labels are profile/configuration data, never identity keys. */
export function matchesVerifiedIdentity(row: IdentityBinding, principal: PortablePrincipal): boolean {
  return principal.kind === "user" && principal.assurance === "verified-jwt"
    && Boolean(principal.issuer) && Boolean(principal.subject)
    && row.authIssuer === principal.issuer && row.authSubject === principal.subject;
}

/** A person identity is separate from each society's users (membership) row. */
export async function ensureExternalIdentityPortable(
  ctx: PortableMutationCtx,
  issuer: string,
  subject: string,
): Promise<string> {
  if (!issuer.trim() || !subject.trim()) throw new Error("Auth issuer and subject are required.");
  const rows = await ctx.db.query("externalIdentities")
    .withIndex("by_issuer_subject", (q) => q.eq("issuer", issuer).eq("subject", subject)).collect();
  if (rows.length > 1) throw new Error("External identity binding is ambiguous.");
  if (rows[0]) {
    if (rows[0].status !== "Active") throw new Error("External identity is disabled.");
    return rows[0]._id;
  }
  return ctx.db.insert("externalIdentities", { issuer, subject, status: "Active", createdAtISO: new Date().toISOString() });
}

export async function assertExternalIdentityActive(
  db: { get(id: string, table?: string): Promise<PortableDoc | null> },
  row: IdentityBinding & { externalIdentityId?: string },
): Promise<void> {
  if (!row.externalIdentityId) return; // explicitly issuer-bound legacy rows can be reconciled by the operator
  const identity = await db.get(row.externalIdentityId, "externalIdentities");
  if (!identity || identity.status !== "Active" || identity.issuer !== row.authIssuer || identity.subject !== row.authSubject) {
    throw new Error("External identity is disabled or its binding is invalid.");
  }
}
