/**
 * The remote MCP endpoint, `POST /mcp` on this deployment's HTTP actions
 * origin (hosted only). Clients authenticate with a personal AI connector
 * token (`Authorization: Bearer soc_mcp_…`) or an OAuth access token
 * (`soc_mat_…`, convex/mcpOAuthHttp.ts); with OAuth on, a 401 points at the
 * protected-resource metadata. Protocol: shared/mcp/server.ts. Docs:
 * docs/mcp-connector.md.
 */
import { ConvexError } from "convex/values";
import type { HttpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { allowedConnectorOrigins, hashConnectorToken, isConnectorTokenShape } from "../shared/mcp/connectorPolicy";
import { handleMcpHttp, type McpBackend, type McpSession, type McpToolOutcome } from "../shared/mcp/server";
import { OAUTH_ACCESS_TOKEN_PREFIX, bearerChallenge, hasOpaqueShape, hashOpaque, mcpOAuthConfig } from "../shared/mcp/oauth";

const INVALID_TOKEN = { ok: false, status: 401, error: "invalid_token", message: "This token isn't recognised." } as const;

function failureFrom(error: unknown): McpToolOutcome {
  if (error instanceof ConvexError && typeof error.data === "object" && error.data !== null) {
    const { code, message } = error.data as { code?: unknown; message?: unknown };
    if (typeof code === "string" && typeof message === "string") return { ok: false, code, message };
  }
  console.error("MCP tool call failed", error instanceof Error ? error.message : String(error));
  return { ok: false, code: "tool_failed", message: "The tool couldn't finish. Try again." };
}

function convexBackend(ctx: ActionCtx): McpBackend {
  const grantId = (session: McpSession) => session.grantId as Id<"agentGrants">;
  return {
    async authenticate(token) {
      // A personal token (soc_mcp_…) or an OAuth access token (soc_mat_…); both resolve to an agentGrants row.
      const result = isConnectorTokenShape(token)
        ? await ctx.runMutation(internal.agentConnectors.authorizeRequest, { tokenHash: await hashConnectorToken(token), nowMs: Date.now() })
        : hasOpaqueShape(token, OAUTH_ACCESS_TOKEN_PREFIX)
          ? await ctx.runMutation(internal.mcpOAuth.authorizeAccessToken, { accessTokenHash: await hashOpaque(token), nowMs: Date.now() })
          : INVALID_TOKEN;
      return result.ok ? { ok: true, session: result.session } : result;
    },
    async callTool(session, tool, input) {
      const args = { grantId: grantId(session), toolName: tool.name, input, nowMs: Date.now() };
      try {
        const json = tool.kind === "read"
          ? await ctx.runQuery(internal.agentConnectors.runReadTool, args)
          : await ctx.runMutation(internal.agentConnectors.runWriteTool, args);
        return { ok: true, result: JSON.parse(json) };
      } catch (error) {
        return failureFrom(error);
      }
    },
    async recordToolCall(session, audit) {
      await ctx.runMutation(internal.agentConnectors.recordToolCall, { grantId: grantId(session), ...audit });
    },
  };
}

const mcp = httpAction(async (ctx, request) => {
  const oauth = mcpOAuthConfig(process.env);
  return handleMcpHttp(request, convexBackend(ctx), {
    allowedOrigins: allowedConnectorOrigins(process.env),
    ...(oauth ? { bearerChallenge: (error?: { error: string; description: string }) => bearerChallenge(oauth, error) } : {}),
  });
});

export function registerMcpRoutes(http: HttpRouter) {
  // Every method reaches the handler so GET/DELETE get a 405 with an Allow header, not a 404.
  for (const method of ["POST", "GET", "DELETE", "OPTIONS", "PUT", "PATCH"] as const) {
    http.route({ path: "/mcp", method, handler: mcp });
  }
}
