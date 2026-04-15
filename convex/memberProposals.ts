import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getActiveBylawRuleSet } from "./lib/bylawRules";

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
    thresholdPercent: v.optional(v.number()),
    eligibleVotersAtSubmission: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rules = await getActiveBylawRuleSet(ctx, args.societyId);
    const thresholdPercent =
      args.thresholdPercent ?? rules.memberProposalThresholdPct;
    const signatureThresholdCount =
      args.eligibleVotersAtSubmission && args.eligibleVotersAtSubmission > 0
        ? Math.ceil(args.eligibleVotersAtSubmission * (thresholdPercent / 100))
        : 0;
    const requiredSignatureCount = Math.max(
      rules.memberProposalMinSignatures,
      signatureThresholdCount,
    );
    // Evaluate threshold on insert
    const meets = args.signatureCount >= requiredSignatureCount;

    let status = meets ? "MeetsThreshold" : "Submitted";
    if (args.meetingId) {
      const meeting = await ctx.db.get(args.meetingId);
      if (meeting?.noticeSentAt) {
        const leadMs = rules.memberProposalLeadDays * 86_400_000;
        const receivedTs = new Date(args.submittedAtISO).getTime();
        const noticeTs = new Date(meeting.noticeSentAt).getTime();
        if (receivedTs > noticeTs - leadMs) {
          status = "Rejected";
        }
      }
    }
    return ctx.db.insert("memberProposals", {
      ...args,
      thresholdPercent,
      includedInAgenda: false,
      status,
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
