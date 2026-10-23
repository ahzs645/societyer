import { defineTable } from "convex/server";
import { v } from "convex/values";
export const procurementAnalyticsTables = {
  procurementAnalyticsArtifacts: defineTable({
    societyId: v.id("societies"), generation: v.string(), request: v.string(), folder: v.string(),
    contentHash: v.string(), inventoryHash: v.string(), bundleSha256: v.string(),
    metricVersion: v.string(), mappingVersion: v.string(), engineVersion: v.string(),
    asOf: v.number(), computedAt: v.number(), validUntil: v.number(), expiresAt: v.number(), resultJson: v.string(),
  }).index("by_society_generation_request", ["societyId", "generation", "request"]).index("by_expiresAt", ["expiresAt"]),
  procurementAnalyticsBundles: defineTable({
    societyId: v.id("societies"), generation: v.string(), folder: v.string(), contentHash: v.string(), inventoryHash: v.string(),
    bundleSha256: v.string(), manifestJson: v.string(), asOf: v.number(), computedAt: v.number(), validUntil: v.number(), expiresAt: v.number(),
  }).index("by_society_generation", ["societyId", "generation"]).index("by_expiresAt", ["expiresAt"]),
  procurementAnalytics: defineTable({
    societyId: v.id("societies"), generation: v.string(), key: v.string(), request: v.string(), asOf: v.number(),
    state: v.union(v.literal("preparing"), v.literal("ready"), v.literal("failed")),
    startedAt: v.number(), expiresAt: v.number(), computedAt: v.optional(v.number()), resultJson: v.optional(v.string()), error: v.optional(v.string()),
    validUntil: v.optional(v.number()),
    measurements: v.optional(v.object({ inputRows: v.number(), inputBytes: v.number(), inputPages: v.number(), resultBytes: v.number(), durationMs: v.number() })),
  }).index("by_society_generation_key", ["societyId", "generation", "key"]).index("by_expiresAt", ["expiresAt"]),
};
