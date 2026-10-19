import { defineTable } from "convex/server";
import { v } from "convex/values";
import { transactionLineValidator } from "./financeTags";
import { transactionRuleApplicationValidator } from "./accounting";

/**
 * Receivables: invoices for dues, program fees, space rentals and
 * sponsorships, the catalog they are built from, recurring series and the
 * per-workspace invoice settings (numbering, terms, payment instructions).
 * Totals, status and recurrence logic live in shared/invoicing.ts.
 */

export const invoiceLineValidator = v.object({
  key: v.string(),
  catalogItemId: v.optional(v.id("invoiceCatalogItems")),
  item: v.string(),
  description: v.optional(v.string()),
  quantity: v.number(),
  unitPriceCents: v.number(),
  taxRatePercent: v.optional(v.number()),
  taxLabel: v.optional(v.string()),
  // Reporting tags (at most one per tag group), copied onto the revenue line in the books.
  tagIds: v.optional(v.array(v.id("financeTags"))),
});

export const invoiceDiscountValidator = v.object({
  kind: v.string(), // percent | amount
  value: v.number(), // percent (10 = 10%) or cents
});

export const invoiceLinkedTransactionSnapshotValidator = v.object({
  category: v.optional(v.string()),
  accountingAccountId: v.optional(v.id("financialAccounts")),
  categorizedBy: v.optional(v.string()),
  ruleId: v.optional(v.id("transactionRules")),
  // The rule run the link cleared, so the rule's Undo still works after unlinking.
  ruleApplication: v.optional(transactionRuleApplicationValidator),
  reconciledAtISO: v.optional(v.string()),
  reconciledByName: v.optional(v.string()),
  matchedKind: v.optional(v.string()),
  matchedId: v.optional(v.string()),
  reconciliationNote: v.optional(v.string()),
  // A split folded into one Accounts receivable line by the link.
  lines: v.optional(v.array(transactionLineValidator)),
});

export const invoicePaymentValidator = v.object({
  key: v.string(),
  date: v.string(),
  amountCents: v.number(),
  method: v.string(), // e_transfer | cheque | cash | card | direct_deposit | other
  reference: v.optional(v.string()),
  financialTransactionId: v.optional(v.id("financialTransactions")),
  note: v.optional(v.string()),
  recordedAtISO: v.optional(v.string()),
  recordedByName: v.optional(v.string()),
  // The books (shared/invoiceLedger.ts). Where an unlinked payment was
  // deposited (Undeposited funds unless chosen); a linked one uses its bank line's account.
  depositAccountId: v.optional(v.id("financialAccounts")),
  // Dr deposit / Cr Accounts receivable (source "invoice_payment", basis "both").
  journalEntryId: v.optional(v.id("journalEntries")),
  // Recognition of the paid share (source "invoice_cash_basis", basis "cash-only").
  cashBasisEntryId: v.optional(v.id("journalEntries")),
  // What linking the bank line changed on it, so unlinking puts it back.
  transactionBefore: v.optional(invoiceLinkedTransactionSnapshotValidator),
  // The deposit's own "Backfill imports" entry, voided while this payment posts it.
  voidedTransactionEntryId: v.optional(v.id("journalEntries")),
});

export const invoiceTimelineEventValidator = v.object({
  atISO: v.string(),
  kind: v.string(), // created | sent | reminder | payment | payment_removed | reverted | voided | duplicated | issued_from_series | restored | posted | reversed | deposit
  label: v.string(),
  actorName: v.optional(v.string()),
  amountCents: v.optional(v.number()),
});

export const invoiceTables = {
  invoices: defineTable({
    societyId: v.id("societies"),
    sequence: v.number(),
    number: v.string(),
    status: v.string(), // draft | sent | void (paid / partially paid / overdue are derived)
    partyKind: v.string(), // member | organization | custom
    memberId: v.optional(v.id("members")),
    counterpartyId: v.optional(v.id("accountingCounterparties")),
    billToName: v.string(),
    billToEmail: v.optional(v.string()),
    billToAddress: v.optional(v.string()),
    issueDate: v.string(),
    terms: v.string(), // due_on_receipt | net_15 | net_30 | net_60 | custom
    dueDate: v.string(),
    reference: v.optional(v.string()),
    currency: v.string(),
    lines: v.array(invoiceLineValidator),
    discount: v.optional(invoiceDiscountValidator),
    memo: v.optional(v.string()),
    // Denormalised from lines/payments for exports and sorting.
    totalCents: v.number(),
    paidCents: v.number(),
    payments: v.array(invoicePaymentValidator),
    timeline: v.array(invoiceTimelineEventValidator),
    seriesId: v.optional(v.id("invoiceSeries")),
    source: v.optional(v.string()), // manual | dues | series | duplicate
    subscriptionId: v.optional(v.id("memberSubscriptions")),
    // Renewal date a dues invoice bills for (one invoice per renewal).
    duesPeriodEnd: v.optional(v.string()),
    // Opaque key shared by the drafts one dues run created (for Undo).
    duesBatch: v.optional(v.string()),
    sentAtISO: v.optional(v.string()),
    lastReminderAtISO: v.optional(v.string()),
    voidedAtISO: v.optional(v.string()),
    voidReason: v.optional(v.string()),
    // The accrual (source "invoice", basis "accrual-only") and, once voided, its
    // reversal (source "invoice_accrual"). `ledgerRound` counts void-and-restore
    // cycles so a restored invoice posts under fresh keys (shared/invoiceLedger.ts).
    journalEntryId: v.optional(v.id("journalEntries")),
    reversalJournalEntryId: v.optional(v.id("journalEntries")),
    ledgerRound: v.optional(v.number()),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_series", ["seriesId"])
    .index("by_member", ["memberId"]),

  invoiceCatalogItems: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    unitPriceCents: v.number(),
    taxRatePercent: v.optional(v.number()),
    taxLabel: v.optional(v.string()),
    category: v.optional(v.string()),
    accountingAccountId: v.optional(v.id("financialAccounts")),
    active: v.boolean(),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),

  invoiceSeries: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    frequency: v.string(), // monthly | quarterly | annually
    startDate: v.string(),
    nextIssueDate: v.optional(v.string()),
    endKind: v.string(), // never | after_count | on_date
    endAfterCount: v.optional(v.number()),
    endDate: v.optional(v.string()),
    issuedCount: v.number(),
    // Stored for when an email path exists; issuing stays a manual "mark sent".
    autoSend: v.boolean(),
    status: v.string(), // active | paused | ended
    partyKind: v.string(),
    memberId: v.optional(v.id("members")),
    counterpartyId: v.optional(v.id("accountingCounterparties")),
    billToName: v.string(),
    billToEmail: v.optional(v.string()),
    billToAddress: v.optional(v.string()),
    terms: v.string(),
    reference: v.optional(v.string()),
    currency: v.string(),
    lines: v.array(invoiceLineValidator),
    discount: v.optional(invoiceDiscountValidator),
    memo: v.optional(v.string()),
    lastIssuedAtISO: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),

  invoiceSettings: defineTable({
    societyId: v.id("societies"),
    prefix: v.string(),
    nextNumber: v.number(),
    defaultTerms: v.string(),
    paymentInstructions: v.optional(v.string()),
    defaultMemo: v.optional(v.string()),
    replyToEmail: v.optional(v.string()),
    // GL account mapping. Revenue per catalog item lives on the item
    // (invoiceCatalogItems.accountingAccountId); per category and the default
    // here. Unset receivable / tax / deposit accounts fall back to the chart's
    // Accounts receivable, GST/HST payable and Undeposited funds (created on use).
    receivableAccountId: v.optional(v.id("financialAccounts")),
    taxPayableAccountId: v.optional(v.id("financialAccounts")),
    defaultRevenueAccountId: v.optional(v.id("financialAccounts")),
    depositAccountId: v.optional(v.id("financialAccounts")),
    categoryAccounts: v.optional(v.array(v.object({ category: v.string(), accountId: v.id("financialAccounts") }))),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),
};
