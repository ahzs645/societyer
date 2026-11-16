/**
 * One Claude Code run per request (no Electron imports).
 *
 * The prompt goes in on stdin; the system prompt, settings and MCP config are
 * files in the run's private folder (claudeProtocol.ts has the flags and why).
 * Tools reach Claude through the shared MCP server (mcpServer.ts) under a
 * token that only lives as long as the run.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import readline from "node:readline";

import { LocalAiProxyError } from "../localAiProxy.js";
import {
  CLAUDE_SETTINGS,
  ClaudeStreamMapper,
  claudeArgs,
  claudeMcpConfig,
  claudeRunEnvironment,
  rejectedNoSessionPersistence,
} from "./claudeProtocol.js";
import { mcpToolServer, type McpRegistration, type McpToolServer } from "./mcpServer.js";
import { makeRunDir, removeRunDir, stopChild, trackChild, writePrivateFile } from "./processes.js";
import type { CliRunOptions } from "./runOptions.js";

export type ClaudeRunOptions = CliRunOptions & { mcpServer?: McpToolServer; tempRoot?: string; managedMcpConfig?: boolean };

const MAX_STDERR_CHARS = 8000;

function managedMcpConfigPath() {
  if (process.platform === "darwin") return "/Library/Application Support/ClaudeCode/managed-mcp.json";
  if (process.platform === "win32") return "C:\\Program Files\\ClaudeCode\\managed-mcp.json";
  return "/etc/claude-code/managed-mcp.json";
}

function abortError(signal: AbortSignal) {
  const reason: unknown = signal.reason;
  return reason instanceof LocalAiProxyError ? reason : new LocalAiProxyError("aborted", "The AI request was stopped.");
}

/** An older Claude Code without `--no-session-persistence` would save every conversation; it isn't run. */
export const CLAUDE_TOO_OLD = "This version of Claude Code is too old for Societyer. Update Claude Code (`claude update`) to use it here.";

function runOnce(options: ClaudeRunOptions, args: string[], cwd: string): Promise<string> {
  const { binary, request, signal } = options;
  return new Promise<string>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    const child = spawn(binary.command, [...binary.prefixArgs, ...args], {
      cwd,
      env: claudeRunEnvironment(options.env),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    trackChild(child);
    const mapper = new ClaudeStreamMapper();
    let streamed = "";
    let stderr = "";
    let spawnError: NodeJS.ErrnoException | null = null;
    const onAbort = () => stopChild(child);
    signal.addEventListener("abort", onAbort, { once: true });

    child.on("error", (error: NodeJS.ErrnoException) => {
      spawnError = error;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (piece: string) => {
      stderr = (stderr + piece).slice(-MAX_STDERR_CHARS);
    });
    // A closed stdin (the CLI exited early) must not crash the main process.
    child.stdin.on("error", () => undefined);
    child.stdin.end(request.prompt);

    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      for (const event of mapper.push(line)) {
        if (event.type === "alive") options.onAlive?.();
        if (event.type !== "text") continue;
        streamed += event.text;
        if (!request.jsonSchema) options.onText(event.text);
      }
    });

    child.on("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) {
        reject(abortError(signal));
        return;
      }
      if (spawnError) {
        reject(
          spawnError.code === "ENOENT" || spawnError.code === "EACCES"
            ? new LocalAiProxyError("refused", "Claude Code couldn't be started. Check its path in On-device AI settings.")
            : new LocalAiProxyError("network", "Claude Code couldn't be started."),
        );
        return;
      }
      const result = mapper.result;
      if (!result) {
        if (rejectedNoSessionPersistence(stderr)) {
          reject(new LocalAiProxyError("refused", CLAUDE_TOO_OLD));
          return;
        }
        reject(
          mapper.knownFailure(request.model, stderr) ??
            new LocalAiProxyError("network", `Claude Code stopped unexpectedly${code === null ? "" : ` (exit code ${code})`}. Try again.`),
        );
        return;
      }
      // --max-turns ends a run whose tool loop went on too long: keep what it said.
      if (result.subtype === "error_max_turns" && !request.jsonSchema) {
        resolve(streamed || result.text);
        return;
      }
      if (result.isError) {
        reject(mapper.failure(request.model, stderr));
        return;
      }
      if (request.jsonSchema) {
        const structured = result.structured;
        resolve(structured === undefined || structured === null ? result.text : JSON.stringify(structured));
        return;
      }
      resolve(streamed || result.text);
    });
  });
}

/** Runs to completion and returns the whole answer; text is also streamed through `onText`. */
export async function runClaude(options: ClaudeRunOptions): Promise<string> {
  const { request } = options;
  const dir = await makeRunDir("societyer-claude-", options.tempRoot);
  let registration: McpRegistration | null = null;
  try {
    const files = {
      systemPrompt: await writePrivateFile(dir, "system-prompt.txt", request.systemPrompt),
      settings: await writePrivateFile(dir, "settings.json", JSON.stringify(CLAUDE_SETTINGS)),
      mcpConfig: undefined as string | undefined,
    };
    if (request.tools.length && options.callTool) {
      const callTool = options.callTool;
      registration = await (options.mcpServer ?? mcpToolServer).register({ tools: request.tools, call: (name, args) => callTool(name, args) });
      files.mcpConfig = await writePrivateFile(dir, "mcp.json", JSON.stringify(claudeMcpConfig(registration.url, registration.token)));
    }
    const managedMcpConfig = options.managedMcpConfig ?? existsSync(managedMcpConfigPath());
    return await runOnce(options, claudeArgs({ request, files, managedMcpConfig }), dir);
  } finally {
    registration?.dispose();
    await removeRunDir(dir);
  }
}
