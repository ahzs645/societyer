import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Entity-formation tables (formation records, name search items, amendments, annual maintenance, jurisdiction metadata, support logs).
 * Extracted from convex/schema.ts (modularization); spread back into defineSchema.
 */
export const formationTables = {
  formationRecords: defineTable({
    societyId: v.id("societies"),
    status: v.string(), // draft | name_search | filing | organizing | complete | cancelled | needs_review
    statusNumber: v.optional(v.number()),
    logStartDate: v.optional(v.string()),
    nuansDate: v.optional(v.string()),
    nuansNumber: v.optional(v.string()),
    relatedUserId: v.optional(v.id("users")),
    addressRental: v.optional(v.boolean()),
    stepDataInput: v.optional(v.string()),
    assignedStaffIds: v.array(v.string()),
    signingPackageIds: v.array(v.string()),
    articlesRestrictionOnActivities: v.optional(v.string()),
    purposeStatement: v.optional(v.string()),
    additionalProvisions: v.optional(v.string()),
    classesOfMembership: v.optional(v.string()),
    distributionOfProperty: v.optional(v.string()),
    draftDocumentIds: v.array(v.id("documents")),
    supportingDocumentIds: v.array(v.id("documents")),
    relatedIncorporationEventId: v.optional(v.string()),
    relatedOrganizingEventId: v.optional(v.string()),
    priceItems: v.array(v.string()),
    jurisdiction: v.optional(v.string()),
    extraProvincialRegistrationJurisdiction: v.optional(v.string()),
    sourceExternalIds: v.array(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),

  nameSearchItems: defineTable({
    societyId: v.id("societies"),
    formationRecordId: v.optional(v.id("formationRecords")),
    name: v.string(),
    success: v.optional(v.boolean()),
    errors: v.array(v.string()),
    reportUrl: v.optional(v.string()),
    reportDocumentId: v.optional(v.id("documents")),
    rank: v.optional(v.number()),
    expressService: v.optional(v.boolean()),
    descriptiveElement: v.optional(v.string()),
    distinctiveElement: v.optional(v.string()),
    nuansReportNumber: v.optional(v.string()),
    suffix: v.optional(v.string()),
    sourceExternalIds: v.array(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_formation", ["formationRecordId"]),

  entityAmendments: defineTable({
    societyId: v.id("societies"),
    status: v.string(), // draft | approved | filed | needs_review
    effectiveDate: v.optional(v.string()),
    entityNameNew: v.optional(v.string()),
    directorsMinimum: v.optional(v.number()),
    directorsMaximum: v.optional(v.number()),
    relatedPrecedentRunId: v.optional(v.id("legalPrecedentRuns")),
    shareClassAmendmentText: v.optional(v.string()),
    jurisdictionNew: v.optional(v.string()),
    sourceDocumentIds: v.array(v.id("documents")),
    sourceExternalIds: v.array(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  annualMaintenanceRecords: defineTable({
    societyId: v.id("societies"),
    status: v.string(), // draft | ready | filed | processed | needs_review
    yearFilingFor: v.optional(v.string()),
    lastAgmDate: v.optional(v.string()),
    filingDate: v.optional(v.string()),
    draftFilingDocumentId: v.optional(v.id("documents")),
    signedFilingDocumentId: v.optional(v.id("documents")),
    processedFilingDocumentId: v.optional(v.id("documents")),
    relatedPrecedentRunId: v.optional(v.id("legalPrecedentRuns")),
    filingId: v.optional(v.id("filings")),
    keyVaultItemId: v.optional(v.id("secretVaultItems")),
    templateFilingId: v.optional(v.id("legalTemplates")),
    authorizingPhone: v.optional(v.string()),
    authorizingRoleHolderId: v.optional(v.id("roleHolders")),
    financialStatementsDocumentId: v.optional(v.id("documents")),
    fiscalYearEndDate: v.optional(v.string()),
    incomeTaxReturnDate: v.optional(v.string()),
    annualFinancialStatementType: v.optional(v.string()),
    financialStatementReportDate: v.optional(v.string()),
    financialStatementReportType: v.optional(v.string()),
    auditedFinancialStatements: v.optional(v.boolean()),
    auditedFinancialStatementsNextYear: v.optional(v.boolean()),
    annualFinancialsEngagementLevel: v.optional(v.string()),
    annualFinancialStatementOption: v.optional(v.string()),
    sourceDocumentIds: v.array(v.id("documents")),
    sourceExternalIds: v.array(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_year", ["societyId", "yearFilingFor"])
    .index("by_society_status", ["societyId", "status"]),

  jurisdictionMetadata: defineTable({
    jurisdiction: v.string(),
    label: v.string(),
    actFormedUnder: v.optional(v.string()),
    nuansJurisdictionNumber: v.optional(v.string()),
    nuansReservationReportTypeId: v.optional(v.string()),
    incorporationServiceEligible: v.optional(v.boolean()),
    sourceOptionId: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_jurisdiction", ["jurisdiction"])
    .index("by_act", ["actFormedUnder"]),

  supportLogs: defineTable({
    societyId: v.optional(v.id("societies")),
    logType: v.string(),
    severity: v.string(), // info | warning | error | critical
    page: v.optional(v.string()),
    pageLocationUrl: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    relatedUserId: v.optional(v.id("users")),
    relatedEventId: v.optional(v.string()),
    relatedEntityId: v.optional(v.id("societies")),
    relatedSubscriptionId: v.optional(v.string()),
    relatedIncorporationId: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    detailsHeading: v.optional(v.string()),
    detailsBody: v.optional(v.string()),
    sourceExternalIds: v.array(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_type", ["societyId", "logType"])
    .index("by_created", ["createdAtISO"]),
};
