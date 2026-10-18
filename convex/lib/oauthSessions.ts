/**
 * OAuth sessions for AI connectors: each code exchange starts a token family
 * (`mcpOAuthFamilies`) under its grant. Settings → AI connectors lists them,
 * so a second consent for the same app shows up as its own session, and any
 * one of them can be revoked. See convex/mcpOAuth.ts.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** "Last used" is written at most once a minute per session. */
const LAST_USED_PRECISION_MS = 60_000;

export type SessionRevocationReason = "person" | "client" | "replay" | "grant";

export function sessionIsLive(family: Doc<"mcpOAuthFamilies">, nowMs: number): boolean {
  return !family.revokedAtMs && family.expiresAtMs > nowMs;
}

/** A session as the connectors card shows it. Never token hashes. */
export function publicSession(family: Doc<"mcpOAuthFamilies">) {
  return {
    familyId: family.familyId,
    clientName: family.clientName,
    redirectHost: family.redirectHost,
    createdAtISO: new Date(family.createdAtMs).toISOString(),
    ...(family.lastUsedAtMs ? { lastUsedAtISO: new Date(family.lastUsedAtMs).toISOString() } : {}),
    expiresAtISO: new Date(family.expiresAtMs).toISOString(),
  };
}

export async function liveSessions(ctx: QueryCtx, grantId: Id<"agentGrants">, nowMs: number) {
  const families = await ctx.db.query("mcpOAuthFamilies").withIndex("by_grant", (q) => q.eq("grantId", grantId)).collect();
  return families.filter((family) => sessionIsLive(family, nowMs)).sort((a, b) => b.createdAtMs - a.createdAtMs);
}

export async function familyById(ctx: QueryCtx, familyId: string) {
  return ctx.db.query("mcpOAuthFamilies").withIndex("by_family", (q) => q.eq("familyId", familyId)).unique();
}

/** Revoke every token in a family and end its session. Returns the grant it belongs to, if known. */
export async function revokeFamily(
  ctx: MutationCtx,
  familyId: string,
  nowMs: number,
  reason: SessionRevocationReason,
  byUserId?: Id<"users">,
): Promise<Id<"agentGrants"> | null> {
  const tokens = await ctx.db.query("mcpOAuthTokens").withIndex("by_family", (q) => q.eq("familyId", familyId)).collect();
  for (const token of tokens) if (!token.revokedAtMs) await ctx.db.patch(token._id, { revokedAtMs: nowMs });
  const family = await familyById(ctx, familyId);
  if (family && !family.revokedAtMs) {
    await ctx.db.patch(family._id, { revokedAtMs: nowMs, revokedReason: reason, ...(byUserId ? { revokedByUserId: byUserId } : {}) });
  }
  return family?.grantId ?? tokens[0]?.grantId ?? null;
}

/** Revoke every session of a grant (disconnecting the app). */
export async function revokeGrantSessions(ctx: MutationCtx, grantId: Id<"agentGrants">, nowMs: number, byUserId: Id<"users">) {
  const families = await ctx.db.query("mcpOAuthFamilies").withIndex("by_grant", (q) => q.eq("grantId", grantId)).collect();
  for (const family of families) await revokeFamily(ctx, family.familyId, nowMs, "grant", byUserId);
  // Tokens from before sessions were tracked, or whose family row was purged.
  const tokens = await ctx.db.query("mcpOAuthTokens").withIndex("by_grant", (q) => q.eq("grantId", grantId)).collect();
  for (const token of tokens) if (!token.revokedAtMs) await ctx.db.patch(token._id, { revokedAtMs: nowMs });
}

/** Note a session's use (an access token on /mcp, or a refresh). */
export async function touchFamily(ctx: MutationCtx, familyId: string, nowMs: number) {
  const family = await familyById(ctx, familyId);
  if (family && (family.lastUsedAtMs ?? 0) <= nowMs - LAST_USED_PRECISION_MS) await ctx.db.patch(family._id, { lastUsedAtMs: nowMs });
}
