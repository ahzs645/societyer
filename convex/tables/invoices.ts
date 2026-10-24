import { defineTable } from "convex/server";
import { v } from "convex/values";
import { transactionLineValidator } from "./financeTags";
import { transactionRuleApplicationValidator } from "./accounting";
import { documentDesignValidator } from "./documentDesign";
import { invoiceMoneyValidator, invoiceDocumentExtrasValidator, invoiceTaxModeValidator } from "./invoiceMoney";

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
  sku: v.optional(v.string()),
  taxMode: v.optional(invoiceTaxModeValidator),
  rateOverridden: v.optional(v.boolean()),
  imageUrl: v.optional(v.string()), manufacturer: v.optional(v.string()), partNumber: v.optional(v.string()), upc: v.optional(v.string()), ean: v.optional(v.string()), isbn: v.optional(v.string()), customField: v.optional(v.string()), batchNumber: v.optional(v.string()), serialNumbers: v.optional(v.array(v.string())),
  unit: v.optional(v.string()),
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
  kind: v.optional(v.union(v.literal("payment"), v.literal("credit"), v.literal("write_off"), v.literal("refund"))),
  idempotencyKey: v.optional(v.string()), sourcePaymentKey: v.optional(v.string()),
  reversedDate: v.optional(v.string()), reversedAtISO: v.optional(v.string()), reversalReason: v.optional(v.string()),
  reversalJournalEntryId: v.optional(v.id("journalEntries")), reversalCashBasisEntryId: v.optional(v.id("journalEntries")),
  restoredTransactionJournalEntryId: v.optional(v.id("journalEntries")),
  replacedTransactionEntryId: v.optional(v.id("journalEntries")), bankTransferJournalEntryId: v.optional(v.id("journalEntries")),
  fxRateMicros: v.optional(v.number()), fxSource: v.optional(v.string()), baseAmountCents: v.optional(v.number()), bookValueCents: v.optional(v.number()), fxGainLossCents: v.optional(v.number()),
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

export const invoiceBrandValidator = v.object({
  id: v.string(), name: v.string(), version: v.string(), sourceUrl: v.optional(v.string()),
  primary: v.string(), ink: v.string(), paper: v.string(), muted: v.string(), light: v.string(),
  font: v.union(v.literal("inter"), v.literal("serif"), v.literal("sans")),
  logoSvg: v.string(), logoWidth: v.number(), logoHeight: v.number(), descriptor: v.optional(v.string()),
});
export const invoiceTemplateValidator = v.object({
  design: v.optional(documentDesignValidator),
  brand: v.optional(invoiceBrandValidator),
  logoVariant: v.optional(v.union(v.literal("primary"), v.literal("black"), v.literal("reverse"))),
  name: v.string(), layout: v.union(v.literal("classic"), v.literal("modern"), v.literal("compact")),
  accentColor: v.string(), title: v.string(), footer: v.string(), showLogo: v.boolean(),
  showDescription: v.boolean(), showPaymentInstructions: v.boolean(), paperSize: v.union(v.literal("letter"), v.literal("a4")),
});
export const invoicePriceEntryValidator = v.object({ catalogItemId: v.id("invoiceCatalogItems"), unitPriceCents: v.number() });
export const repairStatusValidator = v.union(v.literal("received"), v.literal("diagnosing"), v.literal("awaiting_approval"), v.literal("in_progress"), v.literal("ready"), v.literal("completed"), v.literal("cancelled"));

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
    shipToName: v.optional(v.string()),
    shipToAddress: v.optional(v.string()),
    issueDate: v.string(),
    terms: v.string(), // due_on_receipt | net_15 | net_30 | net_60 | custom
    dueDate: v.string(),
    reference: v.optional(v.string()),
    currency: v.string(),
    documentTemplate: v.optional(invoiceTemplateValidator),
    money: v.optional(invoiceMoneyValidator),
    documentExtras: v.optional(invoiceDocumentExtrasValidator),
    priceListId: v.optional(v.id("invoicePriceLists")),
    repairJobId: v.optional(v.id("repairJobs")),
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
    fxRevaluations: v.optional(v.array(v.object({ key: v.string(), date: v.string(), rateMicros: v.number(), source: v.optional(v.string()), invoiceBalanceCents: v.number(), baseBalanceCents: v.number(), adjustmentCents: v.number(), journalEntryId: v.optional(v.id("journalEntries")), reversedDate: v.optional(v.string()), reversalJournalEntryId: v.optional(v.id("journalEntries")) }))),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_repair_job", ["repairJobId"])
    .index("by_series", ["seriesId"])
    .index("by_member", ["memberId"]),

  invoiceCatalogItems: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    unitPriceCents: v.number(),
    kind: v.optional(v.union(v.literal("item"), v.literal("service"))),
    sku: v.optional(v.string()),
    taxMode: v.optional(invoiceTaxModeValidator),
    imageUrl: v.optional(v.string()), manufacturer: v.optional(v.string()), partNumber: v.optional(v.string()), upc: v.optional(v.string()), ean: v.optional(v.string()), isbn: v.optional(v.string()), customField: v.optional(v.string()), batchNumber: v.optional(v.string()), serialNumbers: v.optional(v.array(v.string())),
    unit: v.optional(v.string()),
    currency: v.optional(v.string()),
    taxRatePercent: v.optional(v.number()),
    taxLabel: v.optional(v.string()),
    category: v.optional(v.string()),
    accountingAccountId: v.optional(v.id("financialAccounts")),
    active: v.boolean(),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),

  invoiceTemplates: defineTable({
    societyId: v.id("societies"), config: invoiceTemplateValidator, active: v.boolean(),
    createdAtISO: v.string(), updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),
  invoicePriceLists: defineTable({
    societyId: v.id("societies"), name: v.string(), currency: v.string(), active: v.boolean(),
    entries: v.array(invoicePriceEntryValidator), createdAtISO: v.string(), updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),
  repairJobs: defineTable({
    societyId: v.id("societies"), number: v.string(), partyKind: v.string(),
    memberId: v.optional(v.id("members")), counterpartyId: v.optional(v.id("accountingCounterparties")),
    billToName: v.string(), billToEmail: v.optional(v.string()), billToAddress: v.optional(v.string()),
    asset: v.string(), serialNumber: v.optional(v.string()), problem: v.string(), notes: v.optional(v.string()),
    status: repairStatusValidator, receivedDate: v.string(), targetDate: v.optional(v.string()),
    currency: v.string(), lines: v.array(invoiceLineValidator),
    timeline: v.array(invoiceTimelineEventValidator), createdAtISO: v.string(), updatedAtISO: v.string(),
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
    shipToName: v.optional(v.string()),
    shipToAddress: v.optional(v.string()),
    terms: v.string(),
    reference: v.optional(v.string()),
    currency: v.string(),
    documentTemplate: v.optional(invoiceTemplateValidator),
    money: v.optional(invoiceMoneyValidator),
    documentExtras: v.optional(invoiceDocumentExtrasValidator),
    lines: v.array(invoiceLineValidator),
    discount: v.optional(invoiceDiscountValidator),
    memo: v.optional(v.string()),
    lastIssuedAtISO: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),

  invoiceSettings: defineTable({
    societyId: v.id("societies"),
    defaultTemplateId: v.optional(v.id("invoiceTemplates")),
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
