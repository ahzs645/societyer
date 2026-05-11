import { v } from "convex/values";
import { mutation, query } from "./lib/untypedServer";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("orgChartAssignments")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const upsert = mutation({
  args: {
    societyId: v.id("societies"),
    subjectType: v.string(),
    subjectId: v.string(),
    subjectName: v.string(),
    managerType: v.optional(v.string()),
    managerId: v.optional(v.string()),
    managerName: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("orgChartAssignments")
      .withIndex("by_subject", (q) =>
        q.eq("societyId", args.societyId).eq("subjectType", args.subjectType).eq("subjectId", args.subjectId),
      )
      .first();
    const patch = {
      subjectName: args.subjectName,
      managerType: args.managerType || undefined,
      managerId: args.managerId || undefined,
      managerName: args.managerName || undefined,
      notes: args.notes || undefined,
      updatedAtISO: new Date().toISOString(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("orgChartAssignments", {
      societyId: args.societyId,
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      ...patch,
    });
  },
});

export const remove = mutation({
  args: {
    societyId: v.id("societies"),
    subjectType: v.string(),
    subjectId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("orgChartAssignments")
      .withIndex("by_subject", (q) =>
        q.eq("societyId", args.societyId).eq("subjectType", args.subjectType).eq("subjectId", args.subjectId),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
  },
});
