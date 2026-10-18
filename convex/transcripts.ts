import { authorizedAction, authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./lib/untypedServer";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { transcribeAudio } from "./providers/transcription";
import { resolveMinutesEndpoint, summarizeMinutes } from "./providers/llm";
import { draftToMinutesArgs } from "../shared/ai/draftToMinutesArgs";
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
  assignSpeakerPortable,
  updateSegmentPortable,
  mergeSpeakersPortable,
  unmergeSpeakerPortable,
  importTimedPortable,
  linkMinutesItemPortable,
  markInCameraRangePortable,
} from "../shared/functions/transcripts";
import { claimStorageId, requireSocietyMembership } from "../shared/functions/access";

import { transcriptSegmentValidator as transcriptSegment } from "./tables/transcripts";
import { transcriptRefValidator } from "./validators/meetingModel";

export const getByMeeting = authorizedQuery("transcripts:getByMeeting", query)({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => getByMeetingPortable(await toPortableQueryCtx(ctx), args),
});

export const jobForMeeting = authorizedQuery("transcripts:jobForMeeting", query)({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => jobForMeetingPortable(await toPortableQueryCtx(ctx), args),
});

export const createJob = authorizedMutation("transcripts:createJob", mutation)({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    provider: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => createJobPortable(await toPortableMutationCtx(ctx), args),
});

export const updateJob = authorizedMutation("transcripts:updateJob", mutation)({
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

export const saveTranscript = authorizedMutation("transcripts:saveTranscript", mutation)({
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

export const saveText = authorizedMutation("transcripts:saveText", mutation)({
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

export const importVtt = authorizedMutation("transcripts:importVtt", mutation)({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    vttText: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<Id<"transcripts">> =>
    importVttPortable(await toPortableMutationCtx(ctx), args) as Promise<Id<"transcripts">>,
});

const timedResult = v.object({ wordsDropped: v.boolean() });

export const assignSpeaker = authorizedMutation("transcripts:assignSpeaker", mutation)({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    label: v.string(),
    name: v.optional(v.string()),
    personId: v.optional(v.id("peopleDirectory")),
  },
  returns: timedResult,
  handler: async (ctx, args) => assignSpeakerPortable(await toPortableMutationCtx(ctx), args),
});

export const updateSegment = authorizedMutation("transcripts:updateSegment", mutation)({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    index: v.number(),
    text: v.optional(v.string()),
    speaker: v.optional(v.string()),
  },
  returns: timedResult,
  handler: async (ctx, args) => updateSegmentPortable(await toPortableMutationCtx(ctx), args),
});

export const mergeSpeakers = authorizedMutation("transcripts:mergeSpeakers", mutation)({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    // One label or several, combined into `to` in one step.
    from: v.union(v.string(), v.array(v.string())),
    to: v.string(),
  },
  returns: timedResult,
  handler: async (ctx, args) => mergeSpeakersPortable(await toPortableMutationCtx(ctx), args),
});

/** Undo a combine: the label becomes its own speaker again. */
export const unmergeSpeaker = authorizedMutation("transcripts:unmergeSpeaker", mutation)({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    label: v.string(),
  },
  returns: timedResult,
  handler: async (ctx, args) => unmergeSpeakerPortable(await toPortableMutationCtx(ctx), args),
});

export const importTimed = authorizedMutation("transcripts:importTimed", mutation)({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    provider: v.union(v.literal("vtt"), v.literal("srt"), v.literal("whisper-json"), v.literal("local-whisper")),
    segments: v.array(transcriptSegment),
    durationSeconds: v.optional(v.number()),
  },
  returns: timedResult,
  handler: async (ctx, args) => importTimedPortable(await toPortableMutationCtx(ctx), args),
});

/** Link a draft-minutes motion or action item to a transcript time range (minutes:write). */
export const linkMinutesItem = authorizedMutation("transcripts:linkMinutesItem", mutation)({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    kind: v.union(v.literal("motion"), v.literal("actionItem")),
    motionId: v.optional(v.id("motions")),
    sectionIndex: v.optional(v.number()),
    actionIndex: v.optional(v.number()),
    expectedText: v.optional(v.string()),
    startSec: v.optional(v.number()),
    endSec: v.optional(v.number()),
  },
  returns: v.object({
    kind: v.union(v.literal("motion"), v.literal("actionItem")),
    transcriptRef: v.union(v.null(), transcriptRefValidator),
  }),
  handler: async (ctx, args) => linkMinutesItemPortable(await toPortableMutationCtx(ctx), args),
});

export const _claimPipelineStorage = internalMutation({
  args: {
    societyId: v.id("societies"),
    storageId: v.id("_storage"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const portableCtx = await toPortableMutationCtx(ctx);
    await requireSocietyMembership(portableCtx, args.societyId);
    await claimStorageId(portableCtx, args.storageId, args.societyId);
    return null;
  },
});

// End-to-end action: kick off transcription, then summarize into a minute
// draft that's saved in the `minutes` table.
export const runPipeline = authorizedAction("transcripts:runPipeline", action)({
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

    if (args.storageId) {
      await ctx.runMutation(internal.transcripts._claimPipelineStorage, {
        societyId: args.societyId,
        storageId: args.storageId,
      });
    }

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
        const draft = await summarizeMinutes(
          { transcript: result.text, meetingTitle: meeting.title, meetingType: meeting.type },
          await resolveMinutesEndpoint(ctx, args.societyId),
        );

        await ctx.runMutation(api.minutes.upsertFromDraft, draftToMinutesArgs(meeting, draft, result.text));

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

/** A2: mark where an in-camera session sits in the recording (minutes:write; never on approved minutes). */
export const markInCameraRange = authorizedMutation("transcripts:markInCameraRange", mutation)({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    sessionTitle: v.optional(v.string()),
    startSec: v.optional(v.number()),
    endSec: v.optional(v.number()),
  },
  returns: v.object({ title: v.string(), recordingStartSec: v.union(v.number(), v.null()), recordingEndSec: v.union(v.number(), v.null()) }),
  handler: async (ctx, args) => markInCameraRangePortable(await toPortableMutationCtx(ctx), args),
});
