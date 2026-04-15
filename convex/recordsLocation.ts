import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("recordsLocation")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return rows[0] ?? null;
  },
});

export const upsert = mutation({
  args: {
    societyId: v.id("societies"),
    address: v.string(),
    noticePostedAtOffice: v.boolean(),
    postedAtISO: v.optional(v.string()),
    computerProvidedForInspection: v.boolean(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("recordsLocation")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    if (existing[0]) {
      const { societyId, ...patch } = args;
      await ctx.db.patch(existing[0]._id, patch);
      return existing[0]._id;
    }
    return ctx.db.insert("recordsLocation", args);
  },
});
