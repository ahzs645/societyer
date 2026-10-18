/**
 * The OAuth 2.1 authorization server for the remote MCP endpoint (hosted
 * only): storage, the consent decision and token checks. HTTP routes are in
 * convex/mcpOAuthHttp.ts and the rules in shared/mcp/oauth.ts.
 *
 * Secrets are made in actions (a real CSPRNG) and only their SHA-256 hashes
 * reach these functions and the database. A decision on the consent page is
 * only recorded; /oauth/authorize/complete applies it once it has checked that
 * the browser finishing is the one that started (the binding cookie). Approval
 * then creates or updates an `agentGrants` row (kind "oauth"), so `/mcp`
 * admits an OAuth access token through the same grant checks, rate limit and
 * audit as a personal token, and each code exchange is its own session
 * (`mcpOAuthFamilies`). See docs/mcp-connector.md.
 */
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { authorizedAction } from "./lib/authorizedServer";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import { hostedPrincipal } from "./lib/authIdentity";
import { connectorsEnabled, grantAccess } from "./lib/agentToolRunner";
import { admitGrant } from "./lib/connectorAdmission";
import { liveSessions, revokeFamily, touchFamily } from "./lib/oauthSessions";
import { assertMembershipStatus, requireSocietyMembership } from "../shared/functions/access";
import { insertAgentAudit } from "../shared/functions/aiAgents";
import { listPermissionsForRole } from "../shared/functions/permissions";
import { CONNECTOR_SCOPES } from "../shared/mcp/connectorPolicy";
import {
  ACCESS_TOKEN_SECONDS,
  AUTHORIZATION_CODE_SECONDS,
  AUTHORIZATION_REQUEST_SECONDS,
  ENDED_TOKEN_RETENTION_DAYS,
  MAX_ACTIVE_OAUTH_GRANTS_PER_USER,
  OAUTH_COMPLETION_PREFIX,
  OAUTH_GRANT_DAYS,
  OAUTH_REQUEST_PREFIX,
  REFRESH_TOKEN_SECONDS,
  UNUSED_CLIENT_DAYS,
  authorizationCompletion,
  clientPublisherHost,
  declaredClientHost,
  generateOpaque,
  hasOpaqueShape,
  hashOpaque,
  isLoopbackRedirect,
  mcpOAuthConfig,
  redirectHost,
  type AuthorizationCompletion,
} from "../shared/mcp/oauth";

const AGENT_KEY = "mcp_connector";
const DAY_MS = 86_400_000;
/** Deployment-level OAuth events (no workspace) are kept this long. */
const EVENT_RETENTION_DAYS = 30;

const eventDetailValidator = v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null()));
type EventDetail = Record<string, string | number | boolean | null>;

/** Log an OAuth event that belongs to no workspace (`mcpOAuthEvents`), and to the deployment's logs. Never secrets. */
async function logDeploymentEvent(ctx: MutationCtx, eventType: string, clientId: string | undefined, detail: EventDetail, nowMs: number) {
  await ctx.db.insert("mcpOAuthEvents", { eventType, ...(clientId ? { clientId } : {}), detail, createdAtMs: nowMs });
  console.info(`mcp_oauth_${eventType}`, { clientId, ...detail });
}

/** How long one caller's unauthenticated events fold into one row. */
const EVENT_WINDOW_MS = 3_600_000;

/**
 * For the HTTP routes: a deployment-level event, such as a completion POST
 * from another site. With `throttleKeyHash` (unauthenticated events), the
 * first one per caller per hour is written and logged; the rest only count.
 */
export const recordEvent = internalMutation({
  args: { eventType: v.string(), clientId: v.optional(v.string()), detail: eventDetailValidator, throttleKeyHash: v.optional(v.string()), nowMs: v.number() },
  returns: v.null(),
  handler: async (ctx, { eventType, clientId, detail, throttleKeyHash, nowMs }) => {
    if (!throttleKeyHash) {
      await logDeploymentEvent(ctx, eventType, clientId, detail, nowMs);
      return null;
    }
    const recent = await ctx.db.query("mcpOAuthEvents")
      .withIndex("by_throttle_key", (q) => q.eq("throttleKeyHash", throttleKeyHash).gt("createdAtMs", nowMs - EVENT_WINDOW_MS))
      .first();
    if (recent?.eventType === eventType) {
      await ctx.db.patch(recent._id, { count: (recent.count ?? 1) + 1 });
      return null;
    }
    await ctx.db.insert("mcpOAuthEvents", { eventType, ...(clientId ? { clientId } : {}), detail, throttleKeyHash, count: 1, createdAtMs: nowMs });
    console.info(`mcp_oauth_${eventType}`, { ...detail, note: "Further ones from this caller this hour are only counted." });
    return null;
  },
});
/** Rows one clean-up round deletes per table query, and the rounds one hourly run may chain while batches come back full. */
const PURGE_BATCH = 200;
const PURGE_ROUNDS = 25;

const clientMetadataValidator = v.object({
  clientName: v.string(),
  clientUri: v.optional(v.string()),
  logoUri: v.optional(v.string()),
  redirectUris: v.array(v.string()),
  tokenEndpointAuthMethod: v.union(v.literal("none"), v.literal("client_secret_post"), v.literal("client_secret_basic")),
});

/** A token-endpoint outcome: tokens to hand out, or an RFC 6749 error. */
type TokenOutcome =
  | { ok: true; scopes: string[]; expiresInSeconds: number }
  | { ok: false; error: "invalid_grant" | "invalid_scope"; description: string };

const invalidGrant = (description: string): TokenOutcome => ({ ok: false, error: "invalid_grant", description });

function consentError(code: string, message: string): ConvexError<{ code: string; message: string }> {
  return new ConvexError({ code, message });
}

// --- Clients ------------------------------------------------------------------------

export const getClient = internalQuery({
  args: { clientId: v.string() },
  handler: async (ctx, { clientId }) =>
    ctx.db.query("mcpOAuthClients").withIndex("by_client_id", (q) => q.eq("clientId", clientId)).unique(),
});

/** Cache a validated Client ID Metadata Document. */
export const saveClientMetadata = internalMutation({
  args: { clientId: v.string(), metadata: clientMetadataValidator, fetchedAtMs: v.number(), refreshAfterMs: v.number() },
  returns: v.null(),
  handler: async (ctx, { clientId, metadata, fetchedAtMs, refreshAfterMs }) => {
    const existing = await ctx.db.query("mcpOAuthClients").withIndex("by_client_id", (q) => q.eq("clientId", clientId)).unique();
    const fields = { ...metadata, registration: "cimd" as const, fetchedAtMs, refreshAfterMs, lastActiveAtMs: fetchedAtMs };
    if (existing) await ctx.db.replace(existing._id, { ...fields, clientId, createdAtISO: existing.createdAtISO });
    else await ctx.db.insert("mcpOAuthClients", { ...fields, clientId, createdAtISO: new Date(fetchedAtMs).toISOString() });
    return null;
  },
});

/** A metadata document that now answers 404 or 410: the client is gone, so its cached copy goes too. */
export const forgetClientMetadata = internalMutation({
  args: { clientId: v.string() },
  returns: v.null(),
  handler: async (ctx, { clientId }) => {
    const existing = await ctx.db.query("mcpOAuthClients").withIndex("by_client_id", (q) => q.eq("clientId", clientId)).unique();
    if (existing?.registration === "cimd") await ctx.db.delete(existing._id);
    return null;
  },
});

/**
 * Dynamic client registration (RFC 7591). The HTTP route rate-limits first.
 * A registration belongs to no workspace, so it is logged here; the
 * workspace audit row comes when someone connects the client.
 */
export const registerClient = internalMutation({
  args: { clientId: v.string(), metadata: clientMetadataValidator, clientSecretHash: v.optional(v.string()), nowMs: v.number() },
  returns: v.null(),
  handler: async (ctx, { clientId, metadata, clientSecretHash, nowMs }) => {
    await ctx.db.insert("mcpOAuthClients", {
      ...metadata,
      clientId,
      registration: "dcr",
      ...(clientSecretHash ? { clientSecretHash } : {}),
      createdAtISO: new Date(nowMs).toISOString(),
      lastActiveAtMs: nowMs,
    });
    await logDeploymentEvent(ctx, "client_registered", clientId, {
      clientName: metadata.clientName,
      redirectHosts: [...new Set(metadata.redirectUris.map(redirectHost))].join(", "),
      tokenEndpointAuthMethod: metadata.tokenEndpointAuthMethod,
    }, nowMs);
    return null;
  },
});

// --- Authorization requests -------------------------------------------------------------

export const createRequest = internalMutation({
  args: {
    requestHash: v.string(),
    bindingHash: v.string(),
    clientId: v.string(),
    redirectUri: v.string(),
    codeChallenge: v.string(),
    state: v.optional(v.string()),
    requestedScopes: v.array(v.string()),
    resource: v.string(),
    nowMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { nowMs, ...request }) => {
    await ctx.db.insert("mcpOAuthRequests", {
      ...request,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + AUTHORIZATION_REQUEST_SECONDS * 1000,
      status: "pending",
    });
    const client = await ctx.db.query("mcpOAuthClients").withIndex("by_client_id", (q) => q.eq("clientId", request.clientId)).unique();
    if (client) await ctx.db.patch(client._id, { lastActiveAtMs: nowMs });
    // Requests are short-lived; sweep a few that ended over a day ago (the daily clean-up does the rest).
    const stale = await ctx.db.query("mcpOAuthRequests").withIndex("by_expires", (q) => q.lt("expiresAtMs", nowMs - DAY_MS)).take(25);
    for (const row of stale) await ctx.db.delete(row._id);
    return null;
  },
});

async function requestByHash(ctx: QueryCtx, requestHash: string) {
  return ctx.db.query("mcpOAuthRequests").withIndex("by_request_hash", (q) => q.eq("requestHash", requestHash)).unique();
}

async function clientById(ctx: QueryCtx, clientId: string) {
  return ctx.db.query("mcpOAuthClients").withIndex("by_client_id", (q) => q.eq("clientId", clientId)).unique();
}

/** The signed-in person's active memberships (one per workspace), as `requireSocietyMembership` resolves them. */
async function myMemberships(ctx: QueryCtx) {
  const principal = hostedPrincipal(await ctx.auth.getUserIdentity());
  if (principal.kind !== "user" || !principal.subject) return null;
  const rows = await ctx.db.query("users").withIndex("by_auth_subject", (q) => q.eq("authSubject", principal.subject)).collect();
  const portable = await toPortableQueryCtx(ctx);
  const memberships: { user: Doc<"users">; society: Doc<"societies"> }[] = [];
  for (const societyId of new Set(rows.map((row) => row.societyId))) {
    try {
      const user = await requireSocietyMembership(portable, societyId);
      const society = await ctx.db.get(societyId);
      const row = await ctx.db.get(user._id as Id<"users">);
      if (society && !society.removedAtISO && row) memberships.push({ user: row, society });
    } catch {
      // Disabled, unbound or ambiguous memberships don't offer this workspace.
    }
  }
  return memberships.sort((a, b) => a.society.name.localeCompare(b.society.name));
}

type RequestStatus = "pending" | "expired" | "used" | "not_found";

type ConsentWorkspace = {
  societyId: Id<"societies">;
  name: string;
  role: string;
  connectorsEnabled: boolean;
  scopeOptions: { permission: string; kind: "read" | "write"; label: string; description: string; held: boolean }[];
  /** Scopes of this app's live connection to the workspace, when there is one. */
  connectedScopes?: string[];
  /** How many sessions that connection has; approving adds one. */
  connectedSessions?: number;
};

function requestStatus(request: Doc<"mcpOAuthRequests"> | null, nowMs: number): RequestStatus {
  if (!request) return "not_found";
  if (request.status !== "pending") return "used";
  return request.expiresAtMs <= nowMs ? "expired" : "pending";
}

/** What the consent page shows. */
export const consentContext = internalQuery({
  args: { requestHash: v.string(), nowMs: v.number() },
  handler: async (ctx, { requestHash, nowMs }) => {
    const memberships = await myMemberships(ctx);
    if (!memberships) throw consentError("unauthenticated", "Sign in to continue.");
    const request = await requestByHash(ctx, requestHash);
    const status = requestStatus(request, nowMs);
    if (!request || status !== "pending") return { status, client: null, workspaces: [], requestedScopes: [] };
    const client = await clientById(ctx, request.clientId);
    if (!client) return { status: "not_found" as const, client: null, workspaces: [], requestedScopes: [] };
    const workspaces: ConsentWorkspace[] = [];
    for (const { user, society } of memberships) {
      const held: readonly string[] = listPermissionsForRole(String(user.role));
      const existing = await liveOAuthGrant(ctx, society._id, user._id, client.clientId, nowMs);
      workspaces.push({
        societyId: society._id,
        name: society.name,
        role: String(user.role),
        connectorsEnabled: await connectorsEnabled(ctx, society._id),
        scopeOptions: CONNECTOR_SCOPES.map((scope) => ({ ...scope, held: held.includes(scope.permission) })),
        ...(existing ? { connectedScopes: existing.scopes, connectedSessions: (await liveSessions(ctx, existing._id, nowMs)).length } : {}),
      });
    }
    const publisherHost = clientPublisherHost(client.clientId);
    const declaredHost = client.registration === "dcr" ? declaredClientHost(client.clientUri) : undefined;
    return {
      status,
      client: {
        name: client.clientName,
        /** The metadata document's host: who publishes the app, as far as Societyer can tell. */
        host: publisherHost ?? null,
        /** A self-registered app's own client_uri host. Unverified; the page says so. */
        declaredHost: declaredHost ?? null,
        registration: client.registration,
        redirectHost: redirectHost(request.redirectUri),
        loopback: isLoopbackRedirect(request.redirectUri),
      },
      requestedScopes: request.requestedScopes,
      expiresAtMs: request.expiresAtMs,
      workspaces,
    };
  },
});

async function liveOAuthGrant(ctx: QueryCtx, societyId: Id<"societies">, userId: Id<"users">, clientId: string, nowMs: number) {
  const grants = await ctx.db.query("agentGrants")
    .withIndex("by_society_user_client", (q) => q.eq("societyId", societyId).eq("userId", userId).eq("oauthClientId", clientId))
    .collect();
  return grants.find((grant) => grant.kind === "oauth" && !grant.revokedAtISO && Date.parse(grant.expiresAtISO) > nowMs) ?? null;
}

/**
 * A request still open to decide, for this person. The first person to
 * decide owns the decision: only they may change it before completion, so
 * someone else who learns the request link can't replace it with their own.
 */
async function pendingRequest(ctx: QueryCtx, requestHash: string, nowMs: number, deciderSubject: string) {
  const request = await requestByHash(ctx, requestHash);
  const status = requestStatus(request, nowMs);
  if (!request || status === "not_found") throw consentError("not_found", "This connection request isn't valid. Start connecting again from the app.");
  if (status === "used") throw consentError("used", "This connection request was already answered. Start connecting again from the app.");
  if (status === "expired") throw consentError("expired", "This connection request expired. Start connecting again from the app.");
  if (request.decision && request.decision.deciderSubject !== deciderSubject) {
    throw consentError("decided_elsewhere", "Someone else already answered this connection request. Start connecting again from the app.");
  }
  return request;
}

/** The signed-in person's sign-in subject, or a "sign in" error. */
async function deciderSubject(ctx: QueryCtx): Promise<string> {
  const principal = hostedPrincipal(await ctx.auth.getUserIdentity());
  if (principal.kind !== "user" || !principal.subject) throw consentError("unauthenticated", "Sign in to continue.");
  return principal.subject;
}

/**
 * Approve, as the signed-in person: checks membership, the workspace opt-in
 * and the scopes against the person's role, then records the decision. Nothing
 * is granted until the browser that started the request completes it.
 */
export const recordApproval = internalMutation({
  args: { requestHash: v.string(), nowMs: v.number(), societyId: v.id("societies"), scopes: v.array(v.string()), decisionHash: v.string() },
  returns: v.null(),
  handler: async (ctx, { requestHash, nowMs, societyId, scopes: chosen, decisionHash }) => {
    const subject = await deciderSubject(ctx);
    const request = await pendingRequest(ctx, requestHash, nowMs, subject);
    let user;
    try {
      user = await requireSocietyMembership(await toPortableMutationCtx(ctx), societyId);
    } catch {
      throw consentError("not_a_member", "You aren't an active member of that workspace.");
    }
    if (!await connectorsEnabled(ctx, societyId)) {
      throw consentError("connectors_disabled", "AI connectors are turned off for this workspace. An Owner or Admin can turn them on in Settings → AI connectors.");
    }
    const scopes = [...new Set(chosen)];
    const scopeError = scopeProblem(scopes, String(user.role));
    if (scopeError) throw consentError("invalid_scope", scopeError);
    if (!await clientById(ctx, request.clientId)) throw consentError("not_found", "This app's registration is gone. Start connecting again from the app.");
    await ctx.db.patch(request._id, {
      decision: { kind: "approve", decisionHash, deciderSubject: subject, userId: user._id as Id<"users">, societyId, scopes, decidedAtMs: nowMs },
    });
    return null;
  },
});

/** Why these scopes can't be granted to this role, or null. */
function scopeProblem(scopes: readonly string[], role: string): string | null {
  const held: readonly string[] = listPermissionsForRole(role);
  const known = CONNECTOR_SCOPES.map((scope) => scope.permission);
  if (!scopes.length) return "Choose at least one thing the app may read.";
  const unknown = scopes.filter((scope) => !known.includes(scope));
  if (unknown.length) return `AI connectors can't use ${unknown.join(", ")}.`;
  const notHeld = scopes.filter((scope) => !held.includes(scope));
  if (notHeld.length) return `Your role doesn't include ${notHeld.join(", ")}, so the app can't either.`;
  return null;
}

/**
 * Deny, as the signed-in person. Like approval, it only takes effect in the
 * browser that started the request, so someone who learns a request link
 * can't cancel another person's connection.
 */
export const recordDenial = internalMutation({
  args: { requestHash: v.string(), nowMs: v.number(), societyId: v.optional(v.id("societies")), decisionHash: v.string() },
  returns: v.null(),
  handler: async (ctx, { requestHash, nowMs, societyId, decisionHash }) => {
    const subject = await deciderSubject(ctx);
    const request = await pendingRequest(ctx, requestHash, nowMs, subject);
    let userId: Id<"users"> | undefined;
    if (societyId) {
      try {
        userId = (await requireSocietyMembership(await toPortableMutationCtx(ctx), societyId))._id as Id<"users">;
      } catch {
        throw consentError("not_a_member", "You aren't an active member of that workspace.");
      }
    }
    await ctx.db.patch(request._id, {
      decision: { kind: "deny", decisionHash, deciderSubject: subject, ...(userId ? { userId } : {}), ...(societyId ? { societyId } : {}), decidedAtMs: nowMs },
    });
    return null;
  },
});

type Completion =
  | { ok: true; outcome: "approved" | "denied"; redirectUri: string; state?: string }
  /** `ended`: the request can't be completed any more, so the binding cookie can go. */
  | { ok: false; message: string; ended: boolean };

const START_AGAIN = "Start connecting again from the app.";

/**
 * /oauth/authorize/complete: apply the recorded decision, but only for the
 * browser holding the request's binding cookie and the decision just made.
 * A binding mismatch means the person deciding isn't in the browser that
 * started the request (a forwarded consent link): the decision is discarded
 * and audited, and the request stays open for the browser that started it,
 * so someone who learns a request link can't cancel it either.
 */
export const completeDecision = internalMutation({
  args: { requestHash: v.string(), bindingHash: v.optional(v.string()), decisionHash: v.string(), codeHash: v.string(), nowMs: v.number() },
  handler: async (ctx, { requestHash, bindingHash, decisionHash, codeHash, nowMs }): Promise<Completion> => {
    const request = await requestByHash(ctx, requestHash);
    const status = requestStatus(request, nowMs);
    if (!request || status === "not_found") return { ok: false, ended: true, message: `This connection request isn't valid. ${START_AGAIN}` };
    if (status === "used") return { ok: false, ended: true, message: `This connection request was already answered. ${START_AGAIN}` };
    if (status === "expired") return { ok: false, ended: true, message: `This connection request expired. ${START_AGAIN}` };
    const decision = request.decision;
    if (!decision || decision.decisionHash !== decisionHash) {
      return { ok: false, ended: false, message: "This decision is out of date. Go back to the consent page and choose again." };
    }
    const client = await clientById(ctx, request.clientId);
    const audit = async (societyId: Id<"societies"> | undefined, eventType: string, summary: string, metadata: Record<string, string | boolean | string[]>) => {
      if (!societyId) {
        // No workspace to audit in: keep it at the deployment level instead.
        const detail: EventDetail = { redirectHost: redirectHost(request.redirectUri) };
        for (const [key, value] of Object.entries(metadata)) detail[key] = Array.isArray(value) ? value.join(" ") : value;
        await logDeploymentEvent(ctx, eventType.replace(/^oauth_/, ""), request.clientId, detail, nowMs);
        return;
      }
      await insertAgentAudit(ctx, {
        societyId,
        agentKey: AGENT_KEY,
        eventType,
        summary,
        metadata: { clientId: request.clientId, registration: client?.registration, redirectHost: redirectHost(request.redirectUri), ...metadata },
        ...(decision.userId ? { actorUserId: decision.userId } : {}),
      });
    };
    const clientName = client?.clientName ?? "An AI app";

    if (!bindingHash || bindingHash !== request.bindingHash) {
      await ctx.db.patch(request._id, { decision: undefined });
      await audit(decision.societyId, "oauth_consent_binding_failed",
        `A ${decision.kind === "approve" ? "approval" : "denial"} for ${clientName} was made in a browser that didn't start the connection; it was refused.`,
        { decision: decision.kind, possibleInterception: true });
      return { ok: false, ended: false, message: "Finish connecting in the browser where you started. If you didn't start connecting this app yourself, someone may have sent you their link: don't approve it. Start again from the app." };
    }

    if (decision.kind === "deny") {
      await ctx.db.patch(request._id, { status: "denied", decision: undefined, ...(decision.userId ? { decidedByUserId: decision.userId } : {}) });
      await audit(decision.societyId, "oauth_consent_denied", `Declined to connect ${clientName}.`, {});
      return { ok: true, outcome: "denied", redirectUri: request.redirectUri, ...(request.state ? { state: request.state } : {}) };
    }

    const refused = async (message: string): Promise<Completion> => {
      await ctx.db.patch(request._id, { status: "denied", decision: undefined });
      return { ok: false, ended: true, message };
    };
    const societyId = decision.societyId;
    const userId = decision.userId;
    if (!societyId || !userId || !decision.scopes || !client) return refused(`This connection request can't be completed. ${START_AGAIN}`);
    // The approval was checked when it was made; check what may have changed since.
    const user = await ctx.db.get(userId);
    try {
      if (!user || user.societyId !== societyId) throw new Error("not a member");
      assertMembershipStatus(user);
    } catch {
      return refused("You're no longer an active member of that workspace.");
    }
    if (!await connectorsEnabled(ctx, societyId)) return refused("AI connectors were turned off for this workspace.");
    const scopeError = scopeProblem(decision.scopes, String(user.role));
    if (scopeError) return refused(scopeError);

    const host = clientPublisherHost(client.clientId);
    const expiresAtISO = new Date(nowMs + OAUTH_GRANT_DAYS * DAY_MS).toISOString();
    const existing = await liveOAuthGrant(ctx, societyId, userId, client.clientId, nowMs);
    let grantId: Id<"agentGrants">;
    if (existing) {
      grantId = existing._id;
      await ctx.db.patch(grantId, { name: client.clientName, scopes: decision.scopes, expiresAtISO, ...(host ? { oauthClientHost: host } : {}) });
    } else {
      const mine = await ctx.db.query("agentGrants").withIndex("by_society_user", (q) => q.eq("societyId", societyId).eq("userId", userId)).collect();
      const live = mine.filter((grant) => grant.kind === "oauth" && !grant.revokedAtISO && Date.parse(grant.expiresAtISO) > nowMs);
      if (live.length >= MAX_ACTIVE_OAUTH_GRANTS_PER_USER) {
        return refused(`You have ${MAX_ACTIVE_OAUTH_GRANTS_PER_USER} connected apps in this workspace. Disconnect one in Settings → AI connectors first.`);
      }
      grantId = await ctx.db.insert("agentGrants", {
        societyId,
        userId,
        kind: "oauth",
        name: client.clientName,
        oauthClientId: client.clientId,
        ...(host ? { oauthClientHost: host } : {}),
        scopes: decision.scopes,
        createdAtISO: new Date(nowMs).toISOString(),
        expiresAtISO,
      });
    }
    await ctx.db.patch(request._id, {
      status: "approved",
      decision: undefined,
      decidedByUserId: userId,
      societyId,
      grantId,
      codeHash,
      codeExpiresAtMs: nowMs + AUTHORIZATION_CODE_SECONDS * 1000,
    });
    await audit(societyId, existing ? "oauth_grant_updated" : "oauth_grant_created",
      `${existing ? "Connected another session of" : "Connected"} ${client.clientName}${host ? ` (${host})` : ""} through OAuth.`,
      { grantId, scopes: decision.scopes, ...(client.registration === "dcr" ? { clientRegisteredAtISO: client.createdAtISO } : {}) });
    return { ok: true, outcome: "approved", redirectUri: request.redirectUri, ...(request.state ? { state: request.state } : {}) };
  },
});

// --- Consent page (public) ------------------------------------------------------------------

function requestHashFor(handle: string): Promise<string> {
  if (!hasOpaqueShape(handle, OAUTH_REQUEST_PREFIX)) throw consentError("not_found", "This connection request isn't valid. Start connecting again from the app.");
  return hashOpaque(handle);
}

function oauthConfig() {
  const config = mcpOAuthConfig(process.env);
  if (!config) throw consentError("oauth_disabled", "OAuth sign-in for AI connectors is turned off on this deployment.");
  return config;
}

/** The consent page's details: the app, where it returns to, and the workspaces and scopes on offer. */
export const consentDetails = authorizedAction("mcpOAuth:consentDetails", action)({
  args: { request: v.string() },
  handler: async (ctx, { request }): Promise<unknown> => {
    oauthConfig();
    return ctx.runQuery(internal.mcpOAuth.consentContext, { requestHash: await requestHashFor(request), nowMs: Date.now() });
  },
});

/**
 * Approve: records the decision and returns the completion form for the page
 * to submit to the issuer (a POST with a one-time token only this person
 * gets). The issuer checks the form came from the app, the token and the
 * binding cookie, and only then redirects to the app with a code. The token
 * comes from a CSPRNG.
 */
export const approve = authorizedAction("mcpOAuth:approve", action)({
  args: { request: v.string(), societyId: v.id("societies"), scopes: v.array(v.string()) },
  handler: async (ctx, { request, societyId, scopes }): Promise<AuthorizationCompletion> => {
    const config = oauthConfig();
    const decision = generateOpaque(OAUTH_COMPLETION_PREFIX);
    await ctx.runMutation(internal.mcpOAuth.recordApproval, {
      requestHash: await requestHashFor(request),
      nowMs: Date.now(),
      societyId,
      scopes,
      decisionHash: await hashOpaque(decision),
    });
    return authorizationCompletion(config, request, decision);
  },
});

/** Deny: like approve, a completion form; the issuer then sends error=access_denied to the app. */
export const deny = authorizedAction("mcpOAuth:deny", action)({
  args: { request: v.string(), societyId: v.optional(v.id("societies")) },
  handler: async (ctx, { request, societyId }): Promise<AuthorizationCompletion> => {
    const config = oauthConfig();
    const decision = generateOpaque(OAUTH_COMPLETION_PREFIX);
    await ctx.runMutation(internal.mcpOAuth.recordDenial, {
      requestHash: await requestHashFor(request),
      nowMs: Date.now(),
      ...(societyId ? { societyId } : {}),
      decisionHash: await hashOpaque(decision),
    });
    return authorizationCompletion(config, request, decision);
  },
});

// --- Token endpoint ------------------------------------------------------------------------------

async function auditGrant(ctx: MutationCtx, grantId: Id<"agentGrants"> | null | undefined, eventType: string, summary: string, metadata: Record<string, unknown> = {}) {
  const grant = grantId ? await ctx.db.get(grantId) : null;
  if (!grant) return;
  await insertAgentAudit(ctx, { societyId: grant.societyId, agentKey: AGENT_KEY, eventType, summary, metadata: { grantId, ...metadata }, actorUserId: grant.userId });
}

const issueArgs = { accessTokenHash: v.string(), refreshTokenHash: v.string(), familyId: v.string(), nowMs: v.number() };

async function insertTokens(
  ctx: MutationCtx,
  grant: Doc<"agentGrants">,
  clientId: string,
  resource: string,
  args: { accessTokenHash: string; refreshTokenHash: string; familyId: string; nowMs: number },
) {
  const grantEndsMs = Date.parse(grant.expiresAtISO);
  const accessExpiresAtMs = Math.min(args.nowMs + ACCESS_TOKEN_SECONDS * 1000, grantEndsMs);
  const refreshExpiresAtMs = Math.min(args.nowMs + REFRESH_TOKEN_SECONDS * 1000, grantEndsMs);
  await ctx.db.insert("mcpOAuthTokens", {
    grantId: grant._id,
    clientId,
    familyId: args.familyId,
    accessTokenHash: args.accessTokenHash,
    accessExpiresAtMs,
    refreshTokenHash: args.refreshTokenHash,
    refreshExpiresAtMs,
    resource,
    scopes: grant.scopes,
    createdAtMs: args.nowMs,
  });
  return { outcome: { ok: true as const, scopes: grant.scopes, expiresInSeconds: Math.max(1, Math.floor((accessExpiresAtMs - args.nowMs) / 1000)) }, refreshExpiresAtMs };
}

type CodeFailure = "wrong_client" | "wrong_redirect_uri" | "wrong_verifier";
const CODE_FAILURES: Record<CodeFailure, string> = {
  wrong_client: "The authorization code was issued to another client.",
  wrong_redirect_uri: "redirect_uri doesn't match the authorization request.",
  wrong_verifier: "code_verifier doesn't match the code_challenge.",
};

/**
 * authorization_code: the code is spent by the first attempt, whatever its
 * outcome. Presented again by the client it was issued to, it revokes the
 * tokens the first exchange issued (RFC 6749 §4.1.2); presented by another
 * client it is only refused. A wrong client, redirect URI or verifier is
 * audited as a possible interception.
 */
export const exchangeCode = internalMutation({
  args: { codeHash: v.string(), clientId: v.string(), redirectUri: v.string(), verifierChallenge: v.string(), ...issueArgs },
  handler: async (ctx, args): Promise<TokenOutcome> => {
    const request = await ctx.db.query("mcpOAuthRequests").withIndex("by_code_hash", (q) => q.eq("codeHash", args.codeHash)).unique();
    if (!request) return invalidGrant("The authorization code isn't recognised.");
    if (request.status === "exchanged") {
      if (request.clientId === args.clientId) {
        if (request.familyId) await revokeFamily(ctx, request.familyId, args.nowMs, "replay");
        await auditGrant(ctx, request.grantId, "oauth_code_reused", "An authorization code was presented twice; its tokens were revoked.");
      } else {
        await auditGrant(ctx, request.grantId, "oauth_code_exchange_failed", "Another client presented an authorization code that was already used.", { reason: "wrong_client", possibleInterception: true });
      }
      return invalidGrant("The authorization code was already used.");
    }
    if (request.status !== "approved" || !request.grantId) return invalidGrant("The authorization code isn't recognised.");
    await ctx.db.patch(request._id, { status: "exchanged", familyId: args.familyId });
    if ((request.codeExpiresAtMs ?? 0) <= args.nowMs) return invalidGrant("The authorization code expired. Connect again.");
    const failure: CodeFailure | null = request.clientId !== args.clientId ? "wrong_client"
      : request.redirectUri !== args.redirectUri ? "wrong_redirect_uri"
        : request.codeChallenge !== args.verifierChallenge ? "wrong_verifier"
          : null;
    if (failure) {
      await auditGrant(ctx, request.grantId, "oauth_code_exchange_failed",
        "An authorization code exchange failed its client, redirect or PKCE check; the code was spent. This can mean the code was intercepted.",
        { reason: failure, possibleInterception: true });
      return invalidGrant(CODE_FAILURES[failure]);
    }
    const access = await grantAccess(ctx, await ctx.db.get(request.grantId), args.nowMs);
    if (!access.ok) return invalidGrant(access.message);
    const issued = await insertTokens(ctx, access.grant, request.clientId, request.resource, args);
    const client = await clientById(ctx, request.clientId);
    await ctx.db.insert("mcpOAuthFamilies", {
      familyId: args.familyId,
      grantId: access.grant._id,
      clientId: request.clientId,
      clientName: client?.clientName ?? access.grant.name,
      redirectHost: redirectHost(request.redirectUri),
      createdAtMs: args.nowMs,
      expiresAtMs: issued.refreshExpiresAtMs,
    });
    await insertAgentAudit(ctx, {
      societyId: access.grant.societyId,
      agentKey: AGENT_KEY,
      eventType: "oauth_token_issued",
      summary: `Issued OAuth tokens to ${access.grant.name} (a new session).`,
      metadata: { grantId: access.grant._id, familyId: args.familyId, scopes: access.grant.scopes },
      actorUserId: access.grant.userId,
    });
    return issued.outcome;
  },
});

/** refresh_token: rotate. A refresh token used twice revokes its whole family. */
export const refreshTokens = internalMutation({
  args: { presentedRefreshHash: v.string(), clientId: v.string(), askedScopes: v.array(v.string()), ...issueArgs },
  handler: async (ctx, args): Promise<TokenOutcome> => {
    const row = await ctx.db.query("mcpOAuthTokens").withIndex("by_refresh_hash", (q) => q.eq("refreshTokenHash", args.presentedRefreshHash)).unique();
    if (!row || row.clientId !== args.clientId) return invalidGrant("The refresh token isn't recognised.");
    if (row.revokedAtMs) return invalidGrant("The refresh token was revoked. Connect again.");
    if (row.rotatedAtMs) {
      const grantId = await revokeFamily(ctx, row.familyId, args.nowMs, "replay");
      await auditGrant(ctx, grantId, "oauth_refresh_reused", "A refresh token was used twice; the session's tokens were revoked.", { familyId: row.familyId });
      return invalidGrant("The refresh token was already used. Connect again.");
    }
    if (row.refreshExpiresAtMs <= args.nowMs) return invalidGrant("The refresh token expired. Connect again.");
    if (args.askedScopes.some((scope) => !row.scopes.includes(scope))) {
      return { ok: false, error: "invalid_scope", description: "A refresh can't add scopes. Connect again to change them." };
    }
    const access = await grantAccess(ctx, await ctx.db.get(row.grantId), args.nowMs);
    if (!access.ok) return invalidGrant(access.message);
    await ctx.db.patch(row._id, { rotatedAtMs: args.nowMs });
    const issued = await insertTokens(ctx, access.grant, row.clientId, row.resource, { ...args, familyId: row.familyId });
    const family = await ctx.db.query("mcpOAuthFamilies").withIndex("by_family", (q) => q.eq("familyId", row.familyId)).unique();
    if (family) await ctx.db.patch(family._id, { expiresAtMs: issued.refreshExpiresAtMs, lastUsedAtMs: args.nowMs });
    return issued.outcome;
  },
});

/** RFC 7009: revoke the family an access or refresh token belongs to. Unknown tokens are not an error. */
export const revokeToken = internalMutation({
  args: { tokenHash: v.string(), clientId: v.string(), nowMs: v.number() },
  returns: v.null(),
  handler: async (ctx, { tokenHash, clientId, nowMs }) => {
    const row = await ctx.db.query("mcpOAuthTokens").withIndex("by_access_hash", (q) => q.eq("accessTokenHash", tokenHash)).unique()
      ?? await ctx.db.query("mcpOAuthTokens").withIndex("by_refresh_hash", (q) => q.eq("refreshTokenHash", tokenHash)).unique();
    if (!row || row.clientId !== clientId || row.revokedAtMs) return null;
    const grantId = await revokeFamily(ctx, row.familyId, nowMs, "client");
    await auditGrant(ctx, grantId, "oauth_token_revoked", "The app revoked one of its sessions (RFC 7009).", { familyId: row.familyId });
    return null;
  },
});

// --- /mcp ---------------------------------------------------------------------------------------------

/** Resolve an OAuth access token for `/mcp`: not expired or revoked, bound to this resource, then the grant checks. */
export const authorizeAccessToken = internalMutation({
  args: { accessTokenHash: v.string(), nowMs: v.number() },
  handler: async (ctx, { accessTokenHash, nowMs }) => {
    const unknown = { ok: false as const, status: 401 as const, error: "invalid_token", message: "This access token isn't recognised." };
    const config = mcpOAuthConfig(process.env);
    if (!config) return { ...unknown, message: "OAuth sign-in for AI connectors is turned off on this deployment." };
    const row = await ctx.db.query("mcpOAuthTokens").withIndex("by_access_hash", (q) => q.eq("accessTokenHash", accessTokenHash)).unique();
    if (!row) return unknown;
    if (row.revokedAtMs) return { ...unknown, message: "This access token was revoked." };
    if (row.accessExpiresAtMs <= nowMs) return { ...unknown, message: "This access token has expired. Refresh it." };
    if (row.resource !== config.resource) return { ...unknown, message: "This access token was issued for another resource." };
    const admitted = await admitGrant(ctx, await ctx.db.get(row.grantId), nowMs);
    if (admitted.ok) await touchFamily(ctx, row.familyId, nowMs);
    return admitted;
  },
});

// --- Clean-up (convex/crons.ts) ----------------------------------------------------------------------

/**
 * Hourly (convex/crons.ts): delete authorization requests that ended over a
 * day ago, token rows and sessions that ended (rotated, revoked or expired)
 * more than the retention window ago, deployment events past their
 * retention, and clients nobody connected that have been idle for a week.
 * Each table is cleared in batches; while any batch comes back full the run
 * schedules itself again at once, up to `PURGE_ROUNDS` rounds, so a backlog
 * (each connection rotates about 24 token rows a day) drains within the hour.
 */
export const purgeStale = internalMutation({
  args: { round: v.optional(v.number()) },
  handler: async (ctx, { round = 1 }) => {
    const nowMs = Date.now();
    const ended = nowMs - ENDED_TOKEN_RETENTION_DAYS * DAY_MS;
    const removed = { requests: 0, tokens: 0, sessions: 0, clients: 0, events: 0 };
    let full = false;
    const batch = async <T>(rows: Promise<T[]>) => {
      const taken = await rows;
      if (taken.length === PURGE_BATCH) full = true;
      return taken;
    };

    const requests = await batch(ctx.db.query("mcpOAuthRequests").withIndex("by_expires", (q) => q.lt("expiresAtMs", nowMs - DAY_MS)).take(PURGE_BATCH));
    for (const row of requests) await ctx.db.delete(row._id);
    removed.requests = requests.length;

    const endedTokens = [
      ...await batch(ctx.db.query("mcpOAuthTokens").withIndex("by_rotated", (q) => q.gte("rotatedAtMs", 0).lt("rotatedAtMs", ended)).take(PURGE_BATCH)),
      ...await batch(ctx.db.query("mcpOAuthTokens").withIndex("by_revoked", (q) => q.gte("revokedAtMs", 0).lt("revokedAtMs", ended)).take(PURGE_BATCH)),
      ...await batch(ctx.db.query("mcpOAuthTokens").withIndex("by_refresh_expires", (q) => q.lt("refreshExpiresAtMs", ended)).take(PURGE_BATCH)),
    ];
    for (const id of new Set(endedTokens.map((row) => row._id))) {
      await ctx.db.delete(id);
      removed.tokens += 1;
    }

    const endedSessions = [
      ...await batch(ctx.db.query("mcpOAuthFamilies").withIndex("by_revoked", (q) => q.gte("revokedAtMs", 0).lt("revokedAtMs", ended)).take(PURGE_BATCH)),
      ...await batch(ctx.db.query("mcpOAuthFamilies").withIndex("by_expires", (q) => q.lt("expiresAtMs", ended)).take(PURGE_BATCH)),
    ];
    for (const id of new Set(endedSessions.map((row) => row._id))) {
      await ctx.db.delete(id);
      removed.sessions += 1;
    }

    const events = await batch(ctx.db.query("mcpOAuthEvents").withIndex("by_created", (q) => q.lt("createdAtMs", nowMs - EVENT_RETENTION_DAYS * DAY_MS)).take(PURGE_BATCH));
    for (const row of events) await ctx.db.delete(row._id);
    removed.events = events.length;

    const idle = await batch(ctx.db.query("mcpOAuthClients").withIndex("by_last_active", (q) => q.lt("lastActiveAtMs", nowMs - UNUSED_CLIENT_DAYS * DAY_MS)).take(PURGE_BATCH));
    for (const client of idle) {
      const grant = await ctx.db.query("agentGrants").withIndex("by_oauth_client", (q) => q.eq("oauthClientId", client.clientId)).first();
      // A client someone connected stays; mark it active so the next runs skip it for a week.
      if (grant) await ctx.db.patch(client._id, { lastActiveAtMs: nowMs });
      else {
        await ctx.db.delete(client._id);
        removed.clients += 1;
      }
    }

    const continued = full && round < PURGE_ROUNDS;
    if (continued) await ctx.scheduler.runAfter(0, internal.mcpOAuth.purgeStale, { round: round + 1 });
    return { ...removed, round, continued };
  },
});
