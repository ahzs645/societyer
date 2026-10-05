import { defineTable } from "convex/server";
import { v } from "convex/values";

/** Narrow meeting-preparation download surface; never export the business tables. */
export const offlineMeetingTables = {
  powersync_checkpoints: defineTable({ last_updated: v.float64() }),
  offlineMeetingAggregates: defineTable({
    societyId: v.id("societies"), uuid: v.string(), revision: v.number(), mappings: v.string(),
    file: v.optional(v.string()), fileStorageId: v.optional(v.id("_storage")), updatedByUserId: v.id("users"),
  }).index("by_society_uuid", ["societyId", "uuid"]),
  offlineMeetingReceipts: defineTable({
    societyId: v.id("societies"), userId: v.id("users"), operationId: v.string(), payload: v.string(), result: v.string(),
  }).index("by_actor_operation", ["societyId", "userId", "operationId"]),
  // Only these narrow, per-principal projections are eligible for download.
  offlineMeetingDownloads: defineTable({
    uuid: v.string(), society_id: v.string(), actor_key: v.string(), meeting_uuid: v.string(), revision: v.number(), payload: v.string(),
  }).index("by_society", ["society_id"]).index("by_actor", ["actor_key", "society_id"]),
  offlineMeetingScopes: defineTable({ societyId: v.id("societies"), nextRefreshAt: v.number(), blockedReason: v.optional(v.string()), scheduledJobId: v.optional(v.id("_scheduled_functions")) }).index("by_society", ["societyId"]).index("by_refresh", ["nextRefreshAt"]),
};
