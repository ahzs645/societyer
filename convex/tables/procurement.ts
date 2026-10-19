import { defineTable } from "convex/server";
import { v } from "convex/values";

const scope = { societyId: v.id("societies"), generation: v.string() };
export const procurementRecordFields = {
  ...scope,
  recordKey: v.string(),
  kind: v.string(),
  title: v.string(),
  organization: v.string(),
  // `date` is sortable (YYYY-MM-DD, or YYYY-MM-DDTHH:MM in the source zone) when the source's date could be read;
  // `dateText` keeps the source's own words. Imports before October 18, 2026 stored the source text in `date`.
  status: v.string(),
  date: v.string(),
  dateText: v.optional(v.string()),
  updatedAt: v.string(),
  // The list's own columns (src/features/procurementReview/reader/source.ts `ListRow`), written by imports after
  // October 18, 2026; older imports lack them and read as empty. `value` is absent when the source's isn't a number.
  issuedFor: v.optional(v.string()),
  reference: v.optional(v.string()),
  documents: v.optional(v.number()),
  listedDocuments: v.optional(v.number()),
  supplier: v.optional(v.string()),
  value: v.optional(v.number()),
  currency: v.optional(v.string()),
  procurementType: v.optional(v.string()),
  // Small list-column search text supports older open tabs; source bodies are never copied into the search corpus.
  searchText: v.optional(v.string()),
};
export const procurementDocumentFields = {
  ...scope,
  recordKey: v.string(),
  documentKey: v.string(),
  name: v.string(),
  mediaType: v.string(),
  sha256: v.string(),
  sourceUrl: v.string(),
  status: v.string(),
  bytes: v.number(),
  parts: v.number(),
  available: v.boolean(),
};
/** Small reference index shared across this workspace's catalog generations. */
export const procurementTermFields = {
  key: v.string(),
  releaseId: v.string(),
  scheme: v.string(),
  version: v.string(),
  code: v.string(),
  title: v.string(),
  parentKey: v.union(v.string(), v.null()),
};
export const procurementTaxonomyIndexFields = {
  releaseId: v.string(),
  contentHash: v.string(),
  count: v.number(),
};
export const procurementTables = {
  procurementCatalogs: defineTable({
    ...scope,
    folder: v.string(),
    publishedAt: v.string(),
    counts: v.record(v.string(), v.number()),
    storageGeneration: v.optional(v.string()),
    syncRunId: v.optional(v.id("procurementSyncRuns")),
    profileVersion: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    sourceCounts: v.optional(v.record(v.string(), v.number())),
    taxonomyReleases: v.optional(v.array(v.string())),
    taxonomyCount: v.optional(v.number()),
    taxonomyIndexes: v.optional(
      v.array(v.object(procurementTaxonomyIndexFields)),
    ),
    sourceSnapshotId: v.optional(v.string()),
    sourceCatalogSha256: v.optional(v.string()),
  }).index("by_society", ["societyId"]),
  // List projections stay small; a list read never touches notice bodies or file contents.
  procurementSyncRuns: defineTable({
    societyId: v.id("societies"),
    baseHash: v.string(),
    targetHash: v.string(),
    planHash: v.string(),
    operations: v.number(),
    counts: v.record(v.string(), v.number()),
    applied: v.number(),
    nextBatch: v.number(),
    completed: v.boolean(),
    changedAt: v.number(),
  }).index("by_society", ["societyId"]),
  procurementRecords: defineTable({
    ...procurementRecordFields,
    archived: v.optional(v.boolean()),
  })
    .index("by_live_kind_date", [
      "societyId",
      "generation",
      "archived",
      "kind",
      "date",
    ])
    .index("by_live_kind_title", [
      "societyId",
      "generation",
      "archived",
      "kind",
      "title",
    ])
    .index("by_live_kind_organization", [
      "societyId",
      "generation",
      "archived",
      "kind",
      "organization",
    ])
    .index("by_live_kind_issuedFor", [
      "societyId",
      "generation",
      "archived",
      "kind",
      "issuedFor",
    ])
    .index("by_live_kind_supplier", [
      "societyId",
      "generation",
      "archived",
      "kind",
      "supplier",
    ])
    .index("by_live_kind_value", [
      "societyId",
      "generation",
      "archived",
      "kind",
      "value",
    ])
    .index("by_live_kind_procurementType", [
      "societyId",
      "generation",
      "archived",
      "kind",
      "procurementType",
    ])
    .index("by_live_kind_documents", [
      "societyId",
      "generation",
      "archived",
      "kind",
      "documents",
    ])
    .index("by_live_kind_status", [
      "societyId",
      "generation",
      "archived",
      "kind",
      "status",
    ])
    .index("by_live_kind_recordKey", [
      "societyId",
      "generation",
      "archived",
      "kind",
      "recordKey",
    ])
    .index("by_live_buyer_date", [
      "societyId",
      "generation",
      "archived",
      "kind",
      "organization",
      "date",
    ])
    .index("by_live_issued_date", [
      "societyId",
      "generation",
      "archived",
      "kind",
      "issuedFor",
      "date",
    ])
    .index("by_kind_date", ["societyId", "generation", "kind", "date"])
    .index("by_key", ["societyId", "generation", "recordKey"])
    // The paged reader (released October 18, 2026) read these two. The whole-list
    // reader doesn't, but they stay until a release no longer needs to roll back to
    // it: removing them drops 240k documents from both, and restoring needs a backfill.
    .index("by_kind_status_date", [
      "societyId",
      "generation",
      "kind",
      "status",
      "date",
    ])
    .searchIndex("search_records", {
      searchField: "searchText",
      filterFields: ["societyId", "generation", "kind", "status"],
    }),
  procurementDetails: defineTable({
    ...scope,
    recordKey: v.string(),
    dataJson: v.string(),
    archived: v.optional(v.boolean()),
  }).index("by_key", ["societyId", "generation", "recordKey"]),
  procurementTaxonomyReleases: defineTable({
    societyId: v.id("societies"),
    ...procurementTaxonomyIndexFields,
    status: v.union(v.literal("importing"), v.literal("ready")),
  }).index("by_release", ["societyId", "releaseId"]),
  procurementTaxonomyTerms: defineTable({
    societyId: v.id("societies"),
    ...procurementTermFields,
  }).index("by_release_key", ["societyId", "releaseId", "key"]),
  procurementDocuments: defineTable({
    ...procurementDocumentFields,
    archived: v.optional(v.boolean()),
  })
    .index("by_document_key", ["societyId", "generation", "documentKey"])
    .index("by_record", ["societyId", "generation", "recordKey"]),
  procurementEvidence: defineTable({
    ...scope,
    recordKey: v.string(),
    source: v.string(),
    dataJson: v.string(),
    archived: v.optional(v.boolean()),
    syncKey: v.optional(v.string()),
  })
    .index("by_sync_key", ["societyId", "generation", "syncKey"])
    .index("by_record_source", [
      "societyId",
      "generation",
      "recordKey",
      "source",
    ]),
};
