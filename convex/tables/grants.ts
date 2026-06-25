import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Grants tables (grants, applications, reports, transactions, employee links, sources, source profiles, opportunity candidates), extracted from convex/schema.ts. Spread back into defineSchema; byte-identical.
 */
export const grantTables = {
  grants: defineTable({
    societyId: v.id("societies"),
    committeeId: v.optional(v.id("committees")),
    boardOwnerUserId: v.optional(v.id("users")),
    linkedFinancialAccountId: v.optional(v.id("financialAccounts")),
    opportunityUrl: v.optional(v.string()),
    opportunityType: v.optional(v.string()),
    priority: v.optional(v.string()),
    fitScore: v.optional(v.number()),
    nextAction: v.optional(v.string()),
    publicDescription: v.optional(v.string()),
    allowPublicApplications: v.optional(v.boolean()),
    applicationInstructions: v.optional(v.string()),
    requirements: v.optional(
      v.array(
        v.object({
          id: v.string(),
          category: v.string(),
          label: v.string(),
          status: v.string(), // Needed | Requested | Ready | Attached | Waived
          dueDate: v.optional(v.string()),
          documentId: v.optional(v.id("documents")),
          notes: v.optional(v.string()),
          sourceUrl: v.optional(v.string()),
          documentUrl: v.optional(v.string()),
          formNumber: v.optional(v.string()),
        }),
      ),
    ),
    confirmationCode: v.optional(v.string()),
    sourcePath: v.optional(v.string()),
    sourceImportedAtISO: v.optional(v.string()),
    sourceFileCount: v.optional(v.number()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    confidence: v.optional(v.string()),
    sensitivity: v.optional(v.string()),
    riskFlags: v.optional(v.array(v.string())),
    sourceNotes: v.optional(v.string()),
    keyFacts: v.optional(v.array(v.string())),
    useOfFunds: v.optional(
      v.array(
        v.object({
          label: v.string(),
          amountCents: v.optional(v.number()),
          notes: v.optional(v.string()),
        }),
      ),
    ),
    timelineEvents: v.optional(
      v.array(
        v.object({
          label: v.string(),
          date: v.string(),
          status: v.optional(v.string()),
          notes: v.optional(v.string()),
        }),
      ),
    ),
    complianceFlags: v.optional(
      v.array(
        v.object({
          label: v.string(),
          status: v.string(),
          notes: v.optional(v.string()),
          requirementId: v.optional(v.string()),
        }),
      ),
    ),
    nextSteps: v.optional(
      v.array(
        v.object({
          id: v.string(),
          label: v.string(),
          status: v.string(),
          priority: v.string(),
          dueHint: v.optional(v.string()),
          source: v.optional(v.string()),
          sourceUrl: v.optional(v.string()),
          actionLabel: v.optional(v.string()),
          actionUrl: v.optional(v.string()),
          reason: v.optional(v.string()),
        }),
      ),
    ),
    contacts: v.optional(
      v.array(
        v.object({
          role: v.string(),
          name: v.optional(v.string()),
          organization: v.optional(v.string()),
          email: v.optional(v.string()),
          phone: v.optional(v.string()),
          notes: v.optional(v.string()),
        }),
      ),
    ),
    answerLibrary: v.optional(
      v.array(
        v.object({
          section: v.string(),
          title: v.string(),
          body: v.string(),
        }),
      ),
    ),
    title: v.string(),
    funder: v.string(),
    program: v.optional(v.string()),
    status: v.string(), // Prospecting | Drafting | Submitted | Awarded | Declined | Active | Closed
    amountRequestedCents: v.optional(v.number()),
    amountAwardedCents: v.optional(v.number()),
    restrictedPurpose: v.optional(v.string()),
    applicationDueDate: v.optional(v.string()),
    submittedAtISO: v.optional(v.string()),
    decisionAtISO: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    nextReportDueAtISO: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  grantApplications: defineTable({
    societyId: v.id("societies"),
    grantId: v.optional(v.id("grants")),
    memberId: v.optional(v.id("members")),
    linkedGrantId: v.optional(v.id("grants")),
    applicantName: v.string(),
    organizationName: v.optional(v.string()),
    email: v.string(),
    phone: v.optional(v.string()),
    amountRequestedCents: v.optional(v.number()),
    projectTitle: v.string(),
    projectSummary: v.string(),
    proposedUseOfFunds: v.optional(v.string()),
    expectedOutcomes: v.optional(v.string()),
    source: v.string(), // public | portal | admin
    status: v.string(), // Submitted | Reviewing | Shortlisted | Approved | Declined | Converted
    submittedAtISO: v.string(),
    reviewedAtISO: v.optional(v.string()),
    reviewedByUserId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_grant", ["grantId"])
    .index("by_status", ["societyId", "status"]),

  grantReports: defineTable({
    societyId: v.id("societies"),
    grantId: v.id("grants"),
    title: v.string(),
    dueAtISO: v.string(),
    submittedAtISO: v.optional(v.string()),
    status: v.string(), // Upcoming | Due | Submitted | Overdue
    spendingToDateCents: v.optional(v.number()),
    outcomeSummary: v.optional(v.string()),
    documentId: v.optional(v.id("documents")),
    submittedByUserId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_grant", ["grantId"]),

  grantTransactions: defineTable({
    societyId: v.id("societies"),
    grantId: v.id("grants"),
    financialTransactionId: v.optional(v.id("financialTransactions")),
    documentId: v.optional(v.id("documents")),
    date: v.string(),
    direction: v.string(), // inflow | outflow | commitment | adjustment
    amountCents: v.number(),
    description: v.string(),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_grant", ["grantId"]),

  grantEmployeeLinks: defineTable({
    societyId: v.id("societies"),
    grantId: v.id("grants"),
    employeeId: v.id("employees"),
    role: v.optional(v.string()),
    status: v.string(), // planned | hired | eed_pending | eed_submitted | completed
    source: v.optional(v.string()), // manual | gcos | payroll
    fundedHoursPerWeek: v.optional(v.number()),
    fundedHourlyWageCents: v.optional(v.number()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_grant", ["grantId"])
    .index("by_employee", ["employeeId"])
    .index("by_grant_employee", ["grantId", "employeeId"]),

  grantSources: defineTable({
    societyId: v.optional(v.id("societies")),
    libraryKey: v.optional(v.string()),
    name: v.string(),
    url: v.string(),
    sourceType: v.string(), // funder_site | government_portal | rss | pdf | airtable | spreadsheet | authenticated_portal | custom
    jurisdiction: v.optional(v.string()),
    funderType: v.optional(v.string()), // government | foundation | corporate | university | other
    eligibilityTags: v.array(v.string()),
    topicTags: v.array(v.string()),
    scrapeCadence: v.string(), // manual | daily | weekly | monthly
    trustLevel: v.string(), // official | partner | aggregator | unknown
    status: v.string(), // active | paused | broken | archived
    lastScrapedAtISO: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_library_key", ["libraryKey"])
    .index("by_society_status", ["societyId", "status"]),

  grantSourceProfiles: defineTable({
    societyId: v.optional(v.id("societies")),
    sourceId: v.optional(v.id("grantSources")),
    libraryKey: v.optional(v.string()),
    profileKind: v.string(), // html_selectors | json_feed | rss | pdf_text | playwright_steps | manual_mapping
    listSelector: v.optional(v.string()),
    itemSelector: v.optional(v.string()),
    detailUrlPattern: v.optional(v.string()),
    fieldMappings: v.object({
      title: v.optional(v.string()),
      funder: v.optional(v.string()),
      program: v.optional(v.string()),
      registrationDeadline: v.optional(v.string()),
      applicationDeadline: v.optional(v.string()),
      amount: v.optional(v.string()),
      eligibility: v.optional(v.string()),
      description: v.optional(v.string()),
      applicationUrl: v.optional(v.string()),
      contactEmail: v.optional(v.string()),
    }),
    detailFieldMappings: v.optional(
      v.object({
        fundingOrganization: v.optional(v.string()),
        programName: v.optional(v.string()),
        alternateTitle: v.optional(v.string()),
        sponsors: v.optional(v.string()),
        programLaunchDate: v.optional(v.string()),
        competitions: v.optional(v.string()),
        registrationDeadline: v.optional(v.string()),
        applicationDeadline: v.optional(v.string()),
        anticipatedNoticeOfDecision: v.optional(v.string()),
        fundingStartDate: v.optional(v.string()),
        notices: v.optional(v.string()),
        description: v.optional(v.string()),
        objectives: v.optional(v.string()),
        eligibility: v.optional(v.string()),
        guidelines: v.optional(v.string()),
        reviewProcess: v.optional(v.string()),
        howToApply: v.optional(v.string()),
        contactInformation: v.optional(v.string()),
        sponsorDescription: v.optional(v.string()),
        additionalInformation: v.optional(v.string()),
        fundsAvailable: v.optional(v.string()),
        dateModified: v.optional(v.string()),
      }),
    ),
    dateFormat: v.optional(v.string()),
    currency: v.optional(v.string()),
    pagination: v.optional(
      v.object({
        mode: v.string(), // none | next_link | query_param | load_more
        selectorOrParam: v.optional(v.string()),
      }),
    ),
    requiresAuth: v.optional(v.boolean()),
    connectorId: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_source", ["sourceId"])
    .index("by_library_key", ["libraryKey"])
    .index("by_society", ["societyId"]),

  grantOpportunityCandidates: defineTable({
    societyId: v.id("societies"),
    sourceId: v.optional(v.id("grantSources")),
    sourceLibraryKey: v.optional(v.string()),
    title: v.string(),
    funder: v.optional(v.string()),
    program: v.optional(v.string()),
    opportunityUrl: v.optional(v.string()),
    applicationDueDate: v.optional(v.string()),
    registrationDueDate: v.optional(v.string()),
    amountText: v.optional(v.string()),
    amountMinCents: v.optional(v.number()),
    amountMaxCents: v.optional(v.number()),
    eligibilityText: v.optional(v.string()),
    description: v.optional(v.string()),
    confidence: v.string(), // low | medium | high
    status: v.string(), // New | Reviewing | Accepted | Rejected | Duplicate
    sourceExternalIds: v.array(v.string()),
    riskFlags: v.optional(v.array(v.string())),
    rawSnapshot: v.optional(v.any()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_source", ["sourceId"]),
};
