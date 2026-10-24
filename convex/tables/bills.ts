import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Payables: bills from vendors, their lines (where each cost goes in the
 * books), payments (optionally linked to the money-out bank line) and the
 * approval and activity trail. Vendors are `accountingCounterparties` rows of
 * kind "vendor". Status derivation, posting lines and match suggestions live
 * in shared/bills.ts.
 */

// Extend with optional fields (program codes) as bill lines grow.
export const billLineValidator = v.object({
  key: v.string(),
  accountId: v.optional(v.id("financialAccounts")),
  amountCents: v.number(),
  memo: v.optional(v.string()),
  fundRestrictionId: v.optional(v.id("fundRestrictions")),
  // Reporting tags, at most one per tag group; posted onto journalLines.tagIds.
  tagIds: v.optional(v.array(v.id("financeTags"))),
});

// What linking a bank line changed on it, so removing the payment puts it back.
export const billLinkedTransactionSnapshotValidator = v.object({
  category: v.optional(v.string()),
  accountingAccountId: v.optional(v.id("financialAccounts")),
  categorizedBy: v.optional(v.string()),
  ruleId: v.optional(v.id("transactionRules")),
  // The rule run that categorised it (financialTransactions.ruleApplication), so Undo still works after the link goes.
  ruleApplication: v.optional(v.object({
    ruleName: v.string(),
    batchId: v.string(),
    appliedAtISO: v.string(),
    previous: v.optional(v.any()),
  })),
  reconciledAtISO: v.optional(v.string()),
  reconciledByName: v.optional(v.string()),
  matchedKind: v.optional(v.string()),
  matchedId: v.optional(v.string()),
  reconciliationNote: v.optional(v.string()),
});

export const billPaymentValidator = v.object({
  kind: v.optional(v.union(v.literal("payment"), v.literal("credit"), v.literal("write_off"), v.literal("refund"))),
  idempotencyKey: v.optional(v.string()), sourcePaymentKey: v.optional(v.string()), adjustmentAccountId: v.optional(v.id("financialAccounts")),
  reversedDate: v.optional(v.string()), reversalJournalEntryId: v.optional(v.id("journalEntries")), cashBasisReversalJournalEntryId: v.optional(v.id("journalEntries")),
  reversedAtISO: v.optional(v.string()), reversalReason: v.optional(v.string()), restoredTransactionJournalEntryId: v.optional(v.id("journalEntries")),
  key: v.string(),
  date: v.string(),
  amountCents: v.number(),
  method: v.string(), // eft | e_transfer | cheque | pre_authorized_debit | card | cash | other
  reference: v.optional(v.string()),
  financialTransactionId: v.optional(v.id("financialTransactions")),
  transactionBefore: v.optional(billLinkedTransactionSnapshotValidator),
  // The bank or card account it was paid from (the credit side of the entry).
  cashAccountId: v.optional(v.id("financialAccounts")),
  journalEntryId: v.optional(v.id("journalEntries")),
  // Cash basis: the cash-only entry recognising the paid share of the expense
  // lines on the payment date, and that share per bill line (by line key).
  cashBasisJournalEntryId: v.optional(v.id("journalEntries")),
  cashBasisShares: v.optional(v.array(v.object({ key: v.string(), amountCents: v.number() }))),
  // The bank line's own "Backfill imports" entry, voided while this payment
  // holds the line. Removal posts a new restoration on its correction date.
  voidedTransactionEntryId: v.optional(v.id("journalEntries")),
  replacedTransactionEntryId: v.optional(v.id("journalEntries")),
  bankTransferJournalEntryId: v.optional(v.id("journalEntries")),
  note: v.optional(v.string()),
  recordedAtISO: v.string(),
  recordedByName: v.optional(v.string()),
});

export const billApprovalValidator = v.object({
  userId: v.string(),
  name: v.string(),
  role: v.optional(v.string()),
  atISO: v.string(),
});

export const billTimelineEventValidator = v.object({
  atISO: v.string(),
  kind: v.string(), // created | uploaded | edited | submitted | approved | declined | recalled | reset | posted | scheduled | unscheduled | payment | payment_removed | canceled | reversed | document
  label: v.string(),
  actorName: v.optional(v.string()),
  actorUserId: v.optional(v.string()),
  amountCents: v.optional(v.number()),
});

export const billTables = {
  bills: defineTable({
    societyId: v.id("societies"),
    // The vendor's own invoice number, as printed on the bill.
    billNumber: v.optional(v.string()),
    vendorId: v.optional(v.id("accountingCounterparties")),
    // Denormalised for lists and exports; follows the vendor's name on save.
    vendorName: v.optional(v.string()),
    billDate: v.string(),
    terms: v.string(), // due_on_receipt | net_15 | net_30 | net_60 | custom
    dueDate: v.string(),
    currency: v.string(),
    lines: v.array(billLineValidator),
    notes: v.optional(v.string()),
    documentId: v.optional(v.id("documents")),
    status: v.string(), // draft | awaiting_approval | approved | scheduled | canceled (open / partially paid / paid / overdue are derived)
    // Denormalised from lines/payments for exports and sorting.
    totalCents: v.number(),
    paidCents: v.number(),
    payments: v.array(billPaymentValidator),
    approvals: v.array(billApprovalValidator),
    requiredApprovals: v.optional(v.number()),
    timeline: v.array(billTimelineEventValidator),
    submittedByUserId: v.optional(v.id("users")),
    submittedAtISO: v.optional(v.string()),
    // Whoever edited it while it waited for approval (this round); like the
    // submitter, they can't approve it where the rule blocks self-approval.
    editedByUserIds: v.optional(v.array(v.id("users"))),
    approvedAtISO: v.optional(v.string()),
    declinedReason: v.optional(v.string()),
    declinedAtISO: v.optional(v.string()),
    declinedByName: v.optional(v.string()),
    // A planned payment date (Societyer records payments; it doesn't send them).
    scheduledDate: v.optional(v.string()),
    // Dr expense lines / Cr Accounts payable, posted (accrual-only) when the last approval lands.
    journalEntryId: v.optional(v.id("journalEntries")),
    // The mirror entry posted when an approved bill is canceled.
    reversalJournalEntryId: v.optional(v.id("journalEntries")),
    canceledAtISO: v.optional(v.string()),
    cancelReason: v.optional(v.string()),
    source: v.optional(v.string()), // manual | upload
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_vendor", ["vendorId"]),
};
