import { v } from "convex/values";
import { action, mutation, query } from "./lib/untypedServer";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { transcribeAudio } from "./providers/transcription";
import { summarizeMinutes } from "./providers/llm";
import { providers } from "./providers/env";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import {
  getByMeetingPortable,
  jobForMeetingPortable,
  createJobPortable,
  updateJobPortable,
  saveTranscriptPortable,
  saveTextPortable,
  importVttPortable,
} from "../shared/functions/transcripts";

const transcriptSegment = v.object({
  speaker: v.string(),
  text: v.string(),
  startSec: v.number(),
  endSec: v.number(),
});

export const getByMeeting = query({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => getByMeetingPortable(await toPortableQueryCtx(ctx), args),
});

export const jobForMeeting = query({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => jobForMeetingPortable(await toPortableQueryCtx(ctx), args),
});

export const createJob = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    provider: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => createJobPortable(await toPortableMutationCtx(ctx), args),
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
  returns: v.any(),
  handler: async (ctx, args) => updateJobPortable(await toPortableMutationCtx(ctx), args),
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
  returns: v.any(),
  handler: async (ctx, args): Promise<Id<"transcripts">> =>
    saveTranscriptPortable(await toPortableMutationCtx(ctx), args) as Promise<Id<"transcripts">>,
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
  returns: v.any(),
  handler: async (ctx, args): Promise<Id<"transcripts">> =>
    saveTextPortable(await toPortableMutationCtx(ctx), args) as Promise<Id<"transcripts">>,
});

export const importVtt = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    vttText: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<Id<"transcripts">> =>
    importVttPortable(await toPortableMutationCtx(ctx), args) as Promise<Id<"transcripts">>,
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
  returns: v.any(),
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
          chairName: draft.chairName,
          secretaryName: draft.secretaryName,
          recorderName: draft.recorderName,
          calledToOrderAt: draft.calledToOrderAt,
          adjournedAt: draft.adjournedAt,
          remoteParticipation: draft.remoteParticipation,
          detailedAttendance: draft.detailedAttendance,
          attendees: draft.attendees,
          absent: draft.absent,
          quorumMet: draft.attendees.length >= (meeting.quorumRequired ?? 0),
          discussion: draft.discussion,
          sections: draft.sections,
          motions: draft.motions,
          decisions: draft.decisions,
          actionItems: draft.actionItems,
          nextMeetingAt: draft.nextMeetingAt,
          nextMeetingLocation: draft.nextMeetingLocation,
          nextMeetingNotes: draft.nextMeetingNotes,
          sessionSegments: draft.sessionSegments,
          appendices: draft.appendices,
          agmDetails: draft.agmDetails,
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
