/**
 * AI connectors (hosted only): personal access tokens for the remote MCP
 * endpoint (convex/mcpHttp.ts) and the workspace opt-in. The local and demo
 * runtimes have no endpoint, so these functions have no portable twin.
 * See docs/mcp-connector.md.
 */
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { authorizedAction, authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
// Like the public mutation wrappers, a write tool keeps offline meeting downloads current.
import { internalMutation as meetingInvalidatingInternalMutation } from "./lib/untypedServer";
import { connectorsEnabled, runConnectorTool } from "./lib/agentToolRunner";
import { admitGrant } from "./lib/connectorAdmission";
import { familyById, liveSessions, publicSession, revokeFamily, revokeGrantSessions } from "./lib/oauthSessions";
import { ROLES, canActAs, requireSocietyMembership, type Role } from "../shared/functions/access";
import { insertAgentAudit } from "../shared/functions/aiAgents";
import { listPermissionsForRole } from "../shared/functions/permissions";
import {
  CONNECTOR_SCOPES,
  DEFAULT_TOKEN_DAYS,
  MAX_ACTIVE_TOKENS_PER_USER,
  MAX_TOKEN_DAYS,
  connectorTokenHint,
  defaultConnectorScopes,
  generateConnectorToken,
  hashConnectorToken,
  rateLimitPerMinute,
  validateGrantRequest,
  type ValidGrantRequest,
} from "../shared/mcp/connectorPolicy";
import { mcpOAuthConfig } from "../shared/mcp/oauth";

const AGENT_KEY = "mcp_connector";
const DAY_MS = 86_400_000;

function isAdmin(role: unknown): boolean {
  return (ROLES as readonly string[]).includes(String(role)) && canActAs(role as Role, "Admin");
}

/** A grant as the UI sees it: never the hash or rate-limit counters. */
function publicGrant(grant: Doc<"agentGrants">) {
  return {
    _id: grant._id,
    kind: grant.kind ?? "token",
    name: grant.name,
    ...(grant.tokenHint ? { tokenHint: grant.tokenHint } : {}),
    ...(grant.oauthClientHost ? { clientHost: grant.oauthClientHost } : {}),
    scopes: grant.scopes,
    ...(grant.allowedTools ? { allowedTools: grant.allowedTools } : {}),
    createdAtISO: grant.createdAtISO,
    expiresAtISO: grant.expiresAtISO,
    ...(grant.lastUsedAtISO ? { lastUsedAtISO: grant.lastUsedAtISO } : {}),
    ...(grant.revokedAtISO ? { revokedAtISO: grant.revokedAtISO } : {}),
  };
}

function isLive(grant: Doc<"agentGrants">, nowMs: number): boolean {
  return !grant.revokedAtISO && Date.parse(grant.expiresAtISO) > nowMs;
}

/** A grant for the card; a live OAuth grant also lists its sessions (one per code exchange). */
async function listedGrant(ctx: QueryCtx, grant: Doc<"agentGrants">, nowMs: number) {
  if (grant.kind !== "oauth" || !isLive(grant, nowMs)) return publicGrant(grant);
  return { ...publicGrant(grant), sessions: (await liveSessions(ctx, grant._id, nowMs)).map(publicSession) };
}

/** The AI connectors card: the opt-in, my tokens, and (for Owners and Admins) everyone's active tokens. */
export const overview = authorizedQuery("agentConnectors:overview", query)({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const user = await requireSocietyMembership(await toPortableQueryCtx(ctx), societyId);
    const rolePermissions: readonly string[] = listPermissionsForRole(String(user.role));
    const canManageWorkspace = isAdmin(user.role);
    const grants = await ctx.db.query("agentGrants").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    const mine = grants.filter((grant) => grant.userId === user._id).sort((a, b) => b.createdAtISO.localeCompare(a.createdAtISO));
    const others = canManageWorkspace ? grants.filter((grant) => grant.userId !== user._id && !grant.revokedAtISO) : [];
    const creators = new Map<string, string>();
    for (const grant of others) {
      if (creators.has(grant.userId)) continue;
      const creator = await ctx.db.get(grant.userId);
      creators.set(grant.userId, creator?.displayName || creator?.email || "Former member");
    }
    const siteUrl = process.env.CONVEX_SITE_URL;
    const nowMs = Date.now();
    return {
      enabled: await connectorsEnabled(ctx, societyId),
      canManageWorkspace,
      endpointUrl: siteUrl ? `${siteUrl.replace(/\/+$/, "")}/mcp` : null,
      /** Whether claude.ai, ChatGPT and other OAuth clients can connect without a token. */
      oauthAvailable: mcpOAuthConfig(process.env) !== null,
      scopeOptions: CONNECTOR_SCOPES.map((scope) => ({ ...scope, held: rolePermissions.includes(scope.permission) })),
      defaultScopes: defaultConnectorScopes(rolePermissions),
      limits: { defaultDays: DEFAULT_TOKEN_DAYS, maxDays: MAX_TOKEN_DAYS, requestsPerMinute: rateLimitPerMinute(process.env) },
      grants: await Promise.all(mine.map((grant) => listedGrant(ctx, grant, nowMs))),
      workspaceGrants: await Promise.all(others
        .sort((a, b) => b.createdAtISO.localeCompare(a.createdAtISO))
        .map(async (grant) => ({ ...await listedGrant(ctx, grant, nowMs), createdBy: creators.get(grant.userId) ?? "Former member" }))),
    };
  },
});

/** "Allow AI connectors for this workspace". Owners and Admins only; off by default. */
export const setEnabled = authorizedMutation("agentConnectors:setEnabled", mutation)({
  args: { societyId: v.id("societies"), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { societyId, enabled }) => {
    const user = await requireSocietyMembership(await toPortableMutationCtx(ctx), societyId);
    if (!isAdmin(user.role)) throw new Error("Only an Owner or Admin can change AI connector access.");
    const userId = user._id as Id<"users">;
    const now = new Date().toISOString();
    const existing = await ctx.db.query("agentConnectorSettings").withIndex("by_society", (q) => q.eq("societyId", societyId)).unique();
    if (existing) await ctx.db.patch(existing._id, { enabled, updatedAtISO: now, updatedByUserId: userId });
    else await ctx.db.insert("agentConnectorSettings", { societyId, enabled, updatedAtISO: now, updatedByUserId: userId });
    await insertAgentAudit(ctx, {
      societyId,
      agentKey: AGENT_KEY,
      eventType: enabled ? "connectors_enabled" : "connectors_disabled",
      summary: enabled ? "Turned on AI connectors for the workspace." : "Turned off AI connectors for the workspace.",
      actorUserId: userId,
    });
    return null;
  },
});

const mintArgs = {
  societyId: v.id("societies"),
  name: v.string(),
  expiresInDays: v.optional(v.number()),
  /** Permission strings; defaults to the read-only preset. */
  scopes: v.optional(v.array(v.string())),
  /** Limit the token to these tools. */
  allowedTools: v.optional(v.array(v.string())),
};

/**
 * Mint a token for yourself. An action, so the token comes from a real CSPRNG;
 * it is returned once and only its hash is stored.
 */
export const mintToken = authorizedAction("agentConnectors:mintToken", action)({
  args: mintArgs,
  handler: async (ctx, args): Promise<{ token: string; grant: ReturnType<typeof publicGrant> }> => {
    const token = generateConnectorToken();
    const grant = await ctx.runMutation(internal.agentConnectors.recordGrant, {
      ...args,
      tokenHash: await hashConnectorToken(token),
      tokenHint: connectorTokenHint(token),
    });
    return { token, grant };
  },
});

export const recordGrant = internalMutation({
  args: { ...mintArgs, tokenHash: v.string(), tokenHint: v.string() },
  handler: async (ctx, args) => {
    // The caller's identity comes through from mintToken.
    const user = await requireSocietyMembership(await toPortableMutationCtx(ctx), args.societyId);
    if (!await connectorsEnabled(ctx, args.societyId)) {
      throw new ConvexError({ code: "connectors_disabled", message: "AI connectors are turned off for this workspace. An Owner or Admin can turn them on in Settings." });
    }
    const rolePermissions = listPermissionsForRole(String(user.role));
    let request: ValidGrantRequest;
    try {
      request = validateGrantRequest({
        name: args.name,
        scopes: args.scopes ?? defaultConnectorScopes(rolePermissions),
        expiresInDays: args.expiresInDays ?? DEFAULT_TOKEN_DAYS,
        allowedTools: args.allowedTools,
      }, rolePermissions);
    } catch (error) {
      throw new ConvexError({ code: "invalid_request", message: error instanceof Error ? error.message : "Invalid token request." });
    }
    const userId = user._id as Id<"users">;
    const nowMs = Date.now();
    const mine = await ctx.db.query("agentGrants").withIndex("by_society_user", (q) => q.eq("societyId", args.societyId).eq("userId", userId)).collect();
    if (mine.filter((grant) => grant.kind !== "oauth" && isLive(grant, nowMs)).length >= MAX_ACTIVE_TOKENS_PER_USER) {
      throw new ConvexError({ code: "too_many_tokens", message: `You have ${MAX_ACTIVE_TOKENS_PER_USER} active tokens. Revoke one first.` });
    }
    const grantId = await ctx.db.insert("agentGrants", {
      societyId: args.societyId,
      userId,
      name: request.name,
      tokenHash: args.tokenHash,
      tokenHint: args.tokenHint,
      scopes: request.scopes,
      ...(request.allowedTools ? { allowedTools: request.allowedTools } : {}),
      createdAtISO: new Date(nowMs).toISOString(),
      expiresAtISO: new Date(nowMs + request.expiresInDays * DAY_MS).toISOString(),
    });
    await insertAgentAudit(ctx, {
      societyId: args.societyId,
      agentKey: AGENT_KEY,
      eventType: "token_created",
      summary: `Created AI connector token "${request.name}".`,
      metadata: { grantId, scopes: request.scopes, expiresInDays: request.expiresInDays },
      actorUserId: userId,
    });
    const grant = await ctx.db.get(grantId);
    if (!grant) throw new Error("The token wasn't saved.");
    return publicGrant(grant);
  },
});

/**
 * Revoke your own token, or (Owners and Admins) anyone's in the workspace.
 * With `familyId`, end one session of a connected app and leave the rest.
 * Works while connectors are off.
 */
export const revokeToken = authorizedMutation("agentConnectors:revokeToken", mutation)({
  args: { grantId: v.id("agentGrants"), familyId: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { grantId, familyId }) => {
    const grant = await ctx.db.get(grantId);
    if (!grant) throw new Error("Token not found.");
    const user = await requireSocietyMembership(await toPortableMutationCtx(ctx), grant.societyId);
    if (grant.userId !== user._id && !isAdmin(user.role)) throw new Error("Token not found.");
    if (grant.revokedAtISO) return null;
    const userId = user._id as Id<"users">;
    const nowMs = Date.now();
    const oauth = grant.kind === "oauth";
    if (familyId) {
      const family = oauth ? await familyById(ctx, familyId) : null;
      if (!family || family.grantId !== grantId) throw new Error("Session not found.");
      if (family.revokedAtMs) return null;
      await revokeFamily(ctx, familyId, nowMs, "person", userId);
      await insertAgentAudit(ctx, {
        societyId: grant.societyId,
        agentKey: AGENT_KEY,
        eventType: "oauth_session_revoked",
        summary: `Signed out one session of ${grant.name} (OAuth).`,
        metadata: { grantId, familyId },
        actorUserId: userId,
      });
      return null;
    }
    await ctx.db.patch(grantId, { revokedAtISO: new Date(nowMs).toISOString(), revokedByUserId: userId });
    // The grant check already stops them; revoking the tokens too keeps the token table honest.
    if (oauth) await revokeGrantSessions(ctx, grantId, nowMs, userId);
    await insertAgentAudit(ctx, {
      societyId: grant.societyId,
      agentKey: AGENT_KEY,
      eventType: oauth ? "oauth_grant_revoked" : "token_revoked",
      summary: oauth ? `Disconnected ${grant.name} (OAuth).` : `Revoked AI connector token "${grant.name}".`,
      metadata: { grantId },
      actorUserId: userId,
    });
    return null;
  },
});

// --- Used by the /mcp HTTP action -------------------------------------------------

/** Resolve a bearer token, apply the per-token rate limit and note when it was last used. */
export const authorizeRequest = internalMutation({
  args: { tokenHash: v.string(), nowMs: v.number() },
  handler: async (ctx, { tokenHash, nowMs }) => {
    const grant = await ctx.db.query("agentGrants").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    // An OAuth grant has no personal token; its access tokens go through mcpOAuth:authorizeAccessToken.
    return admitGrant(ctx, grant?.kind === "oauth" ? null : grant, nowMs);
  },
});

const runArgs = { grantId: v.id("agentGrants"), toolName: v.string(), input: v.any(), nowMs: v.number() };

/** Read tools: one query, so every read and the token check see the same snapshot. */
export const runReadTool = internalQuery({
  args: runArgs,
  handler: async (ctx, args) => runConnectorTool(ctx, args),
});

/** Write and draft tools: one mutation; a failure part-way rolls the whole call back. */
export const runWriteTool = meetingInvalidatingInternalMutation({
  args: runArgs,
  handler: async (ctx: MutationCtx, args: { grantId: Id<"agentGrants">; toolName: string; input: unknown; nowMs: number }) => runConnectorTool(ctx, args),
});

/** One audit row per tools/call: tool, token, outcome and duration. No arguments or record text. */
export const recordToolCall = internalMutation({
  args: { grantId: v.id("agentGrants"), toolName: v.string(), outcome: v.string(), durationMs: v.number() },
  returns: v.null(),
  handler: async (ctx, { grantId, toolName, outcome, durationMs }) => {
    const grant = await ctx.db.get(grantId);
    if (!grant) return null;
    await insertAgentAudit(ctx, {
      societyId: grant.societyId,
      agentKey: AGENT_KEY,
      eventType: "tool_call",
      toolName,
      summary: `${toolName}: ${outcome}`,
      metadata: { grantId, outcome, durationMs, surface: "remote" },
      actorUserId: grant.userId,
    });
    return null;
  },
});
