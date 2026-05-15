import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  societies: defineTable({
    name: v.string(),
    incorporationNumber: v.optional(v.string()),
    incorporationDate: v.optional(v.string()),
    fiscalYearEnd: v.optional(v.string()),
    jurisdictionCode: v.optional(v.string()),
    entityType: v.optional(v.string()),
    actFormedUnder: v.optional(v.string()),
    officialEmail: v.optional(v.string()),
    numbered: v.optional(v.boolean()),
    distributing: v.optional(v.boolean()),
    solicitingPublicBenefit: v.optional(v.boolean()),
    organizationStatus: v.optional(v.string()),
    archivedAtISO: v.optional(v.string()),
    removedAtISO: v.optional(v.string()),
    continuanceDate: v.optional(v.string()),
    amalgamationDate: v.optional(v.string()),
    naicsCode: v.optional(v.string()),
    niceClassification: v.optional(v.string()),
    isCharity: v.boolean(),
    isMemberFunded: v.boolean(),
    registeredOfficeAddress: v.optional(v.string()),
    mailingAddress: v.optional(v.string()),
    purposes: v.optional(v.string()),
    bylawsDocId: v.optional(v.id("documents")),
    constitutionDocId: v.optional(v.id("documents")),
    privacyPolicyDocId: v.optional(v.id("documents")),
    privacyOfficerName: v.optional(v.string()),
    privacyOfficerEmail: v.optional(v.string()),
    privacyProgramStatus: v.optional(v.string()), // Unknown | Documented | Needs review | Not started
    privacyProgramReviewedAtISO: v.optional(v.string()),
    privacyProgramNotes: v.optional(v.string()),
    memberDataAccessStatus: v.optional(v.string()), // Unknown | Society-controlled | Partially available | Institution-held | Not applicable
    memberDataGapDocumented: v.optional(v.boolean()),
    memberDataAccessReviewedAtISO: v.optional(v.string()),
    memberDataAccessNotes: v.optional(v.string()),
    boardCadence: v.optional(v.string()),
    boardCadenceDayOfWeek: v.optional(v.string()),
    boardCadenceTime: v.optional(v.string()),
    boardCadenceNotes: v.optional(v.string()),
    publicSlug: v.optional(v.string()),
    publicSummary: v.optional(v.string()),
    publicContactEmail: v.optional(v.string()),
    publicTransparencyEnabled: v.optional(v.boolean()),
    publicShowBoard: v.optional(v.boolean()),
    publicShowBylaws: v.optional(v.boolean()),
    publicShowFinancials: v.optional(v.boolean()),
    publicVolunteerIntakeEnabled: v.optional(v.boolean()),
    publicGrantIntakeEnabled: v.optional(v.boolean()),
    disabledModules: v.optional(v.array(v.string())),
    demoMode: v.optional(v.boolean()),
    updatedAt: v.number(),
  }).index("by_public_slug", ["publicSlug"]),

  organizationAddresses: defineTable({
    societyId: v.id("societies"),
    type: v.string(), // registered_office | records_office | mailing | physical | other
    status: v.string(), // current | past | proposed
    effectiveFrom: v.optional(v.string()),
    effectiveTo: v.optional(v.string()),
    street: v.string(),
    unit: v.optional(v.string()),
    city: v.string(),
    provinceState: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.string(),
    notes: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_type", ["societyId", "type"])
    .index("by_society_status", ["societyId", "status"]),

  organizationRegistrations: defineTable({
    societyId: v.id("societies"),
    jurisdiction: v.string(),
    assumedName: v.optional(v.string()),
    registrationNumber: v.optional(v.string()),
    registrationDate: v.optional(v.string()),
    activityCommencementDate: v.optional(v.string()),
    deRegistrationDate: v.optional(v.string()),
    nuansNumber: v.optional(v.string()),
    officialEmail: v.optional(v.string()),
    representativeIds: v.array(v.string()),
    status: v.string(), // active | inactive | pending | needs_review
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"]),

  organizationIdentifiers: defineTable({
    societyId: v.id("societies"),
    kind: v.string(), // charity_number | business_number | gst | payroll | registry_account | other
    number: v.string(),
    jurisdiction: v.optional(v.string()),
    foreignJurisdiction: v.optional(v.string()),
    registeredAt: v.optional(v.string()),
    status: v.string(), // active | inactive | needs_review
    accessLevel: v.string(), // internal | restricted
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_kind", ["societyId", "kind"])
    .index("by_society_status", ["societyId", "status"]),

  roleHolders: defineTable({
    societyId: v.id("societies"),
    roleType: v.string(), // director | officer | member | incorporator | attorney_for_service | authorized_representative | controller | other
    status: v.string(), // current | proposed | former | needs_review
    fullName: v.string(),
    firstName: v.optional(v.string()),
    middleName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    signerTag: v.optional(v.string()),
    membershipId: v.optional(v.string()),
    membershipClassName: v.optional(v.string()),
    membershipClassId: v.optional(v.id("rightsClasses")),
    officerTitle: v.optional(v.string()),
    directorTerm: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    referenceDate: v.optional(v.string()),
    street: v.optional(v.string()),
    unit: v.optional(v.string()),
    city: v.optional(v.string()),
    provinceState: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.optional(v.string()),
    alternateStreet: v.optional(v.string()),
    alternateUnit: v.optional(v.string()),
    alternateCity: v.optional(v.string()),
    alternateProvinceState: v.optional(v.string()),
    alternatePostalCode: v.optional(v.string()),
    alternateCountry: v.optional(v.string()),
    serviceStreet: v.optional(v.string()),
    serviceUnit: v.optional(v.string()),
    serviceCity: v.optional(v.string()),
    serviceProvinceState: v.optional(v.string()),
    servicePostalCode: v.optional(v.string()),
    serviceCountry: v.optional(v.string()),
    ageOver18: v.optional(v.boolean()),
    dateOfBirth: v.optional(v.string()),
    occupation: v.optional(v.string()),
    citizenshipResidency: v.optional(v.string()),
    citizenshipCountries: v.array(v.string()),
    taxResidenceCountries: v.array(v.string()),
    nonNaturalPerson: v.optional(v.boolean()),
    nonNaturalPersonType: v.optional(v.string()),
    nonNaturalJurisdiction: v.optional(v.string()),
    natureOfControl: v.optional(v.string()),
    authorizedRepresentative: v.optional(v.boolean()),
    relatedRoleHolderId: v.optional(v.id("roleHolders")),
    relatedShareholderIds: v.array(v.string()),
    controllingIndividualIds: v.array(v.string()),
    extraProvincialRegistrationId: v.optional(v.id("organizationRegistrations")),
    sourceDocumentIds: v.array(v.id("documents")),
    sourceExternalIds: v.array(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_role", ["societyId", "roleType"])
    .index("by_society_status", ["societyId", "status"]),

  rightsClasses: defineTable({
    societyId: v.id("societies"),
    className: v.string(),
    classType: v.string(), // membership | voting | non_voting | unit | share | other
    status: v.string(), // active | proposed | inactive | needs_review
    idPrefix: v.optional(v.string()),
    highestAssignedNumber: v.optional(v.number()),
    votingRights: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    conditionsToHold: v.optional(v.string()),
    conditionsToTransfer: v.optional(v.string()),
    conditionsForRemoval: v.optional(v.string()),
    otherProvisions: v.optional(v.string()),
    sourceDocumentIds: v.array(v.id("documents")),
    sourceExternalIds: v.array(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"]),

  rightsholdingTransfers: defineTable({
    societyId: v.id("societies"),
    transferType: v.string(), // issuance | transfer | redemption | cancellation | adjustment | other
    status: v.string(), // draft | posted | void | needs_review
    transferDate: v.optional(v.string()),
    eventId: v.optional(v.string()),
    precedentRunId: v.optional(v.id("legalPrecedentRuns")),
    rightsClassId: v.optional(v.id("rightsClasses")),
    sourceRoleHolderId: v.optional(v.id("roleHolders")),
    destinationRoleHolderId: v.optional(v.id("roleHolders")),
    sourceHolderName: v.optional(v.string()),
    destinationHolderName: v.optional(v.string()),
    quantity: v.optional(v.number()),
    considerationType: v.optional(v.string()),
    considerationDescription: v.optional(v.string()),
    priceToOrganizationCents: v.optional(v.number()),
    priceToOrganizationCurrency: v.optional(v.string()),
    priceToVendorCents: v.optional(v.number()),
    priceToVendorCurrency: v.optional(v.string()),
    sourceDocumentIds: v.array(v.id("documents")),
    sourceExternalIds: v.array(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_date", ["societyId", "transferDate"])
    .index("by_society_status", ["societyId", "status"]),

  legalTemplateDataFields: defineTable({
    societyId: v.optional(v.id("societies")),
    name: v.string(),
    label: v.optional(v.string()),
    fieldType: v.optional(v.string()),
    number: v.optional(v.number()),
    dynamicIndicator: v.optional(v.string()),
    required: v.optional(v.boolean()),
    reviewRequired: v.optional(v.boolean()),
    notes: v.optional(v.string()),
    sourceExternalIds: v.array(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_name", ["name"]),

  legalTemplates: defineTable({
    societyId: v.optional(v.id("societies")),
    templateType: v.string(), // document | policy | filing | search | registration | purpose | vertical | other
    name: v.string(),
    status: v.string(), // active | draft | archived | needs_review
    templateDocumentId: v.optional(v.id("documents")),
    docxDocumentId: v.optional(v.id("documents")),
    pdfDocumentId: v.optional(v.id("documents")),
    html: v.optional(v.string()),
    notes: v.optional(v.string()),
    owner: v.optional(v.string()),
    ownerIsTobuso: v.optional(v.boolean()),
    signatureRequired: v.optional(v.boolean()),
    documentTag: v.optional(v.string()),
    entityTypes: v.array(v.string()),
    jurisdictions: v.array(v.string()),
    requiredSigners: v.array(v.string()),
    requiredDataFieldIds: v.array(v.id("legalTemplateDataFields")),
    optionalDataFieldIds: v.array(v.id("legalTemplateDataFields")),
    reviewDataFieldIds: v.array(v.id("legalTemplateDataFields")),
    requiredDataFields: v.array(v.string()),
    optionalDataFields: v.array(v.string()),
    reviewDataFields: v.array(v.string()),
    timeline: v.optional(v.string()),
    deliverable: v.optional(v.string()),
    terms: v.optional(v.string()),
    filingType: v.optional(v.string()),
    priceItems: v.array(v.string()),
    sourceExternalIds: v.array(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_type", ["societyId", "templateType"])
    .index("by_society_status", ["societyId", "status"]),

  legalPrecedents: defineTable({
    societyId: v.optional(v.id("societies")),
    packageName: v.string(),
    partType: v.optional(v.string()),
    status: v.string(), // active | draft | archived | needs_review
    description: v.optional(v.string()),
    shortDescription: v.optional(v.string()),
    timeline: v.optional(v.string()),
    deliverables: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
    addOnTerms: v.optional(v.string()),
    templateIds: v.array(v.id("legalTemplates")),
    templateNames: v.array(v.string()),
    templateFilingNames: v.array(v.string()),
    templateSearchNames: v.array(v.string()),
    templateRegistrationNames: v.array(v.string()),
    requiresAmendmentRecord: v.optional(v.boolean()),
    requiresAnnualMaintenanceRecord: v.optional(v.boolean()),
    priceItems: v.array(v.string()),
    entityTypes: v.array(v.string()),
    jurisdictions: v.array(v.string()),
    subloopPairs: v.array(v.any()),
    sourceExternalIds: v.array(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),

  legalPrecedentRuns: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    status: v.string(), // draft | data_review | generating | signing | complete | cancelled | needs_review
    precedentId: v.optional(v.id("legalPrecedents")),
    eventId: v.optional(v.string()),
    dateTime: v.optional(v.string()),
    dataJson: v.optional(v.string()),
    dataJsonList: v.array(v.any()),
    dataReviewed: v.optional(v.boolean()),
    externalNotes: v.optional(v.string()),
    searchIds: v.array(v.string()),
    registrationIds: v.array(v.string()),
    filingIds: v.array(v.id("filings")),
    generatedDocumentIds: v.array(v.id("generatedLegalDocuments")),
    signerRoleHolderIds: v.array(v.id("roleHolders")),
    priceItems: v.array(v.string()),
    abstainingDirectorIds: v.array(v.string()),
    abstainingRightsholderIds: v.array(v.string()),
    sourceExternalIds: v.array(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_precedent", ["precedentId"])
    .index("by_society_status", ["societyId", "status"]),

  generatedLegalDocuments: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    status: v.string(), // draft | out_for_signing | signed | final | void | needs_review
    draftDocumentId: v.optional(v.id("documents")),
    signedDocumentId: v.optional(v.id("documents")),
    draftFileUrl: v.optional(v.string()),
    sourceTemplateId: v.optional(v.id("legalTemplates")),
    sourceTemplateName: v.optional(v.string()),
    precedentRunId: v.optional(v.id("legalPrecedentRuns")),
    eventId: v.optional(v.string()),
    effectiveDate: v.optional(v.string()),
    documentTag: v.optional(v.string()),
    dataJson: v.optional(v.string()),
    subloopJsonList: v.array(v.any()),
    syngrafiiFileId: v.optional(v.string()),
    syngrafiiDocumentId: v.optional(v.string()),
    syngrafiiPackageId: v.optional(v.string()),
    signersRequiredRoleHolderIds: v.array(v.id("roleHolders")),
    signersWhoSignedIds: v.array(v.id("legalSigners")),
    signerTagsRequired: v.array(v.string()),
    signerTagsSigned: v.array(v.string()),
    sourceDocumentIds: v.array(v.id("documents")),
    sourceExternalIds: v.array(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_precedent_run", ["precedentRunId"]),

  legalSigners: defineTable({
    societyId: v.id("societies"),
    status: v.string(), // unsigned | opened_package | signed | declined | needs_review
    fullName: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    signerId: v.optional(v.string()),
    signerTag: v.optional(v.string()),
    eventId: v.optional(v.string()),
    generatedDocumentId: v.optional(v.id("generatedLegalDocuments")),
    roleHolderId: v.optional(v.id("roleHolders")),
    sourceExternalIds: v.array(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_document", ["generatedDocumentId"])
    .index("by_society_status", ["societyId", "status"]),

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

  users: defineTable({
    societyId: v.id("societies"),
    email: v.string(),
    displayName: v.string(),
    role: v.string(), // Owner | Admin | Director | Member | Viewer
    authProvider: v.optional(v.string()),
    authSubject: v.optional(v.string()),
    memberId: v.optional(v.id("members")),
    directorId: v.optional(v.id("directors")),
    status: v.string(), // Active | Invited | Disabled
    avatarColor: v.optional(v.string()),
    createdAtISO: v.string(),
    emailVerifiedAtISO: v.optional(v.string()),
    lastLoginAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_email", ["email"])
    .index("by_auth_subject", ["authSubject"]),

  apiClients: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    kind: v.string(), // plugin | integration | service
    status: v.string(), // active | disabled
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  apiTokens: defineTable({
    societyId: v.id("societies"),
    clientId: v.id("apiClients"),
    name: v.string(),
    tokenHash: v.string(),
    tokenStart: v.string(),
    scopes: v.array(v.string()),
    status: v.string(), // active | revoked
    expiresAtISO: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    lastUsedAtISO: v.optional(v.string()),
    revokedAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_client", ["clientId"])
    .index("by_token_hash", ["tokenHash"]),

  pluginInstallations: defineTable({
    societyId: v.id("societies"),
    clientId: v.optional(v.id("apiClients")),
    name: v.string(),
    slug: v.string(),
    status: v.string(), // installed | disabled | removed
    capabilities: v.array(v.string()),
    configJson: v.optional(v.string()),
    installedByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_slug", ["societyId", "slug"]),

  webhookSubscriptions: defineTable({
    societyId: v.id("societies"),
    clientId: v.optional(v.id("apiClients")),
    pluginInstallationId: v.optional(v.id("pluginInstallations")),
    name: v.string(),
    targetUrl: v.string(),
    eventTypes: v.array(v.string()),
    secretEncrypted: v.string(),
    status: v.string(), // active | disabled
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  webhookDeliveries: defineTable({
    societyId: v.id("societies"),
    subscriptionId: v.id("webhookSubscriptions"),
    eventId: v.string(),
    eventType: v.string(),
    payloadJson: v.string(),
    status: v.string(), // pending | delivered | failed
    attempts: v.number(),
    attemptHistoryJson: v.optional(v.string()),
    nextAttemptAtISO: v.optional(v.string()),
    lastAttemptAtISO: v.optional(v.string()),
    lastStatusCode: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAtISO: v.string(),
    deliveredAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_subscription", ["subscriptionId"])
    .index("by_event", ["eventId"])
    .index("by_status_next", ["status", "nextAttemptAtISO"]),

  integrationSyncStates: defineTable({
    societyId: v.id("societies"),
    pluginInstallationId: v.optional(v.id("pluginInstallations")),
    provider: v.string(),
    resourceType: v.string(), // calendar_events | deadline_events | drive_files | connector_actions
    resourceId: v.optional(v.string()),
    externalResourceId: v.optional(v.string()),
    syncToken: v.optional(v.string()),
    deltaLink: v.optional(v.string()),
    webhookChannelId: v.optional(v.string()),
    webhookSubscriptionId: v.optional(v.string()),
    webhookResourceId: v.optional(v.string()),
    webhookExpiresAtISO: v.optional(v.string()),
    lastFullSyncAtISO: v.optional(v.string()),
    lastIncrementalSyncAtISO: v.optional(v.string()),
    lastWebhookAtISO: v.optional(v.string()),
    status: v.string(), // active | needs_renewal | error | disabled
    lastError: v.optional(v.string()),
    metadataJson: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_provider", ["societyId", "provider"])
    .index("by_society_provider_resource", ["societyId", "provider", "resourceType"])
    .index("by_webhook_channel", ["webhookChannelId"])
    .index("by_webhook_subscription", ["webhookSubscriptionId"]),

  documentVersions: defineTable({
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    version: v.number(),
    storageProvider: v.string(), // convex | rustfs | demo
    storageKey: v.string(),
    fileName: v.string(),
    mimeType: v.optional(v.string()),
    fileSizeBytes: v.optional(v.number()),
    sha256: v.optional(v.string()),
    uploadedByUserId: v.optional(v.id("users")),
    uploadedByName: v.optional(v.string()),
    uploadedAtISO: v.string(),
    changeNote: v.optional(v.string()),
    isCurrent: v.boolean(),
  })
    .index("by_document", ["documentId"])
    .index("by_society", ["societyId"]),

  paperlessConnections: defineTable({
    societyId: v.id("societies"),
    status: v.string(), // connected | disconnected | error
    baseUrl: v.optional(v.string()),
    apiVersion: v.optional(v.string()),
    serverVersion: v.optional(v.string()),
    autoCreateTags: v.boolean(),
    autoUpload: v.boolean(),
    tagPrefix: v.optional(v.string()),
    connectedAtISO: v.string(),
    lastCheckedAtISO: v.optional(v.string()),
    lastSyncAtISO: v.optional(v.string()),
    lastError: v.optional(v.string()),
    demo: v.boolean(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  paperlessDocumentSyncs: defineTable({
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    versionId: v.optional(v.id("documentVersions")),
    connectionId: v.optional(v.id("paperlessConnections")),
    status: v.string(), // queued | processing | complete | failed
    paperlessTaskId: v.optional(v.string()),
    paperlessDocumentId: v.optional(v.number()),
    paperlessDocumentUrl: v.optional(v.string()),
    title: v.string(),
    fileName: v.optional(v.string()),
    tags: v.array(v.string()),
    queuedAtISO: v.string(),
    completedAtISO: v.optional(v.string()),
    lastCheckedAtISO: v.optional(v.string()),
    lastError: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_document", ["documentId"])
    .index("by_task", ["paperlessTaskId"]),

  notifications: defineTable({
    societyId: v.id("societies"),
    userId: v.optional(v.id("users")), // null = broadcast to whole society
    kind: v.string(), // deadline | filing | minutes | signature | billing | bot | general
    severity: v.string(), // info | warn | success | err
    title: v.string(),
    body: v.optional(v.string()),
    linkHref: v.optional(v.string()),
    readAt: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_user", ["userId"]),

  notificationPrefs: defineTable({
    userId: v.id("users"),
    channel: v.string(), // email | inApp | slack
    kind: v.string(), // deadline | filing | minutes | billing | bot | general | all
    enabled: v.boolean(),
  }).index("by_user", ["userId"]),

  memberCommunicationPrefs: defineTable({
    societyId: v.id("societies"),
    memberId: v.id("members"),
    email: v.optional(v.string()),
    aliases: v.optional(v.array(v.string())),
    phone: v.optional(v.string()),
    postalAddress: v.optional(v.string()),
    transactionalEmailEnabled: v.boolean(),
    noticeEmailEnabled: v.boolean(),
    newsletterEmailEnabled: v.boolean(),
    smsEnabled: v.boolean(),
    mailEnabled: v.optional(v.boolean()),
    preferredChannel: v.string(), // email | sms | mail
    newsletterConsentAtISO: v.optional(v.string()),
    smsConsentAtISO: v.optional(v.string()),
    unsubscribedAtISO: v.optional(v.string()),
    unsubscribeReason: v.optional(v.string()),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_member", ["memberId"]),

  communicationSegments: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    includeAudience: v.string(), // all_members | voting_members | directors | overdue_subscribers | volunteers | custom
    memberStatus: v.optional(v.string()),
    membershipClass: v.optional(v.string()),
    votingRightsOnly: v.optional(v.boolean()),
    hasEmail: v.optional(v.boolean()),
    hasPhone: v.optional(v.boolean()),
    volunteerStatus: v.optional(v.string()),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),

  communicationTemplates: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    slug: v.string(),
    kind: v.string(), // notice | renewal | digest | newsletter | reminder
    channel: v.string(), // email | inApp | sms
    audience: v.string(), // all_members | voting_members | directors | overdue_subscribers
    subject: v.string(),
    bodyText: v.string(),
    bodyHtml: v.optional(v.string()),
    system: v.boolean(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_slug", ["societyId", "slug"]),

  communicationCampaigns: defineTable({
    societyId: v.id("societies"),
    templateId: v.optional(v.id("communicationTemplates")),
    segmentId: v.optional(v.id("communicationSegments")),
    meetingId: v.optional(v.id("meetings")),
    kind: v.string(),
    channel: v.string(),
    audience: v.string(),
    customAudienceLabel: v.optional(v.string()),
    subject: v.string(),
    bodyText: v.string(),
    status: v.string(), // draft | sending | sent | partial | failed
    memberCount: v.number(),
    deliveredCount: v.number(),
    openedCount: v.number(),
    bouncedCount: v.number(),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    sentAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  communicationDeliveries: defineTable({
    societyId: v.id("societies"),
    campaignId: v.optional(v.id("communicationCampaigns")),
    templateId: v.optional(v.id("communicationTemplates")),
    meetingId: v.optional(v.id("meetings")),
    memberId: v.optional(v.id("members")),
    recipientName: v.string(),
    recipientEmail: v.optional(v.string()),
    recipientPhone: v.optional(v.string()),
    recipientAddress: v.optional(v.string()),
    channel: v.string(),
    provider: v.string(),
    providerMessageId: v.optional(v.string()),
    subject: v.optional(v.string()),
    status: v.string(), // queued | sent | opened | bounced | failed | skipped | unsubscribed
    proofOfNotice: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    providerEventType: v.optional(v.string()),
    providerPayload: v.optional(v.string()),
    sentAtISO: v.string(),
    openedAtISO: v.optional(v.string()),
    bouncedAtISO: v.optional(v.string()),
    unsubscribedAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_campaign", ["campaignId"])
    .index("by_meeting", ["meetingId"])
    .index("by_provider_message", ["provider", "providerMessageId"]),

  financialConnections: defineTable({
    societyId: v.id("societies"),
    provider: v.string(), // wave | demo
    status: v.string(), // connected | disconnected | error
    accountLabel: v.optional(v.string()),
    externalBusinessId: v.optional(v.string()),
    syncMode: v.optional(v.string()), // public_api | browser | demo
    connectedAtISO: v.string(),
    lastSyncAtISO: v.optional(v.string()),
    lastError: v.optional(v.string()),
    demo: v.boolean(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  waveCacheSnapshots: defineTable({
    societyId: v.id("societies"),
    connectionId: v.optional(v.id("financialConnections")),
    provider: v.string(), // wave
    businessId: v.string(),
    businessName: v.string(),
    currencyCode: v.optional(v.string()),
    fetchedAtISO: v.string(),
    resourceCountsJson: v.string(),
    resourceTypes: v.array(v.string()),
    structureTypes: v.array(v.string()),
    status: v.string(), // complete | error
    lastError: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_connection", ["connectionId"])
    .index("by_society_provider", ["societyId", "provider"]),

  waveCacheResources: defineTable({
    societyId: v.id("societies"),
    snapshotId: v.id("waveCacheSnapshots"),
    connectionId: v.optional(v.id("financialConnections")),
    provider: v.string(), // wave
    businessId: v.string(),
    resourceType: v.string(), // business | account | vendor | customer | product | invoice | estimate | salesTax
    externalId: v.optional(v.string()),
    label: v.string(),
    secondaryLabel: v.optional(v.string()),
    typeValue: v.optional(v.string()),
    subtypeValue: v.optional(v.string()),
    status: v.optional(v.string()),
    currencyCode: v.optional(v.string()),
    amountValue: v.optional(v.string()),
    dateValue: v.optional(v.string()),
    searchText: v.string(),
    rawJson: v.string(),
    fetchedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_snapshot", ["snapshotId"])
    .index("by_society_type", ["societyId", "resourceType"])
    .index("by_society_external", ["societyId", "externalId"]),

  waveCacheStructures: defineTable({
    societyId: v.id("societies"),
    snapshotId: v.id("waveCacheSnapshots"),
    connectionId: v.optional(v.id("financialConnections")),
    provider: v.string(), // wave
    businessId: v.string(),
    typeName: v.string(),
    kind: v.string(),
    fieldCount: v.number(),
    fieldsJson: v.string(),
    rawJson: v.string(),
    fetchedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_snapshot", ["snapshotId"])
    .index("by_type", ["typeName"]),

  financialAccounts: defineTable({
    societyId: v.id("societies"),
    connectionId: v.id("financialConnections"),
    externalId: v.string(),
    name: v.string(),
    currency: v.string(),
    accountType: v.string(), // Bank | Credit | Income | Expense | Asset | Liability | Equity
    balanceCents: v.number(),
    isRestricted: v.boolean(),
    restrictedPurpose: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_connection", ["connectionId"]),

  financialTransactions: defineTable({
    societyId: v.id("societies"),
    connectionId: v.id("financialConnections"),
    accountId: v.id("financialAccounts"),
    externalId: v.string(),
    date: v.string(),
    description: v.string(),
    amountCents: v.number(),
    category: v.optional(v.string()),
    categoryAccountExternalId: v.optional(v.string()),
    counterparty: v.optional(v.string()),
    counterpartyExternalId: v.optional(v.string()),
    counterpartyResourceType: v.optional(v.string()), // vendor | customer
    // Reconciliation — match this bank line to an internal record so we can
    // prove the general ledger agrees with the bank statement.
    reconciledAtISO: v.optional(v.string()),
    reconciledByName: v.optional(v.string()),
    matchedKind: v.optional(v.string()), // filing | receipt | payroll | manual
    matchedId: v.optional(v.string()),
    reconciliationNote: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_account", ["accountId"])
    .index("by_society_date", ["societyId", "date"])
    .index("by_society_counterparty_external", ["societyId", "counterpartyExternalId"])
    .index("by_society_counterparty_external_type", ["societyId", "counterpartyExternalId", "counterpartyResourceType"])
    .index("by_society_category_account_external", ["societyId", "categoryAccountExternalId"])
    .index("by_society_category", ["societyId", "category"]),

  budgets: defineTable({
    societyId: v.id("societies"),
    fiscalYear: v.string(),
    category: v.string(),
    plannedCents: v.number(),
    notes: v.optional(v.string()),
  }).index("by_society_fy", ["societyId", "fiscalYear"]),

  operatingSubscriptions: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    vendorName: v.optional(v.string()),
    category: v.string(),
    amountCents: v.number(),
    currency: v.string(),
    interval: v.string(), // week | month | quarter | year
    status: v.string(), // Active | Planned | Paused
    nextRenewalDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  budgetSnapshots: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    fiscalYear: v.string(),
    periodLabel: v.optional(v.string()),
    sourceDate: v.optional(v.string()),
    currency: v.string(),
    totalIncomeCents: v.optional(v.number()),
    totalExpenseCents: v.optional(v.number()),
    netCents: v.optional(v.number()),
    endingBalanceCents: v.optional(v.number()),
    preparedByName: v.optional(v.string()),
    lastModifiedDate: v.optional(v.string()),
    sourcePageCount: v.optional(v.number()),
    importGroupKey: v.optional(v.string()),
    status: v.string(), // NeedsReview | Verified | Superseded
    confidence: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_fy", ["societyId", "fiscalYear"]),

  budgetSnapshotLines: defineTable({
    societyId: v.id("societies"),
    snapshotId: v.id("budgetSnapshots"),
    lineType: v.string(), // income | expense | balance | note
    category: v.string(),
    parentCategory: v.optional(v.string()),
    rowKind: v.optional(v.string()), // detail | subtotal | tax | total | ytd | note
    sortOrder: v.optional(v.number()),
    description: v.optional(v.string()),
    amountCents: v.optional(v.number()),
    projectedCents: v.optional(v.number()),
    ytdCents: v.optional(v.number()),
    sourcePage: v.optional(v.string()),
    rawLabel: v.optional(v.string()),
    rawAmountText: v.optional(v.string()),
    confidence: v.string(),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_snapshot", ["snapshotId"]),

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
    status: v.string(), // NeedsReview | Matched | Ignored | Restricted
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
    signerName: v.string(),
    signerRole: v.optional(v.string()),
    method: v.string(), // typed | drawn | email_confirm
    typedName: v.optional(v.string()),
    signedAtISO: v.string(),
    ipAddress: v.optional(v.string()),
    demo: v.boolean(),
  })
    .index("by_society", ["societyId"])
    .index("by_entity", ["entityType", "entityId"]),

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

  aiAgentRuns: defineTable({
    societyId: v.id("societies"),
    agentKey: v.string(),
    agentName: v.string(),
    status: v.string(), // planned | completed | failed
    input: v.string(),
    inputHints: v.array(v.string()),
    scope: v.string(),
    allowedActions: v.array(v.string()),
    allowedTools: v.array(v.string()),
    plannedToolCalls: v.array(
      v.object({
        toolName: v.string(),
        purpose: v.string(),
        status: v.string(), // planned | skipped | completed
      }),
    ),
    output: v.string(),
    provider: v.string(), // deterministic_stub | configured_llm
    createdAtISO: v.string(),
    completedAtISO: v.optional(v.string()),
    triggeredByUserId: v.optional(v.id("users")),
    loadedSkillNames: v.optional(v.array(v.string())),
    toolCatalogSnapshot: v.optional(v.any()),
    unavailableTools: v.optional(v.array(v.string())),
  })
    .index("by_society", ["societyId"])
    .index("by_society_agent", ["societyId", "agentKey"]),

  aiAgentAuditEvents: defineTable({
    societyId: v.id("societies"),
    runId: v.optional(v.id("aiAgentRuns")),
    agentKey: v.string(),
    eventType: v.string(), // run_requested | skill_loaded | tool_learned | tool_planned | run_completed | run_failed
    toolName: v.optional(v.string()),
    summary: v.string(),
    metadata: v.optional(v.any()),
    createdAtISO: v.string(),
    actorUserId: v.optional(v.id("users")),
  })
    .index("by_society", ["societyId"])
    .index("by_run", ["runId"])
    .index("by_society_agent", ["societyId", "agentKey"]),

  aiSkills: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    content: v.string(),
    isCustom: v.boolean(),
    isActive: v.boolean(),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_name", ["societyId", "name"]),

  aiLogicFunctions: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    status: v.string(), // active | inactive | draft
    inputSchema: v.optional(v.any()),
    toolTriggerSettings: v.optional(v.any()),
    implementationKind: v.string(), // built_in | webhook | workflow | manual
    workflowId: v.optional(v.id("workflows")),
    webhookUrl: v.optional(v.string()),
    manualInstructions: v.optional(v.string()),
    requiredPermission: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_name", ["societyId", "name"]),

  aiChatThreads: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    status: v.string(), // active | archived
    modelId: v.optional(v.string()),
    browsingContext: v.optional(v.any()),
    workspaceInstructions: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
    lastMessageAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  aiMessages: defineTable({
    societyId: v.id("societies"),
    threadId: v.id("aiChatThreads"),
    role: v.string(), // user | assistant | system | tool
    content: v.string(),
    status: v.string(), // complete | error | streaming
    modelId: v.optional(v.string()),
    parts: v.optional(v.any()),
    toolCalls: v.optional(v.any()),
    usage: v.optional(v.any()),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
  })
    .index("by_thread", ["threadId"])
    .index("by_society", ["societyId"]),

  aiToolDrafts: defineTable({
    societyId: v.id("societies"),
    threadId: v.optional(v.id("aiChatThreads")),
    runId: v.optional(v.id("aiAgentRuns")),
    agentKey: v.optional(v.string()),
    toolName: v.string(),
    title: v.optional(v.string()),
    payload: v.any(),
    status: v.string(), // draft | approved | rejected | executed
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_thread", ["threadId"])
    .index("by_run", ["runId"]),

  aiProviderSettings: defineTable({
    societyId: v.id("societies"),
    scope: v.string(), // personal | workspace
    userId: v.optional(v.id("users")),
    provider: v.string(), // openai | openrouter | openai-compatible
    label: v.string(),
    status: v.string(), // active | inactive | needs_validation
    modelId: v.string(),
    baseUrl: v.optional(v.string()),
    secretVaultItemId: v.optional(v.id("secretVaultItems")),
    temperature: v.optional(v.number()),
    maxSteps: v.optional(v.number()),
    validatedAtISO: v.optional(v.string()),
    validationStatus: v.optional(v.string()),
    validationMessage: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_scope", ["societyId", "scope"])
    .index("by_society_user", ["societyId", "userId"])
    .index("by_society_status", ["societyId", "status"]),

  aiModelCatalogCache: defineTable({
    provider: v.string(),
    cacheKey: v.string(),
    models: v.any(),
    fetchedAtISO: v.string(),
    expiresAtISO: v.string(),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_provider_cache", ["provider", "cacheKey"])
    .index("by_provider", ["provider"]),

  recordLayouts: defineTable({
    societyId: v.id("societies"),
    scopeKey: v.string(),
    layoutJson: v.string(),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_scope", ["societyId", "scopeKey"]),

  workflows: defineTable({
    societyId: v.id("societies"),
    recipe: v.string(), // agm_prep | insurance_renewal | annual_report_filing | unbc_affiliate_id_request
    name: v.string(),
    status: v.string(), // active | paused | archived
    provider: v.optional(v.string()), // internal | n8n
    providerConfig: v.optional(
      v.object({
        externalWorkflowId: v.optional(v.string()),
        externalWebhookUrl: v.optional(v.string()),
        externalEditUrl: v.optional(v.string()),
      }),
    ),
    nodePreview: v.optional(
      v.array(
        v.object({
          key: v.string(),
          type: v.string(),
          label: v.string(),
          description: v.optional(v.string()),
          status: v.optional(v.string()),
          config: v.optional(v.any()),
        }),
      ),
    ),
    trigger: v.object({
      kind: v.string(), // cron | manual | date_offset
      cron: v.optional(v.string()),
      offset: v.optional(
        v.object({
          anchor: v.string(), // meetings.scheduledAt | insurancePolicies.renewalDate | filings.dueDate
          anchorId: v.optional(v.string()),
          daysBefore: v.number(),
        }),
      ),
    }),
    config: v.optional(v.any()),
    lastRunAtISO: v.optional(v.string()),
    nextRunAtISO: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
  })
    .index("by_society", ["societyId"])
    .index("by_next_run", ["nextRunAtISO"]),

  // Queued manual-send emails (the "outbox"). Used when no live email
  // provider is configured, or when the workflow author explicitly wants a
  // human to send the message from their own inbox.
  pendingEmails: defineTable({
    societyId: v.id("societies"),
    workflowId: v.optional(v.id("workflows")),
    workflowRunId: v.optional(v.id("workflowRuns")),
    nodeKey: v.optional(v.string()),
    fromName: v.optional(v.string()),
    fromEmail: v.optional(v.string()),
    replyTo: v.optional(v.string()),
    to: v.string(),
    cc: v.optional(v.string()),
    bcc: v.optional(v.string()),
    subject: v.string(),
    body: v.string(),
    attachments: v.array(
      v.object({
        documentId: v.id("documents"),
        fileName: v.string(),
      }),
    ),
    status: v.string(), // draft | ready | sent | cancelled
    createdAtISO: v.string(),
    createdByUserId: v.optional(v.id("users")),
    sentAtISO: v.optional(v.string()),
    sentByUserId: v.optional(v.id("users")),
    sentChannel: v.optional(v.string()), // personal_email | other
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  workflowRuns: defineTable({
    societyId: v.id("societies"),
    workflowId: v.id("workflows"),
    recipe: v.string(),
    status: v.string(), // queued | running | success | failed | manual_required
    startedAtISO: v.string(),
    completedAtISO: v.optional(v.string()),
    steps: v.array(
      v.object({
        key: v.optional(v.string()),
        label: v.string(),
        status: v.string(), // pending | running | ok | fail | skip
        atISO: v.optional(v.string()),
        note: v.optional(v.string()),
        output: v.optional(v.any()),
      }),
    ),
    provider: v.optional(v.string()), // internal | n8n
    externalRunId: v.optional(v.string()),
    externalStatus: v.optional(v.string()),
    generatedDocumentId: v.optional(v.id("documents")),
    generatedDocumentVersionId: v.optional(v.id("documentVersions")),
    output: v.optional(v.any()),
    demo: v.boolean(),
    triggeredBy: v.string(), // cron | manual | event
    triggeredByUserId: v.optional(v.id("users")),
  })
    .index("by_society", ["societyId"])
    .index("by_workflow", ["workflowId"]),

  workflowPackages: defineTable({
    societyId: v.id("societies"),
    workflowId: v.optional(v.id("workflows")),
    workflowRunId: v.optional(v.id("workflowRuns")),
    eventType: v.string(),
    effectiveDate: v.optional(v.string()),
    status: v.string(), // draft | collecting_signatures | ready | filed | cancelled | archived
    packageName: v.string(),
    parts: v.array(v.string()),
    notes: v.optional(v.string()),
    supportingDocumentIds: v.array(v.id("documents")),
    priceItems: v.array(v.string()),
    transactionId: v.optional(v.string()),
    signerRoster: v.array(v.string()),
    signerEmails: v.array(v.string()),
    signingPackageIds: v.array(v.string()),
    stripeCheckoutSessionId: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_workflow", ["workflowId"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_society_effective", ["societyId", "effectiveDate"]),

  subscriptionPlans: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    priceCents: v.number(),
    currency: v.string(),
    interval: v.string(), // month | year | one_time
    benefits: v.array(v.string()),
    membershipClass: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    active: v.boolean(),
  }).index("by_society", ["societyId"]),

  membershipFeePeriods: defineTable({
    societyId: v.id("societies"),
    planId: v.optional(v.id("subscriptionPlans")),
    membershipClass: v.optional(v.string()),
    label: v.string(),
    priceCents: v.number(),
    currency: v.string(),
    interval: v.string(), // month | year | semester | one_time
    effectiveFrom: v.string(),
    effectiveTo: v.optional(v.string()),
    status: v.string(), // planned | active | retired
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_plan", ["planId"])
    .index("by_society_effective_from", ["societyId", "effectiveFrom"]),

  memberSubscriptions: defineTable({
    societyId: v.id("societies"),
    planId: v.id("subscriptionPlans"),
    memberId: v.optional(v.id("members")),
    email: v.string(),
    fullName: v.string(),
    status: v.string(), // active | canceled | past_due | trialing | pending
    startedAtISO: v.string(),
    currentPeriodEndISO: v.optional(v.string()),
    canceledAtISO: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    lastPaymentAtISO: v.optional(v.string()),
    lastPaymentCents: v.optional(v.number()),
    demo: v.boolean(),
  })
    .index("by_society", ["societyId"])
    .index("by_member", ["memberId"])
    .index("by_email", ["email"]),

  fundingSources: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    sourceType: v.string(), // Member dues | Donor | Grant funder | Sponsor | Government | Program revenue | Other
    status: v.string(), // Active | Prospect | Paused | Ended
    contactName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    collectionAgentName: v.optional(v.string()),
    collectionModel: v.optional(v.string()), // direct | third_party | unknown
    memberDisclosureLevel: v.optional(v.string()), // named_members | aggregate_count | aggregate_amount | unknown
    estimatedMemberCount: v.optional(v.number()),
    collectionFrequency: v.optional(v.string()), // annual | semester | monthly | one_time | irregular | unknown
    collectionScheduleNotes: v.optional(v.string()),
    nextExpectedCollectionDate: v.optional(v.string()),
    reconciliationCadence: v.optional(v.string()),
    linkedMemberId: v.optional(v.id("members")),
    linkedGrantId: v.optional(v.id("grants")),
    expectedAnnualCents: v.optional(v.number()),
    committedCents: v.optional(v.number()),
    receivedToDateCents: v.optional(v.number()),
    currency: v.string(),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    restrictedPurpose: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_type", ["societyId", "sourceType"])
    .index("by_society_status", ["societyId", "status"]),

  fundingSourceEvents: defineTable({
    societyId: v.id("societies"),
    sourceId: v.id("fundingSources"),
    eventDate: v.string(),
    kind: v.string(), // Pledged | Received | Agreement | Report | Renewal | Contact | Other
    label: v.string(),
    amountCents: v.optional(v.number()),
    memberCount: v.optional(v.number()),
    periodStart: v.optional(v.string()),
    periodEnd: v.optional(v.string()),
    attributionStatus: v.optional(v.string()), // named | aggregate | unknown
    notes: v.optional(v.string()),
    financialTransactionId: v.optional(v.id("financialTransactions")),
    donationReceiptId: v.optional(v.id("donationReceipts")),
    documentId: v.optional(v.id("documents")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_source", ["sourceId"])
    .index("by_society_date", ["societyId", "eventDate"]),

  transcripts: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    provider: v.string(), // whisper | demo
    storageKey: v.optional(v.string()),
    durationSeconds: v.optional(v.number()),
    language: v.optional(v.string()),
    text: v.string(),
    segments: v.array(
      v.object({
        speaker: v.string(),
        text: v.string(),
        startSec: v.number(),
        endSec: v.number(),
      }),
    ),
    createdAtISO: v.string(),
    demo: v.boolean(),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  transcriptionJobs: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    status: v.string(), // queued | running | complete | failed
    provider: v.string(),
    startedAtISO: v.string(),
    completedAtISO: v.optional(v.string()),
    error: v.optional(v.string()),
    transcriptId: v.optional(v.id("transcripts")),
    demo: v.boolean(),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  // Per-category custom field definitions. Admins add a definition under
  // members/directors/volunteers/employees, then each person in that
  // category can have a value stored in customFieldValues.
  customFieldDefinitions: defineTable({
    societyId: v.id("societies"),
    entityType: v.string(), // members | directors | volunteers | employees
    key: v.string(), // machine key, e.g. "unbc_affiliate_role"
    label: v.string(),
    kind: v.string(), // text | number | date | boolean | email | phone
    required: v.boolean(),
    order: v.number(),
    description: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_entity", ["societyId", "entityType"])
    .index("by_society_entity_key", ["societyId", "entityType", "key"]),

  customFieldValues: defineTable({
    societyId: v.id("societies"),
    definitionId: v.id("customFieldDefinitions"),
    entityType: v.string(),
    entityId: v.string(),
    value: v.any(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_entity", ["entityType", "entityId"])
    .index("by_definition", ["definitionId"])
    .index("by_entity_def", ["entityType", "entityId", "definitionId"]),

  members: defineTable({
    societyId: v.id("societies"),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    aliases: v.optional(v.array(v.string())),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    membershipClass: v.string(),
    status: v.string(),
    joinedAt: v.string(),
    leftAt: v.optional(v.string()),
    votingRights: v.boolean(),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  directors: defineTable({
    societyId: v.id("societies"),
    memberId: v.optional(v.id("members")),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    aliases: v.optional(v.array(v.string())),
    position: v.string(),
    isBCResident: v.boolean(),
    termStart: v.string(),
    termEnd: v.optional(v.string()),
    consentOnFile: v.boolean(),
    resignedAt: v.optional(v.string()),
    status: v.string(),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  boardRoleAssignments: defineTable({
    societyId: v.id("societies"),
    personName: v.string(),
    personKey: v.optional(v.string()),
    memberId: v.optional(v.id("members")),
    directorId: v.optional(v.id("directors")),
    roleTitle: v.string(),
    roleGroup: v.optional(v.string()),
    roleType: v.string(), // director | officer | committee | staff | observed
    startDate: v.string(),
    endDate: v.optional(v.string()),
    status: v.string(), // Observed | Verified | Superseded | Rejected
    confidence: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    importedFrom: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_start", ["societyId", "startDate"])
    .index("by_person", ["societyId", "personKey"]),

  boardRoleChanges: defineTable({
    societyId: v.id("societies"),
    effectiveDate: v.string(),
    changeType: v.string(), // added | removed | renamed | appointed | resigned | elected
    roleTitle: v.string(),
    personName: v.optional(v.string()),
    previousPersonName: v.optional(v.string()),
    memberId: v.optional(v.id("members")),
    directorId: v.optional(v.id("directors")),
    previousMemberId: v.optional(v.id("members")),
    previousDirectorId: v.optional(v.id("directors")),
    meetingId: v.optional(v.id("meetings")),
    minutesId: v.optional(v.id("minutes")),
    motionEvidenceId: v.optional(v.string()),
    status: v.string(),
    confidence: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_date", ["societyId", "effectiveDate"]),

  signingAuthorities: defineTable({
    societyId: v.id("societies"),
    personName: v.string(),
    roleTitle: v.optional(v.string()),
    institutionName: v.optional(v.string()),
    accountLabel: v.optional(v.string()),
    authorityType: v.string(), // signing | banking | card | online-banking | other
    effectiveDate: v.string(),
    endDate: v.optional(v.string()),
    status: v.string(),
    confidence: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_date", ["societyId", "effectiveDate"]),

  committees: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    mission: v.optional(v.string()),
    cadence: v.string(),
    cadenceNotes: v.optional(v.string()),
    nextMeetingAt: v.optional(v.string()),
    chairDirectorId: v.optional(v.id("directors")),
    color: v.string(),
    status: v.string(),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  committeeMembers: defineTable({
    committeeId: v.id("committees"),
    societyId: v.id("societies"),
    name: v.string(),
    email: v.optional(v.string()),
    role: v.string(),
    directorId: v.optional(v.id("directors")),
    memberId: v.optional(v.id("members")),
    joinedAt: v.string(),
    leftAt: v.optional(v.string()),
  })
    .index("by_committee", ["committeeId"])
    .index("by_society", ["societyId"]),

  orgChartAssignments: defineTable({
    societyId: v.id("societies"),
    subjectType: v.string(), // director | employee | volunteer
    subjectId: v.string(),
    subjectName: v.string(),
    managerType: v.optional(v.string()), // director | employee | volunteer
    managerId: v.optional(v.string()),
    managerName: v.optional(v.string()),
    notes: v.optional(v.string()),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_subject", ["societyId", "subjectType", "subjectId"]),

  volunteers: defineTable({
    societyId: v.id("societies"),
    memberId: v.optional(v.id("members")),
    committeeId: v.optional(v.id("committees")),
    publicApplicationId: v.optional(v.id("volunteerApplications")),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    status: v.string(), // Prospect | Applied | Active | Paused | Inactive | Declined
    roleWanted: v.optional(v.string()),
    availability: v.optional(v.string()),
    interests: v.array(v.string()),
    screeningRequired: v.boolean(),
    orientationCompletedAtISO: v.optional(v.string()),
    trainingStatus: v.optional(v.string()), // Pending | InProgress | Complete
    applicationReceivedAtISO: v.optional(v.string()),
    approvedAtISO: v.optional(v.string()),
    renewalDueAtISO: v.optional(v.string()),
    intakeSource: v.optional(v.string()), // public | portal | admin
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_member", ["memberId"])
    .index("by_committee", ["committeeId"]),

  volunteerApplications: defineTable({
    societyId: v.id("societies"),
    memberId: v.optional(v.id("members")),
    linkedVolunteerId: v.optional(v.id("volunteers")),
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    roleWanted: v.optional(v.string()),
    availability: v.optional(v.string()),
    interests: v.array(v.string()),
    notes: v.optional(v.string()),
    source: v.string(), // public | portal | admin
    status: v.string(), // Submitted | Reviewing | Approved | Declined | Converted
    submittedAtISO: v.string(),
    reviewedAtISO: v.optional(v.string()),
    reviewedByUserId: v.optional(v.id("users")),
  })
    .index("by_society", ["societyId"])
    .index("by_status", ["societyId", "status"]),

  volunteerScreenings: defineTable({
    societyId: v.id("societies"),
    volunteerId: v.id("volunteers"),
    kind: v.string(), // Orientation | ReferenceCheck | CriminalRecordCheck | PolicyAttestation | Training
    status: v.string(), // needed | requested | clear | failed | expired | waived
    provider: v.optional(v.string()), // BC_CRRP | Manual | Other
    portalUrl: v.optional(v.string()),
    requestedAtISO: v.optional(v.string()),
    completedAtISO: v.optional(v.string()),
    expiresAtISO: v.optional(v.string()),
    referenceNumber: v.optional(v.string()),
    consentDocumentId: v.optional(v.id("documents")),
    resultDocumentId: v.optional(v.id("documents")),
    verifiedByUserId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_volunteer", ["volunteerId"]),

  meetings: defineTable({
    societyId: v.id("societies"),
    committeeId: v.optional(v.id("committees")),
    type: v.string(),
    title: v.string(),
    scheduledAt: v.string(),
    location: v.optional(v.string()),
    electronic: v.boolean(),
    remoteUrl: v.optional(v.string()),
    remoteMeetingId: v.optional(v.string()),
    remotePasscode: v.optional(v.string()),
    remoteInstructions: v.optional(v.string()),
    noticeSentAt: v.optional(v.string()),
    quorumRequired: v.optional(v.number()),
    bylawRuleSetId: v.optional(v.id("bylawRuleSets")),
    quorumRuleVersion: v.optional(v.number()),
    quorumRuleEffectiveFromISO: v.optional(v.string()),
    quorumSourceLabel: v.optional(v.string()),
    quorumComputedAtISO: v.optional(v.string()),
    status: v.string(),
    attendeeIds: v.array(v.string()),
    agendaJson: v.optional(v.string()),
    meetingTemplateId: v.optional(v.id("meetingTemplates")),
    templateSnapshotJson: v.optional(v.string()),
    minutesId: v.optional(v.id("minutes")),
    sourceReviewStatus: v.optional(v.string()), // imported_needs_review | source_reviewed | rejected
    sourceReviewNotes: v.optional(v.string()),
    sourceReviewedAtISO: v.optional(v.string()),
    sourceReviewedByUserId: v.optional(v.id("users")),
    packageReviewStatus: v.optional(v.string()), // draft | needs_review | ready | released
    packageReviewNotes: v.optional(v.string()),
    packageReviewedAtISO: v.optional(v.string()),
    packageReviewedByUserId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_date", ["societyId", "scheduledAt"])
    .index("by_committee", ["committeeId"]),

  meetingTemplates: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    meetingType: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    items: v.array(
      v.object({
        title: v.string(),
        depth: v.optional(v.union(v.literal(0), v.literal(1))),
        sectionType: v.optional(v.string()),
        presenter: v.optional(v.string()),
        details: v.optional(v.string()),
        motionTemplateId: v.optional(v.id("motionTemplates")),
        motionText: v.optional(v.string()),
      }),
    ),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_default", ["societyId", "isDefault"]),

  minutes: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    heldAt: v.string(),
    chairName: v.optional(v.string()),
    secretaryName: v.optional(v.string()),
    recorderName: v.optional(v.string()),
    calledToOrderAt: v.optional(v.string()),
    adjournedAt: v.optional(v.string()),
    remoteParticipation: v.optional(
      v.object({
        url: v.optional(v.string()),
        meetingId: v.optional(v.string()),
        passcode: v.optional(v.string()),
        instructions: v.optional(v.string()),
      }),
    ),
    detailedAttendance: v.optional(
      v.array(
        v.object({
          name: v.string(),
          status: v.string(), // present | absent | regrets | guest | staff | invited | proxy
          roleTitle: v.optional(v.string()),
          affiliation: v.optional(v.string()),
          memberIdentifier: v.optional(v.string()),
          proxyFor: v.optional(v.string()),
          quorumCounted: v.optional(v.boolean()),
          notes: v.optional(v.string()),
        }),
      ),
    ),
    attendees: v.array(v.string()),
    absent: v.array(v.string()),
    quorumMet: v.boolean(),
    quorumRequired: v.optional(v.number()),
    bylawRuleSetId: v.optional(v.id("bylawRuleSets")),
    quorumRuleVersion: v.optional(v.number()),
    quorumRuleEffectiveFromISO: v.optional(v.string()),
    quorumSourceLabel: v.optional(v.string()),
    quorumComputedAtISO: v.optional(v.string()),
    discussion: v.string(),
    sections: v.optional(
      v.array(
        v.object({
          title: v.string(),
          type: v.optional(v.string()), // discussion | motion | report | break | executive_session | other
          presenter: v.optional(v.string()),
          discussion: v.optional(v.string()),
          motionText: v.optional(v.string()),
          motionTemplateId: v.optional(v.id("motionTemplates")),
          motionBacklogId: v.optional(v.id("motionBacklog")),
          reportSubmitted: v.optional(v.boolean()),
          decisions: v.optional(v.array(v.string())),
          actionItems: v.optional(
            v.array(
              v.object({
                text: v.string(),
                assignee: v.optional(v.string()),
                dueDate: v.optional(v.string()),
                done: v.boolean(),
              }),
            ),
          ),
          linkedTaskIds: v.optional(v.array(v.id("tasks"))),
          // 0 = root agenda item, 1 = sub-item nested under the most recent
          // preceding root. Absent on legacy data, treated as 0.
          depth: v.optional(v.union(v.literal(0), v.literal(1))),
        }),
      ),
    ),
    motions: v.array(
      v.object({
        text: v.string(),
        movedBy: v.optional(v.string()),
        movedByMemberId: v.optional(v.id("members")),
        movedByDirectorId: v.optional(v.id("directors")),
        secondedBy: v.optional(v.string()),
        secondedByMemberId: v.optional(v.id("members")),
        secondedByDirectorId: v.optional(v.id("directors")),
        outcome: v.string(),
        votesFor: v.optional(v.number()),
        votesAgainst: v.optional(v.number()),
        abstentions: v.optional(v.number()),
        resolutionType: v.optional(v.string()), // Ordinary | Special | Unanimous
        sectionIndex: v.optional(v.number()),
        sectionTitle: v.optional(v.string()),
        motionTemplateId: v.optional(v.id("motionTemplates")),
        motionBacklogId: v.optional(v.id("motionBacklog")),
      }),
    ),
    decisions: v.array(v.string()),
    actionItems: v.array(
      v.object({
        text: v.string(),
        assignee: v.optional(v.string()),
        dueDate: v.optional(v.string()),
        done: v.boolean(),
      }),
    ),
    approvedAt: v.optional(v.string()),
    approvedInMeetingId: v.optional(v.id("meetings")),
    nextMeetingAt: v.optional(v.string()),
    nextMeetingLocation: v.optional(v.string()),
    nextMeetingNotes: v.optional(v.string()),
    sessionSegments: v.optional(
      v.array(
        v.object({
          type: v.string(), // public | in_camera | executive_session | closed | other
          title: v.optional(v.string()),
          startedAt: v.optional(v.string()),
          endedAt: v.optional(v.string()),
          notes: v.optional(v.string()),
        }),
      ),
    ),
    appendices: v.optional(
      v.array(
        v.object({
          title: v.string(),
          type: v.optional(v.string()),
          reference: v.optional(v.string()),
          notes: v.optional(v.string()),
        }),
      ),
    ),
    agmDetails: v.optional(
      v.object({
        financialStatementsPresented: v.optional(v.boolean()),
        financialStatementsNotes: v.optional(v.string()),
        directorElectionNotes: v.optional(v.string()),
        directorAppointments: v.optional(
          v.array(
            v.object({
              name: v.string(),
              roleTitle: v.optional(v.string()),
                affiliation: v.optional(v.string()),
                term: v.optional(v.string()),
                consentRecorded: v.optional(v.boolean()),
                votesReceived: v.optional(v.number()),
                elected: v.optional(v.boolean()),
                status: v.optional(v.string()),
                notes: v.optional(v.string()),
              }),
          ),
        ),
        specialResolutionExhibits: v.optional(
          v.array(
            v.object({
              title: v.string(),
              reference: v.optional(v.string()),
              notes: v.optional(v.string()),
            }),
          ),
        ),
      }),
    ),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    sourceReviewStatus: v.optional(v.string()), // imported_needs_review | source_reviewed | rejected
    sourceReviewNotes: v.optional(v.string()),
    sourceReviewedAtISO: v.optional(v.string()),
    sourceReviewedByUserId: v.optional(v.id("users")),
    draftTranscript: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  meetingAttendanceRecords: defineTable({
    societyId: v.id("societies"),
    meetingId: v.optional(v.id("meetings")),
    minutesId: v.optional(v.id("minutes")),
    meetingTitle: v.string(),
    meetingDate: v.string(),
    personName: v.string(),
    memberId: v.optional(v.id("members")),
    directorId: v.optional(v.id("directors")),
    roleTitle: v.optional(v.string()),
    attendanceStatus: v.string(), // present | absent | regrets | guest | needs_review
    quorumCounted: v.optional(v.boolean()),
    confidence: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"])
    .index("by_society_date", ["societyId", "meetingDate"]),

  motionEvidence: defineTable({
    societyId: v.id("societies"),
    meetingId: v.optional(v.id("meetings")),
    minutesId: v.optional(v.id("minutes")),
    meetingTitle: v.string(),
    meetingDate: v.string(),
    motionText: v.string(),
    movedBy: v.optional(v.string()),
    movedByMemberId: v.optional(v.id("members")),
    movedByDirectorId: v.optional(v.id("directors")),
    secondedBy: v.optional(v.string()),
    secondedByMemberId: v.optional(v.id("members")),
    secondedByDirectorId: v.optional(v.id("directors")),
    outcome: v.string(),
    voteSummary: v.optional(v.string()),
    pageRef: v.optional(v.string()),
    evidenceText: v.optional(v.string()),
    confidence: v.string(),
    status: v.string(), // Extracted | Verified | Rejected
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"])
    .index("by_society_date", ["societyId", "meetingDate"]),

  filings: defineTable({
    societyId: v.id("societies"),
    kind: v.string(),
    periodLabel: v.optional(v.string()),
    dueDate: v.string(),
    filedAt: v.optional(v.string()),
    submissionMethod: v.optional(v.string()),
    submittedByUserId: v.optional(v.id("users")),
    confirmationNumber: v.optional(v.string()),
    feePaidCents: v.optional(v.number()),
    receiptDocumentId: v.optional(v.id("documents")),
    stagedPacketDocumentId: v.optional(v.id("documents")),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    submissionChecklist: v.optional(v.array(v.string())),
    registryUrl: v.optional(v.string()),
    evidenceNotes: v.optional(v.string()),
    attestedByUserId: v.optional(v.id("users")),
    attestedAtISO: v.optional(v.string()),
    sourceExternalIds: v.optional(v.array(v.string())),
    sourcePayloadJson: v.optional(v.string()),
    status: v.string(),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_due", ["societyId", "dueDate"]),

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

  deadlines: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    description: v.optional(v.string()),
    dueDate: v.string(),
    category: v.string(),
    done: v.boolean(),
    recurrence: v.optional(v.string()),
    linkedFilingId: v.optional(v.id("filings")),
  })
    .index("by_society", ["societyId"])
    .index("by_society_due", ["societyId", "dueDate"])
    .index("by_society_done", ["societyId", "done"]),

  commitments: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    category: v.string(), // Contract | Grant | Facility | Governance | Privacy | Funding | Other
    sourceDocumentId: v.optional(v.id("documents")),
    sourceLabel: v.optional(v.string()),
    sourceExcerpt: v.optional(v.string()),
    counterparty: v.optional(v.string()),
    requirement: v.string(),
    cadence: v.string(), // Once | Monthly | Quarterly | Annual | Every 2 years | Custom
    nextDueDate: v.optional(v.string()),
    dueDateBasis: v.optional(v.string()),
    noticeLeadDays: v.optional(v.number()),
    owner: v.optional(v.string()),
    status: v.string(), // Active | Watching | Paused | Closed
    reviewStatus: v.optional(v.string()), // NeedsReview | Verified | Rejected
    confidence: v.optional(v.number()),
    uncertaintyNote: v.optional(v.string()),
    lastCompletedAtISO: v.optional(v.string()),
    lastCompletionSummary: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_due", ["societyId", "nextDueDate"])
    .index("by_source_document", ["sourceDocumentId"]),

  commitmentEvents: defineTable({
    societyId: v.id("societies"),
    commitmentId: v.id("commitments"),
    title: v.string(),
    happenedAtISO: v.string(),
    meetingId: v.optional(v.id("meetings")),
    evidenceDocumentIds: v.array(v.id("documents")),
    evidenceStatus: v.optional(v.string()), // NeedsReview | Verified | Rejected
    evidenceNotes: v.optional(v.string()),
    summary: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_happened", ["societyId", "happenedAtISO"])
    .index("by_commitment", ["commitmentId"])
    .index("by_meeting", ["meetingId"]),

  documents: defineTable({
    societyId: v.id("societies"),
    committeeId: v.optional(v.id("committees")),
    meetingId: v.optional(v.id("meetings")),
    agendaItemId: v.optional(v.id("agendaItems")),
    title: v.string(),
    category: v.string(),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    content: v.optional(v.string()),
    url: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    fileSizeBytes: v.optional(v.number()),
    retentionYears: v.optional(v.number()),
    createdAtISO: v.string(),
    lastOpenedAtISO: v.optional(v.string()),
    lastOpenedByUserId: v.optional(v.id("users")),
    reviewStatus: v.optional(v.string()), // none | in_review | needs_signature | approved | blocked
    librarySection: v.optional(v.string()), // governance | policy | meeting_material | finance | other
    flaggedForDeletion: v.boolean(),
    archivedAtISO: v.optional(v.string()),
    archivedReason: v.optional(v.string()),
    sourceExternalIds: v.optional(v.array(v.string())),
    sourcePayloadJson: v.optional(v.string()),
    importSessionId: v.optional(v.id("documents")),
    importRecordKind: v.optional(v.string()),
    tags: v.array(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_category", ["societyId", "category"])
    .index("by_import_session", ["importSessionId"])
    .index("by_committee", ["committeeId"])
    .index("by_meeting", ["meetingId"])
    .index("by_library_section", ["societyId", "librarySection"])
    .index("by_last_opened", ["societyId", "lastOpenedAtISO"]),

  meetingMaterials: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    documentId: v.id("documents"),
    agendaItemId: v.optional(v.id("agendaItems")),
    agendaLabel: v.optional(v.string()),
    label: v.optional(v.string()),
    order: v.number(),
    requiredForMeeting: v.boolean(),
    accessLevel: v.string(), // board | committee | members | public | restricted
    accessGrants: v.optional(
      v.array(
        v.object({
          subjectType: v.string(), // attendee | member | director | user | committee | group
          subjectId: v.optional(v.string()),
          subjectLabel: v.string(),
          access: v.string(), // view | comment | sign | manage
          note: v.optional(v.string()),
        }),
      ),
    ),
    availabilityStatus: v.optional(v.string()), // available | pending | expired | withdrawn
    syncStatus: v.optional(v.string()), // online | synced | offline | unavailable
    expiresAtISO: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"])
    .index("by_document", ["documentId"])
    .index("by_agenda_item", ["agendaItemId"]),

  documentComments: defineTable({
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    pageNumber: v.optional(v.number()),
    anchorText: v.optional(v.string()),
    authorName: v.string(),
    authorUserId: v.optional(v.id("users")),
    body: v.string(),
    status: v.string(), // open | resolved
    createdAtISO: v.string(),
    resolvedAtISO: v.optional(v.string()),
    resolvedByUserId: v.optional(v.id("users")),
  })
    .index("by_society", ["societyId"])
    .index("by_document", ["documentId"])
    .index("by_document_status", ["documentId", "status"]),

  publications: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    summary: v.optional(v.string()),
    category: v.string(), // AnnualReport | Bylaws | AGM | Policy | Notice | Resource | Custom
    documentId: v.optional(v.id("documents")),
    url: v.optional(v.string()),
    publishedAtISO: v.optional(v.string()),
    status: v.string(), // Draft | Published | Archived
    reviewStatus: v.optional(v.string()), // Draft | InReview | Approved
    approvedByUserId: v.optional(v.id("users")),
    approvedAtISO: v.optional(v.string()),
    featured: v.optional(v.boolean()),
    createdAtISO: v.string(),
  }).index("by_society", ["societyId"]),

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
  })
    .index("by_society", ["societyId"])
    .index("by_society_resolved", ["societyId", "resolvedAt"])
    .index("by_director", ["directorId"]),

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

  assets: defineTable({
    societyId: v.id("societies"),
    assetTag: v.string(),
    name: v.string(),
    category: v.string(),
    serialNumber: v.optional(v.string()),
    supplier: v.optional(v.string()),
    purchaseDate: v.optional(v.string()),
    purchaseValueCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    fundingSource: v.optional(v.string()),
    grantId: v.optional(v.id("grants")),
    grantRestrictions: v.optional(v.string()),
    retentionUntil: v.optional(v.string()),
    disposalRules: v.optional(v.string()),
    location: v.optional(v.string()),
    condition: v.string(),
    status: v.string(),
    custodianType: v.optional(v.string()), // member | director | employee | volunteer | committee | location | other
    custodianId: v.optional(v.string()),
    custodianName: v.optional(v.string()),
    responsiblePersonName: v.optional(v.string()),
    expectedReturnDate: v.optional(v.string()),
    insurancePolicyId: v.optional(v.id("insurancePolicies")),
    insuranceNotes: v.optional(v.string()),
    capitalized: v.boolean(),
    depreciationMethod: v.optional(v.string()),
    usefulLifeMonths: v.optional(v.number()),
    bookValueCents: v.optional(v.number()),
    receiptDocumentId: v.optional(v.id("documents")),
    sourceDocumentIds: v.array(v.id("documents")),
    warrantyExpiresAt: v.optional(v.string()),
    nextMaintenanceDate: v.optional(v.string()),
    nextVerificationDate: v.optional(v.string()),
    disposedAt: v.optional(v.string()),
    disposalMethod: v.optional(v.string()),
    disposalReason: v.optional(v.string()),
    disposalValueCents: v.optional(v.number()),
    disposalApprovedMeetingId: v.optional(v.id("meetings")),
    disposalDocumentIds: v.array(v.id("documents")),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_tag", ["societyId", "assetTag"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_society_category", ["societyId", "category"])
    .index("by_grant", ["grantId"])
    .index("by_insurance_policy", ["insurancePolicyId"]),

  assetEvents: defineTable({
    societyId: v.id("societies"),
    assetId: v.id("assets"),
    eventType: v.string(), // intake | checkout | checkin | transfer | maintenance | verification | disposal | note
    happenedAtISO: v.string(),
    actorName: v.optional(v.string()),
    fromCustodianName: v.optional(v.string()),
    toCustodianType: v.optional(v.string()),
    toCustodianId: v.optional(v.string()),
    toCustodianName: v.optional(v.string()),
    responsiblePersonName: v.optional(v.string()),
    location: v.optional(v.string()),
    condition: v.optional(v.string()),
    expectedReturnDate: v.optional(v.string()),
    acceptanceSignature: v.optional(v.string()),
    documentIds: v.array(v.id("documents")),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_asset", ["assetId"])
    .index("by_asset_happened", ["assetId", "happenedAtISO"])
    .index("by_society_happened", ["societyId", "happenedAtISO"]),

  assetMaintenance: defineTable({
    societyId: v.id("societies"),
    assetId: v.id("assets"),
    title: v.string(),
    kind: v.string(), // maintenance | calibration | insurance | warranty | inspection
    dueDate: v.string(),
    status: v.string(),
    completedAtISO: v.optional(v.string()),
    taskId: v.optional(v.id("tasks")),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_asset", ["assetId"])
    .index("by_society_due", ["societyId", "dueDate"])
    .index("by_task", ["taskId"]),

  assetVerificationRuns: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    status: v.string(),
    startedAtISO: v.string(),
    completedAtISO: v.optional(v.string()),
    reviewerName: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  assetVerificationItems: defineTable({
    societyId: v.id("societies"),
    runId: v.id("assetVerificationRuns"),
    assetId: v.id("assets"),
    status: v.string(), // pending | verified | missing | damaged | location_mismatch
    verifiedAtISO: v.optional(v.string()),
    verifiedByName: v.optional(v.string()),
    observedLocation: v.optional(v.string()),
    observedCondition: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_run", ["runId"])
    .index("by_asset", ["assetId"])
    .index("by_run_status", ["runId", "status"]),

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

  // ========== Board meeting workflow ==========

  agendas: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    title: v.string(),
    status: v.string(), // Draft | Published | Finalized
    notes: v.optional(v.string()),
    updatedAtISO: v.string(),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  agendaItems: defineTable({
    societyId: v.id("societies"),
    agendaId: v.id("agendas"),
    order: v.number(),
    type: v.string(), // discussion | motion | report | break | executive_session
    title: v.string(),
    depth: v.optional(v.union(v.literal(0), v.literal(1))),
    details: v.optional(v.string()),
    presenter: v.optional(v.string()),
    timeAllottedMinutes: v.optional(v.number()),
    motionTemplateId: v.optional(v.id("motionTemplates")),
    motionBacklogId: v.optional(v.id("motionBacklog")),
    motionText: v.optional(v.string()),
    outcome: v.optional(v.string()), // carried | defeated | tabled | deferred
    resolutionId: v.optional(v.id("writtenResolutions")),
    createdAtISO: v.string(),
  })
    .index("by_agenda", ["agendaId"])
    .index("by_society", ["societyId"]),

  motionTemplates: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    body: v.string(),
    category: v.string(), // governance | finance | membership | operations | bylaws | other
    requiresSpecialResolution: v.boolean(),
    notes: v.optional(v.string()),
    usageCount: v.optional(v.number()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_category", ["societyId", "category"]),

  motionBacklog: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    motionText: v.string(),
    category: v.string(), // privacy | governance | finance | membership | operations | bylaws | other
    status: v.string(), // Backlog | Agenda | MinutesDraft | Adopted | Deferred | Archived
    priority: v.optional(v.string()), // high | normal | low
    source: v.optional(v.string()), // pipa-setup | manual | imported
    seededKey: v.optional(v.string()),
    notes: v.optional(v.string()),
    targetMeetingId: v.optional(v.id("meetings")),
    agendaId: v.optional(v.id("agendas")),
    agendaItemId: v.optional(v.id("agendaItems")),
    minutesId: v.optional(v.id("minutes")),
    sourceMinutesId: v.optional(v.id("minutes")),
    sourceMotionIndex: v.optional(v.number()),
    sourceSectionIndex: v.optional(v.number()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_society_seeded", ["societyId", "seededKey"])
    .index("by_agenda", ["agendaId"])
    .index("by_meeting", ["targetMeetingId"]),

  minuteBookItems: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    recordType: v.string(), // meeting | minutes | resolution | written_resolution | filing | policy | document | package | other
    effectiveDate: v.optional(v.string()),
    status: v.string(), // Draft | Current | NeedsReview | Archived | Superseded
    documentIds: v.array(v.id("documents")),
    meetingId: v.optional(v.id("meetings")),
    minutesId: v.optional(v.id("minutes")),
    filingId: v.optional(v.id("filings")),
    policyId: v.optional(v.id("policies")),
    workflowPackageId: v.optional(v.id("workflowPackages")),
    writtenResolutionId: v.optional(v.id("writtenResolutions")),
    signatureIds: v.array(v.id("signatures")),
    sourceEvidenceIds: v.array(v.id("sourceEvidence")),
    archivedAtISO: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_type", ["societyId", "recordType"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_society_effective", ["societyId", "effectiveDate"]),

  // Where records are kept if not at the registered office
  recordsLocation: defineTable({
    societyId: v.id("societies"),
    address: v.string(),
    noticePostedAtOffice: v.boolean(),
    postedAtISO: v.optional(v.string()),
    computerProvidedForInspection: v.boolean(),
    notes: v.optional(v.string()),
  }).index("by_society", ["societyId"]),

  sourceEvidence: defineTable({
    societyId: v.id("societies"),
    sourceDocumentId: v.optional(v.id("documents")),
    externalSystem: v.string(),
    externalId: v.optional(v.string()),
    sourceTitle: v.string(),
    sourceDate: v.optional(v.string()),
    evidenceKind: v.string(), // provenance | restricted | publication_sidecar | import_support
    targetTable: v.optional(v.string()),
    targetId: v.optional(v.string()),
    sensitivity: v.string(), // standard | restricted
    accessLevel: v.string(), // public | internal | restricted
    summary: v.string(),
    excerpt: v.optional(v.string()),
    status: v.string(), // NeedsReview | Linked | Verified | Rejected
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_external", ["societyId", "externalId"])
    .index("by_source", ["sourceDocumentId"])
    .index("by_target", ["targetTable", "targetId"]),

  secretVaultItems: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    service: v.string(),
    credentialType: v.string(), // recovery_key | registry_key | api_key | password | certificate | other
    ownerRole: v.optional(v.string()),
    custodianUserId: v.optional(v.id("users")),
    custodianPersonName: v.optional(v.string()),
    custodianEmail: v.optional(v.string()),
    backupCustodianName: v.optional(v.string()),
    backupCustodianEmail: v.optional(v.string()),
    username: v.optional(v.string()),
    accessUrl: v.optional(v.string()),
    storageMode: v.string(), // stored_encrypted | external_reference | encrypted_elsewhere | not_stored
    externalLocation: v.optional(v.string()),
    secretEncrypted: v.optional(v.string()),
    secretPreview: v.optional(v.string()),
    secretUpdatedAtISO: v.optional(v.string()),
    secretUpdatedByUserId: v.optional(v.id("users")),
    secretLastRevealedAtISO: v.optional(v.string()),
    secretLastRevealedByUserId: v.optional(v.id("users")),
    revealPolicy: v.optional(v.string()), // owner_admin | owner_admin_custodian | owner_only
    authorizedUserIds: v.optional(v.array(v.id("users"))),
    lastVerifiedAtISO: v.optional(v.string()),
    rotationDueAtISO: v.optional(v.string()),
    status: v.string(), // Active | NeedsReview | Rotated | Revoked
    sensitivity: v.string(), // restricted | high
    accessLevel: v.string(), // restricted
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_service", ["societyId", "service"])
    .index("by_society_status", ["societyId", "status"]),

  archiveAccessions: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    accessionNumber: v.optional(v.string()),
    containerType: v.string(), // box | binder | drive | folder | external_archive | other
    location: v.string(),
    custodian: v.optional(v.string()),
    dateReceived: v.optional(v.string()),
    dateRange: v.optional(v.string()),
    status: v.string(), // NeedsReview | InCustody | Transferred | Archived
    accessRestrictions: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_date", ["societyId", "dateReceived"]),

  // =========================================================================
  // Record Table metadata — Twenty-style architecture.
  //
  // These four tables power the generic RecordTable. An "Object" (members,
  // directors, filings, …) has "Fields", and a "View" defines how that object
  // is rendered (columns, sort, filters). Columns are ViewFields that
  // reference a FieldMetadata row — so every cell in every table knows its
  // field type at runtime and can be dispatched to the right renderer.
  // =========================================================================

  objectMetadata: defineTable({
    societyId: v.id("societies"),
    // Stable identifier — matches the physical Convex table name, e.g. "members".
    nameSingular: v.string(),      // "member"
    namePlural: v.string(),        // "members" — usually matches the Convex table
    labelSingular: v.string(),     // "Member"
    labelPlural: v.string(),       // "Members"
    description: v.optional(v.string()),
    icon: v.optional(v.string()),  // lucide icon name
    iconColor: v.optional(v.string()),
    permissionConfig: v.optional(v.any()),
    // Field id used as the record's "identifier" — shown as the headline cell,
    // becomes the click target. References fieldMetadata.name, resolved lazily.
    labelIdentifierFieldName: v.optional(v.string()),
    imageIdentifierFieldName: v.optional(v.string()),
    isSystem: v.boolean(),
    isActive: v.boolean(),
    // Route for viewing the index page (e.g. "/app/members").
    routePath: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_name", ["societyId", "nameSingular"])
    .index("by_society_name_plural", ["societyId", "namePlural"]),

  fieldMetadata: defineTable({
    societyId: v.id("societies"),
    objectMetadataId: v.id("objectMetadata"),
    name: v.string(),              // property on the record, e.g. "firstName"
    label: v.string(),             // "First name"
    description: v.optional(v.string()),
    icon: v.optional(v.string()),  // lucide icon name
    // Drives cell rendering. Must be one of FIELD_TYPES from the frontend registry.
    fieldType: v.string(),
    // Type-specific config, stored as JSON for forward compat.
    //   TEXT:        { placeholder? }
    //   NUMBER:      { decimals?, prefix?, suffix? }
    //   CURRENCY:    { currencyCode?: "USD" | "CAD" | ... }
    //   DATE/DATETIME: { includeTime? }
    //   BOOLEAN:     { trueLabel?, falseLabel? }
    //   SELECT:      { options: [{ value, label, color? }] }
    //   MULTI_SELECT:same as SELECT
    //   EMAIL / PHONE / LINK: {}
    //   RELATION:    { targetObjectMetadataId, kind: "many-to-one" | "one-to-many" }
    //   RATING:      { max?: number }
    configJson: v.optional(v.string()),
    permissionConfig: v.optional(v.any()),
    // Default value for new records (serialized).
    defaultValueJson: v.optional(v.string()),
    // When true, the field can't be removed and its type can't be changed.
    isSystem: v.boolean(),
    // When true, the field stays hidden from field pickers — used for
    // internal fields like `_id` / `_creationTime`.
    isHidden: v.boolean(),
    isNullable: v.boolean(),
    // When true, the cell is rendered but the inline editor is disabled.
    // Use for computed / server-managed columns (timestamps, identifiers,
    // joined data, derived status). Defaults to false so existing rows
    // keep their current behaviour.
    isReadOnly: v.optional(v.boolean()),
    // Field position on the default detail page.
    position: v.number(),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_object", ["objectMetadataId"])
    .index("by_object_name", ["objectMetadataId", "name"]),

  views: defineTable({
    societyId: v.id("societies"),
    objectMetadataId: v.id("objectMetadata"),
    name: v.string(),              // "All members"
    icon: v.optional(v.string()),
    type: v.string(),              // "table" | "kanban" | "board" | "calendar"
    // When kanban, which SELECT/RELATION field splits columns.
    kanbanFieldMetadataId: v.optional(v.id("fieldMetadata")),
    kanbanAggregateOperation: v.optional(v.string()),
    kanbanAggregateOperationFieldMetadataId: v.optional(v.id("fieldMetadata")),
    calendarFieldMetadataId: v.optional(v.id("fieldMetadata")),
    calendarLayout: v.optional(v.string()),
    // Filter & sort live on the view, not on each load — serialized.
    //   filtersJson: [{ fieldMetadataId, operator, value, operandKind }]
    //   sortsJson:   [{ fieldMetadataId, direction }]
    filtersJson: v.optional(v.string()),
    viewFilterGroupsJson: v.optional(v.string()),
    sortsJson: v.optional(v.string()),
    viewGroupsJson: v.optional(v.string()),
    viewFieldGroupsJson: v.optional(v.string()),
    // Search term pre-applied to the view.
    searchTerm: v.optional(v.string()),
    anyFieldFilterValue: v.optional(v.string()),
    // DataTable-specific column state (hidden ids, widths, ordering).
    columnStateJson: v.optional(v.string()),
    // Compact vs comfortable.
    density: v.optional(v.string()),
    // "Shared" views are visible to the whole society; personal views only
    // to the creator.
    isShared: v.boolean(),
    visibility: v.optional(v.string()), // "personal" | "shared" | "system"
    openRecordIn: v.optional(v.string()), // "drawer" | "page"
    // System views are seeded (e.g. "All members") — users can't delete them
    // but can clone them.
    isSystem: v.boolean(),
    createdByUserId: v.optional(v.id("users")),
    position: v.number(),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_object", ["objectMetadataId"])
    .index("by_object_position", ["objectMetadataId", "position"]),

  viewFields: defineTable({
    societyId: v.id("societies"),
    viewId: v.id("views"),
    fieldMetadataId: v.id("fieldMetadata"),
    viewFieldGroupId: v.optional(v.string()),
    isVisible: v.boolean(),
    position: v.number(),
    size: v.number(), // pixels
    // Aggregation displayed in the table footer for this column
    // ("sum" | "avg" | "count" | "min" | "max" | "countUniqueValues" | null).
    aggregateOperation: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_view", ["viewId"])
    .index("by_view_position", ["viewId", "position"])
    .index("by_field", ["fieldMetadataId"]),

  commandMenuItems: defineTable({
    societyId: v.id("societies"),
    label: v.string(),
    category: v.string(),
    iconName: v.optional(v.string()),
    commandKey: v.string(),
    scopeType: v.string(), // global | page | object | record | selection
    pagePath: v.optional(v.string()),
    objectMetadataId: v.optional(v.id("objectMetadata")),
    requiredSelection: v.optional(v.string()),
    payloadJson: v.optional(v.string()),
    isPinned: v.boolean(),
    isSystem: v.boolean(),
    position: v.number(),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_scope", ["societyId", "scopeType"])
    .index("by_object", ["objectMetadataId"]),

});
