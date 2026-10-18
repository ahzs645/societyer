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
    // Approval workflow (enforced server-side by the approval rules).
    approvals: v.optional(v.array(v.object({
      userId: v.id("users"),
      name: v.string(),
      role: v.optional(v.string()),
      atISO: v.string(),
    }))),
    requiredApprovals: v.optional(v.number()),
    declinedReason: v.optional(v.string()),
    declinedByUserId: v.optional(v.id("users")),
    declinedAtISO: v.optional(v.string()),
    approvalTrail: v.optional(v.array(v.object({
      atISO: v.string(),
      action: v.string(), // submitted | approved | declined | paid | recalled | reset | edited | reminded | receipt
      actorName: v.string(),
      actorUserId: v.optional(v.id("users")),
      note: v.optional(v.string()),
    }))),
    // Requested when the claim misses the expense-claim policy (convex/tables/expensePolicies.ts).
    policyException: v.optional(v.object({
      reason: v.string(),
      at: v.string(),
      by: v.string(),
      byUserId: v.optional(v.id("users")),
    })),
    // Approvers can be reminded once per 24 hours.
    lastReminderAtISO: v.optional(v.string()),
    // Mileage claims: amount = distance × the claim policy's mileage rate; no receipt needed.
    claimType: v.optional(v.string()), // expense (default) | mileage
    mileage: v.optional(v.object({
      distanceKm: v.number(),
      rateCentsPerKm: v.number(),
      fromLocation: v.optional(v.string()),
      toLocation: v.optional(v.string()),
      tripDescription: v.optional(v.string()),
    })),
    // The committee spend budget the claim counts against (convex/tables/banking.ts).
    spendBudgetId: v.optional(v.id("spendBudgets")),
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
    subjectId: v.optional(v.string()),
    action: v.string(),
    summary: v.string(),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_entity", ["societyId", "entityType", "entityId"])
    .index("by_subject", ["societyId", "entityType", "subjectId"]),

  notes: defineTable({
    societyId: v.id("societies"),
    entityType: v.string(),
    entityId: v.string(),
    subjectId: v.optional(v.string()),
    author: v.string(),
    body: v.string(),
    createdAtISO: v.string(),
    updatedAtISO: v.optional(v.string()),
  })
    .index("by_entity", ["societyId", "entityType", "entityId"])
    .index("by_subject", ["societyId", "entityType", "subjectId"])
    .index("by_society", ["societyId"]),

  invitations: defineTable({
    societyId: v.id("societies"),
    email: v.string(),
    role: v.string(),
    token: v.optional(v.string()), // Legacy invitations require reissue.
    tokenHash: v.optional(v.string()),
    expiresAtISO: v.optional(v.string()),
    invitedByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    acceptedAtISO: v.optional(v.string()),
    acceptedByUserId: v.optional(v.id("users")),
    revokedAtISO: v.optional(v.string()),
    // "link" invitations are bound to no email: whoever signs in with the link
    // joins, so they're limited to non-administrative roles. Absent = "email".
    kind: v.optional(v.union(v.literal("email"), v.literal("link"))),
    // Who a share link is meant for, shown to administrators only.
    label: v.optional(v.string()),
    targetUserId: v.optional(v.id("users")),
    emailRequestedAtMs: v.optional(v.number()),
    emailStatus: v.optional(v.union(v.literal("queued"), v.literal("accepted"), v.literal("failed"))),
    emailAcceptedAtISO: v.optional(v.string()),
    emailError: v.optional(v.string()),
    emailProvider: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_email", ["email"])
    .index("by_token", ["token"])
    .index("by_token_hash", ["tokenHash"]),

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
    // Version 2 separates actual circulation/consent times from administrative entry times.
    evidenceVersion: v.optional(v.number()),
    circulationRecordedAtISO: v.optional(v.string()),
    circulationRecordedByUserId: v.optional(v.id("users")),
    completedAtISO: v.optional(v.string()),
    completionRecordedAtISO: v.optional(v.string()),
    completionHistory: v.optional(v.array(v.object({ completedAtISO: v.string(), recordedAtISO: v.string(), recordedByUserId: v.id("users") }))),
    body: v.optional(v.union(v.literal("members"), v.literal("shareholders"), v.literal("directors"))),
    recordDateISO: v.optional(v.string()),
    profileId: v.optional(v.string()),
    legalRuleReviewedOnISO: v.optional(v.string()),
    citationIds: v.optional(v.array(v.string())),
    electorate: v.optional(v.array(v.object({ key: v.string(), name: v.string(), weight: v.number(),
      memberId: v.optional(v.id("members")), directorId: v.optional(v.id("directors")), roleHolderId: v.optional(v.id("roleHolders")),
    }))),
    electorateTotal: v.optional(v.number()),
    countUnit: v.optional(v.union(v.literal("people"), v.literal("votes"), v.literal("shares"))),
    statutoryRequiredCount: v.optional(v.number()),
    approvalRule: v.optional(v.object({ numerator: v.number(), denominator: v.number(), strict: v.boolean(), unit: v.union(v.literal("people"), v.literal("votes"), v.literal("shares")),
      // "votes_cast" is the Societies Act s. 1 (c) mail/electronic route; omitted means all eligible voters.
      basis: v.optional(v.union(v.literal("eligible"), v.literal("votes_cast"))) })),
    // Reviewed bylaw/articles departure from unanimous directors' consent; never a default.
    approvalOverride: v.optional(v.object({ kind: v.literal("directors_governing_instrument"), numerator: v.number(), denominator: v.number(),
      evidence: v.string(), sourceIds: v.array(v.string()) })),
    votingRoute: v.optional(v.union(v.literal("written_consent"), v.literal("mail_electronic_vote"))),
    votingRouteEvidence: v.optional(v.string()),
    votingClosesAtISO: v.optional(v.string()),
    voteCountEvidence: v.optional(v.string()),
    voteCountCertifiedAtISO: v.optional(v.string()),
    voteCountCertifiedByUserId: v.optional(v.id("users")),
    circulationTimeZone: v.optional(v.string()),
    governingInstrumentEvidence: v.optional(v.string()),
    electorateEvidence: v.optional(v.string()),
    circulationEvidence: v.optional(v.string()),
    authorityReviewedByUserId: v.optional(v.id("users")),
    authorityReviewedAtISO: v.optional(v.string()),
    nonSignerNoticeBusinessDays: v.optional(v.number()),
    nonSignerNoticeTriggeredAtISO: v.optional(v.string()),
    nonSignerNoticeStatus: v.optional(v.string()),
    nonSignerNoticeEvidence: v.optional(v.string()),
    nonSignerNoticeRecordedAtISO: v.optional(v.string()),
    nonSignerNoticeRecordedByUserId: v.optional(v.id("users")),
    nonSignerNotices: v.optional(v.array(v.object({ electorKey: v.string(), givenAtISO: v.string(), recordedAtISO: v.string(),
      recordedByUserId: v.id("users"), evidence: v.string(), documentId: v.optional(v.id("documents")),
    }))),
    nonSignerNoticeDueDateISO: v.optional(v.string()),
    nonSignerNoticeCalendarEvidence: v.optional(v.string()),
    nonSignerNoticeTimeZone: v.optional(v.string()),
    nonSignerNoticeDeadlineTriggerDateISO: v.optional(v.string()),
    nonSignerNoticeDeadlineReviewedAtISO: v.optional(v.string()),
    nonSignerNoticeDeadlineReviewedByUserId: v.optional(v.id("users")),
    // Legacy signature rows are preserved, but cannot prove a verified legal result.
    signatures: v.array(
      v.object({
        signerName: v.string(),
        signedAtISO: v.string(),
        recordedAtISO: v.optional(v.string()),
        memberId: v.optional(v.id("members")),
        directorId: v.optional(v.id("directors")),
        roleHolderId: v.optional(v.id("roleHolders")),
        electorKey: v.optional(v.string()),
        weight: v.optional(v.number()),
        consentEvidence: v.optional(v.string()),
        consentDocumentId: v.optional(v.id("documents")),
        recordedByUserId: v.optional(v.id("users")),
        vote: v.optional(v.union(v.literal("for"), v.literal("against"))),
      }),
    ),
    requiredCount: v.number(),
    status: v.string(), // Draft | Circulating | Carried | Failed | Review required
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
    recipientKey: v.optional(v.string()),
    roleHolderId: v.optional(v.id("roleHolders")),
    directorId: v.optional(v.id("directors")),
    auditorAppointmentId: v.optional(v.id("auditorAppointments")),
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
