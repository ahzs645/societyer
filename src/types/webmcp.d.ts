// WebMCP (https://webmachinelearning.github.io/webmcp/). The draft exposes
// `document.modelContext`; earlier drafts and some polyfills used
// `navigator.modelContext`. Societyer feature-detects both.
type WebMcpToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  untrustedContentHint?: boolean;
  /** The tool changes something the user cares about, so the agent should confirm before calling it. */
  consequentialHint?: boolean;
};

type WebMcpTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: WebMcpToolAnnotations;
  execute: (input: unknown, client?: unknown) => unknown | Promise<unknown>;
};

interface WebMcpModelContext {
  registerTool(
    tool: WebMcpTool,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ): void | Promise<void>;
}

interface Document {
  readonly modelContext?: WebMcpModelContext;
}

interface Navigator {
  readonly modelContext?: WebMcpModelContext;
}
