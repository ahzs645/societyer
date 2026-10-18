import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Workspace-defined reporting dimensions for the books: tag groups (Program,
 * Grant, Event…) and their tags. A bank transaction line carries at most one
 * tag per group (`financialTransactions.tagIds` / `lines[].tagIds`), and the
 * tags travel onto the journal lines it posts (`journalLines.tagIds`).
 * Archiving hides a group or tag from pickers without touching tagged lines.
 */

/** One line of a split bank transaction (see shared/transactionLines.ts). */
export const transactionLineValidator = v.object({
  id: v.string(),
  amountCents: v.number(),
  category: v.optional(v.string()),
  accountingAccountId: v.optional(v.id("financialAccounts")),
  fundRestrictionId: v.optional(v.id("fundRestrictions")),
  memo: v.optional(v.string()),
  tagIds: v.optional(v.array(v.id("financeTags"))),
});

export const financeTagTables = {
  financeTagGroups: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    color: v.optional(v.string()), // chip tone: blue | green | red | amber | purple | teal | gray | pink | violet
    sortOrder: v.number(),
    archivedAtISO: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),

  financeTags: defineTable({
    societyId: v.id("societies"),
    groupId: v.id("financeTagGroups"),
    name: v.string(),
    // Unset: the tag shows in its group's colour.
    color: v.optional(v.string()),
    sortOrder: v.number(),
    archivedAtISO: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_group", ["groupId"]),
};
