import { authorizedAction, authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { action, query, mutation } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";
import { meetingExtensionFields, meetingNoteActionItemValidator } from "./validators/meetingModel";
import {
  createTaskFromNoteActionPortable,
  discardNotesDraftPortable,
  notesSkillContextPortable,
  saveNotesDraftPortable,
  setNoteActionItemsPortable,
} from "../shared/functions/meetingNotes";
import {
  heuristicNotesDraft,
  isNotesDraftTemplateId,
  notesDraftTranscriptFromRow,
  type NotesDraft,
  type NotesDraftInput,
} from "../shared/ai/notesDraft";
import { meetingRecordKind } from "../shared/meetingRecordKind";
import { transcriptWithoutInCamera } from "../shared/minutesPrivacy";
import { sharedNotesForDraft } from "../shared/functions/meetingPersonalNotes";
import { completeStructuredJson, endpointLabel, resolveMinutesEndpoint, ToolsUnsupportedError, toolStep, type MinutesModelEndpoint } from "./providers/llm";
import {
  applySkillCalls,
  createMeetingNotesSkillSession,
  MEETING_NOTES_CALLS_JSON_SCHEMA,
  meetingNotesJsonModeInstruction,
  mergeSkillResults,
  planMeetingNotesSkill,
  runMeetingNotesSkillLoop,
  skillCallsFromText,
  type MeetingNotesSkillContext,
  type MeetingNotesSkillInput,
  type MeetingNotesSkillResult,
  type SkillSpeakerSuggestion,
} from "../shared/ai/meetingNotesSkill";
import type { ChatMessage } from "../shared/ai/minutesDraft";
import { aiProviderErrorMessage } from "../shared/ai/providerErrors";
import type { JsonSchemaFormat } from "../shared/ai/openAiCompatible";
import {
  listPortable,
  getPortable,
  createPortable,
  applyTemplatePortable,
  updatePortable,
  markSourceReviewPortable,
  setPackageReviewStatusPortable,
  removePortable,
  backfillQuorumSnapshotPortable,
  startMinutesFromNotesPortable,
} from "../shared/functions/meetings";
import { mergePortable, mergePreviewPortable } from "../shared/functions/meetingMerge";
import { attendanceRecordsForMeetingPortable } from "../shared/functions/minutesAttendance";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = authorizedQuery("meetings:list", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const get = authorizedQuery("meetings:get", query)({
  args: { id: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => getPortable(await toPortableQueryCtx(ctx), args),
});

export const create = authorizedMutation("meetings:create", mutation)({
  args: {
    societyId: v.id("societies"),
    followUp: v.optional(v.object({ requestId: v.string(), sourceMeetingId: v.id("meetings"), sourceMinutesId: v.optional(v.id("minutes")), motionIndexes: v.array(v.number()), sourceMotionFingerprint: v.optional(v.string()) })),
    committeeId: v.optional(v.id("committees")),
    type: v.string(),
    title: v.string(),
    scheduledAt: v.string(),
    location: v.optional(v.string()),
    electronic: v.boolean(),
    remoteUrl: v.optional(v.string()),
    remoteMeetingId: v.optional(v.string()),
    remotePasscode: v.optional(v.string()),
    remoteInstructions: v.optional(v.string()),
    quorumRequired: v.optional(v.number()),
    bylawRuleSetId: v.optional(v.id("bylawRuleSets")),
    quorumRuleVersion: v.optional(v.number()),
    quorumRuleEffectiveFromISO: v.optional(v.string()),
    quorumSourceLabel: v.optional(v.string()),
    quorumComputedAtISO: v.optional(v.string()),
    status: v.string(),
    attendeeIds: v.array(v.string()),
    agendaJson: v.optional(v.string()),
    meetingTemplateId: v.optional(v.id("meetingTemplates")),
    sourceReviewStatus: v.optional(v.string()),
    sourceReviewNotes: v.optional(v.string()),
    sourceReviewedAtISO: v.optional(v.string()),
    sourceReviewedByUserId: v.optional(v.id("users")),
    packageReviewStatus: v.optional(v.string()),
    packageReviewNotes: v.optional(v.string()),
    packageReviewedAtISO: v.optional(v.string()),
    packageReviewedByUserId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
    ...meetingExtensionFields,
  },
  returns: v.any(),
  handler: async (ctx, args) => createPortable(await toPortableMutationCtx(ctx), args),
});

// Apply (or re-apply) a meeting template's agenda + minutes scaffolding onto an
// EXISTING meeting. create() only materializes a template at creation time, so a
// meeting made without one — or one that needs a different template — could
// never get the standardized agenda/section scaffolding. Safe by default:
// refuses to overwrite existing agenda items unless `replace` is set, and only
// fills minutes sections/motions when they are still empty (never clobbers
// recorded minutes) unless `replace` is set.
export const applyTemplate = authorizedMutation("meetings:applyTemplate", mutation)({
  args: {
    meetingId: v.id("meetings"),
    meetingTemplateId: v.id("meetingTemplates"),
    replace: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => applyTemplatePortable(await toPortableMutationCtx(ctx), args),
});

export const update = authorizedMutation("meetings:update", mutation)({
  args: {
    id: v.id("meetings"),
    expected: v.optional(v.record(v.string(), v.any())),
    patch: v.object({
      type: v.optional(v.string()),
      committeeId: v.optional(v.id("committees")),
      title: v.optional(v.string()),
      scheduledAt: v.optional(v.string()),
      location: v.optional(v.string()),
      electronic: v.optional(v.boolean()),
      remoteUrl: v.optional(v.string()),
      remoteMeetingId: v.optional(v.string()),
      remotePasscode: v.optional(v.string()),
      remoteInstructions: v.optional(v.string()),
      noticeSentAt: v.optional(v.string()),
      quorumRequired: v.optional(v.number()),
      bylawRuleSetId: v.optional(v.id("bylawRuleSets")),
      quorumRuleVersion: v.optional(v.number()),
      quorumRuleEffectiveFromISO: v.optional(v.string()),
      quorumSourceLabel: v.optional(v.string()),
      quorumComputedAtISO: v.optional(v.string()),
      status: v.optional(v.string()),
      attendeeIds: v.optional(v.array(v.string())),
      meetingTemplateId: v.optional(v.id("meetingTemplates")),
      templateSnapshotJson: v.optional(v.string()),
      minutesId: v.optional(v.id("minutes")),
      sourceReviewStatus: v.optional(v.string()),
      sourceReviewNotes: v.optional(v.string()),
      sourceReviewedAtISO: v.optional(v.string()),
      sourceReviewedByUserId: v.optional(v.id("users")),
      packageReviewStatus: v.optional(v.string()),
      packageReviewNotes: v.optional(v.string()),
      packageReviewedAtISO: v.optional(v.string()),
      packageReviewedByUserId: v.optional(v.id("users")),
      notes: v.optional(v.string()),
      // Explicit clear signals — db.patch ignores undefined coming over the
      // wire, so the client can't unset a field by sending `field: undefined`.
      clearNoticeSent: v.optional(v.boolean()),
      clearCommitteeId: v.optional(v.boolean()),
      ...meetingExtensionFields,
    }),
  },
  returns: v.any(),
  handler: async (ctx, args) => updatePortable(await toPortableMutationCtx(ctx), args),
});

// "Turn notes into minutes": switches the meeting to formal minutes and seeds
// the minutes discussion with its working notes. Needs minutes:write too.
export const startMinutesFromNotes = authorizedMutation("meetings:startMinutesFromNotes", mutation)({
  args: { id: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => startMinutesFromNotesPortable(await toPortableMutationCtx(ctx), args),
});

export const markSourceReview = authorizedMutation("meetings:markSourceReview", mutation)({
  args: {
    id: v.id("meetings"),
    status: v.string(),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => markSourceReviewPortable(await toPortableMutationCtx(ctx), args),
});

export const setPackageReviewStatus = authorizedMutation("meetings:setPackageReviewStatus", mutation)({
  args: {
    id: v.id("meetings"),
    status: v.string(),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => setPackageReviewStatusPortable(await toPortableMutationCtx(ctx), args),
});

export const backfillQuorumSnapshot = authorizedMutation("meetings:backfillQuorumSnapshot", mutation)({
  args: { id: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => backfillQuorumSnapshotPortable(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("meetings:remove", mutation)({
  args: { id: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});

// The meeting's attendance register rows, edited through the attendance grid.
export const attendanceRecords = authorizedQuery("meetings:attendanceRecords", query)({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => attendanceRecordsForMeetingPortable(await toPortableQueryCtx(ctx), args),
});

// Duplicate meetings (same body, same day): preview, then fold the duplicate
// into the kept meeting as an imported source version.
export const mergePreview = authorizedQuery("meetings:mergePreview", query)({
  args: { targetId: v.id("meetings"), duplicateId: v.id("meetings"), addMissingAttendees: v.optional(v.boolean()) },
  returns: v.any(),
  handler: async (ctx, args) => mergePreviewPortable(await toPortableQueryCtx(ctx), args),
});

export const merge = authorizedMutation("meetings:merge", mutation)({
  args: { targetId: v.id("meetings"), duplicateId: v.id("meetings"), addMissingAttendees: v.optional(v.boolean()) },
  returns: v.any(),
  handler: async (ctx, args) => mergePortable(await toPortableMutationCtx(ctx), args),
});

// --- Meeting notes: AI draft and action items (shared/functions/meetingNotes.ts) ---

export const saveNotesDraft = authorizedMutation("meetings:saveNotesDraft", mutation)({
  args: {
    id: v.id("meetings"),
    template: v.string(),
    // Untrusted model output; normalised and bounded by the handler.
    draft: v.any(),
    generatedBy: v.string(),
    usedNotes: v.boolean(),
    usedTranscript: v.boolean(),
    // Untrusted, like draft: checked and bounded by the handler.
    speakers: v.optional(v.any()),
  },
  returns: v.any(),
  handler: async (ctx, args) => saveNotesDraftPortable(await toPortableMutationCtx(ctx), args),
});

/** What the notes skill may know: people with ids and roles, goals, committees, speakers. */
export const notesSkillContext = authorizedQuery("meetings:notesSkillContext", query)({
  args: { id: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => notesSkillContextPortable(await toPortableQueryCtx(ctx), args),
});

export const discardNotesDraft = authorizedMutation("meetings:discardNotesDraft", mutation)({
  args: { id: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => discardNotesDraftPortable(await toPortableMutationCtx(ctx), args),
});

export const setNoteActionItems = authorizedMutation("meetings:setNoteActionItems", mutation)({
  args: {
    id: v.id("meetings"),
    // The whole list, or (preferred) changes applied to the list as it is now.
    items: v.optional(v.array(meetingNoteActionItemValidator)),
    ops: v.optional(v.array(v.union(
      v.object({ op: v.literal("add"), item: meetingNoteActionItemValidator }),
      v.object({ op: v.literal("patch"), itemId: v.string(), set: v.optional(v.any()), unset: v.optional(v.array(v.string())) }),
      v.object({ op: v.literal("remove"), itemId: v.string() }),
    ))),
  },
  returns: v.any(),
  handler: async (ctx, args) => setNoteActionItemsPortable(await toPortableMutationCtx(ctx), args),
});

export const createTaskFromNoteAction = authorizedMutation("meetings:createTaskFromNoteAction", mutation)({
  args: { id: v.id("meetings"), itemId: v.string(), priority: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => createTaskFromNoteActionPortable(await toPortableMutationCtx(ctx), args),
});

/** Hosted models take long transcripts whole; past this they are drafted in parts. */
const HOSTED_NOTES_DRAFT_BUDGET_CHARS = 120_000;

/**
 * The notes draft with the workspace's (or the server's) AI model. Reads the
 * meeting's notes and the transcript as this person may read it, then saves
 * through meetings:saveNotesDraft. Without a model, a rule-based draft is
 * saved and labelled as such; a provider failure saves nothing.
 */
export const generateNotesDraft = authorizedAction("meetings:generateNotesDraft", action)({
  args: { id: v.id("meetings"), template: v.string() },
  returns: v.any(),
  handler: async (ctx, { id, template }): Promise<unknown> => {
    if (!isNotesDraftTemplateId(template)) throw new Error("Unknown notes template.");
    const meeting = await ctx.runQuery(api.meetings.get, { id });
    if (!meeting) throw new Error("Meeting not found.");
    if (meetingRecordKind(meeting) !== "notes") throw new Error("AI notes are for meetings that keep notes. This meeting keeps formal minutes.");
    // The team notes and every shared person's notes; private notes never.
    const shared = (await ctx.runQuery(api.meetingPersonalNotes.shared, { meetingId: id }).catch(() => [])) as Array<{ authorName: string; body: string }>;
    const notes = sharedNotesForDraft(String(meeting.workingNotes ?? ""), shared);
    let transcript = "";
    try {
      // Only someone who may read the transcript gets it in their draft, and
      // in-camera parts never go to the model, whoever asks.
      const row = await ctx.runQuery(api.transcripts.getByMeeting, { meetingId: id });
      const minutes = row ? await ctx.runQuery(api.minutes.getByMeeting, { meetingId: id }).catch(() => null) : null;
      transcript = notesDraftTranscriptFromRow(row ? transcriptWithoutInCamera(row, minutes) : row);
    } catch {
      transcript = "";
    }
    if (!notes.trim() && !transcript.trim()) throw new Error("Write some notes or add a transcript first.");
    const input: NotesDraftInput = {
      meetingTitle: String(meeting.title ?? "Meeting"),
      meetingDate: String(meeting.scheduledAt ?? "").slice(0, 10) || undefined,
      template,
      notes,
      transcript,
      attendees: Array.isArray(meeting.attendeeIds) ? meeting.attendeeIds.map(String).slice(0, 50) : undefined,
    };
    const endpoint = await resolveMinutesEndpoint(ctx, String(meeting.societyId));
    let draft: NotesDraft = heuristicNotesDraft(input);
    let speakers: SkillSpeakerSuggestion[] = [];
    let generatedBy = "Rule-based (no AI model connected)";
    if (endpoint) {
      try {
        // The meeting notes skill: the model calls tools, checked against the organization's people.
        const context = (await ctx.runQuery(api.meetings.notesSkillContext, { id })) as MeetingNotesSkillContext;
        const result = await runNotesSkillHosted(endpoint, { template, notes, transcript, context });
        draft = { ...result.draft, summary: result.draft.summary || draft.summary };
        speakers = result.speakers;
        generatedBy = endpointLabel(endpoint);
      } catch (error) {
        throw new Error(`${aiProviderErrorMessage(error)} Nothing was changed.`);
      }
    }
    return await ctx.runMutation(api.meetings.saveNotesDraft, {
      id,
      template,
      draft,
      speakers,
      generatedBy,
      usedNotes: Boolean(notes.trim()),
      usedTranscript: Boolean(transcript.trim()),
    });
  },
});

/**
 * The skill against a hosted model: a tool loop per transcript part, or the
 * whole set of calls as JSON when the provider refuses tools.
 */
async function runNotesSkillHosted(endpoint: MinutesModelEndpoint, input: MeetingNotesSkillInput): Promise<MeetingNotesSkillResult> {
  const results: MeetingNotesSkillResult[] = [];
  for (const messages of planMeetingNotesSkill(input, HOSTED_NOTES_DRAFT_BUDGET_CHARS)) {
    const session = createMeetingNotesSkillSession(input.context, input.template, { transcript: input.transcript });
    try {
      results.push(await runMeetingNotesSkillLoop(toolStep(endpoint), messages, session));
    } catch (error) {
      if (!(error instanceof ToolsUnsupportedError)) throw error;
      const text = await completeStructuredJson(endpoint, {
        messages: [...messages, { role: "system", content: meetingNotesJsonModeInstruction() }] as ChatMessage[],
        jsonSchema: MEETING_NOTES_CALLS_JSON_SCHEMA as unknown as JsonSchemaFormat,
        maxTokens: 3000,
        label: "notes draft",
      });
      results.push(applySkillCalls(session, skillCallsFromText(text)));
    }
  }
  return mergeSkillResults(results);
}
