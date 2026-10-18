/**
 * Reading tool calls from local models, which are inconsistent about it.
 *
 * - Arguments arrive as a JSON string (OpenAI), an object (some Ollama
 *   builds), a string JSON-encoded twice (some llama.cpp and LM Studio
 *   templates), inside a code fence, or not at all.
 * - Models whose server does not parse tool calls write them in the reply
 *   text: `<tool_call>{…}</tool_call>` (Qwen, Hermes), `[TOOL_CALLS][…]`
 *   (Mistral), or a bare `{"name": …, "arguments": …}` object.
 *
 * Nothing here throws: a call whose arguments can't be read becomes an error
 * result the model sees, so it can try again.
 */
import type { RawToolCall } from "../../../shared/ai/openAiCompatible";

export type ToolArguments = Record<string, unknown>;

export type DecodedArguments = { ok: true; value: ToolArguments } | { ok: false; message: string };

function isPlainObject(value: unknown): value is ToolArguments {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripFence(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : text.trim();
}

/** The call's arguments as an object, however the server encoded them. */
export function decodeToolArguments(raw: unknown): DecodedArguments {
  let value = raw;
  // A string may hold JSON, or JSON of a JSON string; unwrap at most twice.
  for (let depth = 0; depth < 3 && typeof value === "string"; depth += 1) {
    const text = stripFence(value);
    if (!text) return { ok: true, value: {} };
    try {
      value = JSON.parse(text);
    } catch {
      return { ok: false, message: "The arguments were not valid JSON. Send them as a JSON object." };
    }
  }
  if (value === undefined || value === null) return { ok: true, value: {} };
  if (isPlainObject(value)) return { ok: true, value };
  return { ok: false, message: "The arguments must be a JSON object." };
}

function callFrom(value: unknown, knownNames: ReadonlySet<string>): RawToolCall | undefined {
  if (!isPlainObject(value)) return undefined;
  // `{ name, arguments }`, `{ name, parameters }`, or `{ function: { name, arguments } }`.
  const fn = isPlainObject(value.function) ? value.function : value;
  const name = typeof fn.name === "string" ? fn.name.trim() : "";
  if (!knownNames.has(name)) return undefined;
  return { id: typeof value.id === "string" ? value.id : undefined, name, arguments: fn.arguments ?? fn.parameters };
}

function callsFromJson(text: string, knownNames: ReadonlySet<string>): RawToolCall[] {
  try {
    const parsed: unknown = JSON.parse(text);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const calls = items.map((item) => callFrom(item, knownNames)).filter((call): call is RawToolCall => Boolean(call));
    return calls.length === items.length ? calls : [];
  } catch {
    return [];
  }
}

/**
 * Tool calls written in the reply text, for servers that pass them through
 * unparsed. Only names in `knownNames` count, and the text must be nothing
 * but the calls, so an answer that merely quotes JSON stays an answer.
 */
export function toolCallsFromText(text: string, knownNames: ReadonlySet<string>): RawToolCall[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const tagged = [...trimmed.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)];
  if (tagged.length) {
    const rest = trimmed.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
    if (rest) return [];
    const calls = tagged.flatMap((match) => callsFromJson(stripFence(match[1]), knownNames));
    return calls.length === tagged.length ? calls : [];
  }
  const mistral = trimmed.match(/^\[TOOL_CALLS\]\s*([\s\S]+)$/);
  if (mistral) return callsFromJson(stripFence(mistral[1]), knownNames);
  const body = stripFence(trimmed);
  return body.startsWith("{") || body.startsWith("[") ? callsFromJson(body, knownNames) : [];
}
