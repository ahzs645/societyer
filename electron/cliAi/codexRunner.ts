/**
 * One Codex turn per request, on the shared app-server (no Electron imports).
 *
 * Each request gets its own ephemeral thread in an empty private folder, with
 * the system prompt as `baseInstructions` and the offered tools as dynamic
 * tools. Codex calls a tool with the `item/tool/call` server request, which
 * goes through the tool bridge to the renderer. Abort interrupts the turn.
 */
import { LocalAiProxyError } from "../localAiProxy.js";
import type { CliRunOptions } from "./runOptions.js";
import { codexAppServer, type CodexAppServer } from "./codexAppServer.js";
import { CODEX_SIGNED_OUT, CodexTurnTracker, codexAccountLabel, dynamicToolReply, threadStartParams, turnStartParams } from "./codexProtocol.js";
import { makeRunDir, removeRunDir } from "./processes.js";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function abortError(signal: AbortSignal) {
  const reason: unknown = signal.reason;
  return reason instanceof LocalAiProxyError ? reason : new LocalAiProxyError("aborted", "The AI request was stopped.");
}

function argumentsText(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

async function runTurn(server: CodexAppServer, options: CliRunOptions, cwd: string): Promise<string> {
  const { request, signal } = options;
  // A signed-out Codex only fails once the turn runs; asking first keeps that a plain error before any output.
  const account = record(await server.request("account/read", { refreshToken: false }));
  if (codexAccountLabel(account.account).signedIn === false) throw new LocalAiProxyError("refused", CODEX_SIGNED_OUT);
  if (signal.aborted) throw abortError(signal);
  const started = record(await server.request("thread/start", threadStartParams(request, cwd)));
  const threadId = record(started.thread).id;
  if (typeof threadId !== "string") throw new LocalAiProxyError("network", "Codex didn't start a conversation.");
  const tracker = new CodexTurnTracker(threadId, request.model);
  let unwatch: () => void = () => undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (error: LocalAiProxyError | null) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolve(tracker.finalText());
      };
      const onAbort = () => {
        if (tracker.turnId) void server.request("turn/interrupt", { threadId, turnId: tracker.turnId }, 10_000).catch(() => undefined);
        finish(abortError(signal));
      };
      unwatch = server.watchThread(threadId, {
        notification: (method, params) => {
          for (const event of tracker.notification(method, params)) {
            if (event.type === "text") {
              if (!request.jsonSchema) options.onText(event.text);
            } else if (event.type === "completed") finish(null);
            else finish(event.error);
          }
        },
        toolCall: async (params) => {
          const name = typeof params.tool === "string" ? params.tool : "";
          if (!options.callTool || !request.tools.some((tool) => tool.name === name) || params.namespace) {
            return dynamicToolReply(`There is no tool named ${name.slice(0, 80)}.`, true);
          }
          const outcome = await options.callTool(name, argumentsText(params.arguments));
          return dynamicToolReply(outcome.content, outcome.isError);
        },
        closed: (error) => finish(error),
      });
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      server
        .request("turn/start", turnStartParams(threadId, request))
        .then((result) => {
          const turnId = record(record(result).turn).id;
          if (typeof turnId === "string") tracker.turnId = turnId;
          if (!signal.aborted) options.onAlive?.();
          // Stopped while turn/start was on its way: interrupt now that the turn has an id.
          if (signal.aborted && tracker.turnId) void server.request("turn/interrupt", { threadId, turnId: tracker.turnId }, 10_000).catch(() => undefined);
        })
        .catch((error: unknown) => finish(error instanceof LocalAiProxyError ? error : new LocalAiProxyError("network", "Codex couldn't start the answer.")));
    });
  } finally {
    unwatch();
    // Lets Codex unload the ephemeral thread right away.
    void server.request("thread/unsubscribe", { threadId }, 10_000).catch(() => undefined);
  }
}

/** Runs one turn to completion and returns the answer; text is also streamed through `onText`. */
export async function runCodex(options: CliRunOptions, server?: CodexAppServer): Promise<string> {
  const appServer = server ?? (await codexAppServer(options.binary, options.env));
  const dir = await makeRunDir("societyer-codex-");
  try {
    return await appServer.use((current) => runTurn(current, options, dir));
  } finally {
    await removeRunDir(dir);
  }
}
