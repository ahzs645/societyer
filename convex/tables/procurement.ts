import { defineTable } from "convex/server";
import { v } from "convex/values";

const scope = { societyId: v.id("societies"), generation: v.string() };
export const procurementRecordFields = {
  ...scope, recordKey: v.string(), kind: v.string(), title: v.string(), organization: v.string(),
  // `date` is sortable (YYYY-MM-DD, or YYYY-MM-DDTHH:MM in the source zone) when the source's date could be read;
  // `dateText` keeps the source's own words. Imports before October 18, 2026 stored the source text in `date`.
  status: v.string(), date: v.string(), dateText: v.optional(v.string()), updatedAt: v.string(), searchText: v.string(),
};
export const procurementDocumentFields = {
  ...scope, recordKey: v.string(), documentKey: v.string(), name: v.string(), mediaType: v.string(),
  sha256: v.string(), sourceUrl: v.string(), status: v.string(), bytes: v.number(), parts: v.number(), available: v.boolean(),
};
/** Small reference index shared across this workspace's catalog generations. */
export const procurementTermFields = {
  key: v.string(), releaseId: v.string(), scheme: v.string(), version: v.string(), code: v.string(), title: v.string(), parentKey: v.union(v.string(), v.null()),
};
export const procurementTables = {
  procurementCatalogs: defineTable({
    ...scope, folder: v.string(), publishedAt: v.string(), counts: v.record(v.string(), v.number()),
    profileVersion: v.optional(v.number()), contentHash: v.optional(v.string()), sourceCounts: v.optional(v.record(v.string(), v.number())),
    taxonomyReleases: v.optional(v.array(v.string())), taxonomyCount: v.optional(v.number()),
  }).index("by_society", ["societyId"]),
  // List projections stay small; a page never reads notice bodies or file contents.
  procurementRecords: defineTable(procurementRecordFields)
    .index("by_kind_date", ["societyId", "generation", "kind", "date"])
    .index("by_kind_status_date", ["societyId", "generation", "kind", "status", "date"])
    .index("by_key", ["societyId", "generation", "recordKey"])
    .searchIndex("search_records", { searchField: "searchText", filterFields: ["societyId", "generation", "kind", "status"] }),
  procurementDetails: defineTable({ ...scope, recordKey: v.string(), dataJson: v.string() })
    .index("by_key", ["societyId", "generation", "recordKey"]),
  procurementTaxonomyTerms: defineTable({ societyId: v.id("societies"), ...procurementTermFields })
    .index("by_release_key", ["societyId", "releaseId", "key"]),
  procurementDocuments: defineTable(procurementDocumentFields)
    .index("by_record", ["societyId", "generation", "recordKey"]),
  procurementEvidence: defineTable({ ...scope, recordKey: v.string(), source: v.string(), dataJson: v.string() })
    .index("by_record_source", ["societyId", "generation", "recordKey", "source"]),
};
