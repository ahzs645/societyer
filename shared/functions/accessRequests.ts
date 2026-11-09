/**
 * PORTABLE FUNCTIONS: self-service workspace access requests (accessRequests:*).
 *
 * A signed-in person who isn't a member can ask to join a workspace they
 * reached through its verified domain, when that workspace allows requests.
 * The workspace's Owners and Admins approve or decline. Approval creates one
 * Active `users` membership bound to the exact issuer/subject that asked; the
 * workspace's sign-in policy and MFA still apply to every later session.
 * See docs/shared-workspaces/architecture.md ("Access requests").
 *
 * Hosted only: local runtimes have no deployment-signed session to bind.
 */
import type { PortableDbReader, PortableDoc, PortableMutationCtx, PortablePrincipal, PortableQueryCtx } from "../portable/ctx";
import { isActiveMembership, ROLES, type Role } from "./access";
import {
  activePersonLinks, ensureExternalIdentityPortable, externalIdentityStatus, linkedIdentityKeys, membershipsForIdentities,
  personLinkState, sameIdentity, type IdentityKey,
} from "./identity";
import { requireMembershipManager } from "./users";
import { activeWorkspaceDomain, type WorkspaceDomainRow } from "../workspaceDomains";

export const ACCESS_REQUEST_TEXT_LIMIT = 500;
/** New requests one identity may send in 24 hours, across every workspace. */
export const ACCESS_REQUEST_DAILY_LIMIT = 5;
/** Pending requests one workspace holds before new ones are refused. */
export const ACCESS_REQUEST_PENDING_LIMIT = 100;
export const ACCESS_REQUEST_DEFAULT_ROLES = ["Viewer", "Member"] as const;
/** Owner is never granted from a request; promote after joining. */
export const ACCESS_REQUEST_APPROVAL_ROLES = ["Admin", "Director", "Member", "Viewer"] as const;
const DAY_MS = 86_400_000;
const DECLINED_VISIBLE_MS = 30 * DAY_MS;
const NOTIFIED_APPROVERS_LIMIT = 25;

export type AccessRequestStatus = "pending" | "approved" | "declined" | "withdrawn";
export type AccessRequestDefaultRole = (typeof ACCESS_REQUEST_DEFAULT_ROLES)[number];

type SettingsRow = PortableDoc & {
  societyId: string; enabled: boolean; defaultRole: AccessRequestDefaultRole; message?: string;
  updatedAtISO: string; updatedByUserId: string;
};
type RequestRow = PortableDoc & {
  societyId: string; requesterIssuer: string; requesterSubject: string; requesterAuthProvider?: string;
  email?: string; emailVerified: boolean; name?: string; note?: string; status: AccessRequestStatus;
  createdAtISO: string; decidedAtISO?: string; decidedByUserId?: string; grantedRole?: string; membershipId?: string;
};
type MembershipRow = PortableDoc & { societyId: string; email?: string; displayName?: string; role?: string; status?: string; authSubject?: string };
type Requester = IdentityKey & { authProvider?: string; email?: string; emailVerified: boolean; name?: string };

export type Availability =
  | { enabled: false }
  | { enabled: true; message?: string; alreadyMember: boolean; existing?: { id: string; status: AccessRequestStatus; createdAtISO: string } };
export type SubmitResult =
  | { status: "requested" | "already-requested"; id: string; createdAtISO: string }
  | { status: "unavailable" | "already-member" | "rate-limited" | "email-unverified" | "identity-disabled" | "unauthenticated" };
export type ApproveResult =
  | { status: "approved"; membershipId: string }
  | { status: "not-pending" | "already-member" | "identity-disabled" | "email-in-use" };

/** Only a deployment-signed user session can ask; API tokens and gateway principals can't. */
function signedInRequester(principal: PortablePrincipal): Requester | null {
  if (principal.kind !== "user" || principal.assurance !== "verified-jwt" || principal.gatewayService || principal.societyId
    || !principal.issuer || !principal.subject || !principal.sessionEvidence?.sessionId) return null;
  const email = principal.email?.trim().toLowerCase();
  const name = principal.name?.trim();
  return {
    issuer: principal.issuer, subject: principal.subject, emailVerified: principal.emailVerified === true,
    ...(principal.authProvider ? { authProvider: principal.authProvider } : {}),
    ...(email ? { email } : {}), ...(name ? { name: name.slice(0, 200) } : {}),
  };
}

function cleanText(value: string | undefined, label: string): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (text.length > ACCESS_REQUEST_TEXT_LIMIT) throw new Error(`Keep the ${label} under ${ACCESS_REQUEST_TEXT_LIMIT} characters.`);
  return text;
}

async function settingsFor(db: PortableDbReader, societyId: string): Promise<SettingsRow | null> {
  const rows = await db.query<SettingsRow>("workspaceAccessRequestSettings")
    .withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  // Duplicate rows are an error: fail closed.
  return rows.length === 1 ? rows[0] : null;
}

/**
 * The workspace's Active, trusted, unambiguous domain, if any. This is the
 * only way a non-member can name a workspace, so without one nothing is shown.
 */
export async function requestableOrigin(db: PortableDbReader, societyId: string, trustedOrigins: readonly string[]): Promise<string | null> {
  const rows = await db.query<WorkspaceDomainRow>("workspaceDomains")
    .withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  const candidates = rows.filter((row) => row.status === "Active" && trustedOrigins.includes(row.origin))
    .sort((a, b) => Number(b.primary) - Number(a.primary));
  for (const row of candidates) {
    if ((await activeWorkspaceDomain(db, row.origin))?.societyId === societyId) return row.origin;
  }
  return null;
}

/** Requests are open only with an opt-in row AND a verified domain that names the workspace. */
async function openForRequests(db: PortableDbReader, societyId: string, trustedOrigins: readonly string[]): Promise<SettingsRow | null> {
  const settings = await settingsFor(db, societyId);
  if (!settings?.enabled) return null;
  if (!await db.get(societyId, "societies")) return null;
  return await requestableOrigin(db, societyId, trustedOrigins) ? settings : null;
}

/** The identity plus every identity proven to belong to the same Active person (as linkedIdentityKeys). */
async function identityKeysFor(db: PortableDbReader, own: IdentityKey): Promise<IdentityKey[]> {
  const state = await personLinkState(db, own);
  if (state.kind !== "linked" || await externalIdentityStatus(db, own) !== "active") return [own];
  const keys: IdentityKey[] = [own];
  for (const link of await activePersonLinks(db, state.person._id)) {
    if (keys.some((key) => sameIdentity(key, link))) continue;
    const identity = await db.get(link.externalIdentityId, "externalIdentities");
    if (identity?.status === "Active" && identity.issuer === link.issuer && identity.subject === link.subject) {
      keys.push({ issuer: link.issuer, subject: link.subject });
    }
  }
  return keys;
}

/** Any membership row, of any status, in this workspace. A Disabled member goes through an administrator. */
async function hasMembership(db: PortableDbReader, keys: readonly IdentityKey[], societyId: string): Promise<boolean> {
  return (await membershipsForIdentities<MembershipRow>(db, keys)).some((row) => row.societyId === societyId);
}

async function requesterRows(db: PortableDbReader, key: IdentityKey, sinceISO?: string): Promise<RequestRow[]> {
  return db.query<RequestRow>("workspaceAccessRequests")
    .withIndex("by_requester", (q) => {
      const base = q.eq("requesterIssuer", key.issuer).eq("requesterSubject", key.subject);
      return sinceISO ? base.gte("createdAtISO", sinceISO) : base;
    })
    .order("desc").take(200);
}

/** Can the signed-in person ask to join this workspace? Reveals nothing unless the workspace is open for requests. */
export async function availabilityPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }, trustedOrigins: readonly string[]): Promise<Availability> {
  const requester = signedInRequester(ctx.principal);
  if (!requester) return { enabled: false };
  const settings = await openForRequests(ctx.db, societyId, trustedOrigins);
  if (!settings) return { enabled: false };
  const alreadyMember = await hasMembership(ctx.db, await linkedIdentityKeys(ctx), societyId);
  const latest = (await requesterRows(ctx.db, requester)).find((row) => row.societyId === societyId && row.status !== "withdrawn");
  return {
    enabled: true, alreadyMember,
    ...(settings.message ? { message: settings.message } : {}),
    ...(latest ? { existing: { id: latest._id, status: latest.status, createdAtISO: latest.createdAtISO } } : {}),
  };
}

export async function submitPortable(ctx: PortableMutationCtx, args: { societyId: string; note?: string }, trustedOrigins: readonly string[]): Promise<SubmitResult> {
  const requester = signedInRequester(ctx.principal);
  if (!requester) return { status: "unauthenticated" };
  const note = cleanText(args.note, "note");
  const settings = await openForRequests(ctx.db, args.societyId, trustedOrigins);
  if (!settings) return { status: "unavailable" };
  // Approvers decide on the email shown, so it must be one the session proved.
  if (!requester.email || !requester.emailVerified) return { status: "email-unverified" };
  if (await externalIdentityStatus(ctx.db, requester) === "disabled") return { status: "identity-disabled" };
  if (await hasMembership(ctx.db, await linkedIdentityKeys(ctx), args.societyId)) return { status: "already-member" };

  const now = Date.now();
  const recent = await requesterRows(ctx.db, requester, new Date(now - DAY_MS).toISOString());
  const pending = (await requesterRows(ctx.db, requester)).find((row) => row.societyId === args.societyId && row.status === "pending");
  if (pending) return { status: "already-requested", id: pending._id, createdAtISO: pending.createdAtISO };
  if (recent.length >= ACCESS_REQUEST_DAILY_LIMIT) return { status: "rate-limited" };
  const queued = await ctx.db.query<RequestRow>("workspaceAccessRequests")
    .withIndex("by_society_status", (q) => q.eq("societyId", args.societyId).eq("status", "pending"))
    .take(ACCESS_REQUEST_PENDING_LIMIT);
  if (queued.length >= ACCESS_REQUEST_PENDING_LIMIT) return { status: "rate-limited" };

  const createdAtISO = new Date(now).toISOString();
  const id = await ctx.db.insert("workspaceAccessRequests", {
    societyId: args.societyId, requesterIssuer: requester.issuer, requesterSubject: requester.subject,
    ...(requester.authProvider ? { requesterAuthProvider: requester.authProvider } : {}),
    ...(requester.email ? { email: requester.email } : {}), emailVerified: requester.emailVerified,
    ...(requester.name ? { name: requester.name } : {}), ...(note ? { note } : {}),
    status: "pending", createdAtISO,
  });
  const who = requesterLabel(requester);
  await ctx.db.insert("activity", {
    societyId: args.societyId, actor: who, entityType: "accessRequest", entityId: id, subjectId: id,
    action: "access-requested", summary: `${who} asked to join this workspace`, createdAtISO,
  });
  // In-app notice for each Active Owner and Admin. The note stays on the Users page.
  for (const approver of await activeApprovers(ctx.db, args.societyId)) {
    await ctx.db.insert("notifications", {
      societyId: args.societyId, userId: approver._id, kind: "general", severity: "info",
      title: `${who} asked to join`, body: "Approve or decline under Users & access.", linkHref: "/app/users",
      createdAtISO,
    });
  }
  return { status: "requested", id, createdAtISO };
}

/** Verified email when there is one; otherwise nothing the requester typed. */
function requesterLabel(row: { email?: string; emailVerified: boolean }): string {
  return row.email && row.emailVerified ? row.email : "A signed-in person";
}

/** Active, bound Owners and Admins of a workspace. */
export async function activeApprovers(db: PortableDbReader, societyId: string): Promise<MembershipRow[]> {
  const rows = await db.query<MembershipRow>("users").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  return rows.filter((row) => (row.role === "Owner" || row.role === "Admin") && isActiveMembership(row) && row.authSubject)
    .slice(0, NOTIFIED_APPROVERS_LIMIT);
}

export async function withdrawPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const requester = signedInRequester(ctx.principal);
  if (!requester) return { status: "unauthenticated" } as const;
  const row = await ctx.db.get<RequestRow>(id, "workspaceAccessRequests");
  // Only the exact identity that asked; anything else reads as not found.
  if (!row || row.requesterIssuer !== requester.issuer || row.requesterSubject !== requester.subject) return { status: "not-found" } as const;
  if (row.status !== "pending") return { status: "not-pending" } as const;
  const now = new Date().toISOString();
  await ctx.db.patch(id, { status: "withdrawn", decidedAtISO: now });
  await ctx.db.insert("activity", {
    societyId: row.societyId, actor: requesterLabel(row), entityType: "accessRequest", entityId: id, subjectId: id,
    action: "access-request-withdrawn", summary: `${requesterLabel(row)} withdrew their access request`, createdAtISO: now,
  });
  return { status: "withdrawn" } as const;
}

/** The signed-in identity's own pending and recently declined requests. */
export async function minePortable(ctx: PortableQueryCtx) {
  const requester = signedInRequester(ctx.principal);
  if (!requester) return [];
  const since = Date.now() - DECLINED_VISIBLE_MS;
  const rows = (await requesterRows(ctx.db, requester))
    .filter((row) => row.status === "pending" || (row.status === "declined" && Date.parse(row.decidedAtISO ?? row.createdAtISO) >= since));
  const result: Array<{ id: string; societyId: string; workspaceName: string; status: AccessRequestStatus; createdAtISO: string; decidedAtISO?: string }> = [];
  for (const row of rows) {
    const society = await ctx.db.get(row.societyId, "societies");
    if (!society) continue;
    result.push({
      id: row._id, societyId: row.societyId, workspaceName: String(society.name), status: row.status, createdAtISO: row.createdAtISO,
      ...(row.decidedAtISO ? { decidedAtISO: row.decidedAtISO } : {}),
    });
  }
  return result;
}

export async function listForWorkspacePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireMembershipManager(ctx, societyId, undefined, undefined);
  const pending = await ctx.db.query<RequestRow>("workspaceAccessRequests")
    .withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "pending"))
    .order("desc").take(ACCESS_REQUEST_PENDING_LIMIT);
  const recent: RequestRow[] = [];
  for (const status of ["approved", "declined"] as const) {
    recent.push(...await ctx.db.query<RequestRow>("workspaceAccessRequests")
      .withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", status))
      .order("desc").take(10));
  }
  recent.sort((a, b) => String(b.decidedAtISO ?? "").localeCompare(String(a.decidedAtISO ?? "")));
  const decider = async (id?: string) => {
    if (!id) return undefined;
    const user = await ctx.db.get<MembershipRow>(id, "users");
    return user?.societyId === societyId ? String(user.displayName || user.email || "") || undefined : undefined;
  };
  return Promise.all([...pending, ...recent.slice(0, 10)].map(async (row) => {
    const decidedBy = await decider(row.decidedByUserId);
    return {
      id: row._id, status: row.status, email: row.email, emailVerified: row.emailVerified, name: row.name, note: row.note,
      createdAtISO: row.createdAtISO, decidedAtISO: row.decidedAtISO, grantedRole: row.grantedRole,
      ...(decidedBy ? { decidedBy } : {}),
    };
  }));
}

/** A request the caller may decide, or the same not-found error for missing and foreign ids. */
async function managedRequest(ctx: PortableQueryCtx, id: string) {
  const row = await ctx.db.get<RequestRow>(id, "workspaceAccessRequests");
  if (!row) throw new Error("Access request not found.");
  try {
    return { row, actor: await requireMembershipManager(ctx, row.societyId, undefined, undefined) };
  } catch {
    throw new Error("Access request not found.");
  }
}

export async function approvePortable(ctx: PortableMutationCtx, { id, role }: { id: string; role: string }): Promise<ApproveResult> {
  if (!(ACCESS_REQUEST_APPROVAL_ROLES as readonly string[]).includes(role) || !ROLES.includes(role as Role)) {
    throw new Error("Choose Admin, Director, Member or Viewer. Promote to Owner after they join.");
  }
  const { row } = await managedRequest(ctx, id);
  // Only an Owner grants Admin, exactly as for invitations and role changes.
  const actor = await requireMembershipManager(ctx, row.societyId, undefined, role);
  if (row.status !== "pending") return { status: "not-pending" };
  const requester: IdentityKey = { issuer: row.requesterIssuer, subject: row.requesterSubject };
  if (await hasMembership(ctx.db, await identityKeysFor(ctx.db, requester), row.societyId)) return { status: "already-member" };
  if (await externalIdentityStatus(ctx.db, requester) === "disabled") return { status: "identity-disabled" };
  const email = row.email?.trim().toLowerCase() ?? "";
  if (!email || !row.emailVerified) throw new Error("This request has no verified email address. Decline it.");
  const roster = await ctx.db.query<MembershipRow>("users").withIndex("by_society", (q) => q.eq("societyId", row.societyId)).collect();
  // One person per email in a workspace, as when adding a user by hand.
  if (roster.some((user) => String(user.email ?? "").trim().toLowerCase() === email)) return { status: "email-in-use" };

  const now = new Date().toISOString();
  const externalIdentityId = await ensureExternalIdentityPortable(ctx, requester.issuer, requester.subject);
  const membershipId = await ctx.db.insert("users", {
    societyId: row.societyId, email, displayName: row.name || email, role,
    authProvider: row.requesterAuthProvider || requester.issuer, authIssuer: requester.issuer, authSubject: requester.subject,
    externalIdentityId, status: "Active", createdAtISO: now,
    emailVerifiedAtISO: now,
  });
  await ctx.db.patch(id, { status: "approved", decidedAtISO: now, decidedByUserId: actor._id, grantedRole: role, membershipId });
  await ctx.db.insert("activity", {
    societyId: row.societyId, actor: String(actor.displayName || actor.email || "Workspace administrator"),
    entityType: "user", entityId: membershipId, subjectId: membershipId, action: "access-request-approved",
    summary: `Approved ${requesterLabel(row)}'s access request as ${role}`, createdAtISO: now,
  });
  return { status: "approved", membershipId };
}

export async function declinePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const { row, actor } = await managedRequest(ctx, id);
  if (row.status !== "pending") return { status: "not-pending" } as const;
  const now = new Date().toISOString();
  await ctx.db.patch(id, { status: "declined", decidedAtISO: now, decidedByUserId: actor._id });
  await ctx.db.insert("activity", {
    societyId: row.societyId, actor: String(actor.displayName || actor.email || "Workspace administrator"),
    entityType: "accessRequest", entityId: id, subjectId: id, action: "access-request-declined",
    summary: `Declined ${requesterLabel(row)}'s access request`, createdAtISO: now,
  });
  return { status: "declined" } as const;
}

export async function getSettingsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }, trustedOrigins: readonly string[]) {
  await requireMembershipManager(ctx, societyId, undefined, undefined);
  const settings = await settingsFor(ctx.db, societyId);
  const origin = await requestableOrigin(ctx.db, societyId, trustedOrigins);
  return {
    enabled: settings?.enabled === true,
    defaultRole: settings?.defaultRole ?? "Viewer",
    ...(settings?.message ? { message: settings.message } : {}),
    ...(origin ? { requestOrigin: origin } : {}),
  };
}

export async function setSettingsPortable(ctx: PortableMutationCtx, args: {
  societyId: string; enabled: boolean; defaultRole: string; message?: string;
}) {
  const actor = await requireMembershipManager(ctx, args.societyId, undefined, undefined);
  if (!(ACCESS_REQUEST_DEFAULT_ROLES as readonly string[]).includes(args.defaultRole)) throw new Error("The default role must be Viewer or Member.");
  const message = cleanText(args.message, "message");
  const rows = await ctx.db.query<SettingsRow>("workspaceAccessRequestSettings")
    .withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect();
  const value = { enabled: args.enabled, defaultRole: args.defaultRole, updatedAtISO: new Date().toISOString(), updatedByUserId: actor._id };
  const [existing, ...duplicates] = rows;
  for (const row of duplicates) await ctx.db.delete(row._id);
  if (existing) await ctx.db.patch(existing._id, { ...value, message });
  else await ctx.db.insert("workspaceAccessRequestSettings", { societyId: args.societyId, ...value, ...(message ? { message } : {}) });
  await ctx.db.insert("activity", {
    societyId: args.societyId, actor: String(actor.displayName || actor.email || "Workspace administrator"),
    entityType: "society", entityId: args.societyId, action: "access-requests-updated",
    summary: args.enabled ? `Turned on access requests (default role ${args.defaultRole})` : "Turned off access requests",
    createdAtISO: value.updatedAtISO,
  });
  return null;
}
