import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const decisionArgs = {
  societyId: v.id("societies"),
  ruleId: v.string(),
  flagLevel: v.string(),
  flagText: v.string(),
  evidenceRequired: v.array(v.string()),
};

export const listDecisions = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("complianceRemediations")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const markReviewed = mutation({
  args: {
    ...decisionArgs,
    notes: v.optional(v.string()),
    targetTable: v.optional(v.string()),
    targetId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const nowISO = new Date().toISOString();
    return await upsertDecision(ctx, {
      ...args,
      status: "resolved",
      resolvedAtISO: nowISO,
      notes: args.notes ?? "Marked reviewed from compliance obligations.",
    });
  },
});

export const dismissDecision = mutation({
  args: {
    ...decisionArgs,
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const nowISO = new Date().toISOString();
    return await upsertDecision(ctx, {
      ...args,
      status: "dismissed",
      dismissedAtISO: nowISO,
      notes: args.notes ?? "Dismissed from compliance obligations.",
    });
  },
});

export const reopenDecision = mutation({
  args: decisionArgs,
  returns: v.any(),
  handler: async (ctx, args) =>
    upsertDecision(ctx, {
      ...args,
      status: "open",
      notes: "Reopened from compliance obligations.",
    }),
});

async function upsertDecision(
  ctx: any,
  args: {
    societyId: any;
    ruleId: string;
    flagLevel: string;
    flagText: string;
    evidenceRequired: string[];
    status: string;
    targetTable?: string;
    targetId?: string;
    resolvedAtISO?: string;
    dismissedAtISO?: string;
    notes?: string;
  },
) {
  const nowISO = new Date().toISOString();
  const existing = await ctx.db
    .query("complianceRemediations")
    .withIndex("by_society_rule", (q: any) =>
      q.eq("societyId", args.societyId).eq("ruleId", args.ruleId),
    )
    .first();
  const patch = {
    flagLevel: args.flagLevel,
    flagText: args.flagText,
    evidenceRequired: args.evidenceRequired,
    status: args.status,
    targetTable: args.targetTable,
    targetId: args.targetId,
    resolvedAtISO: args.resolvedAtISO,
    dismissedAtISO: args.dismissedAtISO,
    notes: args.notes,
    updatedAtISO: nowISO,
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return { remediationId: existing._id, status: args.status, updated: true };
  }
  const remediationId = await ctx.db.insert("complianceRemediations", {
    societyId: args.societyId,
    ruleId: args.ruleId,
    createdAtISO: nowISO,
    ...patch,
  });
  return { remediationId, status: args.status, updated: false };
}
