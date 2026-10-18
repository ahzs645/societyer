/**
 * The agent-tool registry: every tool Societyer offers to an agent, whichever
 * adapter runs it. See README.md in this folder and docs/agent-tools.md.
 */
import { z } from "zod";
import { createGovernanceTasks, getGovernanceSnapshot, listCommitments, listDeadlines, listTasks, openGovernanceView } from "./tools/governance";
import { getMeeting, getTranscript, listMeetings } from "./tools/meetings";
import { getDocument, searchDocuments } from "./tools/documents";
import {
  AGENT_TOOL_DRAFT_OUTPUT,
  AgentToolError,
  principalMayUse,
  toolRunsOn,
  writeModeFor,
  type AgentSurface,
  type AgentTool,
  type AgentToolAdapter,
  type AgentToolAnnotations,
  type AgentToolRunOptions,
} from "./types";

export * from "./types";
export { UNTRUSTED_NOTICE, type UntrustedText } from "./output";

export const AGENT_TOOLS: readonly AgentTool[] = Object.freeze([
  getGovernanceSnapshot,
  listMeetings,
  getMeeting,
  getTranscript,
  searchDocuments,
  getDocument,
  listTasks,
  listDeadlines,
  listCommitments,
  createGovernanceTasks,
  openGovernanceView,
]);

export function findAgentTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((tool) => tool.name === name);
}

/**
 * The tools to offer on a surface to someone holding these permissions. This
 * only decides what an agent is shown; every call is checked again by the
 * wrapped portable functions.
 */
export function agentToolsFor({ surface, permissions, rolePermissions }: {
  surface: AgentSurface;
  permissions: readonly string[];
  /** The person's role permissions when `permissions` is narrowed by token scopes (remote). Defaults to `permissions`. */
  rolePermissions?: readonly string[];
}): AgentTool[] {
  return AGENT_TOOLS.filter((tool) => toolRunsOn(tool, surface) && principalMayUse(tool, permissions, rolePermissions));
}

export type JsonSchema = Record<string, unknown>;

function jsonSchema(schema: z.ZodType, io: "input" | "output"): JsonSchema {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { io, unrepresentable: "any" });
  return rest;
}

/** JSON Schema (draft 2020-12) for the tool's arguments. */
export function agentToolInputSchema(tool: AgentTool): JsonSchema {
  return jsonSchema(tool.input, "input");
}

export function agentToolOutputSchema(tool: AgentTool): JsonSchema | undefined {
  return tool.output ? jsonSchema(tool.output, "output") : undefined;
}

/** The output schema a surface publishes: a draft-mode write returns a pending draft, not its own result. */
export function agentToolOutputSchemaFor(tool: AgentTool, surface: AgentSurface): JsonSchema | undefined {
  return writeModeFor(tool, surface) === "draft" ? jsonSchema(AGENT_TOOL_DRAFT_OUTPUT, "output") : agentToolOutputSchema(tool);
}

/**
 * WebMCP annotations: a write runs directly in the person's session there, so
 * it is flagged `consequentialHint` (WebMCP draft) for the browser agent to
 * confirm first; `readOnlyHint` stays false.
 */
export function webMcpAnnotations(tool: AgentTool): AgentToolAnnotations & { consequentialHint?: true } {
  return writeModeFor(tool, "browser") === "direct" ? { ...tool.annotations, readOnlyHint: false, consequentialHint: true } : tool.annotations;
}

export async function runAgentTool(adapter: AgentToolAdapter, name: string, input: unknown, options?: AgentToolRunOptions): Promise<unknown> {
  const tool = findAgentTool(name);
  if (!tool) throw new AgentToolError("not_available", `Unknown tool ${name}.`);
  return tool.run(input, adapter, options);
}
