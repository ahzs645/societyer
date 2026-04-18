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
    broker: v.optional(v.string()),
    policyNumber: v.string(),
    coverageCents: v.optional(v.number()),
    premiumCents: v.optional(v.number()),
    deductibleCents: v.optional(v.number()),
    coverageSummary: v.optional(v.string()),
    additionalInsureds: v.optional(v.array(v.string())),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    renewalDate: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    confidence: v.optional(v.string()),
    sensitivity: v.optional(v.string()),
    riskFlags: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    return await ctx.db.insert("insurancePolicies", {
      ...args,
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("insurancePolicies"),
    patch: v.object({
      kind: v.optional(v.string()),
      insurer: v.optional(v.string()),
      broker: v.optional(v.string()),
      policyNumber: v.optional(v.string()),
      coverageCents: v.optional(v.number()),
      premiumCents: v.optional(v.number()),
      deductibleCents: v.optional(v.number()),
      coverageSummary: v.optional(v.string()),
      additionalInsureds: v.optional(v.array(v.string())),
      startDate: v.optional(v.string()),
      endDate: v.optional(v.string()),
      renewalDate: v.optional(v.string()),
      sourceDocumentIds: v.optional(v.array(v.id("documents"))),
      sourceExternalIds: v.optional(v.array(v.string())),
      confidence: v.optional(v.string()),
      sensitivity: v.optional(v.string()),
      riskFlags: v.optional(v.array(v.string())),
      notes: v.optional(v.string()),
      status: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, { ...patch, updatedAtISO: new Date().toISOString() });
  },
});

export const remove = mutation({
  args: { id: v.id("insurancePolicies") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
