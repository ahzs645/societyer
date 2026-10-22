import { defineTable } from "convex/server";
import { v } from "convex/values";
export const procurementAnalyticsTables = {
  procurementAnalytics: defineTable({
    societyId: v.id("societies"), generation: v.string(), key: v.string(), request: v.string(), asOf: v.number(),
    state: v.union(v.literal("preparing"), v.literal("ready"), v.literal("failed")),
    startedAt: v.number(), expiresAt: v.number(), computedAt: v.optional(v.number()), resultJson: v.optional(v.string()), error: v.optional(v.string()),
    validUntil: v.optional(v.number()),
    measurements: v.optional(v.object({ inputRows: v.number(), inputBytes: v.number(), inputPages: v.number(), resultBytes: v.number(), durationMs: v.number() })),
  }).index("by_society_generation_key", ["societyId", "generation", "key"]).index("by_expiresAt", ["expiresAt"]),
};
