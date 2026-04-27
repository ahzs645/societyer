import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("deadlines")
      .withIndex("by_society_due", (q) => q.eq("societyId", societyId))
      .order("asc")
      .collect(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    title: v.string(),
    description: v.optional(v.string()),
    dueDate: v.string(),
    category: v.string(),
    recurrence: v.optional(v.string()),
    linkedFilingId: v.optional(v.id("filings")),
  },
  returns: v.any(),
  handler: async (ctx, args) => ctx.db.insert("deadlines", { ...args, done: false }),
});

export const toggleDone = mutation({
  args: { id: v.id("deadlines"), done: v.boolean() },
  returns: v.any(),
  handler: async (ctx, { id, done }) => {
    await ctx.db.patch(id, { done });
  },
});

export const update = mutation({
  args: {
    id: v.id("deadlines"),
    patch: v.object({
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      dueDate: v.optional(v.string()),
      category: v.optional(v.string()),
      done: v.optional(v.boolean()),
      recurrence: v.optional(v.string()),
      linkedFilingId: v.optional(v.id("filings")),
    }),
  },
  returns: v.any(),
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("deadlines") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
