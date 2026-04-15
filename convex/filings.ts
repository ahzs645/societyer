import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: { id: v.id("filings") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("filings")
      .withIndex("by_society_due", (q) => q.eq("societyId", societyId))
      .order("asc")
      .collect(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    kind: v.string(),
    periodLabel: v.optional(v.string()),
    dueDate: v.string(),
    status: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => ctx.db.insert("filings", args),
});

export const markFiled = mutation({
  args: {
    id: v.id("filings"),
    filedAt: v.string(),
    confirmationNumber: v.optional(v.string()),
    feePaidCents: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...rest }) => {
    await ctx.db.patch(id, { ...rest, status: "Filed" });
  },
});

export const update = mutation({
  args: {
    id: v.id("filings"),
    patch: v.object({
      kind: v.optional(v.string()),
      periodLabel: v.optional(v.string()),
      dueDate: v.optional(v.string()),
      status: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("filings") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
