import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { transcribeAudio } from "./providers/transcription";
import { summarizeMinutes } from "./providers/llm";
import { providers } from "./providers/env";

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
    segments: v.array(
      v.object({
        speaker: v.string(),
        text: v.string(),
        startSec: v.number(),
        endSec: v.number(),
      }),
    ),
    storageKey: v.optional(v.string()),
    demo: v.boolean(),
  },
  handler: async (ctx, args): Promise<Id<"transcripts">> => {
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
  },
});

// End-to-end action: kick off transcription, then summarize into a minute
// draft that's saved in the `minutes` table.
export const runPipeline = action({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    storageKey: v.optional(v.string()),
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
      const result = await transcribeAudio({ storageKey: args.storageKey });
      const transcriptId = await ctx.runMutation(api.transcripts.saveTranscript, {
        societyId: args.societyId,
        meetingId: args.meetingId,
        provider: result.provider,
        durationSeconds: result.durationSeconds,
        language: result.language,
        text: result.text,
        segments: result.segments,
        storageKey: args.storageKey,
        demo: result.provider === "demo",
      });

      const meeting = await ctx.runQuery(api.meetings.get, { id: args.meetingId });
      if (!meeting) throw new Error("Meeting vanished mid-transcription.");

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

      await ctx.runMutation(api.transcripts.updateJob, {
        id: jobId,
        patch: {
          status: "complete",
          completedAtISO: new Date().toISOString(),
          transcriptId,
        },
      });

      await ctx.runMutation(api.notifications.create, {
        societyId: args.societyId,
        kind: "minutes",
        severity: "success",
        title: "AI minutes draft ready",
        body: `Transcribed ${Math.round((result.durationSeconds ?? 0) / 60)} min meeting and drafted ${draft.motions.length} motion(s), ${draft.actionItems.length} action item(s).`,
        linkHref: `/meetings/${args.meetingId}`,
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
