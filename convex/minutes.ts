import { query, mutation, action } from "./lib/untypedServer";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { summarizeMinutes } from "./providers/llm";
import {
  listPortable,
  getByMeetingPortable,
  createPortable,
  updatePortable,
  upsertFromDraftPortable,
  backfillMotionPersonLinksPortable,
  backfillQuorumSnapshotPortable,
} from "../shared/functions/minutes";
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
  // Which minutes record this motion adopts; carrying the motion auto-stamps
  // the referenced minutes' approval (see shared/functions/minutes.ts).
  adoptsMinutesId: v.optional(v.id("minutes")),
});

const actionItem = v.object({
  text: v.string(),
  assignee: v.optional(v.string()),
  dueDate: v.optional(v.string()),
  done: v.boolean(),
});

const remoteParticipation = v.object({
  url: v.optional(v.string()),
  meetingId: v.optional(v.string()),
  passcode: v.optional(v.string()),
  instructions: v.optional(v.string()),
});

const detailedAttendance = v.object({
  name: v.string(),
  status: v.string(),
  roleTitle: v.optional(v.string()),
  affiliation: v.optional(v.string()),
  memberIdentifier: v.optional(v.string()),
  proxyFor: v.optional(v.string()),
  quorumCounted: v.optional(v.boolean()),
  notes: v.optional(v.string()),
});

const minuteSection = v.object({
  title: v.string(),
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
  chairName: v.optional(v.string()),
  secretaryName: v.optional(v.string()),
  recorderName: v.optional(v.string()),
  calledToOrderAt: v.optional(v.string()),
  adjournedAt: v.optional(v.string()),
  remoteParticipation: v.optional(remoteParticipation),
  detailedAttendance: v.optional(v.array(detailedAttendance)),
  sections: v.optional(v.array(minuteSection)),
  nextMeetingAt: v.optional(v.string()),
  nextMeetingLocation: v.optional(v.string()),
  nextMeetingNotes: v.optional(v.string()),
  sessionSegments: v.optional(v.array(sessionSegment)),
  appendices: v.optional(v.array(appendix)),
  agmDetails: v.optional(agmDetails),
};

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

export const getByMeeting = query({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: (ctx, args) => getByMeetingPortable(toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    heldAt: v.string(),
    ...structuredMinutesFields,
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
  handler: (ctx, args) => createPortable(toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: {
    id: v.id("minutes"),
    patch: v.object({
      heldAt: v.optional(v.string()),
      ...structuredMinutesFields,
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
  handler: (ctx, args) => updatePortable(toPortableMutationCtx(ctx), args),
});

// Upsert a minutes row from an AI-generated draft (transcripts.runPipeline).
export const upsertFromDraft = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    heldAt: v.string(),
    ...structuredMinutesFields,
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
  handler: (ctx, args) => upsertFromDraftPortable(toPortableMutationCtx(ctx), args),
});

export const backfillMotionPersonLinks = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => backfillMotionPersonLinksPortable(toPortableMutationCtx(ctx), args),
});

export const backfillQuorumSnapshot = mutation({
  args: { id: v.id("minutes") },
  returns: v.any(),
  handler: (ctx, args) => backfillQuorumSnapshotPortable(toPortableMutationCtx(ctx), args),
});

export const generateDraft = action({
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

