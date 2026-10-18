import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * The OAuth 2.1 authorization server for the remote MCP endpoint (hosted
 * only). Every secret (client secret, request handle, browser binding nonce,
 * decision, code, access and refresh token) is stored as a SHA-256 hash. A
 * consent approval becomes an `agentGrants` row (kind "oauth"), which `/mcp`
 * checks like a personal token; each code exchange under it is one session
 * (`mcpOAuthFamilies`). See shared/mcp/oauth.ts and docs/mcp-connector.md.
 */
export const mcpOAuthTables = {
  /** Clients from Client ID Metadata Documents (cached copies) and dynamic registration. */
  mcpOAuthClients: defineTable({
    /** The metadata document URL (CIMD) or `soc_dcr_…` (DCR). */
    clientId: v.string(),
    registration: v.union(v.literal("cimd"), v.literal("dcr")),
    clientName: v.string(),
    clientUri: v.optional(v.string()),
    logoUri: v.optional(v.string()),
    redirectUris: v.array(v.string()),
    tokenEndpointAuthMethod: v.union(v.literal("none"), v.literal("client_secret_post"), v.literal("client_secret_basic")),
    clientSecretHash: v.optional(v.string()),
    createdAtISO: v.string(),
    /** CIMD: when the document was fetched and when to fetch it again. */
    fetchedAtMs: v.optional(v.number()),
    refreshAfterMs: v.optional(v.number()),
    /** Registration, a metadata fetch or an authorization request. Clients without a grant idle past a week are deleted. */
    lastActiveAtMs: v.number(),
  })
    .index("by_client_id", ["clientId"])
    .index("by_last_active", ["lastActiveAtMs"]),

  /**
   * One authorization request, from `/oauth/authorize` to the token exchange:
   * pending (a decision may be recorded) → approved (holds the code) or
   * denied, once /oauth/authorize/complete checks the browser binding →
   * exchanged.
   */
  mcpOAuthRequests: defineTable({
    requestHash: v.string(),
    /** SHA-256 of the nonce in the `__Host-soc-oauth-…` cookie set on the browser that started the request. */
    bindingHash: v.string(),
    clientId: v.string(),
    redirectUri: v.string(),
    codeChallenge: v.string(),
    state: v.optional(v.string()),
    requestedScopes: v.array(v.string()),
    resource: v.string(),
    createdAtMs: v.number(),
    expiresAtMs: v.number(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("denied"), v.literal("exchanged")),
    /**
     * The consent page's decision, applied only by a completion POST from the
     * app's origin carrying its token, in the browser holding the binding
     * cookie. The first person to decide owns it; only they may change it.
     */
    decision: v.optional(v.object({
      kind: v.union(v.literal("approve"), v.literal("deny")),
      /** SHA-256 of the one-time completion token returned to the decider. */
      decisionHash: v.string(),
      /** The decider's sign-in subject, so nobody else can replace their decision. */
      deciderSubject: v.string(),
      /** Who decided. A denial by someone with no workspace to name has none. */
      userId: v.optional(v.id("users")),
      societyId: v.optional(v.id("societies")),
      scopes: v.optional(v.array(v.string())),
      decidedAtMs: v.number(),
    })),
    decidedByUserId: v.optional(v.id("users")),
    societyId: v.optional(v.id("societies")),
    grantId: v.optional(v.id("agentGrants")),
    codeHash: v.optional(v.string()),
    codeExpiresAtMs: v.optional(v.number()),
    /** The token family the code was exchanged for, so a replayed code can revoke it. */
    familyId: v.optional(v.string()),
  })
    .index("by_request_hash", ["requestHash"])
    .index("by_code_hash", ["codeHash"])
    .index("by_expires", ["expiresAtMs"]),

  /**
   * One access + refresh token pair. A refresh replaces the row (rotatedAtMs)
   * with a new one in the same family; presenting a rotated refresh token
   * again revokes the family. Ended rows are deleted after a retention window.
   */
  mcpOAuthTokens: defineTable({
    grantId: v.id("agentGrants"),
    clientId: v.string(),
    familyId: v.string(),
    accessTokenHash: v.string(),
    accessExpiresAtMs: v.number(),
    refreshTokenHash: v.string(),
    refreshExpiresAtMs: v.number(),
    /** The RFC 8707 resource (audience) the tokens are bound to. */
    resource: v.string(),
    scopes: v.array(v.string()),
    createdAtMs: v.number(),
    rotatedAtMs: v.optional(v.number()),
    revokedAtMs: v.optional(v.number()),
  })
    .index("by_access_hash", ["accessTokenHash"])
    .index("by_refresh_hash", ["refreshTokenHash"])
    .index("by_family", ["familyId"])
    .index("by_grant", ["grantId"])
    .index("by_rotated", ["rotatedAtMs"])
    .index("by_revoked", ["revokedAtMs"])
    .index("by_refresh_expires", ["refreshExpiresAtMs"]),

  /**
   * A session: the token family one code exchange started, listed under its
   * grant in Settings → AI connectors so a second consent for the same app
   * shows up as its own entry and can be revoked on its own.
   */
  mcpOAuthFamilies: defineTable({
    familyId: v.string(),
    grantId: v.id("agentGrants"),
    clientId: v.string(),
    clientName: v.string(),
    /** Where the browser returned the code ("claude.ai", "localhost (this computer)"). */
    redirectHost: v.string(),
    createdAtMs: v.number(),
    lastUsedAtMs: v.optional(v.number()),
    /** The newest refresh token's expiry; the session ends then unless refreshed. */
    expiresAtMs: v.number(),
    revokedAtMs: v.optional(v.number()),
    revokedByUserId: v.optional(v.id("users")),
    /** "person" (Settings), "client" (RFC 7009), "replay" (a reused code or refresh token) or "grant" (the whole app disconnected). */
    revokedReason: v.optional(v.string()),
  })
    .index("by_family", ["familyId"])
    .index("by_grant", ["grantId"])
    .index("by_expires", ["expiresAtMs"])
    .index("by_revoked", ["revokedAtMs"]),

  /**
   * OAuth events that belong to no workspace (a registration, a decline or a
   * refused completion with no workspace to name), so they aren't lost. Kept
   * for 30 days (convex/mcpOAuth.ts `purgeStale`). Never secrets.
   */
  mcpOAuthEvents: defineTable({
    eventType: v.string(),
    clientId: v.optional(v.string()),
    detail: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null()))),
    createdAtMs: v.number(),
    /**
     * Unauthenticated events (a refused completion POST) are kept once per
     * caller per hour: the SHA-256 of the caller's throttle key (never the
     * address itself), and how many times it happened in that hour.
     */
    throttleKeyHash: v.optional(v.string()),
    count: v.optional(v.number()),
  })
    .index("by_created", ["createdAtMs"])
    .index("by_throttle_key", ["throttleKeyHash", "createdAtMs"]),
};
