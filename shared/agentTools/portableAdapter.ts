/**
 * Adapter over a `PortableRuntime` (the local data runtime, the desktop app
 * and the test harness). The runtime's principal provider decides who is
 * calling; `context.principal` must describe that same principal.
 */
import type { PortableRuntime } from "../portable/index";
import type { AgentToolAdapter, AgentToolContext, ToolArgs } from "./types";

export function createPortableAgentAdapter(runtime: Pick<PortableRuntime, "runQuery" | "runMutation">, context: AgentToolContext): AgentToolAdapter {
  return {
    context,
    query: <T>(name: string, args: ToolArgs) => runtime.runQuery<T>(name, args),
    mutation: <T>(name: string, args: ToolArgs) => runtime.runMutation<T>(name, args),
  };
}
