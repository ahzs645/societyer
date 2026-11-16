/**
 * The AI notes draft with the on-device model (browser-local workspace and the
 * desktop app), the pure part: no React, no runtime imports, so it runs under
 * Node in scripts/check-meeting-notes-draft.ts.
 *
 *   notes + transcript -> device model (shared prompt; long transcripts in parts)
 *   -> parseNotesDraft -> mergeNotesDrafts
 *
 * The caller writes the result through the portable `meetings:saveNotesDraft`,
 * which normalises it again and stays authoritative.
 */
import {
  heuristicNotesDraft,
  mergeNotesDrafts,
  NOTES_DRAFT_JSON_SCHEMA,
  parseNotesDraft,
  planNotesDraftRequests,
  type NotesDraft,
  type NotesDraftInput,
} from "../../../shared/ai/notesDraft";
import type { DeviceAiClient } from "../../lib/localAi/client";

export async function draftNotesOnDevice(input: {
  client: Pick<DeviceAiClient, "completeJson">;
  draft: NotesDraftInput;
  chunkChars: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ draft: NotesDraft; requests: number; chunked: boolean }> {
  if (!input.draft.notes.trim() && !input.draft.transcript.trim()) throw new Error("Write some notes or add a transcript first.");
  const plan = planNotesDraftRequests(input.draft, input.chunkChars);
  const parts: NotesDraft[] = [];
  for (const [index, request] of plan.requests.entries()) {
    input.onProgress?.(index, plan.requests.length);
    const reply = await input.client.completeJson({
      messages: request.messages,
      jsonSchema: NOTES_DRAFT_JSON_SCHEMA as never,
      signal: input.signal,
    });
    // A reply that is not JSON falls back to the rule-based draft for that part.
    parts.push(parseNotesDraft(reply.text, heuristicNotesDraft(request.input)));
  }
  input.onProgress?.(plan.requests.length, plan.requests.length);
  return { draft: mergeNotesDrafts(parts), requests: plan.requests.length, chunked: plan.chunked };
}
