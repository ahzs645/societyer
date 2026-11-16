/**
 * Claude Code's command line and stream-json output (pure; no Electron).
 *
 * Every run is `claude -p` with Claude Code's own features turned off:
 * - `--tools ""`: no built-in tools (no Bash, file, web or agent tools);
 * - `--setting-sources ""`: no user, project or local settings, so no
 *   CLAUDE.md, rules, plugins, permissions or hooks of the person's own;
 * - `--settings {"disableAllHooks":true}` for hooks that come from elsewhere;
 * - `--disable-slash-commands`: no skills or commands;
 * - `--strict-mcp-config`: no MCP servers but Societyer's (left out when a
 *   managed-mcp.json exists, which already excludes others and rejects it);
 * - `--no-session-persistence`: nothing saved to resume (an older CLI that
 *   doesn't know the flag is refused rather than run without it);
 * - `--max-turns` with tools: a backstop for the tool bridge's call cap;
 * - `--permission-mode dontAsk`: anything not allowed is denied, never asked;
 * - `--system-prompt-file`: Societyer's prompt replaces Claude Code's.
 * CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 turns off auto-memory. The person's own
 * sign-in is used as it is.
 *
 * Output is always `stream-json`; only top-level `stream_event` text deltas
 * become text (a sub-agent's have `parent_tool_use_id`).
 */
import { LocalAiProxyError } from "../localAiProxy.js";
import { MCP_SERVER_NAME } from "./mcpServer.js";
import { MAX_TOOL_CALLS } from "./toolBridge.js";
import type { CliChatRequest } from "./request.js";

export const NO_SESSION_PERSISTENCE = "--no-session-persistence";
export const CLAUDE_SETTINGS = { disableAllHooks: true };
export const CLAUDE_MODEL_ALIASES = ["sonnet", "opus", "haiku"] as const;

export const CLAUDE_SIGNED_OUT = "Claude Code isn't signed in. Run `claude auth login` in Terminal, then try again.";

export type ClaudeRunFiles = { systemPrompt: string; settings: string; mcpConfig?: string };

export function claudeArgs(input: { request: CliChatRequest; files: ClaudeRunFiles; managedMcpConfig: boolean }): string[] {
  const { request, files } = input;
  const args = [
    "-p",
    "--input-format",
    "text",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--system-prompt-file",
    files.systemPrompt,
    "--setting-sources",
    "",
    "--settings",
    files.settings,
    "--tools",
    "",
    "--disable-slash-commands",
    NO_SESSION_PERSISTENCE,
    ...(input.managedMcpConfig ? [] : ["--strict-mcp-config"]),
    "--permission-mode",
    "dontAsk",
  ];
  if (request.model) args.push("--model", request.model);
  if (request.jsonSchema) args.push("--json-schema", JSON.stringify(request.jsonSchema));
  if (files.mcpConfig) {
    args.push("--mcp-config", files.mcpConfig, "--allowedTools", `mcp__${MCP_SERVER_NAME}__*`, "--max-turns", String(MAX_TOOL_CALLS + 2));
  }
  return args;
}

/** The `--mcp-config` file: Societyer's server only, with this run's token. */
export function claudeMcpConfig(url: string, token: string) {
  return { mcpServers: { [MCP_SERVER_NAME]: { type: "http", url, headers: { Authorization: `Bearer ${token}` } } } };
}

/** Variables for the child on top of the shared CLI environment. */
export function claudeRunEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    DISABLE_AUTOUPDATER: "1",
    // Longer than the tool bridge's own 3-minute wait, so the bridge decides.
    MCP_TOOL_TIMEOUT: "200000",
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export type ClaudeLineEvent =
  /** The model has started answering, so the CLI is installed and signed in. */
  | { type: "alive" }
  | { type: "text"; text: string }
  | { type: "result"; isError: boolean; subtype: string; text: string; structured?: unknown };

/** Reads stream-json lines; remembers what a failure needs to be explained. */
export class ClaudeStreamMapper {
  private textSeen = false;
  private alive = false;
  private separate = false;
  assistantError: string | null = null;
  rateLimitedUntil: number | null = null;
  apiErrorStatus: number | null = null;
  result: Extract<ClaudeLineEvent, { type: "result" }> | null = null;

  push(line: string): ClaudeLineEvent[] {
    let message: Record<string, unknown>;
    try {
      message = record(JSON.parse(line));
    } catch {
      return [];
    }
    // A sub-agent's output is not the answer.
    if (message.parent_tool_use_id) return [];
    switch (message.type) {
      case "stream_event": {
        const event = record(message.event);
        const events: ClaudeLineEvent[] = [];
        if (!this.alive) {
          this.alive = true;
          events.push({ type: "alive" });
        }
        if (event.type === "content_block_start" && record(event.content_block).type === "text") {
          // A second text block (after a tool call) starts on a new paragraph.
          if (this.textSeen) this.separate = true;
          return events;
        }
        const delta = record(event.delta);
        if (event.type === "content_block_delta" && delta.type === "text_delta" && typeof delta.text === "string" && delta.text) {
          const text = (this.separate ? "\n\n" : "") + delta.text;
          this.separate = false;
          this.textSeen = true;
          return [...events, { type: "text", text }];
        }
        return events;
      }
      case "assistant":
        if (typeof message.error === "string") this.assistantError = message.error;
        return [];
      case "rate_limit_event": {
        const info = record(message.rate_limit_info);
        if (info.status === "rejected") this.rateLimitedUntil = typeof info.resetsAt === "number" ? info.resetsAt : 0;
        return [];
      }
      case "result": {
        if (typeof message.api_error_status === "number") this.apiErrorStatus = message.api_error_status;
        const isError = message.is_error === true || (typeof message.subtype === "string" && message.subtype !== "success");
        this.result = { type: "result", isError, subtype: typeof message.subtype === "string" ? message.subtype : "", text: typeof message.result === "string" ? message.result : "", structured: message.structured_output };
        return [this.result];
      }
      default:
        return [];
    }
  }

  private failureInput(model: string, stderr: string) {
    return {
      assistantError: this.assistantError,
      rateLimitedUntil: this.rateLimitedUntil,
      apiErrorStatus: this.apiErrorStatus,
      text: `${this.result?.text ?? ""}\n${stderr}`,
      model,
    };
  }

  /** A failure with a known cause (sign-in, limits, billing, model, outage), or null. */
  knownFailure(model: string, stderr = ""): LocalAiProxyError | null {
    return claudeKnownFailure(this.failureInput(model, stderr));
  }

  /** The failure to report for an error result. */
  failure(model: string, stderr = ""): LocalAiProxyError {
    const known = this.knownFailure(model, stderr);
    if (known) return known;
    const detail = (this.result?.text ?? "").trim().split("\n").find((line) => line.trim())?.trim().slice(0, 200);
    return new LocalAiProxyError("network", detail ? `Claude Code couldn't answer: ${detail}` : "Claude Code couldn't answer. Try again.");
  }
}

function resetTime(epochSeconds: number) {
  if (!epochSeconds) return "";
  const when = new Date(epochSeconds * 1000);
  return ` until ${when.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}

export function claudeKnownFailure(input: {
  assistantError: string | null;
  rateLimitedUntil: number | null;
  apiErrorStatus: number | null;
  text: string;
  model: string;
}): LocalAiProxyError | null {
  const { assistantError: error, text } = input;
  if (error === "authentication_failed" || input.apiErrorStatus === 401 || /not logged in|please run \/login|\/login\b|invalid api key|oauth token|authentication/i.test(text)) {
    return new LocalAiProxyError("refused", CLAUDE_SIGNED_OUT);
  }
  if (input.rateLimitedUntil !== null || error === "rate_limit" || /usage limit|limit reached|rate.?limit/i.test(text)) {
    return new LocalAiProxyError("refused", `You've reached your Claude usage limit${resetTime(input.rateLimitedUntil ?? 0)}. Try again later.`);
  }
  if (error === "billing_error" || /credit balance|billing/i.test(text)) {
    return new LocalAiProxyError("refused", "Claude can't answer because of a billing problem with this account. Check it at claude.ai, then try again.");
  }
  if (/model.{0,40}(not found|not available|invalid|does not exist)|unknown model|issue with the selected model/i.test(text) || input.apiErrorStatus === 404) {
    return new LocalAiProxyError("refused", `Claude Code can't use the model “${input.model || "default"}”. Pick another model in On-device AI settings.`);
  }
  if (error === "server_error" || /overloaded|internal server error|\b(529|503)\b/i.test(text) || (input.apiErrorStatus ?? 0) >= 500) {
    return new LocalAiProxyError("network", "Claude is unavailable right now. Try again in a moment.");
  }
  return null;
}

/** Whether an exit was the CLI refusing `--no-session-persistence` (an older version). */
export function rejectedNoSessionPersistence(stderr: string) {
  return stderr.includes(`unknown option '${NO_SESSION_PERSISTENCE}'`);
}
