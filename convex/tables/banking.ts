import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Banking tables: money-account details for the Accounts page, the receipt
 * inbox, and committee spend budgets.
 *
 * - `bankAccountProfiles`: at most one row per money account (a
 *   `financialAccounts` row of type Bank or Credit). Holds what the ledger row
 *   doesn't: institution and last four digits, the opening balance of an
 *   account added by hand, a separate ledger account it posts to, and whether
 *   it is archived. No row means a plain synced or imported account.
 * - `receiptInboxItems`: receipt files uploaded in bulk (each a `documents`
 *   row), waiting to be matched to a bank transaction. Matching sets the
 *   transaction's receipt through financialHub.updateTransaction's logic.
 * - `spendBudgets`: spending limits for a committee and/or named people that
 *   reset weekly, monthly or quarterly, or run once. Not the annual line
 *   budgets in `budgets`; expense claims count against them
 *   (expenseReports.spendBudgetId).
 */
export const bankingTables = {
  bankAccountProfiles: defineTable({
    societyId: v.id("societies"),
    accountId: v.id("financialAccounts"),
    origin: v.optional(v.string()), // manual: added on the Accounts page
    institution: v.optional(v.string()),
    lastFour: v.optional(v.string()),
    openingBalanceCents: v.optional(v.number()),
    openingDate: v.optional(v.string()),
    // The chart-of-accounts account this feed posts to, when it is not its own ledger account.
    ledgerAccountId: v.optional(v.id("financialAccounts")),
    archivedAtISO: v.optional(v.string()),
    archivedByName: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_account", ["accountId"]),

  receiptInboxItems: defineTable({
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    fileName: v.string(),
    merchant: v.optional(v.string()),
    amountCents: v.optional(v.number()),
    date: v.optional(v.string()),
    status: v.string(), // unmatched | matched | discarded
    matchedTransactionId: v.optional(v.id("financialTransactions")),
    matchedAtISO: v.optional(v.string()),
    matchedByName: v.optional(v.string()),
    matchScore: v.optional(v.number()),
    uploadedByUserId: v.optional(v.id("users")),
    uploadedByName: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_document", ["documentId"])
    .index("by_transaction", ["matchedTransactionId"]),

  spendBudgets: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    limitCents: v.number(),
    currency: v.string(),
    cycle: v.string(), // weekly | monthly | quarterly | once
    startDate: v.string(),
    endDate: v.optional(v.string()),
    committeeId: v.optional(v.id("committees")),
    memberUserIds: v.array(v.id("users")),
    notes: v.optional(v.string()),
    archivedAtISO: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_committee", ["committeeId"]),
};
