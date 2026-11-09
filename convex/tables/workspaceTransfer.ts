import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Workspace transfer bookkeeping (operator-only, see convex/workspaceTransfer.ts).
 * One run moves one source society into this deployment; the id map is the
 * source of truth for resume, rewrite, verification and abort.
 */
export const workspaceTransferTables = {
  workspaceTransferRuns: defineTable({
    label: v.string(),
    sourceDeployment: v.string(),
    sourceSocietyId: v.string(),
    destSocietyId: v.optional(v.id("societies")),
    status: v.union(
      v.literal("applying"), v.literal("applied"), v.literal("verified"),
      v.literal("finalized"), v.literal("aborting"), v.literal("aborted"),
    ),
    planDigest: v.string(),
    exportDigest: v.string(),
    schemaDigest: v.string(),
    plannedRows: v.number(),
    plannedFiles: v.number(),
    insertedRows: v.number(),
    rewrittenRows: v.number(),
    uploadedFiles: v.number(),
    boundMemberships: v.number(),
    // Held back from the quarantined society so its public pages stay dark.
    deferredPublicSlug: v.optional(v.string()),
    verifyCursor: v.optional(v.string()),
    verifyCheckedRows: v.optional(v.number()),
    verifyIssues: v.optional(v.number()),
    serverVerifiedAtISO: v.optional(v.string()),
    clientVerifiedAtISO: v.optional(v.string()),
    verificationSummary: v.optional(v.string()),
    note: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
    finishedAtISO: v.optional(v.string()),
  }).index("by_label", ["label"]),

  workspaceTransferIdMap: defineTable({
    runId: v.id("workspaceTransferRuns"),
    sourceTable: v.string(),
    sourceId: v.string(),
    // Polymorphic, so a string rather than v.id(); `_storage` rows hold storage ids.
    destId: v.string(),
    rewrittenAtISO: v.optional(v.string()),
  })
    .index("by_run_source", ["runId", "sourceId"])
    .index("by_run_dest", ["runId", "destId"]),
};
