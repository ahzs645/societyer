/**
 * PORTABLE FUNCTIONS: the transcripts domain (transcript rows + transcription
 * jobs + VTT/plain-text import).
 *
 * Only the pure `ctx.db` handlers live here. The end-to-end `runPipeline`
 * action (which touches `ctx.storage`, transcription/LLM providers, and the
 * scheduler) stays on Convex.
 *
 * Each handler reads/writes exclusively through the portable `ctx.db` contract
 * and runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle.
 */

import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, requireSocietyMembership } from "./access";
import { requirePermissionPortable } from "./permissions";
import { requireTranscriptReaderPortable, transcriptForReader } from "./minutesPrivacy";
import { IN_CAMERA_TITLE, inCameraSessionChoices, isInCameraType } from "../minutesPrivacy";

import {
  normalizeTranscriptText,
  speakerResolver,
  transcriptText,
  SPEAKER_MERGE_MAX_DEPTH,
  validateTranscriptSegments,
  validateTranscriptRef,
  TRANSCRIPT_ROW_LIMIT,
} from "../transcriptModel";
import type {
  TranscriptRef,
  TranscriptSegment as TranscriptSegmentRow,
  TranscriptSpeaker,
} from "../transcriptModel";

async function upsertTranscriptRow(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    meetingId: string;
    provider: string;
    durationSeconds?: number;
    language?: string;
    text: string;
    segments: TranscriptSegmentRow[];
    storageKey?: string;
    demo: boolean;
  },
): Promise<string> {
  const existing = await ctx.db
    .query("transcripts")
    .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
    .collect();
  if (existing[0]) {
    await ctx.db.patch(existing[0]._id, {
      pagedJobId: undefined, contentRevision: `${Date.now()}:${Math.random()}`, segmentCount: undefined, pageCount: undefined,
      provider: args.provider,
      durationSeconds: args.durationSeconds,
      language: args.language,
      text: args.text,
      segments: args.segments,
      storageKey: args.storageKey,
      demo: args.demo,
    });
    return existing[0]._id;
  }
  return await ctx.db.insert("transcripts", {
    ...args,
    createdAtISO: new Date().toISOString(),
  });
}

async function syncMinutesDraftTranscript(
  ctx: PortableMutationCtx,
  meetingId: string,
  text: string,
) {
  const existingMinutes = await ctx.db
    .query("minutes")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  if (
    existingMinutes[0] &&
    !existingMinutes[0].approvedAt &&
    !existingMinutes[0].adoptedSnapshot &&
    !Array.isArray(existingMinutes[0].motionSnapshots)
  ) {
    await ctx.db.patch(existingMinutes[0]._id, { draftTranscript: text });
  }
}

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function stripMarkup(text: string): string {
  return decodeHtml(
    text
      .replace(/<\/?v[^>]*>/gi, "")
      .replace(/<\/?c[^>]*>/gi, "")
      .replace(/<\/?i>/gi, "")
      .replace(/<\/?b>/gi, "")
      .replace(/<\/?u>/gi, "")
      .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "")
      .replace(/<\d{2}:\d{2}\.\d{3}>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function parseTimestamp(value: string): number {
  const normalized = value.trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length < 2 || parts.length > 3) return 0;
  const last = Number(parts[parts.length - 1]);
  const minutes = Number(parts[parts.length - 2]);
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if (![hours, minutes, last].every(Number.isFinite)) return 0;
  return hours * 3600 + minutes * 60 + last;
}

function textToSegments(text: string): TranscriptSegmentRow[] {
  const lines = text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line, index) => {
    const match = line.match(/^([^:]{1,80}):\s+(.+)$/);
    const speaker = match ? match[1].trim() : "Speaker";
    const body = match ? match[2].trim() : line;
    return {
      speaker,
      text: body,
      startSec: index * 5,
      endSec: index * 5 + 5,
    };
  });
}

function parseVttTranscript(vttText: string): {
  text: string;
  segments: TranscriptSegmentRow[];
  durationSeconds: number;
} {
  const lines = vttText.replace(/^﻿/, "").replace(/\r/g, "").split("\n");
  const segments: TranscriptSegmentRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line || /^WEBVTT$/i.test(line)) continue;

    if (/^(NOTE|STYLE|REGION)\b/i.test(line)) {
      while (i + 1 < lines.length && lines[i + 1].trim()) i++;
      continue;
    }

    if (!line.includes("-->") && i + 1 < lines.length && lines[i + 1].includes("-->")) {
      i++;
      line = lines[i].trim();
    }

    if (!line.includes("-->")) continue;

    const [rawStart, rawEnd] = line.split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const startSec = parseTimestamp(rawStart);
    const endSec = parseTimestamp(rawEnd);

    const payload: string[] = [];
    while (i + 1 < lines.length && lines[i + 1].trim()) {
      i++;
      payload.push(lines[i]);
    }

    const joined = payload.join(" ").trim();
    if (!joined) continue;

    const voiceMatch = joined.match(/<v(?:\.[^ >]+)?\s+([^>]+)>([\s\S]*)$/i);
    let speaker = voiceMatch?.[1]?.trim() || "";
    let body = voiceMatch?.[2] ?? joined;

    body = stripMarkup(body);
    const inlineSpeaker = body.match(/^([^:]{1,80}):\s+(.+)$/);
    if (!speaker && inlineSpeaker) {
      speaker = inlineSpeaker[1].trim();
      body = inlineSpeaker[2].trim();
    }

    if (!body) continue;
    segments.push({
      speaker: speaker || "Speaker",
      text: body,
      startSec,
      endSec: endSec > startSec ? endSec : startSec,
    });
  }

  return {
    text: segments.map((segment) => `${segment.speaker}: ${segment.text}`).join("\n"),
    segments,
    durationSeconds: segments.at(-1)?.endSec ?? 0,
  };
}

/**
 * The meeting's working transcript. Only the people who keep the minutes may
 * read it (`requireTranscriptReaderPortable`, decision A1). A reader without
 * in-camera access (a connector) gets it with in-camera segments cut out, or
 * withheld whole when they can't be located (`transcriptForReader`).
 */
export async function getByMeetingPortable(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }) {
  const meeting = await requireOwnedRow(ctx, "meetings", meetingId);
  await requireTranscriptReaderPortable(ctx, String(meeting.societyId));
  const rows = await ctx.db
    .query("transcripts")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  return transcriptForReader(ctx, rows[0] ?? null);
}

export async function jobForMeetingPortable(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }) {
  const meeting = await requireOwnedRow(ctx, "meetings", meetingId);
  await requireTranscriptReaderPortable(ctx, String(meeting.societyId));
  const rows = await ctx.db
    .query("transcriptionJobs")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  return rows.sort((a, b) => b.startedAtISO.localeCompare(a.startedAtISO))[0] ?? null;
}

export async function createJobPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; meetingId: string; provider: string },
) {
  await requireSocietyMembership(ctx, args.societyId);
  await getOwned(ctx, "meetings", args.meetingId, args.societyId);
  return await ctx.db.insert("transcriptionJobs", {
    societyId: args.societyId,
    meetingId: args.meetingId,
    status: "queued",
    provider: args.provider,
    startedAtISO: new Date().toISOString(),
    demo: args.provider === "demo",
  });
}

export async function updateJobPortable(
  ctx: PortableMutationCtx,
  { id, patch }: {
    id: string;
    patch: {
      status?: string;
      completedAtISO?: string;
      error?: string;
      transcriptId?: string;
    };
  },
) {
  const authorizedRow = await requireOwnedRow(ctx, "transcriptionJobs", id);
  const societyId = String(authorizedRow.societyId);
  if (patch.transcriptId) await getOwned(ctx, "transcripts", patch.transcriptId, societyId);
  await ctx.db.patch(id, patch);
}

export async function saveTranscriptPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    meetingId: string;
    provider: string;
    durationSeconds?: number;
    language?: string;
    text: string;
    segments: TranscriptSegmentRow[];
    storageKey?: string;
    demo: boolean;
  },
): Promise<string> {
  await requireSocietyMembership(ctx, args.societyId);
  await getOwned(ctx, "meetings", args.meetingId, args.societyId);
  return await upsertTranscriptRow(ctx, args);
}

export async function saveTextPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    meetingId: string;
    text: string;
    provider?: string;
    durationSeconds?: number;
    language?: string;
    storageKey?: string;
    demo?: boolean;
  },
): Promise<string> {
  await requireSocietyMembership(ctx, args.societyId);
  await getOwned(ctx, "meetings", args.meetingId, args.societyId);
  const text = args.text.trim();
  const transcriptId = await upsertTranscriptRow(ctx, {
    societyId: args.societyId,
    meetingId: args.meetingId,
    provider: args.provider ?? "manual",
    durationSeconds: args.durationSeconds,
    language: args.language ?? "en",
    text,
    segments: textToSegments(text),
    storageKey: args.storageKey,
    demo: args.demo ?? false,
  });
  await syncMinutesDraftTranscript(ctx, args.meetingId, text);
  return transcriptId;
}

export async function importVttPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; meetingId: string; vttText: string },
): Promise<string> {
  await requireSocietyMembership(ctx, args.societyId);
  await getOwned(ctx, "meetings", args.meetingId, args.societyId);
  const parsed = parseVttTranscript(args.vttText);
  if (!parsed.text) throw new Error("No transcript cues were found in that VTT file.");
  const transcriptId = await upsertTranscriptRow(ctx, {
    societyId: args.societyId,
    meetingId: args.meetingId,
    provider: "vtt",
    durationSeconds: parsed.durationSeconds,
    language: "en",
    text: parsed.text,
    segments: parsed.segments,
    demo: false,
  });
  await syncMinutesDraftTranscript(ctx, args.meetingId, parsed.text);
  return transcriptId;
}

async function workingTranscript(ctx: PortableMutationCtx, societyId: string, meetingId: string) {
  await requireSocietyMembership(ctx, societyId);
  await getOwned(ctx, "meetings", meetingId, societyId);
  const row = await ctx.db
    .query("transcripts")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .first();
  if (row && row.societyId !== societyId) throw new Error("Transcript belongs to another workspace.");
  return row;
}

/** Include the whole serialized row, UTF-8 bytes, and headroom for storage metadata. */
function boundedTranscript<
  T extends { segments: TranscriptSegmentRow[]; text: string; wordsDropped?: boolean },
>(row: T): T & { wordsDropped: boolean } {
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes(row) + 4096 <= TRANSCRIPT_ROW_LIMIT) {
    return { ...row, wordsDropped: row.wordsDropped ?? false };
  }
  const trimmed = {
    ...row,
    segments: row.segments.map(({ words: _words, ...segment }) => segment),
    wordsDropped: row.wordsDropped || row.segments.some((segment) => Boolean(segment.words?.length)),
  };
  if (bytes(trimmed) + 4096 > TRANSCRIPT_ROW_LIMIT) {
    throw new Error(
      "Transcript exceeds the safe 700 KB working-row limit even without word timings. Import a shorter transcript.",
    );
  }
  return trimmed;
}

export async function assignSpeakerPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; meetingId: string; label: string; name?: string; personId?: string },
) {
  const row = await workingTranscript(ctx, args.societyId, args.meetingId);
  if (!row) throw new Error("Import a transcript first.");
  if (!args.label.trim() || args.label.length > 200 || (args.name?.length ?? 0) > 200) {
    throw new Error("Speaker labels and names must be 1–200 characters.");
  }
  if (args.personId) await getOwned(ctx, "peopleDirectory", args.personId, args.societyId);
  const speakers: TranscriptSpeaker[] = row.speakers ?? [];
  const previous = speakers.find((speaker) => speaker.label === args.label);
  const name = args.name === undefined ? previous?.name : normalizeTranscriptText(args.name);
  const personId = args.personId ?? (args.name === undefined ? previous?.personId : undefined);
  const assignment: TranscriptSpeaker = {
    label: args.label,
    ...(name ? { name } : {}),
    ...(personId ? { personId } : {}),
    ...(previous?.mergedInto ? { mergedInto: previous.mergedInto } : {}),
  };
  const next = [...speakers.filter((speaker) => speaker.label !== args.label), assignment];
  if (next.length > 1000) throw new Error("Use at most 1,000 speaker assignments.");
  if (row.pagedJobId) { await ctx.db.patch(row._id, { speakers: next, contentRevision: `${Date.now()}:${Math.random()}` }); return { wordsDropped: false }; }
  const segments: TranscriptSegmentRow[] = row.segments;
  const bounded = boundedTranscript({
    ...row,
    speakers: next,
    segments,
    text: transcriptText(segments, next),
  });
  await ctx.db.patch(row._id, {
    contentRevision: `${Date.now()}:${Math.random()}`,
    speakers: next,
    segments: bounded.segments,
    text: bounded.text,
    wordsDropped: bounded.wordsDropped,
  });
  await syncMinutesDraftTranscript(ctx, args.meetingId, bounded.text);
  return { wordsDropped: bounded.wordsDropped ?? false };
}

export async function updateSegmentPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; meetingId: string; index: number; text?: string; speaker?: string },
) {
  const row = await workingTranscript(ctx, args.societyId, args.meetingId);
  if (!row) throw new Error("Import a transcript first.");
  const segments: TranscriptSegmentRow[] = [...row.segments];
  if (!Number.isInteger(args.index) || args.index < 0 || args.index >= segments.length) {
    throw new Error("Segment index is out of bounds.");
  }
  const original = segments[args.index];
  const edited = {
    ...original,
    ...(args.text !== undefined ? { text: normalizeTranscriptText(args.text) } : {}),
    ...(args.speaker !== undefined ? { speaker: args.speaker.trim() } : {}),
  };
  if (edited.text !== original.text) delete edited.words;
  segments[args.index] = edited;
  validateTranscriptSegments(segments);
  const speakers: TranscriptSpeaker[] = row.speakers ?? [];
  const bounded = boundedTranscript({ ...row, segments, text: transcriptText(segments, speakers) });
  await ctx.db.patch(row._id, {
    contentRevision: `${Date.now()}:${Math.random()}`,
    segments: bounded.segments,
    text: bounded.text,
    wordsDropped: bounded.wordsDropped,
  });
  await syncMinutesDraftTranscript(ctx, args.meetingId, bounded.text);
  return { wordsDropped: bounded.wordsDropped ?? false };
}

/** Persist a speaker-map change: regenerate `text` and sync an unapproved minutes draft. */
async function saveSpeakerMap(
  ctx: PortableMutationCtx,
  row: PortableDoc,
  meetingId: string,
  speakers: TranscriptSpeaker[],
) {
  if (row.pagedJobId) { await ctx.db.patch(row._id, { speakers, contentRevision: `${Date.now()}:${Math.random()}` }); return { wordsDropped: false }; }
  const segments: TranscriptSegmentRow[] = row.segments;
  const bounded = boundedTranscript({ ...row, segments, speakers, text: transcriptText(segments, speakers) });
  await ctx.db.patch(row._id, {
    contentRevision: `${Date.now()}:${Math.random()}`,
    segments: bounded.segments,
    speakers,
    text: bounded.text,
    wordsDropped: bounded.wordsDropped,
  });
  await syncMinutesDraftTranscript(ctx, meetingId, bounded.text);
  return { wordsDropped: bounded.wordsDropped ?? false };
}

/**
 * Combine one or more speaker labels into another. Segments keep their raw
 * labels; each source gets `mergedInto` on the speaker map, so
 * `unmergeSpeakerPortable` can undo it. Rows merged before this field existed
 * had their segments relabelled and simply have nothing to undo.
 */
export async function mergeSpeakersPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; meetingId: string; from: string | string[]; to: string },
) {
  const row = await workingTranscript(ctx, args.societyId, args.meetingId);
  if (!row) throw new Error("Import a transcript first.");
  const segments: TranscriptSegmentRow[] = row.segments;
  const labels = new Set(row.pagedJobId ? (row.speakers ?? []).map((speaker: TranscriptSpeaker) => speaker.label) : segments.map((segment) => segment.speaker));
  const sources = [...new Set(Array.isArray(args.from) ? args.from : [args.from])];
  if (
    !sources.length ||
    sources.length > 200 ||
    !labels.has(args.to) ||
    sources.some((label) => label === args.to || !labels.has(label))
  ) {
    throw new Error("Choose two different existing speaker labels to merge.");
  }
  const current: TranscriptSpeaker[] = row.speakers ?? [];
  // Point at the speaker the target already resolves to, so chains stay short.
  const target = speakerResolver(current).resolve(args.to);
  if (sources.includes(target)) {
    throw new Error(`${args.to} is already combined into ${target}. Unmerge it first.`);
  }
  const entries = new Map(current.map((speaker) => [speaker.label, speaker]));
  for (const label of sources) {
    entries.set(label, { ...(entries.get(label) ?? { label }), mergedInto: target });
  }
  const speakers = [...entries.values()];
  if (speakers.length > 1000) throw new Error("Use at most 1,000 speaker assignments.");
  const resolver = speakerResolver(speakers);
  if (speakers.some((speaker) => resolver.depth(speaker.label) > SPEAKER_MERGE_MAX_DEPTH)) {
    throw new Error("Those speakers are combined too many levels deep. Unmerge some first.");
  }
  return await saveSpeakerMap(ctx, row, args.meetingId, speakers);
}

/** Undo a combine: the label becomes its own speaker again, keeping its own name. */
export async function unmergeSpeakerPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; meetingId: string; label: string },
) {
  const row = await workingTranscript(ctx, args.societyId, args.meetingId);
  if (!row) throw new Error("Import a transcript first.");
  const current: TranscriptSpeaker[] = row.speakers ?? [];
  const entry = current.find((speaker) => speaker.label === args.label);
  if (!entry?.mergedInto) throw new Error("That speaker is not combined with another.");
  const { mergedInto: _mergedInto, ...standalone } = entry;
  const speakers = current.flatMap((speaker) =>
    speaker.label !== args.label ? [speaker] : row.pagedJobId || standalone.name || standalone.personId ? [standalone] : [],
  );
  return await saveSpeakerMap(ctx, row, args.meetingId, speakers);
}

export async function importTimedPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    meetingId: string;
    /** "local-whisper": transcribed on this device (Transcript tab). */
    provider: "vtt" | "srt" | "whisper-json" | "local-whisper";
    segments: TranscriptSegmentRow[];
    durationSeconds?: number;
  },
) {
  const existing = await workingTranscript(ctx, args.societyId, args.meetingId);
  if (!["vtt", "srt", "whisper-json", "local-whisper"].includes(args.provider)) {
    throw new Error("Unsupported timed transcript provider.");
  }
  if (!args.segments.length || args.segments.length > 20_000) {
    throw new Error("Use between 1 and 20,000 transcript segments.");
  }
  const segments = args.segments.map((segment) => ({
    ...segment,
    speaker: segment.speaker.trim(),
    text: normalizeTranscriptText(segment.text),
  }));
  validateTranscriptSegments(segments);
  const end = segments.reduce((max, segment) => Math.max(max, segment.endSec), 0);
  if (
    args.durationSeconds !== undefined &&
    (!Number.isFinite(args.durationSeconds) || args.durationSeconds < end)
  ) {
    throw new Error("Duration must be finite and include every segment.");
  }
  const row = boundedTranscript({
    societyId: args.societyId,
    meetingId: args.meetingId,
    provider: args.provider,
    segments,
    text: transcriptText(segments),
    durationSeconds: args.durationSeconds ?? end,
    speakers: [],
    demo: false,
    createdAtISO: existing?.createdAtISO ?? new Date().toISOString(),
    wordsDropped: false,
  });
  if (existing) await ctx.db.patch(existing._id, { ...row, storageKey: undefined, language: undefined, pagedJobId: undefined, contentRevision: `${Date.now()}:${Math.random()}`, segmentCount: undefined, pageCount: undefined });
  else await ctx.db.insert("transcripts", row);
  await syncMinutesDraftTranscript(ctx, args.meetingId, row.text);
  return { wordsDropped: row.wordsDropped };
}

type LinkMinutesItemArgs = {
  societyId: string;
  meetingId: string;
  kind: "motion" | "actionItem";
  /** For kind "motion": the first-class motion row. */
  motionId?: string;
  /** For kind "actionItem": omit for a top-level action, or the agenda section's index. */
  sectionIndex?: number;
  actionIndex?: number;
  /** Optional guard: the action's wording as the client saw it. */
  expectedText?: string;
  /** Omit both to clear the link. */
  startSec?: number;
  endSec?: number;
};

type ActionItemRow = { text: string; transcriptRef?: TranscriptRef };

function withTranscriptRef<T extends { transcriptRef?: TranscriptRef }>(item: T, ref: TranscriptRef | undefined) {
  const { transcriptRef: _previous, ...rest } = item;
  return ref ? { ...rest, transcriptRef: ref } : rest;
}

/**
 * Link a draft-minutes motion or action item to the transcript time it was said
 * at, or clear the link. Approved or adopted minutes are frozen and refused.
 */
export async function linkMinutesItemPortable(ctx: PortableMutationCtx, args: LinkMinutesItemArgs) {
  await requireSocietyMembership(ctx, args.societyId);
  await requirePermissionPortable(ctx, args.societyId, "minutes:write");
  await getOwned(ctx, "meetings", args.meetingId, args.societyId);
  const clearing = args.startSec === undefined && args.endSec === undefined;
  const ref = clearing ? undefined : validateTranscriptRef(Number(args.startSec), Number(args.endSec));
  const minutes = await ctx.db
    .query("minutes")
    .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
    .first();
  if (!minutes || minutes.societyId !== args.societyId) throw new Error("This meeting has no minutes yet.");
  if (minutes.approvedAt || minutes.adoptedSnapshot || Array.isArray(minutes.motionSnapshots)) {
    throw new Error("Adopted minutes are frozen. Start an amendment to change recorded content.");
  }
  if (args.kind === "motion") {
    if (!args.motionId) throw new Error("Choose a motion to link.");
    const motion = await getOwned(ctx, "motions", args.motionId, args.societyId);
    if (String(motion.minutesId) !== String(minutes._id)) {
      throw new Error("That motion is not in this meeting's minutes.");
    }
    await ctx.db.patch(motion._id, { transcriptRef: ref, updatedAtISO: new Date().toISOString() });
    return { kind: args.kind, transcriptRef: ref ?? null };
  }
  if (args.kind !== "actionItem") throw new Error("Only motions and action items can be linked.");
  const sections: { actionItems?: ActionItemRow[] }[] = minutes.sections ?? [];
  const inSection = args.sectionIndex !== undefined;
  if (inSection && (!Number.isInteger(args.sectionIndex) || !sections[args.sectionIndex!])) {
    throw new Error("Agenda section is out of bounds.");
  }
  const items: ActionItemRow[] = inSection
    ? (sections[args.sectionIndex!].actionItems ?? [])
    : (minutes.actionItems ?? []);
  const index = args.actionIndex ?? -1;
  if (!Number.isInteger(index) || !items[index]) throw new Error("Action item is out of bounds.");
  if (args.expectedText !== undefined && items[index].text !== args.expectedText) {
    throw new Error("That action item changed since you opened it. Reload the minutes and try again.");
  }
  const nextItems = items.map((item, at) => (at === index ? withTranscriptRef(item, ref) : item));
  if (inSection) {
    await ctx.db.patch(minutes._id, {
      sections: sections.map((section, at) =>
        at === args.sectionIndex ? { ...section, actionItems: nextItems } : section,
      ),
    });
  } else {
    await ctx.db.patch(minutes._id, { actionItems: nextItems });
  }
  return { kind: args.kind, transcriptRef: ref ?? null };
}

type SessionSegmentRow = {
  type: string;
  title?: string;
  startedAt?: string;
  endedAt?: string;
  notes?: string;
  recordingStartSec?: number;
  recordingEndSec?: number;
};

export type MarkInCameraRangeArgs = {
  societyId: string;
  meetingId: string;
  /** An existing in-camera session (segment or section title). Omit to add a new "In-camera session". */
  sessionTitle?: string;
  /** Both, or neither to clear the session's offsets. */
  startSec?: number;
  endSec?: number;
};

function nextSessionTitle(segments: readonly SessionSegmentRow[]): string {
  const taken = new Set(segments.map((segment) => (segment.title ?? "").trim().toLowerCase()));
  if (!taken.has(IN_CAMERA_TITLE.toLowerCase())) return IN_CAMERA_TITLE;
  let index = 2;
  while (taken.has(`${IN_CAMERA_TITLE} ${index}`.toLowerCase())) index += 1;
  return `${IN_CAMERA_TITLE} ${index}`;
}

/**
 * Mark where an in-camera session sits in the recording (decision A2): sets
 * `recordingStartSec`/`recordingEndSec` on the minutes' session segment, adding
 * the segment when the session is only an in-camera section or is new. With
 * every session marked, readers without in-camera access get the transcript
 * with only those parts cut out. Needs `minutes:write`. Approved or adopted
 * minutes are the record and are never touched: marking them is refused.
 */
export async function markInCameraRangePortable(ctx: PortableMutationCtx, args: MarkInCameraRangeArgs) {
  await requireSocietyMembership(ctx, args.societyId);
  await requirePermissionPortable(ctx, args.societyId, "minutes:write");
  await getOwned(ctx, "meetings", args.meetingId, args.societyId);
  const clearing = args.startSec === undefined && args.endSec === undefined;
  if (clearing && !args.sessionTitle) throw new Error("Choose the in-camera session to clear.");
  const range = clearing ? undefined : validateTranscriptRef(Number(args.startSec), Number(args.endSec));
  if (range && range.endSec <= range.startSec) throw new Error("Select a range that lasts at least a moment.");
  const minutes = await ctx.db
    .query("minutes")
    .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
    .first();
  if (!minutes || minutes.societyId !== args.societyId) throw new Error("Start the minutes before marking an in-camera session.");
  if (minutes.approvedAt || minutes.adoptedSnapshot || Array.isArray(minutes.motionSnapshots)) {
    throw new Error("Approved minutes are the record, so their in-camera sessions can't be changed. Start an amendment to change them.");
  }
  const segments: SessionSegmentRow[] = Array.isArray(minutes.sessionSegments) ? minutes.sessionSegments : [];
  const wanted = args.sessionTitle?.trim();
  if (wanted !== undefined && !wanted) throw new Error("Choose an in-camera session.");
  if (wanted && wanted.length > 200) throw new Error("Keep the session title under 200 characters.");
  const key = wanted?.toLowerCase();
  const index = key === undefined ? -1 : segments.findIndex((segment) => isInCameraType(segment.type) && (segment.title?.trim() || IN_CAMERA_TITLE).toLowerCase() === key);
  if (key !== undefined && index < 0 && !inCameraSessionChoices(minutes).some((choice) => choice.title.toLowerCase() === key)) {
    throw new Error("That in-camera session isn't in these minutes.");
  }
  const offsets = range ? { recordingStartSec: range.startSec, recordingEndSec: range.endSec } : {};
  const title = wanted ?? nextSessionTitle(segments);
  let next: SessionSegmentRow[];
  if (index >= 0) {
    const { recordingStartSec: _start, recordingEndSec: _end, ...rest } = segments[index];
    next = segments.map((segment, at) => (at === index ? { ...rest, ...offsets } : segment));
  } else {
    if (!range) return { title, recordingStartSec: null, recordingEndSec: null };
    next = [...segments, { type: "in_camera", title, ...offsets }];
  }
  await ctx.db.patch(minutes._id, { sessionSegments: next });
  return { title, recordingStartSec: range?.startSec ?? null, recordingEndSec: range?.endSec ?? null };
}
