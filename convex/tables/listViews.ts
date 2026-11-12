import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Named views of the in-memory lists (`RecordListTable`), shared with the
 * workspace (shared/functions/listViews.ts). `tableId` is the list's id in
 * code; `stateJson` is a validated, canonical shared/listViewState.ts state
 * (columns, sorts, filters, grouping, density, search).
 */
export const listViewTables = {
  listViews: defineTable({
    societyId: v.id("societies"),
    tableId: v.string(),
    name: v.string(),
    stateJson: v.string(),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    // A list's views in a workspace.
    .index("by_society_table", ["societyId", "tableId"]),
};
