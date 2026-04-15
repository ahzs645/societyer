import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("memberProposals")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.optional(v.id("meetings")),
    title: v.string(),
    text: v.string(),
    submittedByName: v.string(),
    submittedAtISO: v.string(),
    signatureCount: v.number(),
    thresholdPercent: v.number(),
    eligibleVotersAtSubmission: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Evaluate threshold on insert
    const meets =
      args.eligibleVotersAtSubmission && args.eligibleVotersAtSubmission > 0
        ? args.signatureCount / args.eligibleVotersAtSubmission >= args.thresholdPercent / 100
        : false;
    return ctx.db.insert("memberProposals", {
      ...args,
      includedInAgenda: false,
      status: meets ? "MeetsThreshold" : "Submitted",
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("memberProposals"),
    patch: v.object({
      title: v.optional(v.string()),
      text: v.optional(v.string()),
      signatureCount: v.optional(v.number()),
      eligibleVotersAtSubmission: v.optional(v.number()),
      meetingId: v.optional(v.id("meetings")),
      includedInAgenda: v.optional(v.boolean()),
      status: v.optional(v.string()),
      receivedAtISO: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("memberProposals") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
