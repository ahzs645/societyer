import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies"), limit: v.optional(v.number()) },
  handler: async (ctx, { societyId, limit }) => {
    const rows = await ctx.db
      .query("activity")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .order("desc")
      .take(limit ?? 30);
    return rows;
  },
});

export const log = mutation({
  args: {
    societyId: v.id("societies"),
    actor: v.string(),
    entityType: v.string(),
    entityId: v.optional(v.string()),
    action: v.string(),
    summary: v.string(),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("activity", { ...args, createdAtISO: new Date().toISOString() }),
});
