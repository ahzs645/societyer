import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import societyerSchema from "../../../convex/schema";

// Evaluation schema only. The production schema and deployment are untouched.
export default defineSchema({
  ...societyerSchema.tables,
  powersync_checkpoints: defineTable({ last_updated: v.float64() }),
  offlineDrafts: defineTable({
    societyId: v.id("societies"), uuid: v.string(), title: v.string(), content: v.string(),
    revision: v.number(), updatedByUserId: v.id("users"),
  }).index("by_society_uuid", ["societyId", "uuid"]),
  offlineDraftReceipts: defineTable({
    societyId: v.id("societies"), userId: v.id("users"), batchId: v.string(), payload: v.string(),
  }).index("by_actor_batch", ["societyId", "userId", "batchId"]),
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
});
