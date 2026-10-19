/**
 * On-device minutes drafting, the pure part (no React, no runtime imports) so
 * it runs under Node in scripts/check-minutes-draft-shared.ts.
 *
 *   transcript -> device model (shared prompt; long transcripts in parts)
 *   -> parseMinutesDraft -> mergeMinuteDrafts -> draftToMinutesArgs
 *
 * The caller then writes the result through the portable
 * `minutes:upsertFromDraft`, which stays authoritative.
 */
import { heuristicMinutesDraft, MINUTES_DRAFT_JSON_SCHEMA, parseMinutesDraft, type MinuteDraft } from "../../../shared/ai/minutesDraft";
import { mergeMinuteDrafts, planMinutesDraftRequests } from "../../../shared/ai/minutesDraftChunks";
import { draftToMinutesArgs, type DraftMeeting, type MinutesDraftUpsertArgs } from "../../../shared/ai/draftToMinutesArgs";
import { minutesDraftBlocker } from "../../../shared/minutesDraftInput";
import type { DeviceAiClient } from "../../lib/localAi/client";

export type LocalDraftMeeting = DraftMeeting & {
  title: string;
  type: string;
  /** The template the minutes were seeded from: its defaults are not recorded content. */
  templateSnapshotJson?: string;
};

export type LocalDraftResult = {
  args: MinutesDraftUpsertArgs;
  /** Model requests made (more than one when the transcript was drafted in parts). */
  requests: number;
  chunked: boolean;
};

/**
 * The pure core: refuse adopted minutes or recorded sections before any model
 * call, then one structured request per transcript part, parsed over the
 * rule-based draft for that part, then merged. A reply that is not JSON falls
 * back to the rule-based draft (as the server does); a failed request throws
 * so nothing is written.
 */
export async function draftMinutesOnDevice(input: {
  client: Pick<DeviceAiClient, "completeJson">;
  meeting: LocalDraftMeeting;
  transcript: string;
  /** The meeting's current minutes row (or null), for the draft-blocker pre-check. */
  existingMinutes: unknown;
  chunkChars: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}): Promise<LocalDraftResult> {
  // Stored as given, like the server action (the page already trims it).
  const transcript = input.transcript;
  if (!transcript.trim()) throw new Error("Add a transcript first.");
  // Refuse before calling the model; the upsert repeats this check.
  const blocker = minutesDraftBlocker(input.existingMinutes, input.meeting);
  if (blocker) throw new Error(blocker);
  const meta = { meetingTitle: input.meeting.title, meetingType: input.meeting.type };
  const plan = planMinutesDraftRequests({ ...meta, transcript }, input.chunkChars);
  const parts: MinuteDraft[] = [];
  for (const [index, request] of plan.requests.entries()) {
    input.onProgress?.(index, plan.requests.length);
    const reply = await input.client.completeJson({
      messages: request.messages,
      jsonSchema: MINUTES_DRAFT_JSON_SCHEMA,
      signal: input.signal,
    });
    parts.push(parseMinutesDraft(reply.text, heuristicMinutesDraft({ ...meta, transcript: request.transcript })));
  }
  input.onProgress?.(plan.requests.length, plan.requests.length);
  return {
    args: draftToMinutesArgs(input.meeting, mergeMinuteDrafts(parts), transcript),
    requests: plan.requests.length,
    chunked: plan.chunked,
  };
}
