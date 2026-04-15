import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("societies").collect();
    return all[0] ?? null;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => ctx.db.query("societies").collect(),
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("societies")),
    name: v.string(),
    incorporationNumber: v.optional(v.string()),
    incorporationDate: v.optional(v.string()),
    fiscalYearEnd: v.optional(v.string()),
    isCharity: v.boolean(),
    isMemberFunded: v.boolean(),
    registeredOfficeAddress: v.optional(v.string()),
    mailingAddress: v.optional(v.string()),
    purposes: v.optional(v.string()),
    privacyOfficerName: v.optional(v.string()),
    privacyOfficerEmail: v.optional(v.string()),
    boardCadence: v.optional(v.string()),
    boardCadenceDayOfWeek: v.optional(v.string()),
    boardCadenceTime: v.optional(v.string()),
    boardCadenceNotes: v.optional(v.string()),
    demoMode: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { id, ...rest } = args;
    const payload = { ...rest, updatedAt: Date.now() };
    if (id) {
      await ctx.db.patch(id, payload);
      return id;
    }
    return await ctx.db.insert("societies", payload);
  },
});
