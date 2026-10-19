/**
 * THE ON-DEVICE ASSISTANT'S TOOL LOOP.
 *
 * The model gets the shared agent tools (shared/agentTools) this person may
 * use, as OpenAI function definitions. Each tool call runs through an
 * `AgentToolAdapter` (on the local runtime: `createPortableAgentAdapter`), so
 * the wrapped portable functions apply their own policy as this person:
 * permissions, document access, in-camera redaction, the transcript rule.
 *
 * - Read tools run straight away. Their results go back to the model as JSON
 *   with the `{ untrusted }` wrappers intact, cut to a per-result and a
 *   per-turn budget.
 * - Change tools (`draft`/`write`) never run here: a valid call becomes a
 *   "proposed" record that the chat shows as an approval card, and the model
 *   is told the change awaits approval. `runApprovedChange` runs it on Approve.
 * - Calls to tools that weren't offered are refused; unreadable or invalid
 *   arguments come back to the model as a structured error.
 * - At most `maxSteps` model requests; the last one offers no tools, so the
 *   model has to answer. Abort stops between and during steps.
 * - A server that refuses `tools` gets the turn again without them.
 */
import { z } from "zod";
import {
  AGENT_TOOLS,
  AgentToolError,
  agentToolInputSchema,
  agentToolsFor,
  findAgentTool,
  type AgentTool,
  type AgentToolAdapter,
} from "../../../shared/agentTools";
import type { ChatToolDefinition, ChatWireMessage, RawToolCall } from "../../../shared/ai/openAiCompatible";
import { clip, DEVICE_TOOL_RECORD_LIMITS, type DeviceToolRecord } from "../../../shared/ai/deviceToolRecords";
import type { ChatStepResult, DeviceAiClient } from "./client";
import { DeviceAiError } from "./transport";
import { decodeToolArguments, toolCallsFromText, type ToolArguments } from "./toolCalls";

export type { DeviceToolRecord } from "../../../shared/ai/deviceToolRecords";

export const DEVICE_TOOL_MAX_STEPS = 6;
/** One tool result as the model sees it, in characters of JSON. */
export const DEVICE_TOOL_RESULT_MAX_CHARS = 12_000;
/** Every tool result of one turn together. */
export const DEVICE_TOOL_TURN_MAX_CHARS = 40_000;
export const DEVICE_TOOL_CALLS_PER_STEP = 4;
/** Below this, a lookup isn't worth running; the model is told to answer. */
const MIN_USEFUL_RESULT_CHARS = 400;

export const OUT_OF_STEPS_ANSWER =
  "I couldn't finish looking this up in the steps I'm allowed for one question. Try a narrower question, for example about one meeting or a date range.";

const PROPOSAL_NOTE =
  "Shown to the person as a proposed change with Approve and Dismiss. Nothing has been changed. Tell them what you proposed and that it is waiting for their approval.";

/** The tools the on-device assistant offers this person: reads, and changes only when allowed. */
export function deviceAssistantTools(input: { permissions: readonly string[]; proposeChanges: boolean }): AgentTool[] {
  return agentToolsFor({ surface: "device", permissions: input.permissions }).filter((tool) => tool.kind === "read" || input.proposeChanges);
}

export function chatToolDefinition(tool: AgentTool): ChatToolDefinition {
  const description = tool.kind === "read"
    ? tool.description
    : `${tool.description} This only proposes the change: the person approves or dismisses it in the chat.`;
  return { type: "function", function: { name: tool.name, description, parameters: agentToolInputSchema(tool) } };
}

export type DeviceAssistantEvent =
  | { type: "token"; text: string }
  /** What this step streamed was a tool call, not the answer: clear it. */
  | { type: "discard_text" }
  /** A tool call started ("running") or finished; the same `id` is sent again with the outcome. */
  | { type: "tool"; record: DeviceToolRecord }
  /** The server refused tools; this turn continues without them. */
  | { type: "tools_unavailable" };

export type DeviceAssistantTurn = {
  text: string;
  /** Finished calls, in order (no "running" records). */
  records: DeviceToolRecord[];
  toolsUnavailable: boolean;
  steps: number;
};

/** `id` goes back to the server as `tool_call_id`; `recordId` is unique across turns (servers reuse ids). */
type Call = RawToolCall & { id: string; recordId: string };
type Outcome = { record: DeviceToolRecord; content: string };

function aborted(): DeviceAiError {
  return new DeviceAiError("aborted", "The AI request was stopped.");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw aborted();
}

function argumentsText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? {});
}

/** JSON for the model, cut at `max` characters with a note saying so. */
function boundedJson(value: unknown, max: number): string {
  const text = JSON.stringify(value) ?? "null";
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… [cut here: the full result was ${text.length} characters. Ask for a smaller page or a narrower range.]`;
}

function preview(value: unknown): string {
  return clip(JSON.stringify(value, null, 2) ?? "", DEVICE_TOOL_RECORD_LIMITS.resultPreview);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** The chip label for a record; its title arrives as `{ untrusted }` and is only shown, never sent back to the model. */
function titled(prefix: string, value: unknown): string {
  const title = record(record(value).title).untrusted;
  return typeof title === "string" && title ? `${prefix}: ${title}` : prefix;
}

/** "meetings (12)", "transcript 0:00–5:00", "meeting: October board meeting". */
export function describeLookup(tool: AgentTool, result: unknown): string {
  const row = record(result);
  let summary: string;
  if (tool.name === "get_transcript") {
    const segments = Array.isArray(row.segments) ? row.segments.map(record) : [];
    const first = segments[0];
    const last = segments[segments.length - 1];
    summary = row.available === false
      ? `transcript (${row.reason === "in_camera" ? "withheld" : "none"})`
      : first && last
        ? `transcript ${clock(Number(first.startSec) || 0)}–${clock(Number(last.endSec) || 0)}`
        : "transcript (no lines)";
  } else if (tool.name === "get_meeting") {
    summary = titled("meeting", row.meeting);
  } else if (tool.name === "get_document") {
    summary = titled("document", row.document);
  } else if (tool.name === "get_governance_snapshot") {
    summary = "governance snapshot";
  } else {
    // List tools: the first list in the result, with the total that matched.
    const [key, items] = Object.entries(row).find(([, value]) => Array.isArray(value)) ?? [];
    summary = key && Array.isArray(items) ? `${key} (${typeof row.total === "number" ? row.total : items.length})` : tool.title.toLowerCase();
  }
  return clip(summary, DEVICE_TOOL_RECORD_LIMITS.summary);
}

/** What the approval card says the change will do. */
export function describeProposal(tool: AgentTool, input: ToolArguments): string {
  if (tool.name === "create_governance_tasks" && Array.isArray(input.tasks)) {
    const tasks = input.tasks.map(record);
    const titles = tasks.map((task) => `“${String(task.title ?? "Untitled")}”${task.dueDate ? ` due ${String(task.dueDate)}` : ""}`);
    return clip(`Create ${tasks.length} task${tasks.length === 1 ? "" : "s"}: ${titles.join(", ")}`, DEVICE_TOOL_RECORD_LIMITS.summary);
  }
  return clip(tool.title, DEVICE_TOOL_RECORD_LIMITS.summary);
}

function describeChange(tool: AgentTool, result: unknown): string {
  const count = record(result).count;
  if (tool.name === "create_governance_tasks" && typeof count === "number") return `Created ${count} task${count === 1 ? "" : "s"}`;
  return `${tool.title}: done`;
}

/** Runs (or, for a change, proposes) one call. Never throws except on abort. */
async function executeCall(
  call: Call,
  scope: { offered: ReadonlyMap<string, AgentTool>; adapter: AgentToolAdapter; signal?: AbortSignal; maxChars: number },
): Promise<Outcome> {
  const tool = findAgentTool(call.name);
  const base = { id: call.recordId, name: clip(call.name, DEVICE_TOOL_RECORD_LIMITS.name), kind: tool?.kind ?? ("unknown" as const) };
  const fail = (status: "error" | "refused", code: string, message: string, argsJson: string): Outcome => ({
    record: { ...base, status, summary: clip(`${call.name}: ${status === "refused" ? "not allowed" : code.replace(/_/g, " ")}`, DEVICE_TOOL_RECORD_LIMITS.summary), argsJson: clip(argsJson, DEVICE_TOOL_RECORD_LIMITS.argsJson), resultPreview: clip(message, DEVICE_TOOL_RECORD_LIMITS.resultPreview) },
    content: JSON.stringify({ error: { code, message } }),
  });
  const rawArgs = clip(argumentsText(call.arguments), 2_000);

  if (!tool || !scope.offered.has(tool.name)) {
    return fail("refused", "not_available", `${call.name} isn't one of your tools here. Use only the tools you were given.`, rawArgs);
  }
  const decoded = decodeToolArguments(call.arguments);
  if (!decoded.ok) return fail("error", "invalid_input", decoded.message, rawArgs);
  const parsed = tool.input.safeParse(decoded.value);
  if (!parsed.success) return fail("error", "invalid_input", z.prettifyError(parsed.error), rawArgs);
  const input = record(parsed.data);
  const argsJson = JSON.stringify(input);

  if (tool.kind !== "read") {
    if (argsJson.length > DEVICE_TOOL_RECORD_LIMITS.argsJson) return fail("error", "invalid_input", "This change is too large to propose. Propose a smaller one.", rawArgs);
    return {
      record: { ...base, status: "proposed", summary: describeProposal(tool, input), argsJson },
      content: JSON.stringify({ status: "awaiting_approval", message: PROPOSAL_NOTE }),
    };
  }
  if (scope.maxChars < MIN_USEFUL_RESULT_CHARS) {
    return fail("error", "budget_exhausted", "Enough has been looked up for this question. Answer with what you have.", argsJson);
  }
  let result: unknown;
  try {
    result = await tool.run(input, scope.adapter, { signal: scope.signal });
  } catch (error) {
    throwIfAborted(scope.signal);
    const code = error instanceof AgentToolError ? error.code : "failed";
    const message = error instanceof Error ? clip(error.message, 300) : "The lookup failed.";
    return fail("error", code, message, argsJson);
  }
  throwIfAborted(scope.signal);
  return {
    record: { ...base, status: "complete", summary: describeLookup(tool, result), argsJson: clip(argsJson, DEVICE_TOOL_RECORD_LIMITS.argsJson), resultPreview: preview(result) },
    content: boundedJson(result, scope.maxChars),
  };
}

export async function runDeviceAssistantTurn(input: {
  client: Pick<DeviceAiClient, "chatStep">;
  adapter: AgentToolAdapter;
  /** System prompt (with the tool rules) and history, oldest first. */
  messages: readonly ChatWireMessage[];
  /** The same conversation with the no-tools prompt, used when the server refuses tools. */
  messagesWithoutTools?: readonly ChatWireMessage[];
  tools: readonly AgentTool[];
  onEvent?: (event: DeviceAssistantEvent) => void;
  signal?: AbortSignal;
  maxSteps?: number;
  maxResultChars?: number;
  maxTurnChars?: number;
  /** Prefix that keeps record ids unique across turns (random by default). */
  turnId?: string;
}): Promise<DeviceAssistantTurn> {
  const emit = (event: DeviceAssistantEvent) => input.onEvent?.(event);
  const offered = new Map(input.tools.map((tool) => [tool.name, tool]));
  const definitions = input.tools.map(chatToolDefinition);
  const knownNames = new Set(AGENT_TOOLS.map((tool) => tool.name));
  const maxSteps = Math.max(1, input.maxSteps ?? DEVICE_TOOL_MAX_STEPS);
  const maxResultChars = input.maxResultChars ?? DEVICE_TOOL_RESULT_MAX_CHARS;
  let budget = input.maxTurnChars ?? DEVICE_TOOL_TURN_MAX_CHARS;
  let messages: ChatWireMessage[] = [...input.messages];
  let toolsOn = definitions.length > 0;
  let toolsUnavailable = false;
  let steps = 0;
  const records: DeviceToolRecord[] = [];
  const turnId = input.turnId ?? globalThis.crypto.randomUUID().slice(0, 8);

  const ask = async (offerTools: boolean): Promise<ChatStepResult | null> => {
    try {
      return await input.client.chatStep({
        messages,
        tools: offerTools ? definitions : undefined,
        onToken: (text) => emit({ type: "token", text }),
        signal: input.signal,
      });
    } catch (error) {
      const refused = error instanceof DeviceAiError && error.code === "tools_unsupported";
      if (!refused || !offerTools || records.length) throw error;
      toolsOn = false;
      toolsUnavailable = true;
      messages = [...(input.messagesWithoutTools ?? input.messages)];
      emit({ type: "tools_unavailable" });
      return null;
    }
  };

  for (;;) {
    throwIfAborted(input.signal);
    // The last request offers no tools, so the model has to answer.
    const offerTools = toolsOn && steps < maxSteps - 1;
    const reply = await ask(offerTools);
    if (!reply) continue;
    steps += 1;

    const calls = offerTools ? (reply.toolCalls.length ? reply.toolCalls : toolCallsFromText(reply.text, knownNames)) : [];
    if (!calls.length) {
      // Out of steps and the model still wrote a call instead of an answer.
      if (toolsOn && toolCallsFromText(reply.text, knownNames).length) {
        emit({ type: "discard_text" });
        emit({ type: "token", text: OUT_OF_STEPS_ANSWER });
        return { text: OUT_OF_STEPS_ANSWER, records, toolsUnavailable, steps };
      }
      return { text: reply.text, records, toolsUnavailable, steps };
    }

    if (reply.text) emit({ type: "discard_text" });
    const batch: Call[] = calls.slice(0, DEVICE_TOOL_CALLS_PER_STEP).map((call, index) => {
      const id = call.id ?? `call_${steps}_${index + 1}`;
      return { ...call, id, recordId: clip(`${turnId}-${id}`, DEVICE_TOOL_RECORD_LIMITS.id) };
    });
    messages.push({
      role: "assistant",
      // Text next to structured calls is the model's own preamble; text that *was* the calls isn't repeated.
      content: reply.toolCalls.length && reply.text.trim() ? reply.text : null,
      tool_calls: batch.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: argumentsText(call.arguments) } })),
    });
    for (const call of batch) {
      throwIfAborted(input.signal);
      const tool = findAgentTool(call.name);
      emit({ type: "tool", record: { id: call.recordId, name: clip(call.name, DEVICE_TOOL_RECORD_LIMITS.name), kind: tool?.kind ?? "unknown", status: "running", summary: tool?.title ?? call.name, argsJson: clip(argumentsText(call.arguments), 2_000) } });
      const outcome = await executeCall(call, { offered, adapter: input.adapter, signal: input.signal, maxChars: Math.min(maxResultChars, budget) });
      if (outcome.record.status === "complete") budget -= outcome.content.length;
      records.push(outcome.record);
      emit({ type: "tool", record: outcome.record });
      messages.push({ role: "tool", tool_call_id: call.id, content: outcome.content });
    }
  }
}

/**
 * Runs a change the person approved, exactly as proposed, as them. The tool
 * must still be offered to them (their permissions and the "propose changes"
 * setting); the wrapped mutation checks permissions again.
 */
export async function runApprovedChange(
  adapter: AgentToolAdapter,
  proposal: DeviceToolRecord,
  offered: readonly AgentTool[],
): Promise<DeviceToolRecord> {
  const tool = offered.find((candidate) => candidate.name === proposal.name);
  if (proposal.status !== "proposed" || !tool || tool.kind === "read") {
    throw new Error("This change can't be approved here. Check that proposing changes is still allowed in On-device AI settings.");
  }
  const decoded = decodeToolArguments(proposal.argsJson);
  if (!decoded.ok) throw new Error("This proposed change can't be read any more.");
  const result = await tool.run(decoded.value, adapter);
  return {
    id: clip(`${proposal.id}:approved`, DEVICE_TOOL_RECORD_LIMITS.id),
    name: proposal.name,
    kind: tool.kind,
    status: "executed",
    summary: describeChange(tool, result),
    argsJson: proposal.argsJson,
    resultPreview: preview(result),
    resolves: proposal.id,
  };
}

/** The record saved when the person dismisses a proposal. Nothing runs. */
export function dismissedChange(proposal: DeviceToolRecord): DeviceToolRecord {
  return {
    id: clip(`${proposal.id}:dismissed`, DEVICE_TOOL_RECORD_LIMITS.id),
    name: proposal.name,
    kind: proposal.kind,
    status: "dismissed",
    summary: "Dismissed: nothing was changed",
    argsJson: proposal.argsJson,
    resolves: proposal.id,
  };
}
