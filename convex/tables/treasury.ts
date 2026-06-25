import { defineTable } from "convex/server";
import { v } from "convex/values";

export const treasuryTables = {
  financialStatementImports: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    fiscalYear: v.string(),
    statementType: v.string(), // income_statement | balance_sheet | trial_balance | full_statement
    periodStart: v.optional(v.string()),
    periodEnd: v.string(),
    revenueCents: v.optional(v.number()),
    expensesCents: v.optional(v.number()),
    netAssetsCents: v.optional(v.number()),
    restrictedFundsCents: v.optional(v.number()),
    status: v.string(), // NeedsReview | Verified | Rejected
    confidence: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_fy", ["societyId", "fiscalYear"]),

  financialStatementImportLines: defineTable({
    societyId: v.id("societies"),
    statementImportId: v.id("financialStatementImports"),
    section: v.string(),
    label: v.string(),
    amountCents: v.optional(v.number()),
    confidence: v.string(),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_statement_import", ["statementImportId"]),

  treasurerReports: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    fiscalYear: v.string(),
    reportDate: v.string(),
    authorName: v.optional(v.string()),
    cashBalanceCents: v.optional(v.number()),
    highlights: v.array(v.string()),
    concerns: v.array(v.string()),
    status: v.string(), // NeedsReview | Verified | Archived
    confidence: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_date", ["societyId", "reportDate"]),

  transactionCandidates: defineTable({
    societyId: v.id("societies"),
    transactionDate: v.string(),
    importGroupKey: v.optional(v.string()),
    periodLabel: v.optional(v.string()),
    sourcePage: v.optional(v.string()),
    rowOrder: v.optional(v.number()),
    description: v.string(),
    amountCents: v.optional(v.number()),
    debitCents: v.optional(v.number()),
    creditCents: v.optional(v.number()),
    balanceCents: v.optional(v.number()),
    chequeNumber: v.optional(v.string()),
    comment: v.optional(v.string()),
    rawText: v.optional(v.string()),
    accountName: v.optional(v.string()),
    counterparty: v.optional(v.string()),
    category: v.optional(v.string()),
    debitCredit: v.optional(v.string()),
    status: v.string(), // NeedsReview | Matched | Posted | Ignored | Restricted
    sensitivity: v.string(),
    confidence: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_date", ["societyId", "transactionDate"]),

  signatures: defineTable({
    societyId: v.id("societies"),
    entityType: v.string(), // minutes | resolution | filing
    entityId: v.string(),
    userId: v.optional(v.id("users")),
    directorId: v.optional(v.id("directors")),
    memberId: v.optional(v.id("members")),
    signatureProfileId: v.optional(v.id("signatureProfiles")),
    signerName: v.string(),
    signerRole: v.optional(v.string()),
    method: v.string(), // typed | drawn | uploaded | email_confirm
    typedName: v.optional(v.string()),
    imageDataUrl: v.optional(v.string()), // image data URL for drawn/uploaded signatures
    imageMimeType: v.optional(v.string()),
    signedAtISO: v.string(),
    ipAddress: v.optional(v.string()),
    demo: v.boolean(),
  })
    .index("by_society", ["societyId"])
    .index("by_entity", ["entityType", "entityId"]),

  signatureProfiles: defineTable({
    societyId: v.id("societies"),
    userId: v.optional(v.id("users")),
    directorId: v.optional(v.id("directors")),
    memberId: v.optional(v.id("members")),
    signerName: v.string(),
    normalizedSignerName: v.string(),
    signerRole: v.optional(v.string()),
    method: v.string(), // typed | drawn | uploaded
    typedName: v.optional(v.string()),
    imageDataUrl: v.optional(v.string()),
    imageMimeType: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
    createdByUserId: v.optional(v.id("users")),
    updatedByUserId: v.optional(v.id("users")),
  })
    .index("by_society", ["societyId"])
    .index("by_user", ["userId"])
    .index("by_director", ["directorId"])
    .index("by_member", ["memberId"])
    .index("by_society_name", ["societyId", "normalizedSignerName"]),

  filingBotRuns: defineTable({
    societyId: v.id("societies"),
    filingId: v.id("filings"),
    kind: v.string(), // AnnualReport | BylawAmendment | ChangeOfDirectors
    status: v.string(), // queued | running | success | failed | manual_required
    startedAtISO: v.string(),
    completedAtISO: v.optional(v.string()),
    steps: v.array(
      v.object({
        label: v.string(),
        status: v.string(), // pending | running | ok | fail | skip
        atISO: v.optional(v.string()),
        note: v.optional(v.string()),
      }),
    ),
    demo: v.boolean(),
    confirmationNumber: v.optional(v.string()),
    pdfDocumentId: v.optional(v.id("documents")),
    triggeredByUserId: v.optional(v.id("users")),
  })
    .index("by_society", ["societyId"])
    .index("by_filing", ["filingId"]),
};
