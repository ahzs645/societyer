// @ts-nocheck
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("pipaTrainings")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    participantName: v.string(),
    role: v.string(),
    participantEmail: v.optional(v.string()),
    topic: v.string(),
    completedAtISO: v.string(),
    nextDueAtISO: v.optional(v.string()),
    trainer: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => ctx.db.insert("pipaTrainings", args),
});

export const update = mutation({
  args: {
    id: v.id("pipaTrainings"),
    patch: v.object({
      participantName: v.optional(v.string()),
      role: v.optional(v.string()),
      participantEmail: v.optional(v.string()),
      topic: v.optional(v.string()),
      completedAtISO: v.optional(v.string()),
      nextDueAtISO: v.optional(v.string()),
      trainer: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("pipaTrainings") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
