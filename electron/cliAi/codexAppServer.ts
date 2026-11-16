/**
 * The long-lived `codex app-server` process (no Electron imports).
 *
 * One process is started on first use with the containment overrides
 * (codexProtocol.ts) and spoken to as newline-delimited JSON-RPC over stdio.
 * It stops after 10 idle minutes, is started again after a crash, and is
 * stopped when the app quits (`shutdownCodexAppServer`). Notifications and
 * server requests are routed to the run that owns their `threadId`; a server
 * request no run claims is refused at once so Codex never waits on it.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import os from "node:os";
import readline from "node:readline";

import { LocalAiProxyError } from "../localAiProxy.js";
import type { CliBinary } from "./binary.js";
import {
  CODEX_MCP_LIST_ARGS,
  codexAppServerArgs,
  initializeParams,
  parseMcpServerNames,
  refuseServerRequest,
  type ServerReply,
} from "./codexProtocol.js";
import { execCli, stopChild, trackChild } from "./processes.js";

export const CODEX_IDLE_SHUTDOWN_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_STDERR_CHARS = 8000;

export type ThreadListener = {
  notification(method: string, params: unknown): void;
  /** `item/tool/call` for this thread. */
  toolCall?(params: Record<string, unknown>): Promise<ServerReply>;
  /** The process ended while the thread was running. */
  closed(error: LocalAiProxyError): void;
};

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export class CodexAppServer {
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly threads = new Map<string, ThreadListener>();
  private busy = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private stderr = "";
  dead = false;

  private constructor(
    readonly binaryPath: string,
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly idleMs: number,
    private readonly requestTimeoutMs: number,
  ) {
    child.stdin.on("error", () => undefined);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (piece: string) => {
      this.stderr = (this.stderr + piece).slice(-MAX_STDERR_CHARS);
    });
    readline.createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => this.onLine(line));
    child.once("exit", () => this.onExit());
    child.once("error", () => this.onExit());
  }

  /** Lists the person's MCP servers, starts the process and initializes it. */
  static async start(
    binary: CliBinary,
    env: NodeJS.ProcessEnv,
    options: { idleMs?: number; requestTimeoutMs?: number; clientVersion?: string } = {},
  ): Promise<CodexAppServer> {
    const listed = await execCli(binary, CODEX_MCP_LIST_ARGS, env, 10_000);
    if (listed.notFound) throw new LocalAiProxyError("refused", "Codex couldn't be started. Check its path in On-device AI settings.");
    const names = listed.ok ? parseMcpServerNames(listed.stdout) : null;
    // Without the list, the person's MCP servers can't be turned off: refuse rather than run with them.
    if (!names) throw new LocalAiProxyError("refused", "Societyer couldn't read Codex's MCP server settings (`codex mcp list`), so it won't run Codex. Check that Codex works in Terminal.");
    const child = spawn(binary.command, [...binary.prefixArgs, ...codexAppServerArgs(names)], {
      cwd: os.tmpdir(),
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    trackChild(child);
    const server = new CodexAppServer(binary.path, child, options.idleMs ?? CODEX_IDLE_SHUTDOWN_MS, options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
    try {
      await server.request("initialize", initializeParams(options.clientVersion ?? "1.0.0"));
      server.notify("initialized");
    } catch (error) {
      server.stop();
      if (error instanceof LocalAiProxyError) throw error;
      throw new LocalAiProxyError("network", "Codex didn't start. Check that `codex` works in Terminal.");
    }
    server.armIdle();
    return server;
  }

  /** Holds the process open while work runs; the idle timer starts when the last one ends. */
  async use<T>(work: (server: CodexAppServer) => Promise<T>): Promise<T> {
    this.busy += 1;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    try {
      return await work(this);
    } finally {
      this.busy -= 1;
      this.armIdle();
    }
  }

  private armIdle() {
    if (this.busy > 0 || this.dead) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop(), this.idleMs);
    this.idleTimer.unref();
  }

  watchThread(threadId: string, listener: ThreadListener) {
    this.threads.set(threadId, listener);
    return () => this.threads.delete(threadId);
  }

  /**
   * One JSON-RPC request. A request that goes unanswered means the process is
   * stuck: it is stopped, so the next request starts a fresh one.
   */
  request(method: string, params: unknown, timeoutMs = this.requestTimeoutMs): Promise<unknown> {
    if (this.dead) return Promise.reject(new LocalAiProxyError("network", "Codex stopped. Try again."));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new LocalAiProxyError("timeout", "Codex took too long to answer."));
        this.stop();
      }, Math.min(timeoutMs, this.requestTimeoutMs));
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: unknown) {
    this.write(params === undefined ? { method } : { method, params });
  }

  stop() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    stopChild(this.child);
    this.onExit();
  }

  private write(message: Record<string, unknown>) {
    if (this.dead || !this.child.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  }

  private reply(id: unknown, reply: ServerReply) {
    this.write({ id, ...reply });
  }

  private onLine(line: string) {
    let message: Record<string, unknown>;
    try {
      message = record(JSON.parse(line));
    } catch {
      return;
    }
    const { id, method } = message;
    if (typeof method !== "string") {
      // A response to one of our requests.
      const entry = typeof id === "number" ? this.pending.get(id) : undefined;
      if (!entry || typeof id !== "number") return;
      this.pending.delete(id);
      clearTimeout(entry.timer);
      const error = record(message.error);
      if (message.error !== undefined) {
        entry.reject(new LocalAiProxyError("network", typeof error.message === "string" && error.message ? `Codex: ${error.message.slice(0, 200)}` : "Codex refused the request."));
      } else entry.resolve(message.result);
      return;
    }
    const params = record(message.params);
    const listener = typeof params.threadId === "string" ? this.threads.get(params.threadId) : undefined;
    if (id === undefined || id === null) {
      listener?.notification(method, message.params);
      return;
    }
    if (method === "item/tool/call" && listener?.toolCall) {
      listener
        .toolCall(params)
        .then((reply) => this.reply(id, reply))
        .catch(() => this.reply(id, { result: { contentItems: [{ type: "inputText", text: "The request was stopped." }], success: false } }));
      return;
    }
    this.reply(id, refuseServerRequest(method));
  }

  private onExit() {
    if (this.dead) return;
    this.dead = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const error = new LocalAiProxyError("network", "Codex stopped unexpectedly. Try again.");
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    for (const listener of this.threads.values()) listener.closed(error);
    this.threads.clear();
  }

  /** The last lines Codex wrote to stderr (for logs only). */
  get stderrTail() {
    return this.stderr;
  }
}

let shared: { binaryPath: string; server: Promise<CodexAppServer> } | null = null;

/** The shared app-server for this binary, started (or restarted) when needed. */
export async function codexAppServer(binary: CliBinary, env: NodeJS.ProcessEnv): Promise<CodexAppServer> {
  const current = shared;
  if (current && current.binaryPath === binary.path) {
    const server = await current.server.catch(() => null);
    if (server && !server.dead) return server;
    // Another request replaced it while this one waited.
    if (shared !== current) return codexAppServer(binary, env);
  }
  if (shared) void shared.server.then((server) => server.stop()).catch(() => undefined);
  const server = CodexAppServer.start(binary, env);
  shared = { binaryPath: binary.path, server };
  server.catch(() => {
    if (shared?.server === server) shared = null;
  });
  return server;
}

export function shutdownCodexAppServer() {
  const current = shared;
  shared = null;
  if (current) void current.server.then((server) => server.stop()).catch(() => undefined);
}
