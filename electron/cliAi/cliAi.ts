/**
 * On-device AI through a signed-in command-line agent: the `claude-cli` and
 * `codex-cli` kinds (no Electron imports; ipc/aiHandlers.ts routes to this).
 *
 * The renderer keeps speaking the OpenAI wire format. Here a request becomes
 * one CLI run (request.ts) and the run's output becomes OpenAI JSON or SSE
 * again (openAiWire.ts), so minutes, intake, Ask AI and the assistant need no
 * CLI-specific reading. Tool calls are the exception: the CLI runs the tool
 * loop itself, so each call travels to the renderer as a `tool_call` stream
 * event and back through `localAiToolResult` (toolBridge.ts).
 */
import type {
  DesktopLocalAiCliKind,
  DesktopLocalAiCliStatus,
  DesktopLocalAiConfig,
  DesktopLocalAiResponse,
  DesktopLocalAiStreamEvent,
} from "../../src/lib/desktopBridge";
import { LocalAiProxyError } from "../localAiProxy.js";
import { resolveCliBinary, type CliBinary } from "./binary.js";
import { CLAUDE_MODEL_ALIASES, CLAUDE_SIGNED_OUT } from "./claudeProtocol.js";
import { runClaude } from "./claudeRunner.js";
import { codexAppServer, shutdownCodexAppServer, type CodexAppServer } from "./codexAppServer.js";
import { CODEX_SIGNED_OUT, codexAccountLabel, codexModelIds } from "./codexProtocol.js";
import { runCodex } from "./codexRunner.js";
import { mcpToolServer } from "./mcpServer.js";
import { execCli, removeActiveRunDirsSync, stopAllChildren } from "./processes.js";
import { parseCliChatRequest } from "./request.js";
import type { CliRunOptions } from "./runOptions.js";
import { cliChildEnvironment } from "./shellEnvironment.js";
import { claudeAuthStatus, cliStatus } from "./status.js";
import { MAX_TOOL_CALLS, TOOL_CALL_CAP_MESSAGE, TOOL_CALL_TIMEOUT_MS, ToolCallBridge } from "./toolBridge.js";
import { chatCompletionJson, modelListJson, sseFinish, sseTextChunk, wireIdentity } from "./openAiWire.js";

export const CLI_KINDS: readonly DesktopLocalAiCliKind[] = ["claude-cli", "codex-cli"];
export const MAX_CONCURRENT_CLI_RUNS = 3;

export function isCliKind(kind: unknown): kind is DesktopLocalAiCliKind {
  return (CLI_KINDS as readonly unknown[]).includes(kind);
}

type CliConfig = Pick<DesktopLocalAiConfig, "kind" | "cli">;

/** Swappable for tests (a fake executable, a fake app-server). */
export type CliDeps = {
  env(): Promise<NodeJS.ProcessEnv>;
  resolveBinary: typeof resolveCliBinary;
  run(options: CliRunOptions): Promise<string>;
  codexServer(binary: CliBinary, env: NodeJS.ProcessEnv): Promise<CodexAppServer>;
};

const defaultDeps: CliDeps = {
  env: cliChildEnvironment,
  resolveBinary: resolveCliBinary,
  run: (options) => (options.binary.kind === "claude-cli" ? runClaude(options) : runCodex(options)),
  codexServer: codexAppServer,
};

let running = 0;

function cliKindOf(config: CliConfig): DesktopLocalAiCliKind {
  if (!isCliKind(config.kind)) throw new LocalAiProxyError("refused", "On-device AI isn't set to a command-line agent.");
  return config.kind;
}

function configuredPath(config: CliConfig, kind: DesktopLocalAiCliKind) {
  return kind === "claude-cli" ? config.cli.claudePath : config.cli.codexPath;
}

async function binaryFor(config: CliConfig, deps: CliDeps) {
  const kind = cliKindOf(config);
  const env = await deps.env();
  return { binary: deps.resolveBinary(kind, configuredPath(config, kind), env), env };
}

function asProxyError(error: unknown, signal: AbortSignal): LocalAiProxyError {
  const reason: unknown = signal.reason;
  if (signal.aborted) return reason instanceof LocalAiProxyError ? reason : new LocalAiProxyError("aborted", "The AI request was stopped.");
  if (error instanceof LocalAiProxyError) return error;
  return new LocalAiProxyError("network", "The command-line agent failed unexpectedly. Try again.");
}

/** One of three run slots; refuses a fourth so a stuck renderer can't start CLI after CLI. */
function takeRunSlot(): () => void {
  if (running >= MAX_CONCURRENT_CLI_RUNS) {
    throw new LocalAiProxyError("refused", "Three AI requests are already running through the command-line agent. Wait for one to finish, then try again.");
  }
  running += 1;
  let released = false;
  return () => {
    if (!released) running -= 1;
    released = true;
  };
}

/** `GET /models`: Claude's model aliases, or the models Codex lists for this sign-in. */
async function modelIds(config: CliConfig, deps: CliDeps): Promise<string[]> {
  const { binary, env } = await binaryFor(config, deps);
  if (binary.kind === "claude-cli") {
    const status = await execCli(binary, ["auth", "status"], env, 15_000);
    if (status.notFound) throw new LocalAiProxyError("refused", "Claude Code couldn't be started. Check its path in On-device AI settings.");
    if (claudeAuthStatus(status.stdout).signedIn === false) throw new LocalAiProxyError("refused", CLAUDE_SIGNED_OUT);
    return [...CLAUDE_MODEL_ALIASES];
  }
  const server = await deps.codexServer(binary, env);
  return server.use(async (current) => {
    const account = (await current.request("account/read", { refreshToken: false })) as Record<string, unknown> | null;
    if (codexAccountLabel(account?.account).signedIn === false) throw new LocalAiProxyError("refused", CODEX_SIGNED_OUT);
    const pages: unknown[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const result = (await current.request("model/list", cursor ? { cursor } : {})) as Record<string, unknown> | null;
      pages.push(result);
      cursor = typeof result?.nextCursor === "string" ? result.nextCursor : null;
      if (!cursor) break;
    }
    return codexModelIds(pages);
  });
}

export type CliRequestInput = { path: string; method: "GET" | "POST"; body?: string };

/** A non-streamed request; throws LocalAiProxyError with a plain message on failure. */
export async function cliRequest(config: CliConfig, input: CliRequestInput, signal: AbortSignal, deps: CliDeps = defaultDeps): Promise<DesktopLocalAiResponse> {
  if (input.path === "/api/tags") throw new LocalAiProxyError("refused", "A command-line agent has no Ollama model list.");
  if (input.path === "/models" && input.method === "GET") {
    return { status: 200, ok: true, body: modelListJson(await modelIds(config, deps)), contentType: "application/json" };
  }
  if (input.path !== "/chat/completions" || input.method !== "POST") throw new LocalAiProxyError("refused", "This AI request path is not allowed.");
  const request = parseCliChatRequest(input.body);
  const release = takeRunSlot();
  try {
    const { binary, env } = await binaryFor(config, deps);
    const text = await deps.run({ binary, env, request: { ...request, stream: false, tools: [] }, signal, onText: () => undefined });
    return { status: 200, ok: true, body: chatCompletionJson(wireIdentity(request.model), text), contentType: "application/json" };
  } catch (error) {
    throw asProxyError(error, signal);
  } finally {
    release();
  }
}

/** An SSE comment: the renderer's decoder skips it, but it restarts the renderer's stall timer. */
export const SSE_KEEPALIVE = ": keepalive\n\n";
export const KEEPALIVE_MS = 15_000;
/** Head is sent by now even if the CLI hasn't confirmed it's signed in, so a slow start isn't taken for a stall. */
export const FORCED_HEAD_MS = 45_000;

export type CliStreamTiming = { keepaliveMs: number; forcedHeadMs: number; maxToolCalls: number };

/**
 * A streamed `POST /chat/completions`. `head` waits until the CLI is running
 * and signed in (or FORCED_HEAD_MS passes), so a sign-in failure is still an
 * `error` event; after it, a keepalive comment every KEEPALIVE_MS keeps the
 * renderer's stall timer from ending a run that is thinking or reasoning. Then
 * SSE text chunks and `tool_call` events, ending with `end` or `error`.
 * Past the tool-call cap the run is stopped and the text so far is the answer.
 * `onToolBridge` hands the request's bridge to the caller, which answers tool
 * calls through it.
 */
export async function cliStream(
  config: CliConfig,
  input: CliRequestInput,
  signal: AbortSignal,
  emit: (event: DesktopLocalAiStreamEvent) => void,
  onToolBridge: (bridge: ToolCallBridge) => void = () => undefined,
  deps: CliDeps = defaultDeps,
  timing: CliStreamTiming = { keepaliveMs: KEEPALIVE_MS, forcedHeadMs: FORCED_HEAD_MS, maxToolCalls: MAX_TOOL_CALLS },
): Promise<void> {
  let release: (() => void) | null = null;
  let headed = false;
  let finished = false;
  let keepalive: ReturnType<typeof setInterval> | null = null;
  const head = () => {
    if (headed || finished) return;
    headed = true;
    emit({ type: "head", status: 200, ok: true, contentType: "text/event-stream" });
    keepalive = setInterval(() => {
      if (!finished) emit({ type: "chunk", text: SSE_KEEPALIVE });
    }, timing.keepaliveMs);
  };
  const forcedHead = setTimeout(head, timing.forcedHeadMs);
  // The run stops on the caller's abort, or when the tool-call cap is passed.
  const run = new AbortController();
  let capped = false;
  const onAbort = () => run.abort(signal.reason);
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
  const bridge = new ToolCallBridge(
    (event) => {
      head();
      emit(event);
    },
    TOOL_CALL_TIMEOUT_MS,
    timing.maxToolCalls,
    () => {
      if (capped) return;
      capped = true;
      run.abort(new LocalAiProxyError("aborted", TOOL_CALL_CAP_MESSAGE));
    },
  );
  onToolBridge(bridge);
  let identity = wireIdentity("");
  let first = true;
  const chunk = (text: string) => {
    head();
    emit({ type: "chunk", text: sseTextChunk(identity, text, first) });
    first = false;
  };
  const close = () => {
    head();
    emit({ type: "chunk", text: sseFinish(identity) });
    finished = true;
    emit({ type: "end" });
  };
  try {
    if (input.path !== "/chat/completions" || input.method !== "POST") throw new LocalAiProxyError("refused", "Only chat requests can be streamed.");
    const request = parseCliChatRequest(input.body);
    identity = wireIdentity(request.model);
    release = takeRunSlot();
    const { binary, env } = await binaryFor(config, deps);
    const text = await deps.run({
      binary,
      env,
      request: { ...request, stream: true },
      signal: run.signal,
      onText: chunk,
      onAlive: head,
      callTool: request.tools.length ? (name, args) => bridge.call(name, args) : undefined,
    });
    // Structured output arrives whole; a run that streamed nothing still has its answer.
    if (first && text) chunk(text);
    close();
  } catch (error) {
    if (capped && !signal.aborted) {
      // Enough was looked up: what the model said so far is the answer.
      close();
    } else {
      const failure = asProxyError(error, signal);
      finished = true;
      emit({ type: "error", code: failure.code, message: failure.message });
    }
  } finally {
    finished = true;
    clearTimeout(forcedHead);
    if (keepalive) clearInterval(keepalive);
    signal.removeEventListener("abort", onAbort);
    bridge.close();
    release?.();
  }
}

/** "Test connection": the CLI, its version and its sign-in; never runs a model. */
export async function cliStatusFor(kind: DesktopLocalAiCliKind, cli: DesktopLocalAiConfig["cli"], deps: CliDeps = defaultDeps): Promise<DesktopLocalAiCliStatus> {
  return cliStatus(kind, kind === "claude-cli" ? cli.claudePath : cli.codexPath, {
    env: await deps.env(),
    resolveBinary: deps.resolveBinary,
    codexServer: deps.codexServer,
  });
}

/** Stops every CLI child, the Codex app-server and the MCP server (app quit). */
export function shutdownCliAi() {
  stopAllChildren();
  shutdownCodexAppServer();
  void mcpToolServer.close();
  removeActiveRunDirsSync();
}
