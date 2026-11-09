/**
 * PORTABLE FUNCTIONS: personal account linking (accountLinks:*).
 *
 * Identity A begins from a fresh session and receives a short-lived code that
 * only that session sees. Identity B confirms with its own fresh session. Both
 * exact issuer/subject pairs then belong to one person account, and
 * `linkedIdentityKeys` lets either session reach memberships bound to the
 * other. Memberships themselves are never rebound, created or reactivated.
 * See docs/shared-workspaces/architecture.md.
 *
 * Hosted only: local runtimes have no deployment-signed session to prove.
 */
import type { PortableDbReader, PortableDoc, PortableMutationCtx, PortablePrincipal, PortableQueryCtx } from "../portable/ctx";
import {
  activePersonLinks, ensureExternalIdentityPortable, externalIdentityStatus, membershipsForIdentities, personLinkState, sameIdentity,
  type IdentityKey, type PersonLinkRow, type PersonLinkState,
} from "./identity";

export const LINK_CODE_TTL_MS = 10 * 60_000;
export const FRESH_SESSION_MS = 15 * 60_000;
const CLOCK_SKEW_MS = 60_000;
const CODE = /^[A-Za-z0-9_-]{43}$/;

type SignedInIdentity = IdentityKey & { email?: string; name?: string };
type LinkRequestRow = PortableDoc & {
  codeHash: string;
  initiatorIssuer: string;
  initiatorSubject: string;
  initiatorEmail?: string;
  initiatorName?: string;
  status: "pending" | "completed" | "cancelled";
  createdAtMs: number;
  expiresAtMs: number;
};
type MembershipRow = PortableDoc & { societyId: string; role?: string; status?: string };

export type LinkWorkspace = { name: string; role: string; status: string };
export type LinkParty = { email?: string; name?: string; workspaces: LinkWorkspace[] };
export type LinkConflict = { workspaceName: string };
export type LinkFailure =
  | { status: "invalid" | "expired" | "same-account" | "already-linked" | "reauthentication-required" | "identity-disabled" | "unauthenticated" }
  | { status: "conflict"; conflicts: LinkConflict[] };
export type BeginResult =
  | { status: "started"; code: string; expiresAtISO: string }
  | { status: "reauthentication-required" | "identity-disabled" | "unauthenticated" };
export type PreviewResult = { status: "ready"; initiator: LinkParty; current: LinkParty; conflicts: [] } | LinkFailure;
export type ConfirmResult = { status: "linked" } | LinkFailure;
export type OverviewIdentity = {
  issuer: string; subject: string; email?: string; name?: string; current: boolean; linkedAtISO?: string;
  workspaces: Array<{ societyId: string; name: string; role: string; status: string }>;
};

/** Only a deployment-signed user session can take part; API tokens and gateway principals can't. */
function signedInIdentity(principal: PortablePrincipal): SignedInIdentity | null {
  if (principal.kind !== "user" || principal.assurance !== "verified-jwt" || principal.gatewayService
    || !principal.issuer || !principal.subject || !principal.sessionEvidence?.sessionId) return null;
  return {
    issuer: principal.issuer, subject: principal.subject,
    ...(principal.email ? { email: principal.email } : {}), ...(principal.name?.trim() ? { name: principal.name.trim() } : {}),
  };
}

/** The session's own sign-in (not a token refresh) happened in the last 15 minutes. */
export function sessionIsFresh(principal: PortablePrincipal, now = Date.now()): boolean {
  const at = principal.kind === "user" ? principal.sessionEvidence?.authenticatedAt : undefined;
  return typeof at === "number" && Number.isFinite(at) && at <= now + CLOCK_SKEW_MS && now - at <= FRESH_SESSION_MS;
}

function newLinkCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hashLinkCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function findRequest(db: PortableDbReader, code: unknown): Promise<LinkRequestRow | null> {
  if (typeof code !== "string" || !CODE.test(code)) return null;
  const codeHash = await hashLinkCode(code);
  const rows = await db.query<LinkRequestRow>("accountLinkRequests").withIndex("by_code_hash", (q) => q.eq("codeHash", codeHash)).take(2);
  return rows.length === 1 ? rows[0] : null;
}

type Side = { key: IdentityKey; state: PersonLinkState; keys: IdentityKey[] };

/** Everything that would join the resulting person from one side: its whole person when it has one. */
async function sideOf(db: PortableDbReader, key: IdentityKey): Promise<Side> {
  const state = await personLinkState(db, key);
  const keys: IdentityKey[] = [key];
  if (state.kind === "linked") {
    for (const link of await activePersonLinks(db, state.person._id)) {
      if (!keys.some((known) => sameIdentity(known, link))) keys.push({ issuer: link.issuer, subject: link.subject });
    }
  }
  return { key, state, keys };
}

async function workspacesOf(db: PortableDbReader, keys: readonly IdentityKey[]) {
  const rows = await membershipsForIdentities<MembershipRow>(db, keys);
  return Promise.all(rows.map(async (row) => ({
    societyId: row.societyId,
    name: String((await db.get(row.societyId, "societies"))?.name ?? "Unknown workspace"),
    role: String(row.role ?? ""),
    status: String(row.status || "Active"),
  })));
}

/** Workspaces where the joined identities would hold more than one membership, of any status. */
async function conflictsOf(db: PortableDbReader, keys: readonly IdentityKey[]): Promise<LinkConflict[]> {
  const counts = new Map<string, { name: string; count: number }>();
  for (const workspace of await workspacesOf(db, keys)) {
    const entry = counts.get(workspace.societyId) ?? { name: workspace.name, count: 0 };
    counts.set(workspace.societyId, { ...entry, count: entry.count + 1 });
  }
  return [...counts.values()].filter((entry) => entry.count > 1).map((entry) => ({ workspaceName: entry.name }));
}

async function partyOf(db: PortableDbReader, side: Side, email?: string, name?: string): Promise<LinkParty> {
  const workspaces = (await workspacesOf(db, side.keys)).map(({ name: workspaceName, role, status }) => ({ name: workspaceName, role, status }));
  return { ...(email ? { email } : {}), ...(name ? { name } : {}), workspaces };
}

type Evaluation =
  | { ok: false; result: LinkFailure; request?: LinkRequestRow; me?: SignedInIdentity; keys?: IdentityKey[] }
  | { ok: true; request: LinkRequestRow; me: SignedInIdentity; initiator: Side; current: Side };

/** Every check shared by preview and confirm, cheapest and least revealing first. */
async function evaluate(ctx: PortableQueryCtx, code: unknown, now: number): Promise<Evaluation> {
  const me = signedInIdentity(ctx.principal);
  if (!me) return { ok: false, result: { status: "unauthenticated" } };
  const request = await findRequest(ctx.db, code);
  if (!request || request.status !== "pending") return { ok: false, result: { status: "invalid" } };
  if (request.expiresAtMs <= now) return { ok: false, result: { status: "expired" } };
  const initiatorKey = { issuer: request.initiatorIssuer, subject: request.initiatorSubject };
  if (sameIdentity(initiatorKey, me)) return { ok: false, result: { status: "same-account" } };
  if (!sessionIsFresh(ctx.principal, now)) return { ok: false, result: { status: "reauthentication-required" } };
  const [initiator, current] = await Promise.all([sideOf(ctx.db, initiatorKey), sideOf(ctx.db, me)]);
  const keys = [...initiator.keys, ...current.keys.filter((key) => !initiator.keys.some((known) => sameIdentity(known, key)))];
  const statuses = await Promise.all([externalIdentityStatus(ctx.db, initiatorKey), externalIdentityStatus(ctx.db, me)]);
  if (statuses.includes("disabled") || initiator.state.kind === "blocked" || current.state.kind === "blocked") {
    return { ok: false, result: { status: "identity-disabled" }, request, me, keys };
  }
  if (initiator.state.kind === "linked" && current.state.kind === "linked" && initiator.state.person._id === current.state.person._id) {
    return { ok: false, result: { status: "already-linked" } };
  }
  const conflicts = await conflictsOf(ctx.db, keys);
  if (conflicts.length) return { ok: false, result: { status: "conflict", conflicts }, request, me, keys };
  return { ok: true, request, me, initiator, current };
}

async function recordEvent(ctx: PortableMutationCtx, event: {
  action: "linked" | "unlinked" | "refused"; personAccountId?: string; actor: IdentityKey; identities: readonly IdentityKey[]; reason?: string;
}) {
  await ctx.db.insert("accountLinkEvents", {
    action: event.action,
    ...(event.personAccountId ? { personAccountId: event.personAccountId } : {}),
    actorIssuer: event.actor.issuer, actorSubject: event.actor.subject,
    identities: event.identities.map(({ issuer, subject }) => ({ issuer, subject })),
    ...(event.reason ? { reason: event.reason } : {}),
    createdAtISO: new Date().toISOString(),
  });
}

export async function beginPortable(ctx: PortableMutationCtx): Promise<BeginResult> {
  const me = signedInIdentity(ctx.principal);
  if (!me) return { status: "unauthenticated" };
  const now = Date.now();
  if (!sessionIsFresh(ctx.principal, now)) return { status: "reauthentication-required" };
  if (await externalIdentityStatus(ctx.db, me) === "disabled" || (await personLinkState(ctx.db, me)).kind === "blocked") {
    return { status: "identity-disabled" };
  }
  // One live code per identity. Old finished rows only cost storage; drop them.
  const earlier = await ctx.db.query<LinkRequestRow>("accountLinkRequests")
    .withIndex("by_initiator", (q) => q.eq("initiatorIssuer", me.issuer).eq("initiatorSubject", me.subject)).take(100);
  for (const row of earlier) {
    if (row.status === "pending" && row.expiresAtMs > now) await ctx.db.patch(row._id, { status: "cancelled" });
    else if (row.expiresAtMs < now - 86_400_000) await ctx.db.delete(row._id);
  }
  const code = newLinkCode();
  const expiresAtMs = now + LINK_CODE_TTL_MS;
  await ctx.db.insert("accountLinkRequests", {
    codeHash: await hashLinkCode(code),
    initiatorIssuer: me.issuer, initiatorSubject: me.subject,
    ...(me.email ? { initiatorEmail: me.email } : {}), ...(me.name ? { initiatorName: me.name } : {}),
    status: "pending", createdAtMs: now, expiresAtMs,
  });
  return { status: "started", code, expiresAtISO: new Date(expiresAtMs).toISOString() };
}

export async function previewPortable(ctx: PortableQueryCtx, { code }: { code: string }): Promise<PreviewResult> {
  const evaluation = await evaluate(ctx, code, Date.now());
  if (!evaluation.ok) return evaluation.result;
  const { request, me, initiator, current } = evaluation;
  return {
    status: "ready",
    initiator: await partyOf(ctx.db, initiator, request.initiatorEmail, request.initiatorName),
    current: await partyOf(ctx.db, current, me.email, me.name),
    conflicts: [],
  };
}

export async function confirmPortable(ctx: PortableMutationCtx, { code }: { code: string }): Promise<ConfirmResult> {
  const now = Date.now();
  const evaluation = await evaluate(ctx, code, now);
  if (!evaluation.ok) {
    const { result, request, me, keys } = evaluation;
    if (request && me && keys && (result.status === "conflict" || result.status === "identity-disabled")) {
      // A refused link is final for this code; the person starts again after fixing it.
      await ctx.db.patch(request._id, { status: "cancelled" });
      await recordEvent(ctx, { action: "refused", actor: me, identities: keys, reason: result.status });
    }
    return result;
  }
  const { request, me, initiator, current } = evaluation;
  const nowISO = new Date(now).toISOString();
  const addLink = async (personAccountId: string, key: IdentityKey, email?: string, displayName?: string) => {
    const externalIdentityId = await ensureExternalIdentityPortable(ctx, key.issuer, key.subject);
    await ctx.db.insert("personIdentityLinks", {
      personAccountId, externalIdentityId, issuer: key.issuer, subject: key.subject, status: "Active",
      ...(email ? { email } : {}), ...(displayName ? { displayName } : {}), linkedAtISO: nowISO,
    });
  };

  let personAccountId: string;
  if (initiator.state.kind === "linked") {
    personAccountId = initiator.state.person._id;
    if (current.state.kind === "linked") {
      // Two people become one: B's links move to A's person, B's person is retired.
      for (const link of await activePersonLinks(ctx.db, current.state.person._id)) {
        await ctx.db.patch(link._id, { personAccountId });
      }
      await ctx.db.patch(current.state.person._id, { status: "Disabled", updatedAtISO: nowISO });
    } else {
      await addLink(personAccountId, me, me.email, me.name);
    }
  } else if (current.state.kind === "linked") {
    personAccountId = current.state.person._id;
    await addLink(personAccountId, initiator.key, request.initiatorEmail, request.initiatorName);
  } else {
    personAccountId = await ctx.db.insert("personAccounts", { status: "Active", createdAtISO: nowISO, updatedAtISO: nowISO });
    await addLink(personAccountId, initiator.key, request.initiatorEmail, request.initiatorName);
    await addLink(personAccountId, me, me.email, me.name);
  }
  await ctx.db.patch(personAccountId, { updatedAtISO: nowISO });
  await ctx.db.patch(request._id, { status: "completed", completedAtISO: nowISO, targetIssuer: me.issuer, targetSubject: me.subject });
  const members = await activePersonLinks(ctx.db, personAccountId);
  await recordEvent(ctx, { action: "linked", personAccountId, actor: me, identities: members });
  return { status: "linked" };
}

export async function cancelPortable(ctx: PortableMutationCtx, { code }: { code: string }): Promise<{ status: "cancelled" | "invalid" | "unauthenticated" }> {
  if (!signedInIdentity(ctx.principal)) return { status: "unauthenticated" };
  const request = await findRequest(ctx.db, code);
  if (!request || request.status !== "pending") return { status: "invalid" };
  await ctx.db.patch(request._id, { status: "cancelled" });
  return { status: "cancelled" };
}

/** Only identities inside the caller's own person are described. */
export async function overviewPortable(ctx: PortableQueryCtx): Promise<{ identities: OverviewIdentity[] }> {
  const me = signedInIdentity(ctx.principal);
  if (!me) return { identities: [] };
  const state = await personLinkState(ctx.db, me);
  const links: PersonLinkRow[] = state.kind === "linked" ? await activePersonLinks(ctx.db, state.person._id) : [];
  const own = links.find((link) => sameIdentity(link, me));
  const entries: OverviewIdentity[] = [];
  const describe = async (key: IdentityKey, current: boolean, email?: string, name?: string, linkedAtISO?: string) => {
    const workspaces = await workspacesOf(ctx.db, [key]);
    entries.push({ issuer: key.issuer, subject: key.subject, current, workspaces,
      ...(email ? { email } : {}), ...(name ? { name } : {}), ...(linkedAtISO ? { linkedAtISO } : {}) });
  };
  await describe(me, true, me.email, me.name, own?.linkedAtISO);
  for (const link of links) {
    if (!sameIdentity(link, me)) await describe(link, false, link.email, link.displayName, link.linkedAtISO);
  }
  return { identities: entries };
}

export async function unlinkPortable(ctx: PortableMutationCtx, args: IdentityKey): Promise<{ status: "unlinked" | "not-linked" | "unauthenticated" }> {
  const me = signedInIdentity(ctx.principal);
  if (!me) return { status: "unauthenticated" };
  const state = await personLinkState(ctx.db, me);
  if (state.kind !== "linked") return { status: "not-linked" };
  const links = await activePersonLinks(ctx.db, state.person._id);
  const target = links.find((link) => sameIdentity(link, args));
  if (!target) return { status: "not-linked" };
  const nowISO = new Date().toISOString();
  await ctx.db.patch(target._id, { status: "Unlinked", unlinkedAtISO: nowISO });
  const remaining = links.filter((link) => link._id !== target._id);
  // A person needs two identities; a lone survivor is simply its own account again.
  const removePerson = remaining.length < 2;
  if (removePerson) {
    for (const link of remaining) await ctx.db.patch(link._id, { status: "Unlinked", unlinkedAtISO: nowISO });
    await ctx.db.patch(state.person._id, { status: "Disabled", updatedAtISO: nowISO });
  } else {
    await ctx.db.patch(state.person._id, { updatedAtISO: nowISO });
  }
  await recordEvent(ctx, {
    action: "unlinked", personAccountId: state.person._id, actor: me,
    identities: removePerson ? [target, ...remaining] : [target], ...(removePerson ? { reason: "person-removed" } : {}),
  });
  return { status: "unlinked" };
}
