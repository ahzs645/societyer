import { defineTable } from "convex/server";
import { v } from "convex/values";

const scope = { societyId: v.id("societies"), generation: v.string() };
export const procurementRecordFields = {
  ...scope, recordKey: v.string(), kind: v.string(), title: v.string(), organization: v.string(),
  // `date` is sortable (YYYY-MM-DD, or YYYY-MM-DDTHH:MM in the source zone) when the source's date could be read;
  // `dateText` keeps the source's own words. Imports before October 18, 2026 stored the source text in `date`.
  status: v.string(), date: v.string(), dateText: v.optional(v.string()), updatedAt: v.string(),
  // The list's own columns (src/features/procurementReview/reader/source.ts `ListRow`), written by imports after
  // October 18, 2026; older imports lack them and read as empty. `value` is absent when the source's isn't a number.
  issuedFor: v.optional(v.string()), reference: v.optional(v.string()), documents: v.optional(v.number()), listedDocuments: v.optional(v.number()),
  supplier: v.optional(v.string()), value: v.optional(v.number()), currency: v.optional(v.string()), procurementType: v.optional(v.string()),
  // Earlier imports carried a server search corpus (up to 16 KB a row). The list now searches its loaded rows, so it isn't written.
  searchText: v.optional(v.string()),
};
export const procurementDocumentFields = {
  ...scope, recordKey: v.string(), documentKey: v.string(), name: v.string(), mediaType: v.string(),
  sha256: v.string(), sourceUrl: v.string(), status: v.string(), bytes: v.number(), parts: v.number(), available: v.boolean(),
};
export const procurementTables = {
  procurementCatalogs: defineTable({
    ...scope, folder: v.string(), publishedAt: v.string(), counts: v.record(v.string(), v.number()),
  }).index("by_society", ["societyId"]),
  // List projections stay small; a list read never touches notice bodies or file contents.
  procurementRecords: defineTable(procurementRecordFields)
    .index("by_kind_date", ["societyId", "generation", "kind", "date"])
    .index("by_key", ["societyId", "generation", "recordKey"]),
  procurementDetails: defineTable({ ...scope, recordKey: v.string(), dataJson: v.string() })
    .index("by_key", ["societyId", "generation", "recordKey"]),
  procurementDocuments: defineTable(procurementDocumentFields)
    .index("by_record", ["societyId", "generation", "recordKey"]),
  procurementEvidence: defineTable({ ...scope, recordKey: v.string(), source: v.string(), dataJson: v.string() })
    .index("by_record_source", ["societyId", "generation", "recordKey", "source"]),
};
