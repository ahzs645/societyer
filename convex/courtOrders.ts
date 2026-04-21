import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("courtOrders")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    title: v.string(),
    orderDate: v.string(),
    court: v.string(),
    fileNumber: v.optional(v.string()),
    description: v.string(),
    documentId: v.optional(v.id("documents")),
    status: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => ctx.db.insert("courtOrders", args),
});

export const update = mutation({
  args: {
    id: v.id("courtOrders"),
    patch: v.object({
      title: v.optional(v.string()),
      orderDate: v.optional(v.string()),
      court: v.optional(v.string()),
      fileNumber: v.optional(v.string()),
      description: v.optional(v.string()),
      documentId: v.optional(v.id("documents")),
      status: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("courtOrders") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
