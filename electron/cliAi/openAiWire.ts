/**
 * CLI output → the OpenAI wire format the renderer already reads (pure).
 *
 * Streams are Server-Sent Events of `chat.completion.chunk`s with text deltas
 * only; tool calls never appear here because the CLI runs the tool loop
 * itself (they reach the renderer as `tool_call` stream events instead).
 */
import { randomUUID } from "node:crypto";

export type WireIdentity = { id: string; created: number; model: string };

export function wireIdentity(model: string): WireIdentity {
  return { id: `chatcmpl-${randomUUID()}`, created: Math.floor(Date.now() / 1000), model: model || "default" };
}

function chunk(identity: WireIdentity, delta: Record<string, string>, finishReason: string | null) {
  const payload = {
    id: identity.id,
    object: "chat.completion.chunk",
    created: identity.created,
    model: identity.model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** The first chunk names the role; later ones carry text. */
export function sseTextChunk(identity: WireIdentity, text: string, first = false): string {
  return chunk(identity, first ? { role: "assistant", content: text } : { content: text }, null);
}

/** The closing chunk (`finish_reason: "stop"`) and the `[DONE]` marker. */
export function sseFinish(identity: WireIdentity): string {
  return `${chunk(identity, {}, "stop")}data: [DONE]\n\n`;
}

export function chatCompletionJson(identity: WireIdentity, text: string): string {
  return JSON.stringify({
    id: identity.id,
    object: "chat.completion",
    created: identity.created,
    model: identity.model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
  });
}

export function modelListJson(ids: readonly string[]): string {
  return JSON.stringify({ object: "list", data: ids.map((id) => ({ id, object: "model", owned_by: "cli" })) });
}
