/**
 * THE ON-DEVICE AI CLIENT — one way to talk to Ollama, LM Studio, llama.cpp
 * or any OpenAI-compatible server from the local and desktop runtimes.
 *
 * - Model list: `/v1/models`, falling back to Ollama's `/api/tags`.
 * - Structured replies: `json_schema`, then `json_object`, then plain text,
 *   moving on only when the server rejects the format; the mode that worked
 *   is remembered per server and model. Replies are fence-stripped by the
 *   caller's parser (shared/ai/minutesDraft.ts).
 * - Streaming chat with a stall timeout, and abort through an AbortSignal.
 * - Tool calling for the on-device assistant: `chatStep` streams one model
 *   turn with tools offered and returns its text and tool calls; a server
 *   that refuses `tools` raises `tools_unsupported`. `probeToolCalling`
 *   checks whether a model calls tools at all.
 * - Claude Code and Codex (desktop app) host the tool loop themselves
 *   (`hostsToolLoop`): `chatStep` passes `onToolCall` to the transport, which
 *   runs each call mid-stream; the stall timer is held while a tool runs.
 *
 * Errors are DeviceAiError with a plain message; provider bodies are never
 * shown.
 */
import { aiProviderStatusMessage } from "../../../shared/ai/providerErrors";
import {
  chatCompletionBody,
  chatCompletionContent,
  chatCompletionToolCalls,
  createChatStreamDecoder,
  createToolCallAccumulator,
  isResponseFormatRejection,
  isToolsRejection,
  JSON_MODE_CHAIN,
  modelIdsFromList,
  type ChatToolDefinition,
  type ChatWireMessage,
  type JsonMode,
  type JsonSchemaFormat,
  type RawToolCall,
} from "../../../shared/ai/openAiCompatible";
import type { ChatMessage } from "../../../shared/ai/minutesDraft";
import { getDesktopBridge, type DesktopLocalAiCliStatus } from "../desktopBridge";
import { deviceAiSnapshot } from "./config";
import { isCliKind, modelListPaths, type DeviceAiCliKind, type DeviceAiKind, type DeviceAiPath } from "./models";
import { DeviceAiError, deviceAiTransport, invokeMessage, type DeviceAiToolAnswer, type DeviceAiToolCall, type DeviceAiTransport } from "./transport";

/** Local models can be slow to load and answer; a stall is no data at all for this long. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60_000;
export const DEFAULT_STALL_TIMEOUT_MS = 90_000;
export const MODEL_LIST_TIMEOUT_MS = 10_000;

export type DeviceAiClientOptions = {
  transport: DeviceAiTransport;
  kind: DeviceAiKind;
  model: string;
  /** Used only to remember which JSON mode a server accepts. */
  serverKey?: string;
  requestTimeoutMs?: number;
  stallTimeoutMs?: number;
  /** CLI kinds: finds the CLI, its version and sign-in (the desktop bridge's `localAiCliStatus`). */
  cliStatus?: (kind: DeviceAiCliKind) => Promise<DesktopLocalAiCliStatus>;
};

/** One streamed model turn: the text it wrote and the tools it called. */
export type ChatStepResult = { text: string; toolCalls: RawToolCall[] };

/** Whether a model calls tools: it did, the server refused `tools`, or it answered in text instead. */
export type ToolProbeResult = { outcome: "supported" | "rejected" | "ignored" } | { outcome: "failed"; message: string };

export const TOOL_PROBE_NAME = "get_current_date";
/** Long enough for a local server to load the model first. */
export const TOOL_PROBE_TIMEOUT_MS = 120_000;

/** `cli`: for Claude Code and Codex, whether the CLI was found, its version and sign-in. */
export type ConnectionTestResult =
  | { ok: true; models: string[]; latencyMs: number; cli?: DesktopLocalAiCliStatus }
  | { ok: false; message: string; hint?: string; cli?: DesktopLocalAiCliStatus };

const acceptedJsonMode = new Map<string, JsonMode>();

/** An AbortSignal that fires on the caller's signal or after `ms`. */
function deadline(ms: number, outer?: AbortSignal, message = "The on-device model took too long to answer.") {
  const controller = new AbortController();
  const onOuter = () => controller.abort(new DeviceAiError("aborted", "The AI request was stopped."));
  if (outer?.aborted) onOuter();
  outer?.addEventListener("abort", onOuter, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new DeviceAiError("timeout", message)), ms);
  };
  arm();
  let held = 0;
  return {
    signal: controller.signal,
    /** Restart the timer (a streamed chunk arrived). Not while held. */
    touch() {
      if (!held) arm();
    },
    /** Stop the timer until the returned release is called (a tool is running); it restarts then. */
    hold() {
      held += 1;
      if (timer) clearTimeout(timer);
      timer = undefined;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        held -= 1;
        if (!held && !controller.signal.aborted) arm();
      };
    },
    clear() {
      held = 0;
      if (timer) clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
    },
  };
}

/** What went wrong, as a DeviceAiError: the abort or timeout reason first, then the error itself. */
function asDeviceAiError(error: unknown, signal: AbortSignal): DeviceAiError {
  const reason: unknown = signal.reason;
  if (signal.aborted && reason instanceof DeviceAiError) return reason;
  if (error instanceof DeviceAiError) return error;
  if (signal.aborted) return new DeviceAiError("aborted", "The AI request was stopped.");
  return new DeviceAiError("network", "The connection to the on-device AI server was interrupted.");
}

function rethrow(error: unknown, signal: AbortSignal): never {
  throw asDeviceAiError(error, signal);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.text());
  } catch {
    throw new DeviceAiError("bad_reply", "The AI server's reply was not readable.");
  }
}

function statusError(status: number) {
  return new DeviceAiError("status", aiProviderStatusMessage(status), { status });
}

async function getJson(transport: DeviceAiTransport, path: DeviceAiPath, timeoutMs: number, signal?: AbortSignal) {
  const limit = deadline(timeoutMs, signal, "The AI server did not answer in time.");
  try {
    const response = await transport.send(path, { method: "GET", signal: limit.signal });
    if (!response.ok) throw statusError(response.status);
    return await readJson(response);
  } catch (error) {
    rethrow(error, limit.signal);
  } finally {
    limit.clear();
  }
}

async function listServerModels(transport: DeviceAiTransport, kind: DeviceAiKind, signal?: AbortSignal): Promise<string[]> {
  let lastError: unknown;
  for (const path of modelListPaths(kind)) {
    try {
      return modelIdsFromList(await getJson(transport, path, MODEL_LIST_TIMEOUT_MS, signal));
    } catch (error) {
      lastError = error;
      if (error instanceof DeviceAiError && (error.code === "aborted" || error.code === "network")) break;
    }
  }
  throw lastError instanceof DeviceAiError ? lastError : new DeviceAiError("network", "Could not list the server's models.");
}

/**
 * Read one chat turn: a stream, or one JSON body from a server that ignores
 * `stream`. Each streamed chunk calls `touch` to restart the stall timer.
 */
async function readChatStep(response: Response, touch: () => void, onToken?: (token: string) => void, hostedCalls = () => 0): Promise<ChatStepResult> {
  let text = "";
  let toolCalls: RawToolCall[] = [];
  if (/json/i.test(response.headers.get("content-type") ?? "") || !response.body) {
    const payload = await readJson(response);
    text = chatCompletionContent(payload) ?? "";
    toolCalls = chatCompletionToolCalls(payload);
    if (text) onToken?.(text);
  } else {
    const calls = createToolCallAccumulator();
    const decoder = createChatStreamDecoder({
      onDelta: (delta) => {
        text += delta;
        onToken?.(delta);
      },
      onToolCall: (delta) => calls.push(delta),
    });
    const reader = response.body.getReader();
    const bytes = new TextDecoder();
    while (!decoder.done) {
      const { value, done } = await reader.read();
      if (done) break;
      touch();
      decoder.push(bytes.decode(value, { stream: true }));
    }
    decoder.push(bytes.decode());
    decoder.end();
    await reader.cancel().catch(() => undefined);
    toolCalls = calls.calls();
  }
  // A provider that ran tools itself may end on them; the caller decides what that means.
  if (!text.trim() && !toolCalls.length && !hostedCalls()) throw new DeviceAiError("bad_reply", "The on-device model returned an empty reply.");
  return { text, toolCalls };
}

/** The tool test: one short request offering a single argument-free tool. */
function toolProbeBody(model: string) {
  return chatCompletionBody({
    model,
    messages: [
      { role: "system", content: "You can call tools. When a tool can answer the question, call it instead of answering yourself." },
      { role: "user", content: `What is today's date? Call ${TOOL_PROBE_NAME} to find out.` },
    ],
    tools: [{ type: "function", function: { name: TOOL_PROBE_NAME, description: "Today's date on this computer.", parameters: { type: "object", properties: {}, additionalProperties: false } } }],
    maxTokens: 200,
    temperature: 0,
  });
}

export function createDeviceAiClient(options: DeviceAiClientOptions) {
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
  const modeKey = `${options.serverKey ?? ""}|${options.model}`;
  /** Claude Code and Codex run the tool loop themselves; tool calls arrive through `onToolCall`. */
  const hostsToolLoop = isCliKind(options.kind);

  /** Model ids the server offers, from the first list endpoint that answers. */
  async function listModels(signal?: AbortSignal): Promise<string[]> {
    return listServerModels(options.transport, options.kind, signal);
  }

  /** Claude Code and Codex: is the CLI there, which version, signed in as whom. */
  async function cliStatus(kind: DeviceAiCliKind): Promise<DesktopLocalAiCliStatus> {
    if (!options.cliStatus) {
      return { kind, found: false, signedIn: null, message: "Claude Code and Codex work only in the desktop app." };
    }
    try {
      return await options.cliStatus(kind);
    } catch (error) {
      return { kind, found: false, signedIn: null, message: invokeMessage(error, "Couldn't check the CLI on this computer.") };
    }
  }

  async function testConnection(signal?: AbortSignal): Promise<ConnectionTestResult> {
    const started = Date.now();
    const cli = isCliKind(options.kind) ? await cliStatus(options.kind) : undefined;
    if (cli && (!cli.found || cli.signedIn === false)) return { ok: false, message: cli.message, hint: cli.hint, cli };
    try {
      const models = await listModels(signal);
      return { ok: true, models, latencyMs: Date.now() - started, ...(cli ? { cli } : {}) };
    } catch (error) {
      if (error instanceof DeviceAiError) return { ok: false, message: error.message, hint: error.hint ?? cli?.hint, ...(cli ? { cli } : {}) };
      return { ok: false, message: "Could not reach the on-device AI server.", ...(cli ? { cli } : {}) };
    }
  }

  async function postChat(
    body: Record<string, unknown>,
    signal: AbortSignal,
    stream = false,
    onToolCall?: (call: DeviceAiToolCall) => Promise<DeviceAiToolAnswer>,
  ) {
    return options.transport.send("/chat/completions", { method: "POST", body: JSON.stringify(body), signal, stream, ...(onToolCall ? { onToolCall } : {}) });
  }

  /**
   * One structured reply. Walks the JSON modes until the server accepts one and
   * returns the raw content for the caller to parse.
   */
  async function completeJson(input: {
    messages: ChatMessage[];
    jsonSchema: JsonSchemaFormat;
    signal?: AbortSignal;
    maxTokens?: number;
    temperature?: number;
  }): Promise<{ text: string; jsonMode: JsonMode }> {
    const remembered = acceptedJsonMode.get(modeKey);
    const modes = remembered ? JSON_MODE_CHAIN.slice(JSON_MODE_CHAIN.indexOf(remembered)) : JSON_MODE_CHAIN;
    const limit = deadline(requestTimeoutMs, input.signal);
    try {
      for (const jsonMode of modes) {
        const response = await postChat(
          chatCompletionBody({
            model: options.model,
            messages: input.messages,
            jsonMode,
            jsonSchema: input.jsonSchema,
            maxTokens: input.maxTokens,
            temperature: input.temperature,
          }),
          limit.signal,
        );
        if (response.ok) {
          const text = chatCompletionContent(await readJson(response));
          if (!text?.trim()) throw new DeviceAiError("bad_reply", "The on-device model returned an empty reply.");
          acceptedJsonMode.set(modeKey, jsonMode);
          return { text, jsonMode };
        }
        const detail = await response.text().catch(() => "");
        if (jsonMode === "none" || !isResponseFormatRejection(response.status, detail)) throw statusError(response.status);
      }
      throw new DeviceAiError("bad_reply", "The on-device model did not return a reply.");
    } catch (error) {
      rethrow(error, limit.signal);
    } finally {
      limit.clear();
    }
  }

  /** A plain (non-streamed) text reply. */
  async function completeText(input: { messages: ChatMessage[]; signal?: AbortSignal; maxTokens?: number; temperature?: number }): Promise<string> {
    const limit = deadline(requestTimeoutMs, input.signal);
    try {
      const response = await postChat(
        chatCompletionBody({ model: options.model, messages: input.messages, maxTokens: input.maxTokens, temperature: input.temperature }),
        limit.signal,
      );
      if (!response.ok) throw statusError(response.status);
      const text = chatCompletionContent(await readJson(response));
      if (!text?.trim()) throw new DeviceAiError("bad_reply", "The on-device model returned an empty reply.");
      return text;
    } catch (error) {
      rethrow(error, limit.signal);
    } finally {
      limit.clear();
    }
  }

  /**
   * One streamed model turn. `onToken` gets each piece of text as it arrives;
   * tool-call fragments are joined and returned with the full text. A server
   * that ignores `stream` and answers in one JSON body works too. With tools
   * offered, a refusal the server blames on them raises `tools_unsupported`.
   *
   * When the provider hosts the tool loop (`hostsToolLoop`), `onToolCall`
   * runs each call mid-stream and `toolCalls` stays empty; the stall timer is
   * held while a tool runs, since a running tool produces no chunks.
   */
  async function chatStep(input: {
    messages: readonly ChatWireMessage[];
    tools?: readonly ChatToolDefinition[];
    onToken?: (token: string) => void;
    onToolCall?: (call: DeviceAiToolCall) => Promise<DeviceAiToolAnswer>;
    signal?: AbortSignal;
    maxTokens?: number;
    temperature?: number;
  }): Promise<ChatStepResult> {
    // A stream may run as long as it keeps producing; silence ends it.
    const limit = deadline(stallTimeoutMs, input.signal, "The on-device model stopped responding.");
    const offersTools = Boolean(input.tools?.length);
    const handler = input.onToolCall;
    let hostedCalls = 0;
    const onToolCall = handler
      ? async (call: DeviceAiToolCall) => {
          hostedCalls += 1;
          const release = limit.hold();
          try {
            return await handler(call);
          } finally {
            release();
          }
        }
      : undefined;
    try {
      const response = await postChat(
        chatCompletionBody({
          model: options.model,
          messages: input.messages,
          stream: true,
          tools: input.tools,
          maxTokens: input.maxTokens,
          temperature: input.temperature ?? 0.4,
        }),
        limit.signal,
        true,
        onToolCall,
      );
      if (!response.ok) {
        const detail = offersTools ? await response.text().catch(() => "") : "";
        if (offersTools && isToolsRejection(response.status, detail)) {
          throw new DeviceAiError("tools_unsupported", "This model or server does not accept tools.", { status: response.status });
        }
        throw statusError(response.status);
      }
      return await readChatStep(response, limit.touch, input.onToken, () => hostedCalls);
    } catch (error) {
      rethrow(error, limit.signal);
    } finally {
      limit.clear();
    }
  }

  /** A streamed chat reply without tools; the full text is returned. */
  async function streamChat(input: {
    messages: ChatMessage[];
    onToken?: (token: string) => void;
    signal?: AbortSignal;
    maxTokens?: number;
    temperature?: number;
  }): Promise<string> {
    const { text } = await chatStep(input);
    if (!text.trim()) throw new DeviceAiError("bad_reply", "The on-device model returned an empty reply.");
    return text;
  }

  /**
   * Does this model call tools? One short request offering a single
   * argument-free tool. A model that answers in text instead is "ignored":
   * it would never look anything up.
   */
  async function probeToolCalling(signal?: AbortSignal): Promise<ToolProbeResult> {
    // Claude Code and Codex always take tools: their own loop runs them.
    if (hostsToolLoop) return { outcome: "supported" };
    const limit = deadline(Math.min(requestTimeoutMs, TOOL_PROBE_TIMEOUT_MS), signal, "The on-device model took too long to answer the tool test.");
    try {
      const response = await postChat(toolProbeBody(options.model), limit.signal);
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        if (isToolsRejection(response.status, detail)) return { outcome: "rejected" };
        throw statusError(response.status);
      }
      const payload = await readJson(response);
      const called = chatCompletionToolCalls(payload).some((call) => call.name === TOOL_PROBE_NAME)
        || new RegExp(`"name"\\s*:\\s*"${TOOL_PROBE_NAME}"`).test(chatCompletionContent(payload) ?? "");
      return { outcome: called ? "supported" : "ignored" };
    } catch (error) {
      return { outcome: "failed", message: asDeviceAiError(error, limit.signal).message };
    } finally {
      limit.clear();
    }
  }

  return { hostsToolLoop, listModels, testConnection, completeJson, completeText, streamChat, chatStep, probeToolCalling };
}

export type DeviceAiClient = ReturnType<typeof createDeviceAiClient>;

/** A client for the settings this device has saved. */
export function deviceAiClient(overrides: { model?: string } = {}): DeviceAiClient {
  const { config } = deviceAiSnapshot();
  const bridge = getDesktopBridge();
  return createDeviceAiClient({
    transport: deviceAiTransport(),
    kind: config.kind,
    model: overrides.model ?? config.model,
    serverKey: isCliKind(config.kind) ? config.kind : config.baseUrl,
    ...(bridge ? { cliStatus: (kind: DeviceAiCliKind) => bridge.localAiCliStatus(kind) } : {}),
  });
}

/** Test seam: forget which JSON modes servers accepted. */
export function resetAcceptedJsonModes() {
  acceptedJsonMode.clear();
}
