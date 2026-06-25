import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * YCN-derived register tables, extracted from convex/schema.ts into a domain
 * module (the first step of modularizing the monolithic schema). These objects
 * are spread back into `defineSchema({...})`, so the generated data model and
 * runtime are byte-identical — this is purely an organizational refactor.
 *
 * Grouped by which entity kind they apply to, mirroring the society /
 * corporation / multi-entity product split:
 *  - SHARED registers apply to both societies and corporations (+ the portfolio).
 *  - CORPORATION registers have no society analog (share capital, certificates,
 *    dividends, the BC transparency register of significant individuals).
 */

/** Registers that apply to BOTH societies and corporations (and span the portfolio). */
export const sharedRegisterTables = {
  // Cross-tenant people directory: store a person once, reuse across entities.
  // Logic: shared/peopleDirectory.ts.
  peopleDirectory: defineTable({
    fullName: v.string(),
    searchName: v.string(), // normalizeSearchName(fullName)
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    dob: v.optional(v.string()),
    isIndividual: v.optional(v.boolean()),
    defaultAddress: v.optional(v.string()),
    // YCN PEOPLE_DIRECTORY grammar/signature drivers.
    isServiceProvider: v.optional(v.boolean()),
    atAgeOfMajority: v.optional(v.boolean()),
    gender: v.optional(v.string()), // M | F | X
    pronouns: v.optional(v.string()), // stated pronouns; override gender for NLG
    corpSign: v.optional(v.string()), // signature-block "By:" prefix for orgs
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_search_name", ["searchName"]),

  // External service-provider register. Logic: shared/serviceProviders.ts.
  serviceProviders: defineTable({
    societyId: v.id("societies"),
    function: v.string(), // lawyer | accountant | banker | transfer_agent | auditor | registered_agent | other
    firmName: v.string(),
    contactName: v.optional(v.string()),
    firmLocation: v.optional(v.string()),
    appointedOn: v.optional(v.string()),
    removedOn: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_function", ["societyId", "function"]),

  // Effective-dated corporate name history (YCN CORP_NAME). Logic: shared/nameHistory.ts.
  societyNameHistory: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    shortName: v.optional(v.string()),
    startISO: v.string(),
    regPosn: v.optional(v.number()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"]),

  // Constating-document timeline (YCN CONSTATING). Logic: shared/constating.ts.
  constatingEvents: defineTable({
    societyId: v.id("societies"),
    action: v.string(), // incorporated | transitioned | continued | amalgamated | restated | other
    jurisdiction: v.string(),
    legislation: v.string(),
    regNumber: v.optional(v.string()),
    startISO: v.string(),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"]),

  // Per-year / per-jurisdiction annual-filing ledger (YCN REG_FILING).
  // Logic: shared/annualFilings.ts.
  annualFilingLedger: defineTable({
    societyId: v.id("societies"),
    jurisdiction: v.string(),
    year: v.string(),
    filed: v.boolean(),
    filedOn: v.optional(v.string()),
    regnNature: v.optional(v.string()),
    regnLegislation: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_jurisdiction", ["societyId", "jurisdiction"]),

  // Per-entity signer roster (YCN ENT_PEOPLE: GLOB_ID link, SIGN_ORDER, validity, CORP_SIGN).
  entitySigners: defineTable({
    societyId: v.id("societies"),
    directoryPersonId: v.optional(v.id("peopleDirectory")),
    name: v.string(),
    signOrder: v.optional(v.number()),
    validFromISO: v.optional(v.string()),
    validToISO: v.optional(v.string()),
    corpSign: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"]),
};

/** Registers specific to the CORPORATION track (no society analog). */
export const corporationRegisterTables = {
  // Dividend declarations. Logic: shared/dividends.ts.
  dividends: defineTable({
    societyId: v.id("societies"),
    declaredOn: v.string(),
    shareClass: v.string(),
    perShareCents: v.number(),
    sharesOutstanding: v.number(),
    currency: v.string(),
    totalCents: v.number(),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_class", ["societyId", "shareClass"]),

  // Diligence sub-register: steps taken to confirm a significant individual.
  // Logic: shared/significantIndividuals.ts (reviewsDue).
  significantIndividualSteps: defineTable({
    societyId: v.id("societies"),
    individualName: v.string(),
    roleHolderId: v.optional(v.id("roleHolders")),
    stepsNarrative: v.string(),
    stepDate: v.string(),
    nextReviewDate: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_review", ["societyId", "nextReviewDate"]),

  // Physical share-certificate register (YCN SHARE_TRANS SHR_CERT/SHR_CERT_REPL).
  // Logic: shared/shareCertificates.ts.
  shareCertificates: defineTable({
    societyId: v.id("societies"),
    certificateNumber: v.string(),
    holderName: v.string(),
    shareClass: v.string(),
    shares: v.number(),
    issuedOn: v.string(),
    replacesCertificateNumber: v.optional(v.string()),
    cancelledOn: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_class", ["societyId", "shareClass"]),
};

/** All YCN-derived register tables (shared + corporation), for schema spread. */
export const ycnRegisterTables = {
  ...sharedRegisterTables,
  ...corporationRegisterTables,
};
