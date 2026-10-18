/**
 * Agent-tool adapter #1: the browser. Calls go through the app's Convex client,
 * which is the hosted Convex client or the local portable runtime's client, so
 * the server-side (or local) function policy applies to every tool call.
 */
import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  agentToolInputSchema,
  agentToolOutputSchemaFor,
  webMcpAnnotations,
  type AgentTool,
  type AgentToolAdapter,
  type AgentToolContext,
  type ToolArgs,
} from "../../../shared/agentTools";

type FunctionClient = Pick<ConvexReactClient, "query" | "mutation">;

export function createBrowserAgentAdapter(client: FunctionClient, context: AgentToolContext): AgentToolAdapter {
  return {
    context,
    query: <T>(name: string, args: ToolArgs) => client.query(makeFunctionReference<"query", ToolArgs, T>(name), args),
    mutation: <T>(name: string, args: ToolArgs) => client.mutation(makeFunctionReference<"mutation", ToolArgs, T>(name), args),
  };
}

/** The registry tool as a WebMCP tool. The adapter is read at call time so it sees the current page. */
export function toWebMcpTool(tool: AgentTool, adapter: () => AgentToolAdapter): WebMcpTool {
  const outputSchema = agentToolOutputSchemaFor(tool, "browser");
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: agentToolInputSchema(tool),
    ...(outputSchema ? { outputSchema } : {}),
    // Writes run directly in this session, so they are marked consequential (decision A4).
    annotations: webMcpAnnotations(tool),
    execute: (input) => tool.run(input, adapter()),
  };
}

/** Every distinct WebMCP model context on this page. */
export function webMcpContexts(): WebMcpModelContext[] {
  const contexts: WebMcpModelContext[] = [];
  for (const candidate of [document.modelContext, typeof navigator === "undefined" ? undefined : navigator.modelContext]) {
    if (candidate && typeof candidate.registerTool === "function" && !contexts.includes(candidate)) contexts.push(candidate);
  }
  return contexts;
}
