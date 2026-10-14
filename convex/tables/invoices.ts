import { defineTable } from "convex/server";
import { v } from "convex/values";

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
});

export const invoiceDiscountValidator = v.object({
  kind: v.string(), // percent | amount
  value: v.number(), // percent (10 = 10%) or cents
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
});

export const invoiceTimelineEventValidator = v.object({
  atISO: v.string(),
  kind: v.string(), // created | sent | reminder | payment | payment_removed | reverted | voided | duplicated | issued_from_series | restored
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
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),
};
