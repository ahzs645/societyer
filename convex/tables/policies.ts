import { defineTable } from "convex/server";
import { v } from "convex/values";

export const policyTables = {
  policies: defineTable({
    societyId: v.id("societies"),
    policyName: v.string(),
    policyNumber: v.optional(v.string()),
    owner: v.optional(v.string()),
    effectiveDate: v.optional(v.string()),
    reviewDate: v.optional(v.string()),
    ceasedDate: v.optional(v.string()),
    docxDocumentId: v.optional(v.id("documents")),
    pdfDocumentId: v.optional(v.id("documents")),
    adoptedAtMeetingId: v.optional(v.id("meetings")),
    adoptedInMinutesId: v.optional(v.id("minutes")),
    adoptingMotionEvidenceId: v.optional(v.id("motionEvidence")),
    html: v.optional(v.string()),
    requiredSigners: v.array(v.string()),
    signatureRequired: v.boolean(),
    jurisdictions: v.array(v.string()),
    entityTypes: v.array(v.string()),
    status: v.string(), // Draft | Active | ReviewDue | Superseded | Ceased
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_society_review", ["societyId", "reviewDate"]),

  conflicts: defineTable({
    societyId: v.id("societies"),
    directorId: v.id("directors"),
    declaredAt: v.string(),
    contractOrMatter: v.string(),
    natureOfInterest: v.string(),
    abstainedFromVote: v.boolean(),
    leftRoom: v.boolean(),
    resolvedAt: v.optional(v.string()),
    notes: v.optional(v.string()),
    // Optional link to the meeting (and specific motion) the recusal applies to,
    // so declarations can be captured per-meeting and rendered into the minutes.
    meetingId: v.optional(v.id("meetings")),
    motionIndex: v.optional(v.number()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_resolved", ["societyId", "resolvedAt"])
    .index("by_director", ["directorId"])
    .index("by_meeting", ["meetingId"]),

  financials: defineTable({
    societyId: v.id("societies"),
    fiscalYear: v.string(),
    periodEnd: v.string(),
    revenueCents: v.number(),
    expensesCents: v.number(),
    netAssetsCents: v.number(),
    restrictedFundsCents: v.optional(v.number()),
    auditStatus: v.string(),
    auditorName: v.optional(v.string()),
    approvedByBoardAt: v.optional(v.string()),
    presentedAtMeetingId: v.optional(v.id("meetings")),
    remunerationDisclosures: v.array(
      v.object({ role: v.string(), amountCents: v.number() }),
    ),
    statementsDocId: v.optional(v.id("documents")),
  }).index("by_society", ["societyId"]),

  bylawRuleSets: defineTable({
    societyId: v.id("societies"),
    version: v.number(),
    status: v.string(), // Draft | Active | Archived
    effectiveFromISO: v.optional(v.string()),
    sourceBylawDocumentId: v.optional(v.id("documents")),
    sourceAmendmentId: v.optional(v.id("bylawAmendments")),
    generalNoticeMinDays: v.number(),
    generalNoticeMaxDays: v.number(),
    allowElectronicMeetings: v.boolean(),
    allowHybridMeetings: v.boolean(),
    allowElectronicVoting: v.boolean(),
    allowProxyVoting: v.boolean(),
    proxyHolderMustBeMember: v.boolean(),
    proxyLimitPerGrantorPerMeeting: v.number(),
    quorumType: v.string(), // fixed | percentage
    quorumValue: v.number(),
    quorumMinimumCount: v.optional(v.number()),
    memberProposalThresholdPct: v.number(),
    memberProposalMinSignatures: v.number(),
    memberProposalLeadDays: v.number(),
    requisitionMeetingThresholdPct: v.number(),
    annualReportDueDaysAfterMeeting: v.number(),
    requireAgmFinancialStatements: v.boolean(),
    requireAgmElections: v.boolean(),
    ballotIsAnonymous: v.boolean(),
    voterMustBeMemberAtRecordDate: v.boolean(),
    inspectionMemberRegisterByMembers: v.boolean(),
    inspectionMemberRegisterByPublic: v.boolean(),
    inspectionDirectorRegisterByMembers: v.boolean(),
    inspectionCopiesAllowed: v.boolean(),
    ordinaryResolutionThresholdPct: v.number(),
    specialResolutionThresholdPct: v.number(),
    unanimousWrittenSpecialResolution: v.boolean(),
    // Society-editable resolution-type catalogue. When absent, the three
    // statutory built-ins (Majority/Special/Unanimous) are derived from the
    // *ResolutionThresholdPct fields above (see src/lib/motionGovernance.ts).
    // `base` selects the denominator ("number of total people"); requiredApprovers
    // is named-consent ("specific person"). builtIn rows cannot be deleted.
    resolutionTypes: v.optional(
      v.array(
        v.object({
          id: v.string(), // 'ordinary' | 'special' | 'unanimous' | custom slug
          label: v.string(),
          builtIn: v.optional(v.boolean()),
          base: v.string(), // votesCast | eligibleMembers | quorum
          thresholdPct: v.number(),
          requiredApprovers: v.optional(v.array(v.string())),
          tieBreak: v.optional(v.string()), // fails | chairCasts
          order: v.optional(v.number()),
        }),
      ),
    ),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  goals: defineTable({
    societyId: v.id("societies"),
    committeeId: v.optional(v.id("committees")),
    title: v.string(),
    description: v.optional(v.string()),
    category: v.string(),
    status: v.string(),
    startDate: v.string(),
    targetDate: v.string(),
    progressPercent: v.number(),
    ownerName: v.optional(v.string()),
    milestones: v.array(
      v.object({
        title: v.string(),
        done: v.boolean(),
        dueDate: v.optional(v.string()),
      }),
    ),
    keyResults: v.array(
      v.object({
        description: v.string(),
        currentValue: v.number(),
        targetValue: v.number(),
        unit: v.string(),
      }),
    ),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_committee", ["committeeId"]),

  tasks: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.string(),
    priority: v.string(),
    assignee: v.optional(v.string()),
    responsibleUserIds: v.optional(v.array(v.id("users"))),
    dueDate: v.optional(v.string()),
    committeeId: v.optional(v.id("committees")),
    meetingId: v.optional(v.id("meetings")),
    goalId: v.optional(v.id("goals")),
    filingId: v.optional(v.id("filings")),
    workflowId: v.optional(v.id("workflows")),
    documentId: v.optional(v.id("documents")),
    commitmentId: v.optional(v.id("commitments")),
    eventId: v.optional(v.string()),
    tags: v.array(v.string()),
    createdAtISO: v.string(),
    completedAt: v.optional(v.string()),
    completedByUserId: v.optional(v.id("users")),
    completionNote: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_committee", ["committeeId"])
    .index("by_goal", ["goalId"])
    .index("by_meeting", ["meetingId"])
    .index("by_filing", ["filingId"])
    .index("by_workflow", ["workflowId"])
    .index("by_document", ["documentId"])
    .index("by_commitment", ["commitmentId"]),
};
