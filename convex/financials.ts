import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const remItem = v.object({ role: v.string(), amountCents: v.number() });

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("financials")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    fiscalYear: v.string(),
    periodEnd: v.string(),
    revenueCents: v.number(),
    expensesCents: v.number(),
    netAssetsCents: v.number(),
    restrictedFundsCents: v.optional(v.number()),
    auditStatus: v.string(),
    auditorName: v.optional(v.string()),
    remunerationDisclosures: v.array(remItem),
  },
  handler: async (ctx, args) => ctx.db.insert("financials", args),
});

export const update = mutation({
  args: {
    id: v.id("financials"),
    patch: v.object({
      fiscalYear: v.optional(v.string()),
      periodEnd: v.optional(v.string()),
      revenueCents: v.optional(v.number()),
      expensesCents: v.optional(v.number()),
      netAssetsCents: v.optional(v.number()),
      restrictedFundsCents: v.optional(v.number()),
      auditStatus: v.optional(v.string()),
      auditorName: v.optional(v.string()),
      approvedByBoardAt: v.optional(v.string()),
      presentedAtMeetingId: v.optional(v.id("meetings")),
      remunerationDisclosures: v.optional(v.array(remItem)),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("financials") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
