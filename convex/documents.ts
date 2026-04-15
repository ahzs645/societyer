import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("documents")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    title: v.string(),
    category: v.string(),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    content: v.optional(v.string()),
    url: v.optional(v.string()),
    retentionYears: v.optional(v.number()),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("documents", {
      ...args,
      createdAtISO: new Date().toISOString(),
      flaggedForDeletion: false,
    }),
});

export const flagForDeletion = mutation({
  args: { id: v.id("documents"), flagged: v.boolean() },
  handler: async (ctx, { id, flagged }) => {
    await ctx.db.patch(id, { flaggedForDeletion: flagged });
  },
});

export const remove = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
