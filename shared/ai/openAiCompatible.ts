/**
 * The OpenAI-compatible chat protocol, as spoken by OpenAI, OpenRouter, Ollama
 * (/v1), LM Studio and the llama.cpp server. Request bodies, reply parsing and
 * Server-Sent-Events decoding only; callers own the transport.
 *
 * Structured output support differs: LM Studio refuses `json_object` and wants
 * `json_schema`, some llama.cpp builds reject `json_schema`, and older servers
 * know neither. Callers walk JSON_MODE_CHAIN until one is accepted, and the
 * reply is always fence-stripped and parsed defensively afterwards.
 *
 * Tool calling (the on-device assistant) differs too: servers send arguments
 * as a JSON string (OpenAI), an object (some Ollama builds), or a string that
 * was JSON-encoded twice, and streamed calls arrive in fragments. Replies are
 * reduced to `RawToolCall`s here; decoding and validating the arguments is the
 * caller's job (src/lib/localAi/toolCalls.ts).
 */
import type { ChatMessage } from "./minutesDraft";

/** A function call as sent back to the server in the assistant turn that made it. */
export type ChatToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

/** Every message the chat endpoint accepts: plain turns, a turn that called tools, and tool results. */
export type ChatWireMessage =
  | ChatMessage
  | { role: "assistant"; content: string | null; tool_calls: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** A tool offered to the model (OpenAI function-calling format). */
export type ChatToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

/** A tool call as the server sent it. `arguments` is whatever arrived: a string, an object or nothing. */
export type RawToolCall = { id?: string; name: string; arguments: unknown };

export type JsonMode = "json_schema" | "json_object" | "none";
export const JSON_MODE_CHAIN: readonly JsonMode[] = ["json_schema", "json_object", "none"];

export type JsonSchemaFormat = { name: string; strict?: boolean; schema: Record<string, unknown> };

export function chatCompletionBody(input: {
  model: string;
  messages: readonly ChatWireMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: JsonMode;
  jsonSchema?: JsonSchemaFormat;
  stream?: boolean;
  /** Offered tools; left out of the body when empty. */
  tools?: readonly ChatToolDefinition[];
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    temperature: input.temperature ?? 0.2,
  };
  if (input.maxTokens) body.max_tokens = input.maxTokens;
  if (input.stream) body.stream = true;
  if (input.jsonMode === "json_object") body.response_format = { type: "json_object" };
  if (input.jsonMode === "json_schema" && input.jsonSchema) body.response_format = { type: "json_schema", json_schema: input.jsonSchema };
  if (input.tools?.length) {
    body.tools = input.tools;
    body.tool_choice = "auto";
  }
  return body;
}

/**
 * Whether a failed request means the server or model can't take `tools`
 * (Ollama: 400 "does not support tools"; llama.cpp without --jinja: 500
 * mentioning tools). Only the status and a keyword test are used.
 */
export function isToolsRejection(status: number, bodyText: string): boolean {
  if (status === 400 || status === 415 || status === 422 || status === 501) return true;
  return status >= 500 && /\btools?\b|tool_choice|function|jinja/i.test(bodyText);
}

/**
 * Whether a failed request should be retried with the next JSON mode. Only the
 * status and a keyword test are used; the body is never surfaced.
 */
export function isResponseFormatRejection(status: number, bodyText: string): boolean {
  if (status === 400 || status === 415 || status === 422) return true;
  return status >= 500 && /response_format|json_schema|json_object|grammar/i.test(bodyText);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** `choices[0].message.content` of a non-streaming reply. */
export function chatCompletionContent(payload: unknown): string | undefined {
  const choices = record(payload)?.choices;
  if (!Array.isArray(choices)) return undefined;
  const message = record(record(choices[0])?.message);
  const content = message?.content;
  return typeof content === "string" ? content : undefined;
}

function rawToolCall(value: unknown): RawToolCall | undefined {
  const call = record(value);
  const fn = record(call?.function);
  const name = fn?.name;
  if (typeof name !== "string" || !name.trim()) return undefined;
  return { id: typeof call?.id === "string" && call.id ? call.id : undefined, name: name.trim(), arguments: fn?.arguments };
}

/**
 * `choices[0].message.tool_calls` of a non-streaming reply, plus the older
 * single `function_call` shape.
 */
export function chatCompletionToolCalls(payload: unknown): RawToolCall[] {
  const choices = record(payload)?.choices;
  if (!Array.isArray(choices)) return [];
  const message = record(record(choices[0])?.message);
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls.map(rawToolCall) : [];
  const legacy = message?.function_call ? [rawToolCall({ function: message.function_call })] : [];
  return [...calls, ...legacy].filter((call): call is RawToolCall => Boolean(call));
}

/** One fragment of a streamed tool call: the first carries the id and name, the rest pieces of the arguments. */
export type ToolCallDelta = { index: number; id?: string; name?: string; arguments?: unknown };

function toolCallDeltas(payload: unknown): ToolCallDelta[] {
  const choices = record(payload)?.choices;
  if (!Array.isArray(choices)) return [];
  const calls = record(record(choices[0])?.delta)?.tool_calls;
  if (!Array.isArray(calls)) return [];
  return calls.flatMap((value, position) => {
    const call = record(value);
    if (!call) return [];
    const fn = record(call.function);
    return [{
      index: typeof call.index === "number" ? call.index : position,
      id: typeof call.id === "string" && call.id ? call.id : undefined,
      name: typeof fn?.name === "string" && fn.name ? fn.name : undefined,
      arguments: fn?.arguments,
    }];
  });
}

/**
 * Joins streamed tool-call fragments by index. String argument pieces are
 * concatenated; a server that sends the arguments as one object is kept as is.
 */
export function createToolCallAccumulator() {
  const calls = new Map<number, { id?: string; name: string; text: string; value?: unknown }>();
  return {
    push(delta: ToolCallDelta) {
      const call = calls.get(delta.index) ?? { name: "", text: "" };
      if (delta.id) call.id = delta.id;
      // Most servers send the name once; some repeat it with every fragment.
      if (delta.name && call.name !== delta.name) call.name += delta.name;
      if (typeof delta.arguments === "string") call.text += delta.arguments;
      else if (delta.arguments !== undefined && delta.arguments !== null) call.value = delta.arguments;
      calls.set(delta.index, call);
    },
    calls(): RawToolCall[] {
      return [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => ({ id: call.id, name: call.name.trim(), arguments: call.value ?? call.text }))
        .filter((call) => call.name);
    },
  };
}

/** `choices[0].delta.content` of one streamed chunk. */
export function chatCompletionDelta(payload: unknown): string | undefined {
  const choices = record(payload)?.choices;
  if (!Array.isArray(choices)) return undefined;
  const delta = record(record(choices[0])?.delta);
  const content = delta?.content;
  return typeof content === "string" ? content : undefined;
}

/** Model ids from `/v1/models` ({data:[{id}]}) or Ollama's `/api/tags` ({models:[{name}]}). */
export function modelIdsFromList(payload: unknown): string[] {
  const root = record(payload);
  const out: string[] = [];
  for (const entry of Array.isArray(root?.data) ? root.data : []) {
    const id = record(entry)?.id;
    if (typeof id === "string" && id.trim()) out.push(id.trim());
  }
  for (const entry of Array.isArray(root?.models) ? root.models : []) {
    const row = record(entry);
    const id = row?.model ?? row?.name;
    if (typeof id === "string" && id.trim()) out.push(id.trim());
  }
  return [...new Set(out)];
}

/**
 * Incremental SSE decoder for chat streams. Feed it text as it arrives; it
 * calls `onDelta` for each content token and `onDone` at `data: [DONE]`.
 */
export function createChatStreamDecoder(handlers: {
  onDelta: (text: string) => void;
  onToolCall?: (delta: ToolCallDelta) => void;
  onDone?: () => void;
}) {
  let buffer = "";
  let done = false;
  const handleLine = (line: string) => {
    if (done || !line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data) return;
    if (data === "[DONE]") {
      done = true;
      handlers.onDone?.();
      return;
    }
    try {
      const payload: unknown = JSON.parse(data);
      const delta = chatCompletionDelta(payload);
      if (delta) handlers.onDelta(delta);
      if (handlers.onToolCall) for (const call of toolCallDeltas(payload)) handlers.onToolCall(call);
    } catch {
      // A malformed keep-alive or comment line is skipped.
    }
  };
  return {
    push(text: string) {
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    },
    end() {
      if (buffer) handleLine(buffer);
      buffer = "";
      if (!done) {
        done = true;
        handlers.onDone?.();
      }
    },
    get done() {
      return done;
    },
  };
}
