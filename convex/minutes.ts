import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { summarizeMinutes } from "./providers/llm";

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
    discussion: v.string(),
    motions: v.array(motion),
    decisions: v.array(v.string()),
    actionItems: v.array(actionItem),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    draftTranscript: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("minutes", args);
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
    discussion: v.string(),
    motions: v.array(motion),
    decisions: v.array(v.string()),
    actionItems: v.array(actionItem),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    draftTranscript: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("minutes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .collect();
    if (existing[0]) {
      await ctx.db.patch(existing[0]._id, args);
      return existing[0]._id;
    }
    const id = await ctx.db.insert("minutes", args);
    await ctx.db.patch(args.meetingId, { minutesId: id });
    return id;
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
