import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import { votingPowerPortable } from "../shared/functions/votingPower";
import { upsertRightsClassPortable } from "../shared/functions/rightsClasses";
import {
  upsertRightsholdingTransferPortable,
  removeRightsholdingTransferPortable,
  removeRightsClassPortable,
} from "../shared/functions/rightsholdingTransfers";
import {
  listRoleHoldersPortable,
  upsertRoleHolderPortable,
  removeRoleHolderPortable,
  rightsLedgerPortable,
} from "../shared/functions/roleHolders";
import {
  upsertLegalTemplatePortable,
  removeLegalTemplatePortable,
  upsertLegalPrecedentPortable,
  removeLegalPrecedentPortable,
  upsertLegalPrecedentRunPortable,
  removeLegalPrecedentRunPortable,
  upsertGeneratedLegalDocumentPortable,
  removeGeneratedLegalDocumentPortable,
  upsertLegalSignerPortable,
  removeLegalSignerPortable,
  formationMaintenancePortable,
  upsertFormationRecordPortable,
  removeFormationRecordPortable,
  upsertNameSearchItemPortable,
  removeNameSearchItemPortable,
  upsertEntityAmendmentPortable,
  removeEntityAmendmentPortable,
  upsertAnnualMaintenanceRecordPortable,
  removeAnnualMaintenanceRecordPortable,
  upsertJurisdictionMetadataPortable,
  removeJurisdictionMetadataPortable,
  upsertSupportLogPortable,
  removeSupportLogPortable,
} from "../shared/functions/legalRecords";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import {
  templateEnginePortable,
  seedStarterPolicyTemplatesPortable,
  seedCorporationDocumentPacketsPortable,
  seedSocietyDocumentPacketsPortable,
  generatePacketForSocietyPortable,
  generateDocumentFromCatalogPortable,
  seedDocumentPacketsForEntityPortable,
  stageCorporationDocumentPacketPortable,
  stageShareIssuancePacketPortable,
  stageShareSplitPacketPortable,
  upsertTemplateDataFieldPortable,
  removeTemplateDataFieldPortable,
} from "../shared/functions/legalDocuments";

export const listRoleHolders = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listRoleHoldersPortable(await toPortableQueryCtx(ctx), args),
});

export const upsertRoleHolder = mutation({
  args: {
    id: v.optional(v.id("roleHolders")),
    societyId: v.id("societies"),
    roleType: v.string(),
    status: v.optional(v.string()),
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
    citizenshipCountries: v.optional(v.array(v.string())),
    taxResidenceCountries: v.optional(v.array(v.string())),
    nonNaturalPerson: v.optional(v.boolean()),
    nonNaturalPersonType: v.optional(v.string()),
    nonNaturalJurisdiction: v.optional(v.string()),
    natureOfControl: v.optional(v.string()),
    authorizedRepresentative: v.optional(v.boolean()),
    relatedRoleHolderId: v.optional(v.id("roleHolders")),
    relatedShareholderIds: v.optional(v.array(v.string())),
    controllingIndividualIds: v.optional(v.array(v.string())),
    extraProvincialRegistrationId: v.optional(v.id("organizationRegistrations")),
    directoryPersonId: v.optional(v.id("peopleDirectory")),
    gender: v.optional(v.string()),
    pronouns: v.optional(v.string()),
    actorUserId: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertRoleHolderPortable(await toPortableMutationCtx(ctx), args),
});

export const removeRoleHolder = mutation({
  args: { id: v.id("roleHolders"), actorUserId: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => removeRoleHolderPortable(await toPortableMutationCtx(ctx), args),
});

export const rightsLedger = query({
  // `asOf` (YYYY-MM-DD) reconstructs the cap table at a past date: transfers are
  // truncated to that day and holdings re-derived from them, for a point-in-time
  // register. Omitted = live state from the stored holdings.
  args: { societyId: v.id("societies"), asOf: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => rightsLedgerPortable(await toPortableQueryCtx(ctx), args),
});

/**
 * Voting-power roll-up: each shareholder's total votes (shares × the class's
 * votes-per-share), partitioned into voting / non-voting, plus the eligible
 * voting-signatory set (natural persons at the age of majority). Logic in the
 * tested shared/votingPower.ts.
 */
export const votingPower = query({
  // `asOf` (YYYY-MM-DD) computes the roll-up from the cap table as it stood on a
  // past date (holdings re-derived from transfers ≤ asOf). Omitted = live state.
  args: { societyId: v.id("societies"), asOf: v.optional(v.string()) },
  returns: v.any(),
  // Portable handler: the SAME function runs unchanged on the local (Dexie)
  // runtime. The marshalling that used to be hand-copied into the static mirror
  // now lives once in shared/functions/votingPower.ts.
  // See docs/portable-functions-architecture.md.
  handler: async (ctx, { societyId, asOf }) =>
    votingPowerPortable(await toPortableQueryCtx(ctx), { societyId, asOf }),
});

export const upsertRightsClass = mutation({
  args: {
    id: v.optional(v.id("rightsClasses")),
    societyId: v.id("societies"),
    className: v.string(),
    classType: v.string(),
    status: v.optional(v.string()),
    idPrefix: v.optional(v.string()),
    highestAssignedNumber: v.optional(v.number()),
    votingRights: v.optional(v.string()),
    votesPerShare: v.optional(v.number()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    conditionsToHold: v.optional(v.string()),
    conditionsToTransfer: v.optional(v.string()),
    conditionsForRemoval: v.optional(v.string()),
    otherProvisions: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  // Portable handler: the same insert/patch runs on the local runtime and the
  // convex-test oracle. See shared/functions/rightsClasses.ts.
  handler: async (ctx, args) => upsertRightsClassPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertRightsholdingTransfer = mutation({
  args: {
    id: v.optional(v.id("rightsholdingTransfers")),
    societyId: v.id("societies"),
    transferType: v.string(),
    status: v.optional(v.string()),
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
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  // Portable handler: validate-ledger + multi-row syncRightsHoldings runs on the
  // local runtime (inside one atomic transaction) and convex-test alike.
  handler: async (ctx, args) => upsertRightsholdingTransferPortable(await toPortableMutationCtx(ctx), args),
});

export const removeRightsClass = mutation({
  args: { id: v.id("rightsClasses") },
  returns: v.any(),
  handler: async (ctx, args) => removeRightsClassPortable(await toPortableMutationCtx(ctx), args),
});

export const removeRightsholdingTransfer = mutation({
  args: { id: v.id("rightsholdingTransfers") },
  returns: v.any(),
  handler: async (ctx, args) => removeRightsholdingTransferPortable(await toPortableMutationCtx(ctx), args),
});

export const templateEngine = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => templateEnginePortable(await toPortableQueryCtx(ctx), args),
});

export const seedStarterPolicyTemplates = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => seedStarterPolicyTemplatesPortable(await toPortableMutationCtx(ctx), args),
});

export const seedCorporationDocumentPackets = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => seedCorporationDocumentPacketsPortable(await toPortableMutationCtx(ctx), args),
});

export const seedSocietyDocumentPackets = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => seedSocietyDocumentPacketsPortable(await toPortableMutationCtx(ctx), args),
});

/**
 * Generate a draft document from the catalog for ANY entity kind: resolves the
 * packet from the corporation OR society catalog by key, ensures it's seeded,
 * then produces the draft document + version + artifacts via the same
 * createPacketRunArtifacts path (which binds the grammar-aware render context).
 */
export const generateDocumentFromCatalog = mutation({
  args: {
    societyId: v.id("societies"),
    packetKey: v.string(),
    effectiveDate: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => generateDocumentFromCatalogPortable(await toPortableMutationCtx(ctx), args),
});

/**
 * Core of catalog generation, callable directly (e.g. by the firm-wide batch
 * generator in convex/firm.ts) without going through the mutation wrapper. Thin
 * Convex adapter over the portable kernel so external callers pass a raw Convex
 * ctx.
 */
export async function generatePacketForSociety(
  ctx: any,
  args: { societyId: any; packetKey: string; effectiveDate?: string },
): Promise<any> {
  return generatePacketForSocietyPortable(await toPortableMutationCtx(ctx), args);
}

/**
 * Seed the right packet catalog for an entity by its kind: corporations get the
 * corporation packets, everything else (societies) gets the society packets.
 * Idempotent — safe to call on entity creation or on demand.
 */
export const seedDocumentPacketsForEntity = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => seedDocumentPacketsForEntityPortable(await toPortableMutationCtx(ctx), societyId),
});

/**
 * Seed the correct packet catalog for an entity by kind. Plain helper so other
 * mutations (e.g. society.createWorkspace) can auto-seed on entity creation
 * without going through the mutation boundary. Thin Convex adapter over the
 * portable kernel so external callers pass a raw Convex ctx.
 */
export async function seedDocumentPacketsForEntityHelper(ctx: any, societyId: any) {
  return seedDocumentPacketsForEntityPortable(await toPortableMutationCtx(ctx), societyId);
}

export const stageCorporationDocumentPacket = mutation({
  args: {
    societyId: v.id("societies"),
    packetKey: v.optional(v.string()),
    obligationKey: v.optional(v.string()),
    obligationRuleId: v.optional(v.string()),
    obligationTitle: v.optional(v.string()),
    filingKind: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    filingId: v.optional(v.id("filings")),
    sourceRegistrationId: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => stageCorporationDocumentPacketPortable(await toPortableMutationCtx(ctx), args),
});

export const stageShareIssuancePacket = mutation({
  args: {
    societyId: v.id("societies"),
    transferId: v.id("rightsholdingTransfers"),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => stageShareIssuancePacketPortable(await toPortableMutationCtx(ctx), args),
});

export const stageShareSplitPacket = mutation({
  args: {
    societyId: v.id("societies"),
    rightsClassId: v.id("rightsClasses"),
    numerator: v.number(),
    denominator: v.number(),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => stageShareSplitPacketPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertTemplateDataField = mutation({
  args: {
    id: v.optional(v.id("legalTemplateDataFields")),
    societyId: v.optional(v.id("societies")),
    name: v.string(),
    label: v.optional(v.string()),
    fieldType: v.optional(v.string()),
    number: v.optional(v.number()),
    dynamicIndicator: v.optional(v.string()),
    required: v.optional(v.boolean()),
    reviewRequired: v.optional(v.boolean()),
    notes: v.optional(v.string()),
    sourceExternalIds: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertTemplateDataFieldPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertLegalTemplate = mutation({
  args: {
    id: v.optional(v.id("legalTemplates")),
    societyId: v.optional(v.id("societies")),
    templateType: v.string(),
    name: v.string(),
    status: v.optional(v.string()),
    templateDocumentId: v.optional(v.id("documents")),
    docxDocumentId: v.optional(v.id("documents")),
    pdfDocumentId: v.optional(v.id("documents")),
    html: v.optional(v.string()),
    notes: v.optional(v.string()),
    owner: v.optional(v.string()),
    ownerIsTobuso: v.optional(v.boolean()),
    signatureRequired: v.optional(v.boolean()),
    documentTag: v.optional(v.string()),
    entityTypes: v.optional(v.array(v.string())),
    jurisdictions: v.optional(v.array(v.string())),
    requiredSigners: v.optional(v.array(v.string())),
    requiredDataFieldIds: v.optional(v.array(v.id("legalTemplateDataFields"))),
    optionalDataFieldIds: v.optional(v.array(v.id("legalTemplateDataFields"))),
    reviewDataFieldIds: v.optional(v.array(v.id("legalTemplateDataFields"))),
    requiredDataFields: v.optional(v.array(v.string())),
    optionalDataFields: v.optional(v.array(v.string())),
    reviewDataFields: v.optional(v.array(v.string())),
    timeline: v.optional(v.string()),
    deliverable: v.optional(v.string()),
    terms: v.optional(v.string()),
    filingType: v.optional(v.string()),
    priceItems: v.optional(v.array(v.string())),
    sourceExternalIds: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertLegalTemplatePortable(await toPortableMutationCtx(ctx), args),
});

export const upsertLegalPrecedent = mutation({
  args: {
    id: v.optional(v.id("legalPrecedents")),
    societyId: v.optional(v.id("societies")),
    packageName: v.string(),
    partType: v.optional(v.string()),
    status: v.optional(v.string()),
    description: v.optional(v.string()),
    shortDescription: v.optional(v.string()),
    timeline: v.optional(v.string()),
    deliverables: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
    addOnTerms: v.optional(v.string()),
    templateIds: v.optional(v.array(v.id("legalTemplates"))),
    templateNames: v.optional(v.array(v.string())),
    templateFilingNames: v.optional(v.array(v.string())),
    templateSearchNames: v.optional(v.array(v.string())),
    templateRegistrationNames: v.optional(v.array(v.string())),
    requiresAmendmentRecord: v.optional(v.boolean()),
    requiresAnnualMaintenanceRecord: v.optional(v.boolean()),
    priceItems: v.optional(v.array(v.string())),
    entityTypes: v.optional(v.array(v.string())),
    jurisdictions: v.optional(v.array(v.string())),
    subloopPairs: v.optional(v.array(v.any())),
    sourceExternalIds: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertLegalPrecedentPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertLegalPrecedentRun = mutation({
  args: {
    id: v.optional(v.id("legalPrecedentRuns")),
    societyId: v.id("societies"),
    name: v.string(),
    status: v.optional(v.string()),
    precedentId: v.optional(v.id("legalPrecedents")),
    eventId: v.optional(v.string()),
    dateTime: v.optional(v.string()),
    dataJson: v.optional(v.string()),
    dataJsonList: v.optional(v.array(v.any())),
    dataReviewed: v.optional(v.boolean()),
    externalNotes: v.optional(v.string()),
    searchIds: v.optional(v.array(v.string())),
    registrationIds: v.optional(v.array(v.string())),
    filingIds: v.optional(v.array(v.id("filings"))),
    generatedDocumentIds: v.optional(v.array(v.id("generatedLegalDocuments"))),
    signerRoleHolderIds: v.optional(v.array(v.id("roleHolders"))),
    priceItems: v.optional(v.array(v.string())),
    abstainingDirectorIds: v.optional(v.array(v.string())),
    abstainingRightsholderIds: v.optional(v.array(v.string())),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertLegalPrecedentRunPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertGeneratedLegalDocument = mutation({
  args: {
    id: v.optional(v.id("generatedLegalDocuments")),
    societyId: v.id("societies"),
    title: v.string(),
    status: v.optional(v.string()),
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
    subloopJsonList: v.optional(v.array(v.any())),
    syngrafiiFileId: v.optional(v.string()),
    syngrafiiDocumentId: v.optional(v.string()),
    syngrafiiPackageId: v.optional(v.string()),
    signersRequiredRoleHolderIds: v.optional(v.array(v.id("roleHolders"))),
    signersWhoSignedIds: v.optional(v.array(v.id("legalSigners"))),
    signerTagsRequired: v.optional(v.array(v.string())),
    signerTagsSigned: v.optional(v.array(v.string())),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertGeneratedLegalDocumentPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertLegalSigner = mutation({
  args: {
    id: v.optional(v.id("legalSigners")),
    societyId: v.id("societies"),
    status: v.optional(v.string()),
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
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertLegalSignerPortable(await toPortableMutationCtx(ctx), args),
});

export const removeTemplateDataField = mutation({
  args: { id: v.id("legalTemplateDataFields") },
  returns: v.any(),
  handler: async (ctx, args) => removeTemplateDataFieldPortable(await toPortableMutationCtx(ctx), args),
});

export const removeLegalTemplate = mutation({
  args: { id: v.id("legalTemplates") },
  returns: v.any(),
  handler: async (ctx, args) => removeLegalTemplatePortable(await toPortableMutationCtx(ctx), args),
});

export const removeLegalPrecedent = mutation({
  args: { id: v.id("legalPrecedents") },
  returns: v.any(),
  handler: async (ctx, args) => removeLegalPrecedentPortable(await toPortableMutationCtx(ctx), args),
});

export const removeLegalPrecedentRun = mutation({
  args: { id: v.id("legalPrecedentRuns") },
  returns: v.any(),
  handler: async (ctx, args) => removeLegalPrecedentRunPortable(await toPortableMutationCtx(ctx), args),
});

export const removeGeneratedLegalDocument = mutation({
  args: { id: v.id("generatedLegalDocuments") },
  returns: v.any(),
  handler: async (ctx, args) => removeGeneratedLegalDocumentPortable(await toPortableMutationCtx(ctx), args),
});

export const removeLegalSigner = mutation({
  args: { id: v.id("legalSigners") },
  returns: v.any(),
  handler: async (ctx, args) => removeLegalSignerPortable(await toPortableMutationCtx(ctx), args),
});

export const formationMaintenance = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => formationMaintenancePortable(await toPortableQueryCtx(ctx), args),
});

export const upsertFormationRecord = mutation({
  args: {
    id: v.optional(v.id("formationRecords")),
    societyId: v.id("societies"),
    status: v.optional(v.string()),
    statusNumber: v.optional(v.number()),
    logStartDate: v.optional(v.string()),
    nuansDate: v.optional(v.string()),
    nuansNumber: v.optional(v.string()),
    relatedUserId: v.optional(v.id("users")),
    addressRental: v.optional(v.boolean()),
    stepDataInput: v.optional(v.string()),
    assignedStaffIds: v.optional(v.array(v.string())),
    signingPackageIds: v.optional(v.array(v.string())),
    articlesRestrictionOnActivities: v.optional(v.string()),
    purposeStatement: v.optional(v.string()),
    additionalProvisions: v.optional(v.string()),
    classesOfMembership: v.optional(v.string()),
    distributionOfProperty: v.optional(v.string()),
    draftDocumentIds: v.optional(v.array(v.id("documents"))),
    supportingDocumentIds: v.optional(v.array(v.id("documents"))),
    relatedIncorporationEventId: v.optional(v.string()),
    relatedOrganizingEventId: v.optional(v.string()),
    priceItems: v.optional(v.array(v.string())),
    jurisdiction: v.optional(v.string()),
    extraProvincialRegistrationJurisdiction: v.optional(v.string()),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertFormationRecordPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertNameSearchItem = mutation({
  args: {
    id: v.optional(v.id("nameSearchItems")),
    societyId: v.id("societies"),
    formationRecordId: v.optional(v.id("formationRecords")),
    name: v.string(),
    success: v.optional(v.boolean()),
    errors: v.optional(v.array(v.string())),
    reportUrl: v.optional(v.string()),
    reportDocumentId: v.optional(v.id("documents")),
    rank: v.optional(v.number()),
    expressService: v.optional(v.boolean()),
    descriptiveElement: v.optional(v.string()),
    distinctiveElement: v.optional(v.string()),
    nuansReportNumber: v.optional(v.string()),
    suffix: v.optional(v.string()),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertNameSearchItemPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertEntityAmendment = mutation({
  args: {
    id: v.optional(v.id("entityAmendments")),
    societyId: v.id("societies"),
    status: v.optional(v.string()),
    effectiveDate: v.optional(v.string()),
    entityNameNew: v.optional(v.string()),
    directorsMinimum: v.optional(v.number()),
    directorsMaximum: v.optional(v.number()),
    relatedPrecedentRunId: v.optional(v.id("legalPrecedentRuns")),
    shareClassAmendmentText: v.optional(v.string()),
    jurisdictionNew: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertEntityAmendmentPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertAnnualMaintenanceRecord = mutation({
  args: {
    id: v.optional(v.id("annualMaintenanceRecords")),
    societyId: v.id("societies"),
    status: v.optional(v.string()),
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
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertAnnualMaintenanceRecordPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertJurisdictionMetadata = mutation({
  args: {
    id: v.optional(v.id("jurisdictionMetadata")),
    jurisdiction: v.string(),
    label: v.string(),
    actFormedUnder: v.optional(v.string()),
    nuansJurisdictionNumber: v.optional(v.string()),
    nuansReservationReportTypeId: v.optional(v.string()),
    incorporationServiceEligible: v.optional(v.boolean()),
    sourceOptionId: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertJurisdictionMetadataPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertSupportLog = mutation({
  args: {
    id: v.optional(v.id("supportLogs")),
    societyId: v.optional(v.id("societies")),
    logType: v.string(),
    severity: v.optional(v.string()),
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
    sourceExternalIds: v.optional(v.array(v.string())),
    createdAtISO: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertSupportLogPortable(await toPortableMutationCtx(ctx), args),
});

export const removeFormationRecord = mutation({
  args: { id: v.id("formationRecords") },
  returns: v.any(),
  handler: async (ctx, args) => removeFormationRecordPortable(await toPortableMutationCtx(ctx), args),
});

export const removeNameSearchItem = mutation({
  args: { id: v.id("nameSearchItems") },
  returns: v.any(),
  handler: async (ctx, args) => removeNameSearchItemPortable(await toPortableMutationCtx(ctx), args),
});

export const removeEntityAmendment = mutation({
  args: { id: v.id("entityAmendments") },
  returns: v.any(),
  handler: async (ctx, args) => removeEntityAmendmentPortable(await toPortableMutationCtx(ctx), args),
});

export const removeAnnualMaintenanceRecord = mutation({
  args: { id: v.id("annualMaintenanceRecords") },
  returns: v.any(),
  handler: async (ctx, args) => removeAnnualMaintenanceRecordPortable(await toPortableMutationCtx(ctx), args),
});

export const removeJurisdictionMetadata = mutation({
  args: { id: v.id("jurisdictionMetadata") },
  returns: v.any(),
  handler: async (ctx, args) => removeJurisdictionMetadataPortable(await toPortableMutationCtx(ctx), args),
});

export const removeSupportLog = mutation({
  args: { id: v.id("supportLogs") },
  returns: v.any(),
  handler: async (ctx, args) => removeSupportLogPortable(await toPortableMutationCtx(ctx), args),
});
