import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const motion = v.object({
  text: v.string(),
  movedBy: v.optional(v.string()),
  secondedBy: v.optional(v.string()),
  outcome: v.string(),
  votesFor: v.optional(v.number()),
  votesAgainst: v.optional(v.number()),
  abstentions: v.optional(v.number()),
});

const action = v.object({
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
    actionItems: v.array(action),
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
      actionItems: v.optional(v.array(action)),
      approvedAt: v.optional(v.string()),
      approvedInMeetingId: v.optional(v.id("meetings")),
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
    actionItems: v.array(action),
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

// Mock AI minute generation — produces a structured draft from a plain-text transcript.
// In production you'd replace this with an action calling an LLM.
export const generateDraft = mutation({
  args: {
    meetingId: v.id("meetings"),
    transcript: v.string(),
  },
  handler: async (ctx, { meetingId, transcript }) => {
    const meeting = await ctx.db.get(meetingId);
    if (!meeting) throw new Error("Meeting not found");

    const lines = transcript
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);

    const motions = lines
      .filter((l) => /motion|moved|seconded/i.test(l))
      .slice(0, 5)
      .map((text) => ({
        text,
        outcome: /carried|passed/i.test(text) ? "Carried" : /defeat/i.test(text) ? "Defeated" : "Tabled",
      }));

    const decisions = lines
      .filter((l) => /decided|resolved|approved/i.test(l))
      .slice(0, 5);

    const actionItems = lines
      .filter((l) => /action|to do|will|follow up/i.test(l))
      .slice(0, 8)
      .map((text) => ({ text, done: false }));

    const discussion = lines.slice(0, 20).join("\n");

    const existing = await ctx.db
      .query("minutes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();

    const payload = {
      societyId: meeting.societyId,
      meetingId,
      heldAt: meeting.scheduledAt,
      attendees: meeting.attendeeIds,
      absent: [],
      quorumMet: true,
      discussion,
      motions,
      decisions,
      actionItems,
      draftTranscript: transcript,
    };

    if (existing[0]) {
      await ctx.db.patch(existing[0]._id, payload);
      return existing[0]._id;
    }
    const id = await ctx.db.insert("minutes", payload);
    await ctx.db.patch(meetingId, { minutesId: id });
    return id;
  },
});
