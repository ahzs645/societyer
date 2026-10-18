/**
 * Long transcripts on small local models.
 *
 * A local model often has a context window of a few thousand tokens. When a
 * transcript is longer than the configured character budget it is split on
 * line boundaries, each part is drafted on its own, and the partial drafts are
 * merged here without another model call (the merge itself would not fit a
 * small window either). Short transcripts take the single-request path, which
 * is byte-for-byte the request the hosted server sends.
 */
import {
  buildMinutesDraftMessages,
  MINUTES_DRAFT_SYSTEM_PROMPT,
  minutesDraftUserPrompt,
  type ChatMessage,
  type MinuteDraft,
  type MinutesDraftInput,
} from "./minutesDraft";

/** About 2,000 tokens of transcript: leaves room for the prompt and reply in a 4k window. */
export const DEFAULT_MINUTES_CHUNK_CHARS = 8000;
export const MIN_MINUTES_CHUNK_CHARS = 1000;
export const MAX_MINUTES_CHUNK_CHARS = 200_000;

export function clampChunkChars(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_MINUTES_CHUNK_CHARS;
  return Math.min(MAX_MINUTES_CHUNK_CHARS, Math.max(MIN_MINUTES_CHUNK_CHARS, Math.floor(number)));
}

/** Splits on line breaks; a single line longer than the budget is cut at a space. */
export function splitTranscript(transcript: string, budgetChars: number): string[] {
  const budget = clampChunkChars(budgetChars);
  if (transcript.length <= budget) return [transcript];
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) chunks.push(current);
    current = "";
  };
  for (const line of transcript.split("\n")) {
    let rest = line;
    while (rest.length > budget) {
      flush();
      const cut = rest.lastIndexOf(" ", budget);
      const at = cut > budget / 2 ? cut : budget;
      chunks.push(rest.slice(0, at));
      rest = rest.slice(at);
    }
    const next = current ? `${current}\n${rest}` : rest;
    if (next.length > budget) {
      flush();
      current = rest;
    } else {
      current = next;
    }
  }
  flush();
  return chunks;
}

export type MinutesDraftRequestPlan = {
  /** One entry per model request, in transcript order. */
  requests: Array<{ transcript: string; messages: ChatMessage[] }>;
  chunked: boolean;
};

/** One request for a short transcript; one request per part for a long one. */
export function planMinutesDraftRequests(input: MinutesDraftInput, budgetChars: number): MinutesDraftRequestPlan {
  const parts = splitTranscript(input.transcript, budgetChars);
  if (parts.length === 1) {
    return { chunked: false, requests: [{ transcript: input.transcript, messages: buildMinutesDraftMessages(input) }] };
  }
  return {
    chunked: true,
    requests: parts.map((part, index) => ({
      transcript: part,
      messages: [
        { role: "system", content: MINUTES_DRAFT_SYSTEM_PROMPT },
        {
          role: "user",
          content: `This is part ${index + 1} of ${parts.length} of one meeting's transcript. Draft only what this part contains; the parts are combined afterwards.\n\n${minutesDraftUserPrompt({ ...input, transcript: part })}`,
        },
      ],
    })),
  };
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}

function first<T>(values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined);
}

function last<T>(values: Array<T | undefined>): T | undefined {
  return [...values].reverse().find((value) => value !== undefined);
}

function concatOptional<T>(lists: Array<T[] | undefined>): T[] | undefined {
  const out = lists.flatMap((list) => list ?? []);
  return out.length ? out : undefined;
}

/**
 * Combines per-part drafts in transcript order. Lists are concatenated (motion
 * and action order is the order they were spoken), names are de-duplicated,
 * opening facts come from the first part that states them and closing facts
 * from the last. Someone who spoke in any part is not listed as absent.
 */
export function mergeMinuteDrafts(parts: MinuteDraft[]): MinuteDraft {
  if (parts.length === 1) return parts[0];
  const attendees = unique(parts.flatMap((part) => part.attendees));
  const present = new Set(attendees.map((name) => name.toLowerCase()));
  const attendanceByName = new Map<string, NonNullable<MinuteDraft["detailedAttendance"]>[number]>();
  for (const row of parts.flatMap((part) => part.detailedAttendance ?? [])) {
    const key = row.name.toLowerCase();
    const existing = attendanceByName.get(key);
    if (!existing || (existing.status !== "present" && row.status === "present")) attendanceByName.set(key, row);
  }
  return {
    chairName: first(parts.map((part) => part.chairName)),
    secretaryName: first(parts.map((part) => part.secretaryName)),
    recorderName: first(parts.map((part) => part.recorderName)),
    calledToOrderAt: first(parts.map((part) => part.calledToOrderAt)),
    adjournedAt: last(parts.map((part) => part.adjournedAt)),
    remoteParticipation: first(parts.map((part) => part.remoteParticipation)),
    detailedAttendance: attendanceByName.size ? [...attendanceByName.values()] : undefined,
    discussion: parts.map((part) => part.discussion.trim()).filter(Boolean).join("\n\n"),
    sections: concatOptional(parts.map((part) => part.sections)),
    motions: parts.flatMap((part) => part.motions),
    decisions: unique(parts.flatMap((part) => part.decisions)),
    actionItems: parts.flatMap((part) => part.actionItems),
    attendees,
    absent: unique(parts.flatMap((part) => part.absent)).filter((name) => !present.has(name.toLowerCase())),
    nextMeetingAt: last(parts.map((part) => part.nextMeetingAt)),
    nextMeetingLocation: last(parts.map((part) => part.nextMeetingLocation)),
    nextMeetingNotes: last(parts.map((part) => part.nextMeetingNotes)),
    sessionSegments: concatOptional(parts.map((part) => part.sessionSegments)),
    appendices: concatOptional(parts.map((part) => part.appendices)),
    agmDetails: first(parts.map((part) => part.agmDetails)),
  };
}
