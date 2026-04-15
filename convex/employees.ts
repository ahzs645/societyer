import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("employees")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    role: v.string(),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    employmentType: v.string(),
    annualSalaryCents: v.optional(v.number()),
    hourlyWageCents: v.optional(v.number()),
    worksafeBCNumber: v.optional(v.string()),
    cppExempt: v.boolean(),
    eiExempt: v.boolean(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => ctx.db.insert("employees", args),
});

export const update = mutation({
  args: {
    id: v.id("employees"),
    patch: v.object({
      firstName: v.optional(v.string()),
      lastName: v.optional(v.string()),
      email: v.optional(v.string()),
      role: v.optional(v.string()),
      startDate: v.optional(v.string()),
      endDate: v.optional(v.string()),
      employmentType: v.optional(v.string()),
      annualSalaryCents: v.optional(v.number()),
      hourlyWageCents: v.optional(v.number()),
      worksafeBCNumber: v.optional(v.string()),
      cppExempt: v.optional(v.boolean()),
      eiExempt: v.optional(v.boolean()),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("employees") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
