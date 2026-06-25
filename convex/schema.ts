import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { ycnRegisterTables } from "./tables/ycnRegisters";
import { legalDocsTables } from "./tables/legalDocs";
import { formationTables } from "./tables/formation";
import { platformTables } from "./tables/platform";
import { documentSyncTables } from "./tables/documentSync";
import { communicationsTables } from "./tables/communications";
import { waveCacheTables } from "./tables/waveCache";
import { transcriptTables } from "./tables/transcripts";
import { volunteerTables } from "./tables/volunteers";
import { filingTables } from "./tables/filings";
import { inventoryTables } from "./tables/inventory";
import { governanceTables } from "./tables/governance";
import { electionsMiscTables } from "./tables/electionsMisc";
import { meetingWorkflowTables } from "./tables/meetingWorkflow";
import { recordTableTables } from "./tables/recordTable";
import { accountingTables } from "./tables/accounting";
import { aiTables } from "./tables/ai";
import { peopleTables } from "./tables/people";
import { grantTables } from "./tables/grants";
import { documentTables } from "./tables/documents";
import { assetTables } from "./tables/assets";
import { treasuryTables } from "./tables/treasury";
import { workflowTables } from "./tables/workflows";
import { subscriptionTables } from "./tables/subscriptions";
import { meetingTables } from "./tables/meetings";
import { complianceTables } from "./tables/compliance";
import { policyTables } from "./tables/policies";

export default defineSchema({
  societies: defineTable({
    name: v.string(),
    incorporationNumber: v.optional(v.string()),
    incorporationDate: v.optional(v.string()),
    fiscalYearEnd: v.optional(v.string()),
    jurisdictionCode: v.optional(v.string()),
    homeJurisdictionCode: v.optional(v.string()),
    primaryRegistrationId: v.optional(v.id("organizationRegistrations")),
    anniversaryDate: v.optional(v.string()),
    corporationKeyVaultItemId: v.optional(v.id("secretVaultItems")),
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
    logoStorageId: v.optional(v.id("_storage")),
    logoDarkStorageId: v.optional(v.id("_storage")),
    logoInvertInDarkMode: v.optional(v.boolean()),
    letterheadStorageId: v.optional(v.id("_storage")),
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
    consumableIntakeCountPromptEnabled: v.optional(v.boolean()),
    // Days a dismissed notification is kept before the daily purge deletes it.
    // Undefined = use the default (30). 0 = keep forever (never auto-delete).
    notificationRetentionDays: v.optional(v.number()),
    demoMode: v.optional(v.boolean()),
    // YCN-style compliance settings consumed by shared/corporationSettings.ts to
    // derive AGM / annual-report deadlines. Optional and additive.
    agmMonth: v.optional(v.number()),
    agmDay: v.optional(v.number()),
    waivePrepFinancials: v.optional(v.boolean()),
    // Current short/defined-term name ("the Company"). Effective-dated history
    // lives in societyNameHistory; this is the current convenience value.
    shortName: v.optional(v.string()),
    // YCN Corporation_Settings — records-manager contacts + physical record
    // locations + document-prep preferences.
    primaryContactName: v.optional(v.string()),
    primaryContactPhone: v.optional(v.string()),
    primaryContactEmail: v.optional(v.string()),
    altContactName: v.optional(v.string()),
    altContactPhone: v.optional(v.string()),
    altContactEmail: v.optional(v.string()),
    minuteBookLocation: v.optional(v.string()),
    sealLocation: v.optional(v.string()),
    docPrepLanguage: v.optional(v.string()),
    responsibleLawyer: v.optional(v.string()),
    restrictPeoplePicker: v.optional(v.boolean()),
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
    // YCN BUS_ADDRESS: a business/operating address (type "business_address")
    // may carry named contacts (name + role) and free-form address lines.
    contacts: v.optional(v.array(v.object({ name: v.string(), role: v.optional(v.string()) }))),
    freeformLines: v.optional(v.array(v.string())),
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
    registrationType: v.optional(v.string()), // home | extra_provincial | business_name | branch | licence | deregistered
    jurisdiction: v.string(),
    homeJurisdiction: v.optional(v.string()),
    assumedName: v.optional(v.string()),
    registrationNumber: v.optional(v.string()),
    registrationDate: v.optional(v.string()),
    activityCommencementDate: v.optional(v.string()),
    deRegistrationDate: v.optional(v.string()),
    nuansNumber: v.optional(v.string()),
    officialEmail: v.optional(v.string()),
    annualReturnDueDate: v.optional(v.string()),
    lastAnnualReturnFiledDate: v.optional(v.string()),
    registryProfileReportDate: v.optional(v.string()),
    registryPortalKey: v.optional(v.string()),
    profileReportDocumentId: v.optional(v.id("documents")),
    companyKeyVaultItemId: v.optional(v.id("secretVaultItems")),
    agentForServiceName: v.optional(v.string()),
    agentForServiceAddress: v.optional(v.string()),
    principalOfficeAddress: v.optional(v.string()),
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
    // Transparency-register fields for roleType 'controller' (significant
    // individuals), read by convex/registerHistory.ts significantIndividualsAsOf.
    significanceReason: v.optional(v.string()),
    taxResidentHomeJurisdiction: v.optional(v.string()), // yes | no | unknown
    // Link to the cross-tenant people directory (YCN ENT_PEOPLE.GLOB_ID) and
    // concurrent extra officer titles (YCN OFFICER PRES/SECR/OTHER).
    directoryPersonId: v.optional(v.id("peopleDirectory")),
    additionalOfficerTitles: v.optional(v.array(v.string())),
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
    // YCN SHR_SINGLE: hand-authored singular display form ("Common Share") for NLG.
    singularForm: v.optional(v.string()),
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

  rightsHoldings: defineTable({
    societyId: v.id("societies"),
    rightsClassId: v.id("rightsClasses"),
    holderRoleHolderId: v.optional(v.id("roleHolders")),
    holderKey: v.string(),
    quantity: v.number(),
    status: v.string(), // current | zeroed | needs_review
    lastTransactionId: v.optional(v.id("rightsholdingTransfers")),
    sourceDocumentIds: v.array(v.id("documents")),
    sourceExternalIds: v.array(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_class", ["societyId", "rightsClassId"])
    .index("by_society_holder", ["societyId", "holderKey"]),

  // legalDocs — extracted to convex/tables/legalDocs.ts
  ...legalDocsTables,

  // formation — extracted to convex/tables/formation.ts
  ...formationTables,

  // platform — extracted to convex/tables/platform.ts
  ...platformTables,

  // documentSync — extracted to convex/tables/documentSync.ts
  ...documentSyncTables,

  // communications — extracted to convex/tables/communications.ts
  ...communicationsTables,

  // waveCache — extracted to convex/tables/waveCache.ts
  ...waveCacheTables,

  // Accounting & budgeting — extracted to convex/tables/accounting.ts
  ...accountingTables,

  // treasury — extracted to convex/tables/treasury.ts
  ...treasuryTables,

  // AI agent / chat / provider tables (agent runs, audit events, skills, logic functions, chat threads, messages, tool drafts, provider settings, model cache), extracted from convex/schema — extracted to convex/tables/ai.ts
  ...aiTables,

  recordLayouts: defineTable({
    societyId: v.id("societies"),
    scopeKey: v.string(),
    layoutJson: v.string(),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_scope", ["societyId", "scopeKey"]),

  // workflows — extracted to convex/tables/workflows.ts
  ...workflowTables,

  // subscriptions / funding — extracted to convex/tables/subscriptions.ts
  ...subscriptionTables,

  // transcripts — extracted to convex/tables/transcripts.ts
  ...transcriptTables,

  ...peopleTables,

  // volunteers — extracted to convex/tables/volunteers.ts
  ...volunteerTables,

  ...meetingTables,

  // filings — extracted to convex/tables/filings.ts
  ...filingTables,

  ...grantTables,

  // compliance — extracted to convex/tables/compliance.ts
  ...complianceTables,

  // Document tables (documents, meeting materials, document comments, publications), extracted from convex/schema — extracted to convex/tables/documents.ts
  ...documentTables,

  // policies / bylaws — extracted to convex/tables/policies.ts
  ...policyTables,

  // Asset tables (assets, asset events, maintenance, verification runs/items, receipt links), extracted from convex/schema — extracted to convex/tables/assets.ts
  ...assetTables,

  // inventory — extracted to convex/tables/inventory.ts
  ...inventoryTables,

  // governance — extracted to convex/tables/governance.ts
  ...governanceTables,

  // electionsMisc — extracted to convex/tables/electionsMisc.ts
  ...electionsMiscTables,

  ...meetingWorkflowTables,

  // =========================================================================
  // Record Table metadata — Twenty-style architecture.
  //
  // These four tables power the generic RecordTable. An "Object" (members,
  // directors, filings, …) has "Fields", and a "View" defines how that object
  // is rendered (columns, sort, filters). Columns are ViewFields that
  // reference a FieldMetadata row — so every cell in every table knows its
  // field type at runtime and can be dispatched to the right renderer.
  // =========================================================================

  // Record Table metadata — extracted to convex/tables/recordTable.ts
  ...recordTableTables,

  // --- YCN-derived registers — extracted to convex/tables/ycnRegisters.ts ---
  // (shared registers + corporation-only registers, spread in below).
  ...ycnRegisterTables,

});
