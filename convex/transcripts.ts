import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { transcribeAudio } from "./providers/transcription";
import { summarizeMinutes } from "./providers/llm";
import { providers } from "./providers/env";

const transcriptSegment = v.object({
  speaker: v.string(),
  text: v.string(),
  startSec: v.number(),
  endSec: v.number(),
});

type TranscriptSegmentRow = {
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
};

async function upsertTranscriptRow(
  ctx: any,
  args: {
    societyId: Id<"societies">;
    meetingId: Id<"meetings">;
    provider: string;
    durationSeconds?: number;
    language?: string;
    text: string;
    segments: TranscriptSegmentRow[];
    storageKey?: string;
    demo: boolean;
  },
): Promise<Id<"transcripts">> {
  const existing = await ctx.db
    .query("transcripts")
    .withIndex("by_meeting", (q: any) => q.eq("meetingId", args.meetingId))
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
  ctx: any,
  meetingId: Id<"meetings">,
  text: string,
) {
  const existingMinutes = await ctx.db
    .query("minutes")
    .withIndex("by_meeting", (q: any) => q.eq("meetingId", meetingId))
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
  const lines = vttText.replace(/^\uFEFF/, "").replace(/\r/g, "").split("\n");
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

export const getByMeeting = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, { meetingId }) => {
    const rows = await ctx.db
      .query("transcripts")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    return rows[0] ?? null;
  },
});

export const jobForMeeting = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, { meetingId }) => {
    const rows = await ctx.db
      .query("transcriptionJobs")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    return rows.sort((a, b) => b.startedAtISO.localeCompare(a.startedAtISO))[0] ?? null;
  },
});

export const createJob = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    provider: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("transcriptionJobs", {
      societyId: args.societyId,
      meetingId: args.meetingId,
      status: "queued",
      provider: args.provider,
      startedAtISO: new Date().toISOString(),
      demo: args.provider === "demo",
    });
  },
});

export const updateJob = mutation({
  args: {
    id: v.id("transcriptionJobs"),
    patch: v.object({
      status: v.optional(v.string()),
      completedAtISO: v.optional(v.string()),
      error: v.optional(v.string()),
      transcriptId: v.optional(v.id("transcripts")),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const saveTranscript = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    provider: v.string(),
    durationSeconds: v.optional(v.number()),
    language: v.optional(v.string()),
    text: v.string(),
    segments: v.array(transcriptSegment),
    storageKey: v.optional(v.string()),
    demo: v.boolean(),
  },
  handler: async (ctx, args): Promise<Id<"transcripts">> => {
    return await upsertTranscriptRow(ctx, args);
  },
});

export const saveText = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    text: v.string(),
    provider: v.optional(v.string()),
    durationSeconds: v.optional(v.number()),
    language: v.optional(v.string()),
    storageKey: v.optional(v.string()),
    demo: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Id<"transcripts">> => {
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
  },
});

export const importVtt = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    vttText: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"transcripts">> => {
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
  },
});

// End-to-end action: kick off transcription, then summarize into a minute
// draft that's saved in the `minutes` table.
export const runPipeline = action({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    storageKey: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    sourceFileName: v.optional(v.string()),
    sourceMimeType: v.optional(v.string()),
    draftMinutes: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const transcriptionProvider = providers.transcription();
    const jobId = await ctx.runMutation(api.transcripts.createJob, {
      societyId: args.societyId,
      meetingId: args.meetingId,
      provider: transcriptionProvider.id,
    });

    await ctx.runMutation(api.transcripts.updateJob, {
      id: jobId,
      patch: { status: "running" },
    });

    try {
      const storageRef = args.storageId ?? args.storageKey;
      let audioBytes: Uint8Array | undefined;
      if (storageRef) {
        const blob = await ctx.storage.get(storageRef);
        if (!blob) throw new Error("The uploaded audio file could not be read from storage.");
        audioBytes = new Uint8Array(await blob.arrayBuffer());
      }

      const result = await transcribeAudio({
        audioBytes,
        storageKey: storageRef,
        fileName: args.sourceFileName,
        mimeType: args.sourceMimeType,
      });
      const transcriptId = await ctx.runMutation(api.transcripts.saveTranscript, {
        societyId: args.societyId,
        meetingId: args.meetingId,
        provider: result.provider,
        durationSeconds: result.durationSeconds,
        language: result.language,
        text: result.text,
        segments: result.segments,
        storageKey: storageRef,
        demo: result.provider === "demo",
      });

      const shouldDraftMinutes = args.draftMinutes !== false;
      const meeting = await ctx.runQuery(api.meetings.get, { id: args.meetingId });
      if (!meeting) throw new Error("Meeting vanished mid-transcription.");

      if (shouldDraftMinutes) {
        const draft = await summarizeMinutes({
          transcript: result.text,
          meetingTitle: meeting.title,
          meetingType: meeting.type,
        });

        await ctx.runMutation(api.minutes.upsertFromDraft, {
          societyId: args.societyId,
          meetingId: args.meetingId,
          heldAt: meeting.scheduledAt,
          attendees: draft.attendees,
          absent: draft.absent,
          quorumMet: draft.attendees.length >= (meeting.quorumRequired ?? 0),
          discussion: draft.discussion,
          motions: draft.motions,
          decisions: draft.decisions,
          actionItems: draft.actionItems,
          draftTranscript: result.text,
        });

        await ctx.runMutation(api.notifications.create, {
          societyId: args.societyId,
          kind: "minutes",
          severity: "success",
          title: "AI minutes draft ready",
          body: `Transcribed ${Math.round((result.durationSeconds ?? 0) / 60)} min meeting and drafted ${draft.motions.length} motion(s), ${draft.actionItems.length} action item(s).`,
          linkHref: `/meetings/${args.meetingId}`,
        });
      } else {
        const existingMinutes = await ctx.runQuery(api.minutes.getByMeeting, {
          meetingId: args.meetingId,
        });
        if (existingMinutes) {
          await ctx.runMutation(api.minutes.update, {
            id: existingMinutes._id,
            patch: { draftTranscript: result.text },
          });
        }

        await ctx.runMutation(api.notifications.create, {
          societyId: args.societyId,
          kind: "transcript",
          severity: "success",
          title: "Meeting transcript ready",
          body: `Transcript saved for ${meeting.title}.`,
          linkHref: `/meetings/${args.meetingId}`,
        });
      }

      await ctx.runMutation(api.transcripts.updateJob, {
        id: jobId,
        patch: {
          status: "complete",
          completedAtISO: new Date().toISOString(),
          transcriptId,
        },
      });

      return { transcriptId, jobId };
    } catch (err: any) {
      await ctx.runMutation(api.transcripts.updateJob, {
        id: jobId,
        patch: {
          status: "failed",
          completedAtISO: new Date().toISOString(),
          error: err?.message ?? "Unknown error",
        },
      });
      throw err;
    }
  },
});
