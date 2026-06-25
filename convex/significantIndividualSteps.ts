import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  reviewsDue as computeReviewsDue,
  type SignificanceStep,
} from "../shared/significantIndividuals";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("significantIndividualSteps")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return rows.sort((a, b) => (a.stepDate < b.stepDate ? 1 : a.stepDate > b.stepDate ? -1 : 0));
  },
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    individualName: v.string(),
    roleHolderId: v.optional(v.id("roleHolders")),
    stepsNarrative: v.string(),
    stepDate: v.string(),
    nextReviewDate: v.optional(v.string()),
    nowISO: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { nowISO, ...rest } = args;
    return ctx.db.insert("significantIndividualSteps", {
      ...rest,
      createdAtISO: nowISO,
    });
  },
});

export const reviewsDue = query({
  args: { societyId: v.id("societies"), asOf: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, asOf }) => {
    const rows = await ctx.db
      .query("significantIndividualSteps")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const steps: SignificanceStep[] = rows.map((row) => ({
      individualName: row.individualName,
      stepsNarrative: row.stepsNarrative,
      stepDate: row.stepDate,
      nextReviewDate: row.nextReviewDate,
    }));
    return computeReviewsDue(steps, asOf);
  },
});

export const remove = mutation({
  args: { id: v.id("significantIndividualSteps") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
