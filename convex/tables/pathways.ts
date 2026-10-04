import { defineTable } from "convex/server";
import { v } from "convex/values";

export const pathwayTables = {
  pathwayRuns: defineTable({
    societyId: v.id("societies"), pathwayKey: v.string(), pathwayVersion: v.string(), pathwayTitle: v.string(),
    graph: v.any(), inputs: v.any(), inputsFrozen: v.boolean(), createdByUserId: v.id("users"),
    status: v.string(), createdAtISO: v.string(), updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),
  pathwaySteps: defineTable({
    societyId: v.id("societies"), runId: v.id("pathwayRuns"), nodeKey: v.string(), state: v.string(),
    notes: v.optional(v.string()), documentId: v.optional(v.id("documents")), documentVersionId: v.optional(v.id("documentVersions")),
    documentSnapshotJson: v.optional(v.string()), completedByUserId: v.optional(v.id("users")),
    approvedByUserId: v.optional(v.id("users")), approvedPayloadsJson: v.optional(v.string()),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]).index("by_run", ["runId"]).index("by_run_node", ["runId", "nodeKey"]),
  pathwaySubmissionOutbox: defineTable({
    societyId: v.id("societies"), runId: v.id("pathwayRuns"), stepKey: v.string(), adapterId: v.string(),
    payloadJson: v.string(), approvedSha256: v.string(), idempotencyKey: v.string(), actorId: v.id("users"),
    documentIds: v.array(v.id("documents")), status: v.string(), createdAtISO: v.string(), updatedAtISO: v.string(),
    officialUrl: v.optional(v.string()), attemptId: v.optional(v.string()), receiptJson: v.optional(v.string()), error: v.optional(v.string()),
  }).index("by_society", ["societyId"]).index("by_run", ["runId"]).index("by_idempotency", ["idempotencyKey"]),
  pathwayAudit: defineTable({
    societyId: v.id("societies"), runId: v.id("pathwayRuns"), event: v.string(), nodeKey: v.optional(v.string()),
    actorUserId: v.id("users"), atISO: v.string(), detailJson: v.string(),
  }).index("by_society", ["societyId"]).index("by_run", ["runId"]),
};
