# Agent tools

One definition per tool, used by every agent surface. Full guide:
[docs/agent-tools.md](../../docs/agent-tools.md).

- `types.ts`: the contract (`AgentTool`, `AgentToolAdapter`, `AgentToolContext`, `defineAgentTool`).
- `output.ts`: bounded output helpers. Anything a person typed (prose, titles, places, names, tags, file names) goes out as `{ untrusted: "…" }` (`untrusted`, `untrustedLabel`, `untrustedTitle`); IDs, dates, enums and counts stay plain.
- `tools/*.ts`: the tools. `index.ts`: `AGENT_TOOLS`, `agentToolsFor`, JSON Schema, `runAgentTool`.
- `portableAdapter.ts`: adapter over a `PortableRuntime` (local runtime, desktop, tests).
- Browser adapter and WebMCP registration: `src/features/webmcp/`.
- Remote MCP adapter (hosted `POST /mcp`): `convex/lib/agentToolRunner.ts`, protocol in `shared/mcp/`. A new tool that calls a portable function not yet in `AGENT_TOOL_FUNCTIONS` there must be added to it (`scripts/check-mcp-endpoint.ts` fails otherwise). See [docs/mcp-connector.md](../../docs/mcp-connector.md).

## Adapter contract

```ts
interface AgentToolAdapter {
  readonly context: AgentToolContext; // surface, workspace, principal { role, permissions }, browser?, now()
  query<T>(name: string, args: Record<string, unknown>): Promise<T>;    // "meetings:list"
  mutation<T>(name: string, args: Record<string, unknown>): Promise<T>;
}
```

`query`/`mutation` must run the named portable function **as the caller**, so its
action policy, handler checks and in-camera redaction apply. `context.principal.permissions`
must be that same caller's permissions (`permissions:myPermissions`). The tool's own
check against them only decides what to offer; it is never the security boundary.

Adding a tool: write it with `defineAgentTool` in `tools/`, list every portable
function it calls in `calls`, declare `requires` (and `enrichesWith` for optional
reads) so they equal `actionPermission()` of those calls, add it to `AGENT_TOOLS`,
and run `node --import tsx scripts/check-agent-tools.ts`.
