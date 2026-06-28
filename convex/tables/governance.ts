import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Governance/records tables (compliance remediations, expense reports, activity, notes, invitations, inspections, director attestations, written resolutions, agm runs, notice deliveries).
 * Extracted from convex/schema.ts (modularization); spread back into defineSchema.
 */
export const governanceTables = {
  complianceRemediations: defineTable({
    societyId: v.id("societies"),
    ruleId: v.string(),
    flagLevel: v.string(),
    flagText: v.string(),
    evidenceRequired: v.array(v.string()),
    status: v.string(), // open | resolved | dismissed
    assignedTo: v.optional(v.string()),
    taskId: v.optional(v.id("tasks")),
    sourceEvidenceIds: v.optional(v.array(v.id("sourceEvidence"))),
    targetTable: v.optional(v.string()),
    targetId: v.optional(v.string()),
    resolvedAtISO: v.optional(v.string()),
    resolvedByUserId: v.optional(v.id("users")),
    dismissedAtISO: v.optional(v.string()),
    snoozedUntilISO: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_rule", ["societyId", "ruleId"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_task", ["taskId"]),

  expenseReports: defineTable({
    societyId: v.id("societies"),
    claimantName: v.string(),
    claimantUserId: v.optional(v.id("users")),
    title: v.string(),
    category: v.string(),
    amountCents: v.number(),
    currency: v.string(),
    incurredAtISO: v.string(),
    submittedAtISO: v.optional(v.string()),
    status: v.string(), // Draft | Submitted | Approved | Paid | Rejected | Recalled
    approverUserId: v.optional(v.id("users")),
    approvedAtISO: v.optional(v.string()),
    paidAtISO: v.optional(v.string()),
    receiptDocumentId: v.optional(v.id("documents")),
    paymentReference: v.optional(v.string()),
    journalEntryId: v.optional(v.id("journalEntries")),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_receipt_document", ["receiptDocumentId"]),

  activity: defineTable({
    societyId: v.id("societies"),
    actor: v.string(),
    entityType: v.string(),
    entityId: v.optional(v.string()),
    action: v.string(),
    summary: v.string(),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_entity", ["societyId", "entityType", "entityId"]),

  notes: defineTable({
    societyId: v.id("societies"),
    entityType: v.string(),
    entityId: v.string(),
    author: v.string(),
    body: v.string(),
    createdAtISO: v.string(),
    updatedAtISO: v.optional(v.string()),
  })
    .index("by_entity", ["societyId", "entityType", "entityId"])
    .index("by_society", ["societyId"]),

  invitations: defineTable({
    societyId: v.id("societies"),
    email: v.string(),
    role: v.string(),
    token: v.string(),
    invitedByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    acceptedAtISO: v.optional(v.string()),
    revokedAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_token", ["token"]),

  // ========== Priority A additions ==========

  inspections: defineTable({
    societyId: v.id("societies"),
    documentId: v.optional(v.id("documents")),
    inspectorName: v.string(),
    isMember: v.boolean(),
    recordsRequested: v.string(),
    inspectedAtISO: v.string(),
    feeCents: v.optional(v.number()),
    copyPages: v.optional(v.number()),
    copyFeeCents: v.optional(v.number()),
    deliveryMethod: v.string(), // "in-person" | "electronic"
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_document", ["documentId"]),

  directorAttestations: defineTable({
    societyId: v.id("societies"),
    directorId: v.id("directors"),
    year: v.number(),
    signedAtISO: v.string(),
    isAtLeast18: v.boolean(),
    notBankrupt: v.boolean(),
    notDisqualified: v.boolean(),
    stillResidentOrEligible: v.boolean(),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_director", ["directorId"])
    .index("by_director_year", ["directorId", "year"]),

  writtenResolutions: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    text: v.string(),
    kind: v.string(), // Ordinary | Special
    circulatedAtISO: v.string(),
    completedAtISO: v.optional(v.string()),
    // Required: unanimous signatures from all voting members (for members' special resolutions in lieu of meeting)
    signatures: v.array(
      v.object({
        signerName: v.string(),
        signedAtISO: v.string(),
        memberId: v.optional(v.id("members")),
      }),
    ),
    requiredCount: v.number(),
    status: v.string(), // Draft | Circulating | Carried | Failed
    notes: v.optional(v.string()),
  }).index("by_society", ["societyId"]),

  agmRuns: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    step: v.string(), // notice | held | financialsPresented | electionsHeld | minutesApproved | annualReportFiled | complete
    noticeSentAt: v.optional(v.string()),
    noticeRecipientCount: v.optional(v.number()),
    quorumCheckedAtISO: v.optional(v.string()),
    financialsPresentedAt: v.optional(v.string()),
    electionsCompletedAt: v.optional(v.string()),
    minutesApprovedAt: v.optional(v.string()),
    annualReportFiledAt: v.optional(v.string()),
    annualReportFilingId: v.optional(v.id("filings")),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  noticeDeliveries: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    campaignId: v.optional(v.id("communicationCampaigns")),
    recipientName: v.string(),
    recipientEmail: v.optional(v.string()),
    memberId: v.optional(v.id("members")),
    channel: v.string(), // email | mail | in-person
    provider: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),
    subject: v.optional(v.string()),
    sentAtISO: v.string(),
    openedAtISO: v.optional(v.string()),
    bouncedAtISO: v.optional(v.string()),
    proofOfNotice: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    status: v.string(), // queued | sent | bounced | failed
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  // ========== Priority B additions ==========
};
