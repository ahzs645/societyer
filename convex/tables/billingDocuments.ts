import { defineTable } from "convex/server";
import { v } from "convex/values";
import { invoiceLineValidator, invoiceDiscountValidator, invoiceTemplateValidator } from "./invoices";
import { invoiceMoneyValidator } from "./invoiceMoney";

export const quoteStatusValidator = v.union(v.literal("draft"), v.literal("sent"), v.literal("accepted"), v.literal("declined"), v.literal("expired"));
export const quoteFieldsValidator = v.object({
  partyKind: v.union(v.literal("member"), v.literal("organization"), v.literal("custom")), memberId: v.optional(v.id("members")), counterpartyId: v.optional(v.id("accountingCounterparties")),
  billToName: v.string(), billToEmail: v.optional(v.string()), billToAddress: v.optional(v.string()), shipToName: v.optional(v.string()), shipToAddress: v.optional(v.string()),
  issueDate: v.string(), validUntil: v.string(), currency: v.string(), lines: v.array(invoiceLineValidator), discount: v.optional(invoiceDiscountValidator),
  memo: v.optional(v.string()), termsAndConditions: v.optional(v.string()), documentTemplate: invoiceTemplateValidator, money: v.optional(invoiceMoneyValidator),
});
const quoteEvent = v.object({ atISO: v.string(), actorUserId: v.string(), action: v.string(), note: v.optional(v.string()) });
export const statementValidator = v.object({
  customerKey: v.string(), customerName: v.string(), customerEmail: v.optional(v.string()), customerAddress: v.optional(v.string()), currency: v.string(), from: v.string(), to: v.string(),
  openingCents: v.number(), chargeCents: v.number(), creditCents: v.number(), closingCents: v.number(), generatedAtISO: v.string(), documentTemplate: v.optional(invoiceTemplateValidator),
  rows: v.array(v.object({ date: v.string(), kind: v.string(), reference: v.string(), description: v.string(), chargeCents: v.number(), creditCents: v.number(), balanceCents: v.number(), invoiceId: v.optional(v.id("invoices")) })),
});
export const billingDocumentTables = {
  billingQuotes: defineTable({ societyId: v.id("societies"), number: v.string(), revision: v.number(), status: quoteStatusValidator, fields: quoteFieldsValidator, totalCents: v.number(),
    convertedInvoiceId: v.optional(v.id("invoices")), createdByUserId: v.string(), createdAtISO: v.string(), updatedAtISO: v.string(), timeline: v.array(quoteEvent),
  }).index("by_society", ["societyId"]).index("by_society_status", ["societyId", "status"]).index("by_society_status_valid_until", ["societyId", "status", "fields.validUntil"]),
  billingQuoteRevisions: defineTable({ societyId: v.id("societies"), quoteId: v.id("billingQuotes"), revision: v.number(), status: quoteStatusValidator, fields: quoteFieldsValidator, totalCents: v.number(), createdByUserId: v.string(), createdAtISO: v.string() }).index("by_quote", ["quoteId"]).index("by_quote_revision", ["quoteId", "revision"]).index("by_society", ["societyId"]),
  customerStatementSnapshots: defineTable({ societyId: v.id("societies"), customerKey: v.string(), statement: statementValidator, createdByUserId: v.string(), createdAtISO: v.string() }).index("by_society", ["societyId"]).index("by_society_and_customer", ["societyId", "customerKey"]).index("by_society_customer_currency", ["societyId", "customerKey", "statement.currency"]),
  repairOperations: defineTable({ societyId: v.id("societies"), repairJobId: v.id("repairJobs"), technicianUserId: v.optional(v.id("users")), scheduledDate: v.optional(v.string()), estimatedMinutes: v.optional(v.number()),
    approvalRequired: v.boolean(), approvalStatus: v.union(v.literal("not_required"), v.literal("requested"), v.literal("approved"), v.literal("rejected")), approvalRequestedAtISO: v.optional(v.string()), approvalScope: v.optional(v.string()),
    approvedAmountCents: v.optional(v.number()), approvalDecisionAtISO: v.optional(v.string()), approvalDecidedByUserId: v.optional(v.string()), approvalCustomerName: v.optional(v.string()), approvalNote: v.optional(v.string()), updatedAtISO: v.string(),
  }).index("by_repair_job", ["repairJobId"]).index("by_society", ["societyId"]).index("by_society_and_technician", ["societyId", "technicianUserId"]),
  repairTimeEntries: defineTable({ societyId: v.id("societies"), repairJobId: v.id("repairJobs"), technicianUserId: v.id("users"), startAtISO: v.string(), endAtISO: v.optional(v.string()), durationMinutes: v.optional(v.number()), costRateCents: v.number(), billingRateCents: v.number(), note: v.string(), billable: v.boolean(), createdByUserId: v.string(), updatedAtISO: v.string() }).index("by_repair_job", ["repairJobId"]).index("by_society", ["societyId"]).index("by_society_and_technician", ["societyId", "technicianUserId"]),
  repairOperationEvents: defineTable({ societyId: v.id("societies"), repairJobId: v.id("repairJobs"), kind: v.string(), label: v.string(), actorUserId: v.string(), atISO: v.string(), details: v.optional(v.string()) }).index("by_repair_job", ["repairJobId"]).index("by_society", ["societyId"]),
};
