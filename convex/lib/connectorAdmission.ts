/**
 * Admitting one `/mcp` request for a grant, whichever credential found it (a
 * personal token or an OAuth access token): the grant checks in
 * `grantAccess`, the per-grant rate limit, and "last used".
 */
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { grantAccess, type GrantDenied } from "./agentToolRunner";
import { RATE_LIMIT_WINDOW_MS, rateLimitPerMinute } from "../../shared/mcp/connectorPolicy";
import type { McpSession } from "../../shared/mcp/server";

export type GrantAdmission =
  | { ok: true; session: McpSession }
  | GrantDenied
  | { ok: false; status: 429; error: "rate_limited"; message: string; retryAfterSeconds: number };

export async function admitGrant(ctx: MutationCtx, grant: Doc<"agentGrants"> | null, nowMs: number): Promise<GrantAdmission> {
  const access = await grantAccess(ctx, grant, nowMs);
  if (!access.ok) return access;
  const limit = rateLimitPerMinute(process.env);
  const windowStart = Math.floor(nowMs / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS;
  const count = access.grant.rateWindowStartMs === windowStart ? access.grant.rateWindowCount ?? 0 : 0;
  if (count >= limit) {
    const what = access.grant.kind === "oauth" ? "This connection" : "This token";
    return {
      ok: false,
      status: 429,
      error: "rate_limited",
      message: `${what} is limited to ${limit} requests a minute. Try again shortly.`,
      retryAfterSeconds: Math.max(1, Math.ceil((windowStart + RATE_LIMIT_WINDOW_MS - nowMs) / 1000)),
    };
  }
  await ctx.db.patch(access.grant._id, { rateWindowStartMs: windowStart, rateWindowCount: count + 1, lastUsedAtISO: new Date(nowMs).toISOString() });
  return {
    ok: true,
    session: {
      grantId: access.grant._id,
      societyId: access.grant.societyId,
      permissions: access.permissions,
      rolePermissions: access.rolePermissions,
      ...(access.grant.allowedTools ? { allowedTools: access.grant.allowedTools } : {}),
    },
  };
}
