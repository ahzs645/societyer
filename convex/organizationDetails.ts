import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  overviewPortable,
  upsertAddressPortable,
  removeAddressPortable,
  upsertRegistrationPortable,
  removeRegistrationPortable,
  upsertIdentifierPortable,
  removeIdentifierPortable,
  seedFromSocietyAddressesPortable,
  backfillFromExistingRecordsPortable,
  recordIncorporationPortable,
  applyRegistryImportPortable,
} from "../shared/functions/organizationDetails";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import { registrationAttorneyStatusValidator, registrationPortalAccessValidator } from "./validators/organizationRegistration";
import { writeCorporationKeyToVault } from "./secrets";

/** Registry facts shared by `upsertRegistration` and `applyRegistryImport`. */
const registrationRegistryFactArgs = {
  registrationTime: v.optional(v.string()),
  registrationTimeZone: v.optional(v.string()),
  homeCorporationNumber: v.optional(v.string()),
  nameInHomeJurisdiction: v.optional(v.string()),
  attorneyStatus: v.optional(registrationAttorneyStatusValidator),
  attorneyNotRequiredReason: v.optional(v.string()),
  reminderEmailsSubscribed: v.optional(v.boolean()),
  publicRecordUrl: v.optional(v.string()),
  certificateDocumentId: v.optional(v.id("documents")),
  portalAccess: v.optional(v.array(registrationPortalAccessValidator)),
};

export const overview = authorizedQuery("organizationDetails:overview", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => overviewPortable(await toPortableQueryCtx(ctx), args),
});

export const seedFromSocietyAddresses = authorizedMutation("organizationDetails:seedFromSocietyAddresses", mutation)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => seedFromSocietyAddressesPortable(await toPortableMutationCtx(ctx), args),
});

export const backfillFromExistingRecords = authorizedMutation("organizationDetails:backfillFromExistingRecords", mutation)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => backfillFromExistingRecordsPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertAddress = authorizedMutation("organizationDetails:upsertAddress", mutation)({
  args: {
    id: v.optional(v.id("organizationAddresses")),
    societyId: v.id("societies"),
    type: v.string(),
    status: v.string(),
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
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertAddressPortable(await toPortableMutationCtx(ctx), args),
});

export const removeAddress = authorizedMutation("organizationDetails:removeAddress", mutation)({
  args: { id: v.id("organizationAddresses") },
  returns: v.any(),
  handler: async (ctx, args) => removeAddressPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertRegistration = authorizedMutation("organizationDetails:upsertRegistration", mutation)({
  args: {
    id: v.optional(v.id("organizationRegistrations")),
    societyId: v.id("societies"),
    corporationClass: v.optional(v.string()),
    licenceEvidenceDocumentId: v.optional(v.id("documents")),
    registrationType: v.optional(v.string()),
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
    // null removes the stored value.
    registryPortalKey: v.optional(v.union(v.string(), v.null())),
    profileReportDocumentId: v.optional(v.id("documents")),
    companyKeyVaultItemId: v.optional(v.id("secretVaultItems")),
    agentForServiceName: v.optional(v.string()),
    agentForServiceAddress: v.optional(v.string()),
    principalOfficeAddress: v.optional(v.string()),
    representativeIds: v.optional(v.array(v.string())),
    status: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    notes: v.optional(v.string()),
    ...registrationRegistryFactArgs,
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertRegistrationPortable(await toPortableMutationCtx(ctx), args),
});

export const removeRegistration = authorizedMutation("organizationDetails:removeRegistration", mutation)({
  args: { id: v.id("organizationRegistrations") },
  returns: v.any(),
  handler: async (ctx, args) => removeRegistrationPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertIdentifier = authorizedMutation("organizationDetails:upsertIdentifier", mutation)({
  args: {
    id: v.optional(v.id("organizationIdentifiers")),
    societyId: v.id("societies"),
    kind: v.string(),
    number: v.string(),
    jurisdiction: v.optional(v.string()),
    foreignJurisdiction: v.optional(v.string()),
    registeredAt: v.optional(v.string()),
    status: v.optional(v.string()),
    accessLevel: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertIdentifierPortable(await toPortableMutationCtx(ctx), args),
});

export const removeIdentifier = authorizedMutation("organizationDetails:removeIdentifier", mutation)({
  args: { id: v.id("organizationIdentifiers") },
  returns: v.any(),
  handler: async (ctx, args) => removeIdentifierPortable(await toPortableMutationCtx(ctx), args),
});


/** Turns a preparing or submitted organization into a verified incorporated one from its certificate. */
export const recordIncorporation = authorizedMutation("organizationDetails:recordIncorporation", mutation)({
  args: {
    societyId: v.id("societies"),
    incorporationNumber: v.string(),
    incorporationDate: v.string(),
    certificateEvidenceDocumentId: v.id("documents"),
    certificateReference: v.optional(v.string()),
    actFormedUnder: v.optional(v.string()),
    registeredOfficeEffectiveFrom: v.optional(v.string()),
    makeRegisteredOfficeCurrent: v.optional(v.boolean()),
  },
  returns: v.object({
    registeredOfficeUpdated: v.boolean(),
    homeRegistrationId: v.union(v.id("organizationRegistrations"), v.null()),
  }),
  handler: async (ctx, args) => recordIncorporationPortable(await toPortableMutationCtx(ctx), args),
});

/**
 * Applies a reviewed registry-document proposal in one transaction. A
 * corporation key is encrypted into the vault here; it never reaches a field,
 * an identifier row, a log or activity text.
 */
export const applyRegistryImport = authorizedMutation("organizationDetails:applyRegistryImport", mutation)({
  args: {
    societyId: v.id("societies"),
    profile: v.optional(v.object({
      name: v.optional(v.string()),
      incorporationNumber: v.optional(v.string()),
      incorporationDate: v.optional(v.string()),
      anniversaryDate: v.optional(v.string()),
      actFormedUnder: v.optional(v.string()),
      jurisdictionCode: v.optional(v.string()),
      articlesMinDirectors: v.optional(v.number()),
      articlesMaxDirectors: v.optional(v.number()),
      articlesShareTransferRestrictions: v.optional(v.string()),
      articlesBusinessRestrictions: v.optional(v.string()),
      articlesOtherProvisions: v.optional(v.string()),
      articlesSourceDocumentId: v.optional(v.id("documents")),
      craBnStatus: v.optional(v.string()),
      craRcStatus: v.optional(v.string()),
      officialEmail: v.optional(v.string()),
    })),
    registrations: v.optional(v.array(v.object({
      id: v.optional(v.id("organizationRegistrations")),
      registrationType: v.string(),
      jurisdiction: v.string(),
      homeJurisdiction: v.optional(v.string()),
      registrationNumber: v.optional(v.string()),
      registrationDate: v.optional(v.string()),
      sourceDocumentIds: v.optional(v.array(v.id("documents"))),
      status: v.optional(v.string()),
      ...registrationRegistryFactArgs,
    }))),
    addresses: v.optional(v.array(v.object({
      type: v.string(),
      status: v.string(),
      street: v.string(),
      unit: v.optional(v.string()),
      city: v.string(),
      provinceState: v.optional(v.string()),
      postalCode: v.optional(v.string()),
      country: v.string(),
      effectiveFrom: v.optional(v.string()),
      sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    }))),
    identifiers: v.optional(v.array(v.object({
      id: v.optional(v.id("organizationIdentifiers")),
      kind: v.string(),
      number: v.string(),
      jurisdiction: v.optional(v.string()),
      registeredAt: v.optional(v.string()),
      status: v.string(),
      accessLevel: v.string(),
      sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    }))),
    corporationKey: v.optional(v.object({
      value: v.string(),
      label: v.string(),
      sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    })),
  },
  returns: v.any(),
  handler: async (ctx, args) => applyRegistryImportPortable(await toPortableMutationCtx(ctx), args, {
    corporationKeyVault: (input) => writeCorporationKeyToVault(ctx, input),
  }),
});
