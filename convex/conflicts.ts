import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("conflicts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    directorId: v.id("directors"),
    declaredAt: v.string(),
    contractOrMatter: v.string(),
    natureOfInterest: v.string(),
    abstainedFromVote: v.boolean(),
    leftRoom: v.boolean(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => ctx.db.insert("conflicts", args),
});

export const resolve = mutation({
  args: { id: v.id("conflicts"), resolvedAt: v.string() },
  handler: async (ctx, { id, resolvedAt }) => {
    await ctx.db.patch(id, { resolvedAt });
  },
});

export const remove = mutation({
  args: { id: v.id("conflicts") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
