/**
 * The remote (MCP) adapter for the agent-tool registry. A tool runs inside one
 * Convex query (read tools) or mutation (write tools) as the token's creator:
 * a service principal whose scopes are the token's scopes, so every wrapped
 * portable function applies its own action policy, membership, document
 * access, in-camera and transcript rules, narrowed by those scopes (see
 * `requirePermissionPortable`). The token is re-checked in the same
 * transaction as the reads.
 */
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { AgentToolError, findAgentTool, toolDraftApprovalPath, type AgentToolAdapter, type AgentToolDraftProposal } from "../../shared/agentTools";
import { createPortableAgentAdapter } from "../../shared/agentTools/portableAdapter";
import { connectorToolsFor, effectiveConnectorPermissions } from "../../shared/mcp/connectorPolicy";
import { requireSocietyMembership, type PortableUserRow } from "../../shared/functions/access";
import { insertAgentAudit } from "../../shared/functions/aiAgents";
import { listPermissionsForRole } from "../../shared/functions/permissions";
import { makeCapabilities } from "../../shared/portable/capabilities";
import type { PortablePrincipal, PortableQueryCtx } from "../../shared/portable/ctx";
import { PortableRuntime, definePortableMutation, definePortableQuery, type PortableFunctionDef } from "../../shared/portable/define";
import * as commitments from "../../shared/functions/commitments";
import * as dashboard from "../../shared/functions/dashboard";
import * as deadlines from "../../shared/functions/deadlines";
import * as documents from "../../shared/functions/documents";
import * as filings from "../../shared/functions/filings";
import * as meetings from "../../shared/functions/meetings";
import * as minutes from "../../shared/functions/minutes";
import * as tasks from "../../shared/functions/tasks";
import * as transcripts from "../../shared/functions/transcripts";
import { convexPortableDb } from "./portable";

/**
 * The portable functions the agent tools call, as registered in
 * shared/functions/registry.ts (hosted Convex doesn't load the whole registry).
 * scripts/check-mcp-endpoint.ts checks this list against every tool's `calls`.
 */
export const AGENT_TOOL_FUNCTIONS: readonly PortableFunctionDef[] = [
  definePortableQuery({ name: "dashboard:summary", handler: dashboard.summaryPortable }),
  definePortableQuery({ name: "deadlines:list", handler: deadlines.listPortable }),
  definePortableQuery({ name: "filings:list", handler: filings.listPortable }),
  definePortableQuery({ name: "meetings:list", handler: meetings.listPortable }),
  definePortableQuery({ name: "meetings:get", handler: meetings.getPortable }),
  definePortableQuery({ name: "minutes:getByMeeting", handler: minutes.getByMeetingPortable }),
  definePortableQuery({ name: "transcripts:getByMeeting", handler: transcripts.getByMeetingPortable }),
  definePortableQuery({ name: "documents:listSummaries", handler: documents.listSummariesPortable }),
  definePortableQuery({ name: "documents:get", handler: documents.getPortable }),
  definePortableQuery({ name: "tasks:list", handler: tasks.tasksList }),
  definePortableQuery({ name: "commitments:list", handler: commitments.listPortable }),
  definePortableMutation({ name: "tasks:create", handler: tasks.taskCreate }),
].map((definition) => ({ ...definition, applicationPolicy: true }));

export type GrantDenied = { ok: false; status: 401 | 403; error: string; message: string };
export type GrantAccess = {
  ok: true;
  grant: Doc<"agentGrants">;
  user: PortableUserRow;
  society: Doc<"societies">;
  /** Current role permissions ∩ token scopes. */
  permissions: string[];
  /** The creator's current role permissions, for role-only tools (decision A1). */
  rolePermissions: string[];
};

const denied = (status: 401 | 403, error: string, message: string): GrantDenied => ({ ok: false, status, error, message });

/** The audit and draft key for everything an AI connector does. */
const CONNECTOR_AGENT_KEY = "mcp_connector";

/** The principal every call with this token runs as. */
export function connectorPrincipal(grant: Doc<"agentGrants">): PortablePrincipal {
  return {
    kind: "service",
    runtime: "convex-hosted",
    assurance: "trusted-internal",
    subject: `agentGrant:${grant._id}`,
    societyId: grant.societyId,
    actorUserId: grant.userId,
    clientId: "mcp",
    scopes: grant.scopes,
  };
}

function portableReader(ctx: QueryCtx, principal: PortablePrincipal): PortableQueryCtx {
  return {
    db: convexPortableDb(ctx.db),
    capabilities: makeCapabilities({}),
    principal,
    runQuery: async () => { throw new Error("Nested queries aren't available to AI connectors."); },
  };
}

export async function connectorsEnabled(ctx: QueryCtx, societyId: Id<"societies">): Promise<boolean> {
  const settings = await ctx.db.query("agentConnectorSettings").withIndex("by_society", (q) => q.eq("societyId", societyId)).unique();
  return settings?.enabled === true;
}

/** Whether this grant may be used right now, and with which permissions. */
export async function grantAccess(ctx: QueryCtx, grant: Doc<"agentGrants"> | null, nowMs: number): Promise<GrantAccess | GrantDenied> {
  if (!grant) return denied(401, "invalid_token", "This token isn't recognised.");
  if (grant.revokedAtISO) return denied(401, "invalid_token", "This token was revoked.");
  if (Date.parse(grant.expiresAtISO) <= nowMs) return denied(401, "invalid_token", "This token has expired. Create a new one in Settings.");
  const society = await ctx.db.get(grant.societyId);
  if (!society || society.removedAtISO) return denied(401, "invalid_token", "This token's workspace no longer exists.");
  if (!await connectorsEnabled(ctx, grant.societyId)) {
    return denied(403, "connectors_disabled", "AI connectors are turned off for this workspace. An Owner or Admin can turn them on in Settings.");
  }
  let user: PortableUserRow;
  try {
    user = await requireSocietyMembership(portableReader(ctx, connectorPrincipal(grant)), grant.societyId);
  } catch {
    return denied(401, "invalid_token", "The person who created this token is no longer an active member of the workspace.");
  }
  const rolePermissions = [...listPermissionsForRole(String(user.role))];
  const permissions = effectiveConnectorPermissions(rolePermissions, grant.scopes);
  return { ok: true, grant, user, society, permissions, rolePermissions };
}

export type ToolFailure = { code: string; message: string };

/** What the client is told when a tool fails. Unexpected errors stay generic. */
function toolFailure(toolName: string, error: unknown): ToolFailure {
  if (error instanceof AgentToolError) return { code: error.code, message: error.message };
  const message = error instanceof Error ? error.message : String(error);
  if (/^(Permission|Service scope) .+ required/.test(message)) return { code: "permission_denied", message };
  if (/not found|Invalid argument|not a valid ID|Unable to decode/i.test(message)) return { code: "not_found", message: "Record not found." };
  console.error(`MCP tool ${toolName} failed: ${message}`);
  return { code: "tool_failed", message: `${toolName} couldn't finish. Check the arguments and try again.` };
}

export type RunToolArgs = { grantId: Id<"agentGrants">; toolName: string; input: unknown; nowMs: number };

/**
 * Run one tool for a grant. Throws `ConvexError<ToolFailure>` on refusal or
 * failure (a mutation then rolls back). Returns the result as JSON text.
 */
export async function runConnectorTool(ctx: QueryCtx | MutationCtx, args: RunToolArgs): Promise<string> {
  const access = await grantAccess(ctx, await ctx.db.get(args.grantId), args.nowMs);
  if (!access.ok) throw new ConvexError<ToolFailure>({ code: access.error, message: access.message });
  const tool = findAgentTool(args.toolName);
  if (!tool || !connectorToolsFor(access.permissions, access.grant.allowedTools, access.rolePermissions).includes(tool)) {
    throw new ConvexError<ToolFailure>({ code: "permission_denied", message: `${args.toolName} isn't available to this token.` });
  }
  const principal = connectorPrincipal(access.grant);
  const runtime = new PortableRuntime({
    db: convexPortableDb(ctx.db),
    capabilities: makeCapabilities({}),
    principalProvider: () => principal,
  }).registerAll([...AGENT_TOOL_FUNCTIONS]);
  const portableAdapter = createPortableAgentAdapter(runtime, {
    surface: "remote",
    workspace: {
      id: access.society._id,
      name: access.society.name,
      jurisdictionCode: access.society.jurisdictionCode,
      entityType: access.society.entityType,
    },
    principal: { userId: access.user._id, role: String(access.user.role), permissions: access.permissions, rolePermissions: access.rolePermissions },
    now: () => new Date(args.nowMs),
  });
  // Decision A4: remote writes only propose a draft a person approves in Societyer.
  const adapter: AgentToolAdapter = isMutationCtx(ctx)
    ? { ...portableAdapter, proposeDraft: (proposal) => proposeConnectorDraft(ctx, access, proposal, args.nowMs) }
    : portableAdapter;
  try {
    return JSON.stringify(await tool.run(args.input, adapter));
  } catch (error) {
    throw new ConvexError<ToolFailure>(toolFailure(tool.name, error));
  }
}

function isMutationCtx(ctx: QueryCtx | MutationCtx): ctx is MutationCtx {
  return "insert" in ctx.db;
}

/** The app origin (the first `SITE_URL` entry) for approval links, when configured. */
function appOrigin(): string | undefined {
  const first = (process.env.SITE_URL ?? "").split(",").map((value) => value.trim()).find(Boolean);
  if (!first) return undefined;
  try {
    return new URL(first).origin;
  } catch {
    return undefined;
  }
}

/**
 * A pending `aiToolDrafts` row for a remote write, and an audit row for the
 * proposal (the approval is audited by `approveToolDraft`). The audit names the
 * tool, grant and draft, never the arguments.
 */
async function proposeConnectorDraft(ctx: MutationCtx, access: GrantAccess, proposal: AgentToolDraftProposal, nowMs: number) {
  const now = new Date(nowMs).toISOString();
  const draftId = await ctx.db.insert("aiToolDrafts", {
    societyId: access.grant.societyId,
    agentKey: CONNECTOR_AGENT_KEY,
    toolName: proposal.toolName,
    title: proposal.title,
    payload: { input: proposal.input, surface: "remote", grantId: access.grant._id },
    status: "draft",
    createdByUserId: access.user._id as Id<"users">,
    createdAtISO: now,
    updatedAtISO: now,
  });
  await insertAgentAudit(ctx, {
    societyId: access.grant.societyId,
    agentKey: CONNECTOR_AGENT_KEY,
    eventType: "tool_draft_proposed",
    toolName: proposal.toolName,
    summary: `${proposal.toolName}: draft proposed for approval`,
    metadata: { grantId: access.grant._id, draftId, surface: "remote" },
    actorUserId: access.user._id,
  });
  const approvePath = toolDraftApprovalPath(draftId);
  const origin = appOrigin();
  return { draftId, approvePath, ...(origin ? { approveUrl: `${origin}${approvePath}` } : {}) };
}
