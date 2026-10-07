import { meetingTables } from "./tables/meetings";
import { authorizedAction, authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { meetingHistoryFields } from "./validators/meetingHistory";
import { query, mutation, action } from "./lib/untypedServer";
import { v } from "convex/values";
import { detailedAttendanceValidator, minutesActionItemValidator, motionExtensionFields, nextMeetingValidator } from "./validators/meetingModel";
import { api } from "./_generated/api";
import { summarizeMinutes } from "./providers/llm";
import {
  transposeSourcePortable,
  transposeSourcesPortable,
  completeSourceRecordsPortable,
  listPortable,
  listSummariesPortable,
  getByMeetingPortable,
  createPortable,
  carryForwardActionPortable,
  updatePortable,
  upsertFromDraftPortable,
  backfillMotionPersonLinksPortable,
  backfillQuorumSnapshotPortable,
} from "../shared/functions/minutes";
import { repairImportedPortable } from "../shared/functions/minutesRepair";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

const motion = v.object({
  name: v.optional(v.string()),
  text: v.string(),
  movedBy: v.optional(v.string()),
  movedByMemberId: v.optional(v.id("members")),
  movedByDirectorId: v.optional(v.id("directors")),
  secondedBy: v.optional(v.string()),
  secondedByMemberId: v.optional(v.id("members")),
  secondedByDirectorId: v.optional(v.id("directors")),
  outcome: v.string(),
  votesFor: v.optional(v.number()),
  votesAgainst: v.optional(v.number()),
  abstentions: v.optional(v.number()),
  resolutionType: v.optional(v.string()),
  // How the motion was decided: vote | consent | automatic. Procedural motions
  // (adjournment, approve-minutes) default to consent. See
  // shared/proceduralMotions.ts.
  decidedBy: v.optional(v.string()),
  sectionIndex: v.optional(v.number()),
  sectionTitle: v.optional(v.string()),
  // Present on stored motions written by the agenda sync
  // (shared/functions/agendas.ts); must be accepted when clients round-trip
  // the stored array through update, or every such save is rejected.
  motionTemplateId: v.optional(v.id("motionTemplates")),
  motionId: v.optional(v.id("motions")),
  // Free-form labels on the first-class motion row. Round-tripped through the
  // editor (displayMotions carries them), so this must be accepted or every save
  // of a labelled motion is rejected.
  tags: v.optional(v.array(v.string())),
  // Which minutes record this motion adopts; carrying the motion auto-stamps
  // the referenced minutes' approval (see shared/functions/minutes.ts).
  adoptsMinutesId: v.optional(v.id("minutes")),
  // A1/A11/C1/C13/G-04 extensions, mirrored onto the first-class motion row.
  ...motionExtensionFields,
});

const actionItem = minutesActionItemValidator;

const remoteParticipation = v.object({
  url: v.optional(v.string()),
  meetingId: v.optional(v.string()),
  passcode: v.optional(v.string()),
  instructions: v.optional(v.string()),
});

const detailedAttendance = detailedAttendanceValidator;

const minuteSection = v.object({
  title: v.string(),
  agendaItemId: v.optional(v.id("agendaItems")),
  type: v.optional(v.string()),
  presenter: v.optional(v.string()),
  discussion: v.optional(v.string()),
  // Written into stored sections by the agenda sync; accepted here so clients
  // can round-trip stored sections through update without validation errors.
  motionText: v.optional(v.string()),
  motionTemplateId: v.optional(v.id("motionTemplates")),
  motionId: v.optional(v.id("motions")),
  reportSubmitted: v.optional(v.boolean()),
  decisions: v.optional(v.array(v.string())),
  actionItems: v.optional(v.array(actionItem)),
  linkedTaskIds: v.optional(v.array(v.id("tasks"))),
  depth: v.optional(v.union(v.literal(0), v.literal(1))),
  publicVisible: v.optional(v.boolean()),
  sourceReference: v.optional(v.string()),
  sourceReviewStatus: v.optional(v.string()),
  sourceKind: v.optional(v.string()),
  sourceEvidence: v.optional(v.any()),
  sourceTitle: v.optional(v.string()),
});

const sessionSegment = v.object({
  type: v.string(),
  title: v.optional(v.string()),
  startedAt: v.optional(v.string()),
  endedAt: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const appendix = v.object({
  title: v.string(),
  type: v.optional(v.string()),
  reference: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const directorAppointment = v.object({
  name: v.string(),
  roleTitle: v.optional(v.string()),
  affiliation: v.optional(v.string()),
  term: v.optional(v.string()),
  consentRecorded: v.optional(v.boolean()),
  votesReceived: v.optional(v.number()),
  elected: v.optional(v.boolean()),
  status: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const specialResolutionExhibit = v.object({
  title: v.string(),
  reference: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const agmDetails = v.object({
  financialStatementsPresented: v.optional(v.boolean()),
  financialStatementsNotes: v.optional(v.string()),
  directorElectionNotes: v.optional(v.string()),
  directorAppointments: v.optional(v.array(directorAppointment)),
  specialResolutionExhibits: v.optional(v.array(specialResolutionExhibit)),
});

const structuredMinutesFields = {
  consentItems: meetingTables.minutes.validator.fields.consentItems,
  conditionalDecisions: meetingTables.minutes.validator.fields.conditionalDecisions,
  decisionRequirements: meetingTables.minutes.validator.fields.decisionRequirements,
  attendanceEvents: meetingTables.minutes.validator.fields.attendanceEvents,
  quorumCheckpoints: meetingTables.minutes.validator.fields.quorumCheckpoints,
  futureMeetingSuggestions: meetingTables.minutes.validator.fields.futureMeetingSuggestions,

  quorumStatus: v.optional(v.union(v.literal("confirmed"), v.literal("not_met"), v.literal("not_recorded"))),
  chairName: v.optional(v.string()),
  secretaryName: v.optional(v.string()),
  recorderName: v.optional(v.string()),
  calledToOrderAt: v.optional(v.string()),
  adjournedAt: v.optional(v.string()),
  remoteParticipation: v.optional(remoteParticipation),
  detailedAttendance: v.optional(v.array(detailedAttendance)),
  sections: v.optional(v.array(minuteSection)),
  sourceTransposition: v.optional(v.any()),
  nextMeetingAt: v.optional(v.string()),
  nextMeetingLocation: v.optional(v.string()),
  nextMeetingNotes: v.optional(v.string()),
  nextMeetings: v.optional(v.array(nextMeetingValidator)),
  sessionSegments: v.optional(v.array(sessionSegment)),
  appendices: v.optional(v.array(appendix)),
  agmDetails: v.optional(agmDetails),
};

export const list = authorizedQuery("minutes:list", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

/** `list` without the heavy imported-source fields — for lists, pickers and adoption flows. */
export const listSummaries = authorizedQuery("minutes:listSummaries", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listSummariesPortable(await toPortableQueryCtx(ctx), args),
});

export const getByMeeting = authorizedQuery("minutes:getByMeeting", query)({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => getByMeetingPortable(await toPortableQueryCtx(ctx), args),
});

export const create = authorizedMutation("minutes:create", mutation)({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    heldAt: v.string(),
    ...structuredMinutesFields,
    ...meetingHistoryFields,
    attendees: v.array(v.string()),
    absent: v.array(v.string()),
    quorumMet: v.boolean(),
    quorumRequired: v.optional(v.number()),
    bylawRuleSetId: v.optional(v.id("bylawRuleSets")),
    quorumRuleVersion: v.optional(v.number()),
    quorumRuleEffectiveFromISO: v.optional(v.string()),
    quorumSourceLabel: v.optional(v.string()),
    quorumComputedAtISO: v.optional(v.string()),
    discussion: v.string(),
    motions: v.array(motion),
    decisions: v.array(v.string()),
    actionItems: v.array(actionItem),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    sourceReviewStatus: v.optional(v.string()),
    sourceReviewNotes: v.optional(v.string()),
    sourceReviewedAtISO: v.optional(v.string()),
    sourceReviewedByUserId: v.optional(v.id("users")),
    draftTranscript: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => createPortable(await toPortableMutationCtx(ctx), args),
});

export const update = authorizedMutation("minutes:update", mutation)({
  args: {
    id: v.id("minutes"),
    patch: v.object({
      heldAt: v.optional(v.string()),
      ...structuredMinutesFields,
      ...meetingHistoryFields,
      attendees: v.optional(v.array(v.string())),
      absent: v.optional(v.array(v.string())),
      quorumMet: v.optional(v.boolean()),
      quorumRequired: v.optional(v.number()),
      bylawRuleSetId: v.optional(v.id("bylawRuleSets")),
      quorumRuleVersion: v.optional(v.number()),
      quorumRuleEffectiveFromISO: v.optional(v.string()),
      quorumSourceLabel: v.optional(v.string()),
      quorumComputedAtISO: v.optional(v.string()),
      discussion: v.optional(v.string()),
      motions: v.optional(v.array(motion)),
      decisions: v.optional(v.array(v.string())),
      actionItems: v.optional(v.array(actionItem)),
      approvedAt: v.optional(v.string()),
      approvedInMeetingId: v.optional(v.id("meetings")),
      sourceDocumentIds: v.optional(v.array(v.id("documents"))),
      sourceExternalIds: v.optional(v.array(v.string())),
      sourceReviewStatus: v.optional(v.string()),
      sourceReviewNotes: v.optional(v.string()),
      sourceReviewedAtISO: v.optional(v.string()),
      sourceReviewedByUserId: v.optional(v.id("users")),
      draftTranscript: v.optional(v.string()),
      // Convex strips `undefined` patch fields from the wire, so unsetting
      // approval needs explicit flags (same pattern as meetings.clearNoticeSent).
      clearApproval: v.optional(v.boolean()),
      clearApprovedInMeeting: v.optional(v.boolean()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, args) => updatePortable(await toPortableMutationCtx(ctx), args),
});

// Upsert a minutes row from an AI-generated draft (transcripts.runPipeline).
export const upsertFromDraft = authorizedMutation("minutes:upsertFromDraft", mutation)({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    heldAt: v.string(),
    ...structuredMinutesFields,
    ...meetingHistoryFields,
    attendees: v.array(v.string()),
    absent: v.array(v.string()),
    quorumMet: v.boolean(),
    quorumRequired: v.optional(v.number()),
    bylawRuleSetId: v.optional(v.id("bylawRuleSets")),
    quorumRuleVersion: v.optional(v.number()),
    quorumRuleEffectiveFromISO: v.optional(v.string()),
    quorumSourceLabel: v.optional(v.string()),
    quorumComputedAtISO: v.optional(v.string()),
    discussion: v.string(),
    motions: v.array(motion),
    decisions: v.array(v.string()),
    actionItems: v.array(actionItem),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    sourceReviewStatus: v.optional(v.string()),
    sourceReviewNotes: v.optional(v.string()),
    sourceReviewedAtISO: v.optional(v.string()),
    sourceReviewedByUserId: v.optional(v.id("users")),
    draftTranscript: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertFromDraftPortable(await toPortableMutationCtx(ctx), args),
});

// One-off, idempotent repair of data produced by the earlier rule-based
// imports (motion outcomes, embedded motions, pipe titles, file-name titles,
// date precision, stated quorum, non-person attendees). Pass dryRun first.
export const repairImported = authorizedMutation("minutes:repairImported", mutation)({
  args: {
    societyId: v.id("societies"),
    dryRun: v.optional(v.boolean()),
    options: v.optional(v.object({
      motions: v.optional(v.boolean()),
      embedded: v.optional(v.boolean()),
      sections: v.optional(v.boolean()),
      titles: v.optional(v.boolean()),
      reclassifyBodies: v.optional(v.boolean()),
      datePrecision: v.optional(v.boolean()),
      quorum: v.optional(v.boolean()),
      attendance: v.optional(v.boolean()),
    })),
  },
  returns: v.any(),
  handler: async (ctx, args) => repairImportedPortable(await toPortableMutationCtx(ctx), args),
});

export const backfillMotionPersonLinks = authorizedMutation("minutes:backfillMotionPersonLinks", mutation)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => backfillMotionPersonLinksPortable(await toPortableMutationCtx(ctx), args),
});

const sourceSelection = v.object({documentId:v.id("documents"),selectedText:v.string(),sourceKind:v.optional(v.string()),sourceReference:v.optional(v.string())});
const transposeArgs = {id:v.id("minutes"),sourceSelection:v.optional(v.array(sourceSelection)),expectedAgendaItems:v.optional(v.array(v.any()))};
export const completeSourceRecords = authorizedMutation("minutes:completeSourceRecords", mutation)({
  args: {societyId:v.id("societies"),entries:v.array(v.object({id:v.id("minutes"),sourceSelection:v.optional(v.array(v.any())),expectedSections:v.optional(v.array(v.any())),expectedStructured:v.optional(v.any())}))},
  returns: v.any(),
  handler: async (ctx,args) => completeSourceRecordsPortable(await toPortableMutationCtx(ctx),args),
});

export const transposeSources = authorizedMutation("minutes:transposeSources", mutation)({
  args: {societyId:v.id("societies"),entries:v.array(v.object(transposeArgs))}, returns:v.any(),
  handler: async (ctx,args) => transposeSourcesPortable(await toPortableMutationCtx(ctx),args),
});

export const transposeSource = authorizedMutation("minutes:transposeSource", mutation)({
  args: transposeArgs, returns: v.any(),
  handler: async (ctx, args) => transposeSourcePortable(await toPortableMutationCtx(ctx), args),
});

export const backfillQuorumSnapshot = authorizedMutation("minutes:backfillQuorumSnapshot", mutation)({
  args: { id: v.id("minutes") },
  returns: v.any(),
  handler: async (ctx, args) => backfillQuorumSnapshotPortable(await toPortableMutationCtx(ctx), args),
});

export const generateDraft = authorizedAction("minutes:generateDraft", action)({
  args: {
    meetingId: v.id("meetings"),
    transcript: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, { meetingId, transcript }) => {
    const meeting = await ctx.runQuery(api.meetings.get, { id: meetingId });
    if (!meeting) throw new Error("Meeting not found");

    const draft = await summarizeMinutes({
      transcript,
      meetingTitle: meeting.title,
      meetingType: meeting.type,
    });

    return await ctx.runMutation(api.minutes.upsertFromDraft, {
      societyId: meeting.societyId,
      meetingId,
      heldAt: meeting.scheduledAt,
      chairName: draft.chairName,
      secretaryName: draft.secretaryName,
      recorderName: draft.recorderName,
      calledToOrderAt: draft.calledToOrderAt,
      adjournedAt: draft.adjournedAt,
      remoteParticipation: draft.remoteParticipation,
      detailedAttendance: draft.detailedAttendance,
      attendees: draft.attendees.length ? draft.attendees : meeting.attendeeIds,
      absent: draft.absent,
      // Unknown quorum requirement means quorum is NOT established — every
      // other creation path treats it that way (see meetings createPortable).
      quorumStatus: meeting.quorumRequired == null ? "not_recorded" : draft.attendees.length >= meeting.quorumRequired ? "confirmed" : "not_met",
      quorumMet:
        meeting.quorumRequired == null
          ? false
          : draft.attendees.length >= meeting.quorumRequired,
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
      draftTranscript: transcript,
    });
  },
});


export const carryForwardAction = authorizedMutation("minutes:carryForwardAction", mutation)({
  args: { sourceMinutesId: v.id("minutes"), targetMinutesId: v.id("minutes"), sourceEntryId: v.string(), notes: v.optional(v.string()) },
  returns: v.object({ entryId: v.string(), created: v.boolean() }),
  handler: async (ctx, args) => carryForwardActionPortable(await toPortableMutationCtx(ctx), args),
});
