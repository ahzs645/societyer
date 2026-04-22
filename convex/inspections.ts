import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("inspections")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const forDocument = query({
  args: { documentId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, { documentId }) =>
    ctx.db
      .query("inspections")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .collect(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    documentId: v.optional(v.id("documents")),
    inspectorName: v.string(),
    isMember: v.boolean(),
    recordsRequested: v.string(),
    inspectedAtISO: v.string(),
    feeCents: v.optional(v.number()),
    copyPages: v.optional(v.number()),
    copyFeeCents: v.optional(v.number()),
    deliveryMethod: v.string(),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => ctx.db.insert("inspections", args),
});

export const remove = mutation({
  args: { id: v.id("inspections") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
