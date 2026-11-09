import type { PortableDbReader, PortableDoc, PortableMutationCtx, PortablePrincipal } from "../portable/ctx";

export type IdentityBinding = Record<string, unknown> & { authIssuer?: string; authSubject?: string };

/** An exact login identity. Never an email address or provider label. */
export type IdentityKey = { issuer: string; subject: string };
export type PersonAccountRow = PortableDoc & { status: "Active" | "Disabled" };
export type PersonLinkRow = PortableDoc & {
  personAccountId: string;
  externalIdentityId: string;
  issuer: string;
  subject: string;
  status: "Active" | "Unlinked";
  email?: string;
  displayName?: string;
  linkedAtISO: string;
};
export type PersonLinkState =
  | { kind: "none" }
  | { kind: "linked"; link: PersonLinkRow; person: PersonAccountRow }
  // Several Active links, or a Disabled person: follow nothing and refuse new links.
  | { kind: "blocked" };

export const sameIdentity = (a: IdentityKey, b: IdentityKey) => a.issuer === b.issuer && a.subject === b.subject;

export function bindingIdentity(row: IdentityBinding): IdentityKey | null {
  return row.authIssuer && row.authSubject ? { issuer: row.authIssuer, subject: row.authSubject } : null;
}

export async function personLinkState(db: PortableDbReader, key: IdentityKey): Promise<PersonLinkState> {
  const links = (await db.query<PersonLinkRow>("personIdentityLinks")
    .withIndex("by_issuer_subject", (q) => q.eq("issuer", key.issuer).eq("subject", key.subject))
    .collect()).filter((link) => link.status === "Active");
  if (!links.length) return { kind: "none" };
  if (links.length > 1) return { kind: "blocked" };
  const person = await db.get<PersonAccountRow>(links[0].personAccountId, "personAccounts");
  return person?.status === "Active" ? { kind: "linked", link: links[0], person } : { kind: "blocked" };
}

export async function activePersonLinks(db: PortableDbReader, personAccountId: string): Promise<PersonLinkRow[]> {
  return (await db.query<PersonLinkRow>("personIdentityLinks")
    .withIndex("by_person", (q) => q.eq("personAccountId", personAccountId))
    .collect()).filter((link) => link.status === "Active");
}

/** "missing" when no row exists yet; a duplicate row counts as disabled. */
export async function externalIdentityStatus(db: PortableDbReader, key: IdentityKey): Promise<"active" | "disabled" | "missing"> {
  const rows = await db.query("externalIdentities")
    .withIndex("by_issuer_subject", (q) => q.eq("issuer", key.issuer).eq("subject", key.subject)).collect();
  if (!rows.length) return "missing";
  return rows.length === 1 && rows[0].status === "Active" ? "active" : "disabled";
}

/**
 * Only a deployment-signed user session follows links. API tokens, gateway
 * service principals, local trusted-workspace principals and synthetic
 * principals (no session id) stay on their own exact identity.
 */
export function followsLinkedIdentities(principal: PortablePrincipal): boolean {
  return principal.kind === "user" && principal.assurance === "verified-jwt" && !principal.gatewayService
    && typeof principal.sessionEvidence?.sessionId === "string" && principal.sessionEvidence.sessionId.length > 0;
}

/**
 * The principal's own exact identity first, then every other identity proven
 * to belong to the same Active person whose external identity is Active.
 * Empty for anything but a verified user. A disabled own identity follows nothing.
 */
export async function linkedIdentityKeys(ctx: { db: PortableDbReader; principal: PortablePrincipal }): Promise<IdentityKey[]> {
  const principal = ctx.principal;
  if (principal.kind !== "user" || principal.assurance !== "verified-jwt" || !principal.issuer || !principal.subject) return [];
  const own = { issuer: principal.issuer, subject: principal.subject };
  if (!followsLinkedIdentities(principal)) return [own];
  const state = await personLinkState(ctx.db, own);
  if (state.kind !== "linked" || await externalIdentityStatus(ctx.db, own) !== "active") return [own];
  const keys: IdentityKey[] = [own];
  for (const link of await activePersonLinks(ctx.db, state.person._id)) {
    if (sameIdentity(link, own) || keys.some((key) => sameIdentity(key, link))) continue;
    const identity = await ctx.db.get(link.externalIdentityId, "externalIdentities");
    if (identity?.status === "Active" && identity.issuer === link.issuer && identity.subject === link.subject) {
      keys.push({ issuer: link.issuer, subject: link.subject });
    }
  }
  return keys;
}

/** Every membership row (any status) bound to one of these exact identities. */
export async function membershipsForIdentities<T extends PortableDoc>(db: PortableDbReader, keys: readonly IdentityKey[]): Promise<T[]> {
  const rows: T[] = [];
  for (const key of keys) {
    rows.push(...await db.query<T>("users")
      .withIndex("by_auth_identity", (q) => q.eq("authIssuer", key.issuer).eq("authSubject", key.subject))
      .collect());
  }
  return rows;
}

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

/** Compatibility name for existing Clerk callers; hosted comparison remains exact. */
export type AuthBinding = IdentityBinding & { authProvider?: string };
export function normalizeAuthIssuer(issuer: string): string { return issuer.trim(); }
export function matchesAuthBinding(binding: AuthBinding, principal: PortablePrincipal): boolean {
  if (principal.kind === "user" && principal.assurance === "trusted-workspace") return binding.authSubject === principal.subject;
  return matchesVerifiedIdentity(binding, principal);
}
