import { defineTable } from "convex/server";
import { v } from "convex/values";
export const remittanceChannelValidator = v.union(
  v.literal("cra_myba_pad"),
  v.literal("financial_institution"),
  v.literal("third_party"),
);
export const remittancePlanFieldsValidator = v.object({
  obligationId: v.id("payrollRemittances"),
  bankAccountId: v.id("financialAccounts"),
  amountCents: v.number(),
  scheduledDate: v.string(),
  channel: remittanceChannelValidator,
  destinationReference: v.string(),
  liabilityAccountId: v.optional(v.id("financialAccounts")),
  employerExpenseAccountId: v.optional(v.id("financialAccounts")),
  notes: v.optional(v.string()),
});
export const remittanceReadinessFieldsValidator = v.object({
  rpRegistrationConfirmed: v.boolean(),
  remitterCategoryConfirmed: v.boolean(),
  mandateConfirmed: v.boolean(),
  mandateReference: v.optional(v.string()),
  providerName: v.optional(v.string()),
  providerContractReference: v.optional(v.string()),
  credentialVaultItemId: v.optional(v.id("secretVaultItems")),
  approvalPolicyReference: v.optional(v.string()),
  leadBusinessDays: v.number(),
  cutoffLocalTime: v.optional(v.string()),
  timezone: v.string(),
  statusWebhookConfirmed: v.boolean(),
  retryPolicyReference: v.optional(v.string()),
});
const components = v.object({
  cppEmployeeCents: v.number(),
  cpp2EmployeeCents: v.number(),
  eiEmployeeCents: v.number(),
  incomeTaxCents: v.number(),
  cppEmployerCents: v.number(),
  cpp2EmployerCents: v.number(),
  eiEmployerCents: v.number(),
});
const source = v.object({
  obligationId: v.id("payrollRemittances"),
  periodStart: v.string(),
  periodEnd: v.string(),
  dueDate: v.optional(v.string()),
  amountDueCents: v.number(),
  paidCents: v.number(),
  outstandingCents: v.number(),
  payrollAccountNumber: v.string(),
  remitterType: v.string(),
  components,
  payRunIds: v.array(v.id("payRuns")),
  sourceFingerprint: v.string(),
  warnings: v.array(v.string()),
});
const audit = v.object({
  action: v.string(),
  atISO: v.string(),
  actorUserId: v.id("users"),
  reference: v.optional(v.string()),
});
export const payrollRemittanceTables = {
  payrollRemittancePlans: defineTable({
    societyId: v.id("societies"),
    ...remittancePlanFieldsValidator.fields,
    version: v.number(),
    status: v.union(
      v.literal("draft"),
      v.literal("approved"),
      v.literal("exported"),
      v.literal("manual_submitted"),
      v.literal("settled"),
      v.literal("rejected"),
    ),
    source,
    sourceFingerprint: v.string(),
    history: v.array(audit),
    revisions: v.array(
      v.object({
        version: v.number(),
        fields: remittancePlanFieldsValidator,
        sourceFingerprint: v.string(),
      }),
    ),
    approvedAtISO: v.optional(v.string()),
    approvedByUserId: v.optional(v.id("users")),
    submissionReference: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_obligation", ["societyId", "obligationId"]),
  payrollRemittanceSettlements: defineTable({
    societyId: v.id("societies"),
    planId: v.id("payrollRemittancePlans"),
    obligationId: v.id("payrollRemittances"),
    bankAccountId: v.id("financialAccounts"),
    date: v.string(),
    amountCents: v.number(),
    evidence: v.string(),
    transactionId: v.optional(v.id("financialTransactions")),
    craConfirmationNumber: v.optional(v.string()),
    idempotencyKey: v.string(),
    destinationReference: v.string(),
    payrollAccountNumber: v.string(),
    journalEntryIds: v.array(v.id("journalEntries")),
    employerContributionsRecognizedCents: v.optional(v.number()),
    createdAtISO: v.string(),
    createdByUserId: v.id("users"),
  })
    .index("by_society", ["societyId"])
    .index("by_society_obligation", ["societyId", "obligationId"])
    .index("by_society_plan", ["societyId", "planId"])
    .index("by_society_key", ["societyId", "idempotencyKey"])
    .index("by_society_transaction", ["societyId", "transactionId"])
    .index("by_society_confirmation", ["societyId", "craConfirmationNumber"]),
  payrollRemittanceReadiness: defineTable({
    societyId: v.id("societies"),
    fields: remittanceReadinessFieldsValidator,
    version: v.number(),
    updatedAtISO: v.string(),
    updatedByUserId: v.id("users"),
  }).index("by_society", ["societyId"]),
};
