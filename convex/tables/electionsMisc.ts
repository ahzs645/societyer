import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Insurance, training, proxies, auditors, proposals, elections, donations, employees, court orders, bylaw amendments.
 * Extracted from convex/schema.ts (modularization); spread back into defineSchema.
 */
export const electionsMiscTables = {
  insurancePolicies: defineTable({
    societyId: v.id("societies"),
    kind: v.string(), // DirectorsOfficers | GeneralLiability | PropertyCasualty | CyberLiability | Other
    insurer: v.string(),
    broker: v.optional(v.string()),
    policyNumber: v.string(),
    policySeriesKey: v.optional(v.string()),
    policyTermLabel: v.optional(v.string()),
    versionType: v.optional(v.string()),
    renewalOfPolicyNumber: v.optional(v.string()),
    coverageCents: v.optional(v.number()),
    premiumCents: v.optional(v.number()),
    deductibleCents: v.optional(v.number()),
    coverageSummary: v.optional(v.string()),
    additionalInsureds: v.optional(v.array(v.string())),
    coveredParties: v.optional(v.array(v.object({
      name: v.string(),
      partyType: v.optional(v.string()),
      coveredClass: v.optional(v.string()),
      sourceExternalIds: v.optional(v.array(v.string())),
      citationId: v.optional(v.string()),
      notes: v.optional(v.string()),
    }))),
    coverageItems: v.optional(v.array(v.object({
      label: v.string(),
      coverageType: v.optional(v.string()),
      coveredClass: v.optional(v.string()),
      limitCents: v.optional(v.number()),
      deductibleCents: v.optional(v.number()),
      summary: v.optional(v.string()),
      sourceExternalIds: v.optional(v.array(v.string())),
      citationId: v.optional(v.string()),
    }))),
    coveredLocations: v.optional(v.array(v.object({
      label: v.string(),
      address: v.optional(v.string()),
      room: v.optional(v.string()),
      coverageCents: v.optional(v.number()),
      sourceExternalIds: v.optional(v.array(v.string())),
      citationId: v.optional(v.string()),
      notes: v.optional(v.string()),
    }))),
    policyDefinitions: v.optional(v.array(v.object({
      term: v.string(),
      definition: v.string(),
      sourceExternalIds: v.optional(v.array(v.string())),
      citationId: v.optional(v.string()),
    }))),
    declinedCoverages: v.optional(v.array(v.object({
      label: v.string(),
      reason: v.optional(v.string()),
      offeredLimitCents: v.optional(v.number()),
      premiumCents: v.optional(v.number()),
      declinedAt: v.optional(v.string()),
      sourceExternalIds: v.optional(v.array(v.string())),
      citationId: v.optional(v.string()),
      notes: v.optional(v.string()),
    }))),
    certificatesOfInsurance: v.optional(v.array(v.object({
      holderName: v.string(),
      additionalInsuredLegalName: v.optional(v.string()),
      eventName: v.optional(v.string()),
      eventDate: v.optional(v.string()),
      requiredLimitCents: v.optional(v.number()),
      issuedAt: v.optional(v.string()),
      expiresAt: v.optional(v.string()),
      status: v.optional(v.string()),
      sourceExternalIds: v.optional(v.array(v.string())),
      citationId: v.optional(v.string()),
      notes: v.optional(v.string()),
    }))),
    insuranceRequirements: v.optional(v.array(v.object({
      context: v.string(),
      requirementType: v.optional(v.string()),
      coverageSource: v.optional(v.string()),
      cglLimitRequiredCents: v.optional(v.number()),
      cglLimitConfirmedCents: v.optional(v.number()),
      additionalInsuredRequired: v.optional(v.boolean()),
      additionalInsuredLegalName: v.optional(v.string()),
      coiStatus: v.optional(v.string()),
      coiDueDate: v.optional(v.string()),
      tenantLegalLiabilityLimitCents: v.optional(v.number()),
      hostLiquorLiability: v.optional(v.string()),
      indemnityRequired: v.optional(v.boolean()),
      waiverRequired: v.optional(v.boolean()),
      vendorCoiRequired: v.optional(v.boolean()),
      studentEventChecklistRequired: v.optional(v.boolean()),
      riskTriggers: v.optional(v.array(v.string())),
      sourceExternalIds: v.optional(v.array(v.string())),
      citationId: v.optional(v.string()),
      notes: v.optional(v.string()),
    }))),
    claimsMadeTerms: v.optional(v.object({
      retroactiveDate: v.optional(v.string()),
      continuityDate: v.optional(v.string()),
      reportingDeadline: v.optional(v.string()),
      extendedReportingPeriod: v.optional(v.string()),
      defenseCostsInsideLimit: v.optional(v.boolean()),
      territory: v.optional(v.string()),
      retentionCents: v.optional(v.number()),
      claimsNoticeContact: v.optional(v.string()),
      sourceExternalIds: v.optional(v.array(v.string())),
      citationId: v.optional(v.string()),
      notes: v.optional(v.string()),
    })),
    claimIncidents: v.optional(v.array(v.object({
      incidentDate: v.optional(v.string()),
      claimNoticeDate: v.optional(v.string()),
      status: v.optional(v.string()),
      privacyFlag: v.optional(v.boolean()),
      insurerNotifiedAt: v.optional(v.string()),
      brokerNotifiedAt: v.optional(v.string()),
      sourceExternalIds: v.optional(v.array(v.string())),
      citationId: v.optional(v.string()),
      notes: v.optional(v.string()),
    }))),
    annualReviews: v.optional(v.array(v.object({
      reviewDate: v.string(),
      boardMeetingDate: v.optional(v.string()),
      reviewer: v.optional(v.string()),
      outcome: v.optional(v.string()),
      nextReviewDate: v.optional(v.string()),
      sourceExternalIds: v.optional(v.array(v.string())),
      citationId: v.optional(v.string()),
      notes: v.optional(v.string()),
    }))),
    complianceChecks: v.optional(v.array(v.object({
      label: v.string(),
      status: v.optional(v.string()),
      dueDate: v.optional(v.string()),
      completedAt: v.optional(v.string()),
      sourceExternalIds: v.optional(v.array(v.string())),
      citationId: v.optional(v.string()),
      notes: v.optional(v.string()),
    }))),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    renewalDate: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    confidence: v.optional(v.string()),
    sensitivity: v.optional(v.string()),
    riskFlags: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    status: v.string(), // NeedsReview | Active | Lapsed | Cancelled
    createdAtISO: v.optional(v.string()),
    updatedAtISO: v.optional(v.string()),
  }).index("by_society", ["societyId"]),

  pipaTrainings: defineTable({
    societyId: v.id("societies"),
    participantUserId: v.optional(v.id("users")),
    participantMemberId: v.optional(v.id("members")),
    participantName: v.string(),
    role: v.string(), // Director | Staff | Volunteer
    participantEmail: v.optional(v.string()),
    topic: v.string(), // PIPA | CASL | Privacy-refresh
    completedAtISO: v.string(),
    nextDueAtISO: v.optional(v.string()),
    trainer: v.optional(v.string()),
    documentId: v.optional(v.id("documents")),
    notes: v.optional(v.string()),
  }).index("by_society", ["societyId"]),

  proxies: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    grantorName: v.string(),
    grantorMemberId: v.optional(v.id("members")),
    proxyHolderName: v.string(),
    proxyHolderMemberId: v.optional(v.id("members")),
    instructions: v.optional(v.string()), // specific instructions, if any
    signedAtISO: v.string(),
    revokedAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  auditorAppointments: defineTable({
    societyId: v.id("societies"),
    firmName: v.string(),
    engagementType: v.string(), // Audit | ReviewEngagement | CompilationEngagement
    fiscalYear: v.string(),
    appointedBy: v.string(), // Directors | Members
    appointedAtISO: v.string(),
    engagementLetterDocId: v.optional(v.id("documents")),
    independenceAttested: v.boolean(),
    status: v.string(), // Active | Completed | Resigned | Replaced
    notes: v.optional(v.string()),
  }).index("by_society", ["societyId"]),

  memberProposals: defineTable({
    societyId: v.id("societies"),
    meetingId: v.optional(v.id("meetings")),
    title: v.string(),
    text: v.string(),
    submittedByName: v.string(),
    submittedAtISO: v.string(),
    receivedAtISO: v.optional(v.string()),
    signatureCount: v.number(),
    thresholdPercent: v.number(), // default 5
    eligibleVotersAtSubmission: v.optional(v.number()),
    includedInAgenda: v.boolean(),
    status: v.string(), // Submitted | MeetsThreshold | Rejected | Included
    notes: v.optional(v.string()),
  }).index("by_society", ["societyId"]),

  elections: defineTable({
    societyId: v.id("societies"),
    meetingId: v.optional(v.id("meetings")),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.string(), // Draft | Open | Closed | Tallied | Cancelled
    opensAtISO: v.string(),
    closesAtISO: v.string(),
    nominationsOpenAtISO: v.optional(v.string()),
    nominationsCloseAtISO: v.optional(v.string()),
    eligibilityCutoffISO: v.optional(v.string()),
    anonymousBallot: v.boolean(),
    scrutineerUserIds: v.optional(v.array(v.id("users"))),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
    talliedAtISO: v.optional(v.string()),
    resultsPublishedAtISO: v.optional(v.string()),
    evidenceDocumentId: v.optional(v.id("documents")),
    resultsSummary: v.optional(v.string()),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  electionQuestions: defineTable({
    societyId: v.id("societies"),
    electionId: v.id("elections"),
    title: v.string(),
    description: v.optional(v.string()),
    kind: v.optional(v.string()), // single_choice | multi_choice
    maxSelections: v.number(),
    seatsAvailable: v.optional(v.number()),
    options: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        memberId: v.optional(v.id("members")),
        statement: v.optional(v.string()),
      }),
    ),
    order: v.number(),
  })
    .index("by_election", ["electionId"])
    .index("by_society", ["societyId"]),

  electionEligibleVoters: defineTable({
    societyId: v.id("societies"),
    electionId: v.id("elections"),
    memberId: v.id("members"),
    userId: v.optional(v.id("users")),
    email: v.optional(v.string()),
    fullName: v.string(),
    status: v.string(), // Eligible | Confirmed | Voted | Revoked
    eligibilityReason: v.optional(v.string()),
    confirmedAtISO: v.optional(v.string()),
    votedAtISO: v.optional(v.string()),
    revokedAtISO: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_election", ["electionId"])
    .index("by_member", ["memberId"])
    .index("by_election_member", ["electionId", "memberId"]),

  electionBallots: defineTable({
    societyId: v.id("societies"),
    electionId: v.id("elections"),
    receiptCode: v.string(),
    submittedAtISO: v.string(),
    choices: v.array(
      v.object({
        questionId: v.id("electionQuestions"),
        optionIds: v.array(v.string()),
      }),
    ),
    spoiledAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_election", ["electionId"])
    .index("by_receipt", ["electionId", "receiptCode"]),

  electionNominations: defineTable({
    societyId: v.id("societies"),
    electionId: v.id("elections"),
    questionId: v.optional(v.id("electionQuestions")),
    memberId: v.optional(v.id("members")),
    nomineeName: v.string(),
    nomineeEmail: v.optional(v.string()),
    statement: v.optional(v.string()),
    status: v.string(), // Submitted | Accepted | Rejected | Withdrawn | OnBallot
    submittedByUserId: v.optional(v.id("users")),
    submittedAtISO: v.string(),
    reviewedByUserId: v.optional(v.id("users")),
    reviewedAtISO: v.optional(v.string()),
    addedToBallotAtISO: v.optional(v.string()),
  })
    .index("by_election", ["electionId"])
    .index("by_society", ["societyId"]),

  electionAuditEvents: defineTable({
    societyId: v.id("societies"),
    electionId: v.id("elections"),
    actorName: v.string(),
    action: v.string(),
    detail: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_election", ["electionId"])
    .index("by_society", ["societyId"]),

  donationReceipts: defineTable({
    societyId: v.id("societies"),
    charityNumber: v.string(),
    receiptNumber: v.string(),
    donorName: v.string(),
    donorEmail: v.optional(v.string()),
    donorAddress: v.optional(v.string()),
    amountCents: v.number(),
    eligibleAmountCents: v.number(),
    receivedOnISO: v.string(),
    issuedAtISO: v.string(),
    location: v.string(),
    description: v.optional(v.string()), // non-cash gifts
    isNonCash: v.boolean(),
    appraiserName: v.optional(v.string()),
    voidedAtISO: v.optional(v.string()),
    voidReason: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_receipt_number", ["societyId", "receiptNumber"]),

  employees: defineTable({
    societyId: v.id("societies"),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    birthDate: v.optional(v.string()),
    addressLine1: v.optional(v.string()),
    addressLine2: v.optional(v.string()),
    city: v.optional(v.string()),
    province: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.optional(v.string()),
    sinSecretVaultItemId: v.optional(v.id("secretVaultItems")),
    role: v.string(),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    employmentType: v.string(), // FullTime | PartTime | Casual | Contractor
    annualSalaryCents: v.optional(v.number()),
    hourlyWageCents: v.optional(v.number()),
    worksafeBCNumber: v.optional(v.string()),
    cppExempt: v.boolean(),
    eiExempt: v.boolean(),
    notes: v.optional(v.string()),
  }).index("by_society", ["societyId"]),

  courtOrders: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    orderDate: v.string(),
    court: v.string(),
    fileNumber: v.optional(v.string()),
    description: v.string(),
    documentId: v.optional(v.id("documents")),
    status: v.string(), // Active | Satisfied | Vacated
    notes: v.optional(v.string()),
  }).index("by_society", ["societyId"]),

  bylawAmendments: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    // Current bylaws text at the time this draft was started (immutable snapshot).
    baseText: v.string(),
    // Proposed replacement text. Editable while Draft; frozen after consultation starts.
    proposedText: v.string(),
    // Draft | Consultation | ResolutionPassed | Filed | Superseded | Withdrawn
    status: v.string(),
    createdByName: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
    consultationStartedAtISO: v.optional(v.string()),
    consultationEndedAtISO: v.optional(v.string()),
    resolutionMeetingId: v.optional(v.id("meetings")),
    resolutionPassedAtISO: v.optional(v.string()),
    votesFor: v.optional(v.number()),
    votesAgainst: v.optional(v.number()),
    abstentions: v.optional(v.number()),
    filingId: v.optional(v.id("filings")),
    filedAtISO: v.optional(v.string()),
    supersededAtISO: v.optional(v.string()),
    supersededByAmendmentId: v.optional(v.id("bylawAmendments")),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    importedFrom: v.optional(v.string()),
    confidence: v.optional(v.string()),
    notes: v.optional(v.string()),
    history: v.array(
      v.object({
        atISO: v.string(),
        actor: v.string(),
        action: v.string(),
        note: v.optional(v.string()),
      }),
    ),
  }).index("by_society", ["societyId"]),

  // ========== Board meeting workflow — extracted to convex/tables/meetingWorkflow.ts ==========
};
