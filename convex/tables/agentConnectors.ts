import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * AI connectors (hosted only): personal access tokens and OAuth grants for
 * the remote MCP endpoint, and the workspace opt-in. Tokens are stored as
 * SHA-256 hashes. OAuth clients, codes and tokens: ./mcpOAuth.ts.
 * See docs/mcp-connector.md.
 */
export const agentConnectorTables = {
  agentGrants: defineTable({
    societyId: v.id("societies"),
    /** The creator. Every call runs as this user, narrowed by `scopes`. */
    userId: v.id("users"),
    /** "token": a personal access token (the default for older rows). "oauth": an app connected through OAuth (convex/mcpOAuth.ts). */
    kind: v.optional(v.union(v.literal("token"), v.literal("oauth"))),
    /** The token name, or the OAuth client's name. */
    name: v.string(),
    /** Personal tokens only: the SHA-256 of the token. OAuth tokens live in `mcpOAuthTokens`. */
    tokenHash: v.optional(v.string()),
    /** `soc_mcp_…` plus the last four characters, for recognising the token in a list. Personal tokens only. */
    tokenHint: v.optional(v.string()),
    /** OAuth grants: the client's `client_id` and, for a metadata-document client, the host that publishes it. */
    oauthClientId: v.optional(v.string()),
    oauthClientHost: v.optional(v.string()),
    scopes: v.array(v.string()),
    allowedTools: v.optional(v.array(v.string())),
    createdAtISO: v.string(),
    expiresAtISO: v.string(),
    lastUsedAtISO: v.optional(v.string()),
    revokedAtISO: v.optional(v.string()),
    revokedByUserId: v.optional(v.id("users")),
    /** Fixed-window rate limit. */
    rateWindowStartMs: v.optional(v.number()),
    rateWindowCount: v.optional(v.number()),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_society", ["societyId"])
    .index("by_society_user", ["societyId", "userId"])
    .index("by_society_user_client", ["societyId", "userId", "oauthClientId"])
    .index("by_oauth_client", ["oauthClientId"]),

  /** "Allow AI connectors for this workspace". No row means off. */
  agentConnectorSettings: defineTable({
    societyId: v.id("societies"),
    enabled: v.boolean(),
    updatedAtISO: v.string(),
    updatedByUserId: v.id("users"),
  }).index("by_society", ["societyId"]),
};
