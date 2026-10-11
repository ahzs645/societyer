// @ts-nocheck
import { normalizeAddressText } from "../shared/structuredAddress";
import { readOnboardingAnswersJson, validateInitialOrganizationProfile } from "../shared/onboarding";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { entitySetupFields, validateEntitySetup, validateFormationEvidence, certificateAnniversaryDate } from "../shared/entitySetup";
import { validateWorkspaceLegalIdentity, validateWorkspaceLegalIdentityUpdate } from "../shared/organizationDomain";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { integrationSettingsValidator } from "./lib/integrationSettings";
import { disabledModulesValidator } from "./lib/moduleSettings";
import { assertAllowedOption } from "./lib/orgHubOptions";
import { seedSociety } from "./seedRecordTableMetadata";
import { seedDocumentPacketsForEntityHelper } from "./legalOperations";
import {
  DEFAULT_HOME_JURISDICTION_CODE,
  workspaceOnboardingWorkflowConfig,
  buildWorkspaceOnboardingNodes,
  buildWorkspaceOnboardingTasks,
} from "../shared/jurisdictionWorkspace";
import {
  setLogoInvertInDarkModePortable,
  updateModulesPortable,
  cloneSocietyPortable,
  updateComplianceSettingsPortable,
  updateInventorySettingsPortable,
  updateNotificationSettingsPortable,
  updateIntegrationSettingsPortable,
  getPortable,
  listPortable,
  getByIdPortable,
  setLogoPortable,
  clearLogoPortable,
  setDarkLogoPortable,
  clearDarkLogoPortable,
  setLetterheadPortable,
  clearLetterheadPortable,
  seedNewSocietyOwnerPortable,
  assertWorkspaceCreator,
} from "../shared/functions/society";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import { createWorkspacePortable } from "../shared/functions/societyCreate";
import { buildConvexCapabilities } from "./providers/capabilities";
import { getOwned, requireAuthenticated, requireSocietyMembership } from "../shared/functions/access";
import { PORTABLE_ACCESS_ENFORCEMENT } from "../shared/portable/define";

export const get = authorizedQuery("society:get", query)({
  args: {},
  returns: v.any(),
  handler: async (ctx) => getPortable(await toPortableQueryCtx(ctx, buildConvexCapabilities(ctx)), {}),
});

export const list = authorizedQuery("society:list", query)({
  args: {},
  returns: v.any(),
  handler: async (ctx) => listPortable(await toPortableQueryCtx(ctx, buildConvexCapabilities(ctx))),
});

export const getById = authorizedQuery("society:getById", query)({
  args: { id: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => getByIdPortable(await toPortableQueryCtx(ctx, buildConvexCapabilities(ctx)), args),
});

const withStorageCaps = async (ctx) => await toPortableMutationCtx(ctx, buildConvexCapabilities(ctx));

export const setLogo = authorizedMutation("society:setLogo", mutation)({
  args: { societyId: v.id("societies"), storageId: v.id("_storage") },
  returns: v.id("societies"),
  handler: async (ctx, args) => setLogoPortable(await withStorageCaps(ctx), args),
});

export const clearLogo = authorizedMutation("society:clearLogo", mutation)({
  args: { societyId: v.id("societies") },
  returns: v.id("societies"),
  handler: async (ctx, args) => clearLogoPortable(await withStorageCaps(ctx), args),
});

export const setDarkLogo = authorizedMutation("society:setDarkLogo", mutation)({
  args: { societyId: v.id("societies"), storageId: v.id("_storage") },
  returns: v.id("societies"),
  handler: async (ctx, args) => setDarkLogoPortable(await withStorageCaps(ctx), args),
});

export const clearDarkLogo = authorizedMutation("society:clearDarkLogo", mutation)({
  args: { societyId: v.id("societies") },
  returns: v.id("societies"),
  handler: async (ctx, args) => clearDarkLogoPortable(await withStorageCaps(ctx), args),
});

export const setLetterhead = authorizedMutation("society:setLetterhead", mutation)({
  args: { societyId: v.id("societies"), storageId: v.id("_storage") },
  returns: v.id("societies"),
  handler: async (ctx, args) => setLetterheadPortable(await withStorageCaps(ctx), args),
});

export const clearLetterhead = authorizedMutation("society:clearLetterhead", mutation)({
  args: { societyId: v.id("societies") },
  returns: v.id("societies"),
  handler: async (ctx, args) => clearLetterheadPortable(await withStorageCaps(ctx), args),
});

export const setLogoInvertInDarkMode = authorizedMutation("society:setLogoInvertInDarkMode", mutation)({
  args: {
    societyId: v.id("societies"),
    invert: v.boolean(),
  },
  returns: v.id("societies"),
  handler: async (ctx, args) => setLogoInvertInDarkModePortable(await toPortableMutationCtx(ctx), args),
});

export const upsert = authorizedMutation("society:upsert", mutation)({
  args: {
    id: v.optional(v.id("societies")),
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
    legalSubtype: v.optional(v.string()),
    formationStatus: v.optional(v.string()),
    certificateEvidenceDocumentId: v.optional(v.id("documents")),
    certificateReference: v.optional(v.string()),
    certificateDate: v.optional(v.string()),
    craBnStatus: v.optional(v.string()),
    craRcStatus: v.optional(v.string()),
    gstHstStatus: v.optional(v.string()),
    payrollStatus: v.optional(v.string()),
    charityStatus: v.optional(v.string()),
    taxStatusEvidence: v.optional(v.string()),
    annualReferenceDate: v.optional(v.string()),
    annualMeetingDate: v.optional(v.string()),
    agmExtensionDate: v.optional(v.string()),
    agmExtensionEvidence: v.optional(v.string()),
    iscAwarenessDate: v.optional(v.string()),
    iscRegisterEntryDate: v.optional(v.string()),
    transparencyAwarenessDate: v.optional(v.string()),
    transparencyEntryDate: v.optional(v.string()),
    transparencyCessationEntryDate: v.optional(v.string()),
    annualMeetingYear: v.optional(v.number()),
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
    privacyOfficerName: v.optional(v.string()),
    privacyOfficerEmail: v.optional(v.string()),
    privacyProgramStatus: v.optional(v.string()),
    privacyProgramReviewedAtISO: v.optional(v.string()),
    privacyProgramNotes: v.optional(v.string()),
    memberDataAccessStatus: v.optional(v.string()),
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
    publicIntakePrivacyNotice: v.optional(v.string()),
    publicTransparencyEnabled: v.optional(v.boolean()),
    publicShowBoard: v.optional(v.boolean()),
    publicShowBylaws: v.optional(v.boolean()),
    publicShowFinancials: v.optional(v.boolean()),
    publicVolunteerIntakeEnabled: v.optional(v.boolean()),
    publicGrantIntakeEnabled: v.optional(v.boolean()),
    demoMode: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { id, ...rest } = args;
    const portable = await toPortableMutationCtx(ctx);
    if (!id && PORTABLE_ACCESS_ENFORCEMENT) requireAuthenticated(portable);
    if (id) {
      await requireSocietyMembership(portable, id);
      if (rest.primaryRegistrationId) {
        await getOwned(
          portable,
          "organizationRegistrations",
          rest.primaryRegistrationId,
          id,
        );
      }
      if (rest.corporationKeyVaultItemId) {
        await getOwned(
          portable,
          "secretVaultItems",
          rest.corporationKeyVaultItemId,
          id,
        );
      }
    }
    const previous = id ? await ctx.db.get(id) : {};
    const formation = { ...previous, ...rest };
    validateEntitySetup(formation);
    const certificate = formation.certificateEvidenceDocumentId ? await getOwned(portable, "documents", formation.certificateEvidenceDocumentId, id ?? "") : undefined;
    const certificateVersions = certificate ? await ctx.db.query("documentVersions").withIndex("by_document", (q) => q.eq("documentId", certificate._id)).collect() : [];
    validateFormationEvidence(formation, id, certificate, certificateVersions);
    validateWorkspaceLegalIdentityUpdate(id ? await ctx.db.get(id) : null, { ...rest, ...(rest.jurisdictionCode ? { homeJurisdictionCode: rest.homeJurisdictionCode ?? rest.jurisdictionCode } : {}) });
    assertAllowedOption("entityTypes", rest.entityType, "Entity type");
    assertAllowedOption("actsFormedUnder", rest.actFormedUnder, "Act formed under");
    assertAllowedOption("organizationStatuses", rest.organizationStatus, "Organization status");
    if (rest.publicSlug) {
      const existing = await ctx.db
        .query("societies")
        .withIndex("by_public_slug", (q) => q.eq("publicSlug", rest.publicSlug))
        .first();
      if (existing && (!id || String(existing._id) !== String(id))) {
        throw new Error("Public slug is already in use by another society.");
      }
    }
    const payload = {
      ...rest,
      incorporationDate: formation.formationStatus === "incorporated" ? formation.certificateDate : rest.incorporationDate,
      homeJurisdictionCode: rest.homeJurisdictionCode ?? rest.jurisdictionCode,
      anniversaryDate: certificateAnniversaryDate(previous ?? {}, formation),
      updatedAt: Date.now(),
    };
    if (id) {
      await ctx.db.patch(id, payload);
      return id;
    }
    const newId = await ctx.db.insert("societies", payload);
    if (rest.primaryRegistrationId) {
      await getOwned(
        portable,
        "organizationRegistrations",
        rest.primaryRegistrationId,
        newId,
      );
    }
    if (rest.corporationKeyVaultItemId) {
      await getOwned(
        portable,
        "secretVaultItems",
        rest.corporationKeyVaultItemId,
        newId,
      );
    }
    // Seed record-table object/field/view metadata for the new society so
    // pages that render record tables (Members, Directors, etc.) render
    // immediately instead of showing a "Metadata not seeded" empty state.
    await seedSociety(ctx, newId);
    // Seed an Owner user so the workspace has an admin actor from the start
    // (matches createWorkspace). Without this the Users page is stranded.
    const ownerEmail = rest.officialEmail || `owner@${rest.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.local`;
    await seedNewSocietyOwnerPortable(await toPortableMutationCtx(ctx), {
      societyId: newId,
      placeholderEmail: ownerEmail,
      placeholderDisplayName: rest.privacyOfficerName || "Owner",
      createdAtISO: new Date().toISOString(),
    });
    return newId;
  },
});

export const createWorkspace = authorizedMutation("society:createWorkspace", mutation)({
  args: {
    name: v.string(),
    onboardingAnswersJson: v.optional(v.string()),
    incorporationNumber: v.optional(v.string()),
    incorporationDate: v.optional(v.string()),
    fiscalYearEnd: v.optional(v.string()),
    jurisdictionCode: v.optional(v.string()),
    homeJurisdictionCode: v.optional(v.string()),
    anniversaryDate: v.optional(v.string()),
    corporationKeyVaultItemId: v.optional(v.id("secretVaultItems")),
    entityType: v.optional(v.string()),
    legalSubtype: v.optional(v.string()),
    formationStatus: v.optional(v.string()),
    certificateEvidenceDocumentId: v.optional(v.id("documents")),
    certificateReference: v.optional(v.string()),
    certificateDate: v.optional(v.string()),
    craBnStatus: v.optional(v.string()),
    craRcStatus: v.optional(v.string()),
    gstHstStatus: v.optional(v.string()),
    payrollStatus: v.optional(v.string()),
    charityStatus: v.optional(v.string()),
    taxStatusEvidence: v.optional(v.string()),
    annualReferenceDate: v.optional(v.string()),
    annualMeetingDate: v.optional(v.string()),
    agmExtensionDate: v.optional(v.string()),
    agmExtensionEvidence: v.optional(v.string()),
    iscAwarenessDate: v.optional(v.string()),
    iscRegisterEntryDate: v.optional(v.string()),
    transparencyAwarenessDate: v.optional(v.string()),
    transparencyEntryDate: v.optional(v.string()),
    transparencyCessationEntryDate: v.optional(v.string()),
    annualMeetingYear: v.optional(v.number()),
    actFormedUnder: v.optional(v.string()),
    officialEmail: v.optional(v.string()),
    numbered: v.optional(v.boolean()),
    distributing: v.optional(v.boolean()),
    solicitingPublicBenefit: v.optional(v.boolean()),
    organizationStatus: v.optional(v.string()),
    registeredOfficeAddress: v.optional(v.string()),
    mailingAddress: v.optional(v.string()),
    purposes: v.optional(v.string()),
    privacyOfficerName: v.optional(v.string()),
    privacyOfficerEmail: v.optional(v.string()),
    isCharity: v.optional(v.boolean()),
    isMemberFunded: v.optional(v.boolean()),
    actingUserId: v.optional(v.id("users")),
    continuanceDate: v.optional(v.string()),
    amalgamationDate: v.optional(v.string()),
    // Auto-seed the entity's document packet catalog on creation (default true).
    seedDocumentPackets: v.optional(v.boolean()),
  },
  returns: v.object({
    societyId: v.id("societies"),
    workflowId: v.id("workflows"),
    taskIds: v.array(v.id("tasks")),
  }),
  // One handler for hosted Convex and the local runtime (A4); record-table
  // metadata definitions live here, so the wrapper seeds them.
  handler: async (ctx, args) =>
    createWorkspacePortable(await toPortableMutationCtx(ctx), args, {
      seedRecordTableMetadata: (societyId) => seedSociety(ctx, societyId),
    }),
});

export const updateModules = authorizedMutation("society:updateModules", mutation)({
  args: {
    societyId: v.id("societies"),
    disabledModules: disabledModulesValidator,
  },
  returns: v.any(),
  handler: async (ctx, args) => updateModulesPortable(await toPortableMutationCtx(ctx), args),
});

export const cloneSociety = authorizedMutation("society:cloneSociety", mutation)({
  args: { sourceSocietyId: v.id("societies"), newName: v.string(), nowISO: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => cloneSocietyPortable(await toPortableMutationCtx(ctx), args),
});

// YCN-style compliance settings (AGM date + financials-prep waiver). Consumed by
// shared/corporationSettings.ts to derive AGM / annual-report deadlines.
export const updateComplianceSettings = authorizedMutation("society:updateComplianceSettings", mutation)({
  args: {
    societyId: v.id("societies"),
    agmMonth: v.optional(v.number()),
    agmDay: v.optional(v.number()),
    waivePrepFinancials: v.optional(v.boolean()),
    shortName: v.optional(v.string()),
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
    includeDocumentIdHeader: v.optional(v.boolean()),
  },
  returns: v.id("societies"),
  handler: async (ctx, args) => updateComplianceSettingsPortable(await toPortableMutationCtx(ctx), args),
});

export const updateInventorySettings = authorizedMutation("society:updateInventorySettings", mutation)({
  args: {
    societyId: v.id("societies"),
    consumableIntakeCountPromptEnabled: v.boolean(),
  },
  returns: v.id("societies"),
  handler: async (ctx, args) => updateInventorySettingsPortable(await toPortableMutationCtx(ctx), args),
});

export const updateNotificationSettings = authorizedMutation("society:updateNotificationSettings", mutation)({
  args: {
    societyId: v.id("societies"),
    // Days dismissed notifications are retained before purge. 0 = keep forever.
    notificationRetentionDays: v.number(),
  },
  returns: v.id("societies"),
  handler: async (ctx, args) => updateNotificationSettingsPortable(await toPortableMutationCtx(ctx), args),
});

function blankToUndefined(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

// buildWorkspaceOnboardingNodes now lives in shared/jurisdictionWorkspace so the
// local runtimes create the same workflow shape. Re-exported for existing callers.
export { buildWorkspaceOnboardingNodes };

export { buildWorkspaceOnboardingTasks };
export const updateIntegrationSettings = authorizedMutation("society:updateIntegrationSettings", mutation)({
  args: { societyId: v.id("societies"), integrationSettings: integrationSettingsValidator },
  returns: v.id("societies"),
  handler: async (ctx, args) => updateIntegrationSettingsPortable(await toPortableMutationCtx(ctx), args),
});
