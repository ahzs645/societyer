import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import societyerSchema from "../../../convex/schema";

// Additional draft-only evaluation tables; meeting preparation reuses production schema.
export default defineSchema({
  ...societyerSchema.tables,
  offlineDrafts: defineTable({
    societyId: v.id("societies"), uuid: v.string(), title: v.string(), content: v.string(),
    revision: v.number(), updatedByUserId: v.id("users"),
  }).index("by_society_uuid", ["societyId", "uuid"]),
  offlineDraftReceipts: defineTable({
    societyId: v.id("societies"), userId: v.id("users"), batchId: v.string(), payload: v.string(),
  }).index("by_actor_batch", ["societyId", "userId", "batchId"]),
});
