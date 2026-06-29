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
} from "../shared/functions/organizationDetails";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const overview = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => overviewPortable(toPortableQueryCtx(ctx), args),
});

export const seedFromSocietyAddresses = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => seedFromSocietyAddressesPortable(toPortableMutationCtx(ctx), args),
});

export const backfillFromExistingRecords = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => backfillFromExistingRecordsPortable(toPortableMutationCtx(ctx), args),
});

export const upsertAddress = mutation({
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
  handler: (ctx, args) => upsertAddressPortable(toPortableMutationCtx(ctx), args),
});

export const removeAddress = mutation({
  args: { id: v.id("organizationAddresses") },
  returns: v.any(),
  handler: (ctx, args) => removeAddressPortable(toPortableMutationCtx(ctx), args),
});

export const upsertRegistration = mutation({
  args: {
    id: v.optional(v.id("organizationRegistrations")),
    societyId: v.id("societies"),
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
    registryPortalKey: v.optional(v.string()),
    profileReportDocumentId: v.optional(v.id("documents")),
    companyKeyVaultItemId: v.optional(v.id("secretVaultItems")),
    agentForServiceName: v.optional(v.string()),
    agentForServiceAddress: v.optional(v.string()),
    principalOfficeAddress: v.optional(v.string()),
    representativeIds: v.optional(v.array(v.string())),
    status: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => upsertRegistrationPortable(toPortableMutationCtx(ctx), args),
});

export const removeRegistration = mutation({
  args: { id: v.id("organizationRegistrations") },
  returns: v.any(),
  handler: (ctx, args) => removeRegistrationPortable(toPortableMutationCtx(ctx), args),
});

export const upsertIdentifier = mutation({
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
  handler: (ctx, args) => upsertIdentifierPortable(toPortableMutationCtx(ctx), args),
});

export const removeIdentifier = mutation({
  args: { id: v.id("organizationIdentifiers") },
  returns: v.any(),
  handler: (ctx, args) => removeIdentifierPortable(toPortableMutationCtx(ctx), args),
});

