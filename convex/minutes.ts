import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { summarizeMinutes } from "./providers/llm";
import { buildQuorumSnapshot, QuorumSnapshot } from "./lib/bylawRules";
import { Doc } from "./_generated/dataModel";

const motion = v.object({
  text: v.string(),
  movedBy: v.optional(v.string()),
  secondedBy: v.optional(v.string()),
  outcome: v.string(),
  votesFor: v.optional(v.number()),
  votesAgainst: v.optional(v.number()),
  abstentions: v.optional(v.number()),
  resolutionType: v.optional(v.string()),
});

const actionItem = v.object({
  text: v.string(),
  assignee: v.optional(v.string()),
  dueDate: v.optional(v.string()),
  done: v.boolean(),
});

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("minutes")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const getByMeeting = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, { meetingId }) => {
    const rows = await ctx.db
      .query("minutes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    return rows[0] ?? null;
  },
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    heldAt: v.string(),
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
    draftTranscript: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    const snapshot = meeting
      ? await quorumSnapshotForMeeting(ctx, meeting, args.quorumRequired)
      : null;
    const id = await ctx.db.insert("minutes", {
      ...args,
      ...minutesSnapshotFields(args, snapshot),
    });
    await ctx.db.patch(args.meetingId, { minutesId: id });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("minutes"),
    patch: v.object({
      heldAt: v.optional(v.string()),
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
      draftTranscript: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

// Upsert a minutes row from an AI-generated draft (transcripts.runPipeline).
export const upsertFromDraft = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    heldAt: v.string(),
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
    draftTranscript: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    const snapshot = meeting
      ? await quorumSnapshotForMeeting(ctx, meeting, args.quorumRequired)
      : null;
    const quorumRequired = args.quorumRequired ?? snapshot?.quorumRequired;
    const payload = {
      ...args,
      ...minutesSnapshotFields(args, snapshot),
      quorumMet:
        quorumRequired == null
          ? args.quorumMet
          : args.attendees.length >= quorumRequired,
    };
    const existing = await ctx.db
      .query("minutes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .collect();
    if (existing[0]) {
      await ctx.db.patch(existing[0]._id, payload);
      return existing[0]._id;
    }
    const id = await ctx.db.insert("minutes", payload);
    await ctx.db.patch(args.meetingId, { minutesId: id });
    return id;
  },
});

export const backfillQuorumSnapshot = mutation({
  args: { id: v.id("minutes") },
  handler: async (ctx, { id }) => {
    const minutes = await ctx.db.get(id);
    if (!minutes) return null;
    const meeting = await ctx.db.get(minutes.meetingId);
    if (!meeting) return null;
    const snapshot = await quorumSnapshotForMeeting(
      ctx,
      meeting,
      minutes.quorumRequired ?? meeting.quorumRequired,
    );
    const patch: any = {};
    if (minutes.quorumRequired == null && snapshot.quorumRequired != null) {
      patch.quorumRequired = snapshot.quorumRequired;
    }
    if (!minutes.bylawRuleSetId && snapshot.bylawRuleSetId) {
      patch.bylawRuleSetId = snapshot.bylawRuleSetId;
    }
    if (minutes.quorumRuleVersion == null && snapshot.quorumRuleVersion != null) {
      patch.quorumRuleVersion = snapshot.quorumRuleVersion;
    }
    if (!minutes.quorumRuleEffectiveFromISO && snapshot.quorumRuleEffectiveFromISO) {
      patch.quorumRuleEffectiveFromISO = snapshot.quorumRuleEffectiveFromISO;
    }
    if (!minutes.quorumSourceLabel) {
      patch.quorumSourceLabel = snapshot.quorumSourceLabel;
    }
    if (!minutes.quorumComputedAtISO) {
      patch.quorumComputedAtISO = snapshot.quorumComputedAtISO;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(id, patch);
    }
    return { patched: Object.keys(patch) };
  },
});

export const generateDraft = action({
  args: {
    meetingId: v.id("meetings"),
    transcript: v.string(),
  },
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
      attendees: draft.attendees.length ? draft.attendees : meeting.attendeeIds,
      absent: draft.absent,
      quorumMet: draft.attendees.length >= (meeting.quorumRequired ?? 0),
      discussion: draft.discussion,
      motions: draft.motions,
      decisions: draft.decisions,
      actionItems: draft.actionItems,
      draftTranscript: transcript,
    });
  },
});

async function quorumSnapshotForMeeting(
  ctx: any,
  meeting: Doc<"meetings">,
  quorumRequiredOverride?: number,
) {
  return await buildQuorumSnapshot(ctx, {
    societyId: meeting.societyId,
    meetingDateISO: meeting.scheduledAt,
    meetingType: meeting.type,
    quorumRequiredOverride,
  });
}

function minutesSnapshotFields(
  args: {
    quorumRequired?: number;
    bylawRuleSetId?: any;
    quorumRuleVersion?: number;
    quorumRuleEffectiveFromISO?: string;
    quorumSourceLabel?: string;
    quorumComputedAtISO?: string;
  },
  snapshot: QuorumSnapshot | null,
) {
  return {
    quorumRequired: args.quorumRequired ?? snapshot?.quorumRequired,
    bylawRuleSetId: args.bylawRuleSetId ?? snapshot?.bylawRuleSetId,
    quorumRuleVersion: args.quorumRuleVersion ?? snapshot?.quorumRuleVersion,
    quorumRuleEffectiveFromISO:
      args.quorumRuleEffectiveFromISO ??
      snapshot?.quorumRuleEffectiveFromISO,
    quorumSourceLabel: args.quorumSourceLabel ?? snapshot?.quorumSourceLabel,
    quorumComputedAtISO: args.quorumComputedAtISO ?? snapshot?.quorumComputedAtISO,
  };
}
