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

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

type TranscriptSegmentRow = {
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
};

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
  if (existingMinutes[0]) {
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

export async function getByMeetingPortable(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }) {
  const rows = await ctx.db
    .query("transcripts")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  return rows[0] ?? null;
}

export async function jobForMeetingPortable(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }) {
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
