// @ts-nocheck
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("insurancePolicies")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    kind: v.string(),
    insurer: v.string(),
    policyNumber: v.string(),
    coverageCents: v.number(),
    premiumCents: v.optional(v.number()),
    startDate: v.string(),
    renewalDate: v.string(),
    notes: v.optional(v.string()),
    status: v.string(),
  },
  handler: async (ctx, args) => ctx.db.insert("insurancePolicies", args),
});

export const update = mutation({
  args: {
    id: v.id("insurancePolicies"),
    patch: v.object({
      kind: v.optional(v.string()),
      insurer: v.optional(v.string()),
      policyNumber: v.optional(v.string()),
      coverageCents: v.optional(v.number()),
      premiumCents: v.optional(v.number()),
      startDate: v.optional(v.string()),
      renewalDate: v.optional(v.string()),
      notes: v.optional(v.string()),
      status: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("insurancePolicies") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
