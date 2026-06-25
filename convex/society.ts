// @ts-nocheck
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { disabledModulesValidator } from "./lib/moduleSettings";
import { assertAllowedOption } from "./lib/orgHubOptions";
import { seedSociety } from "./seedRecordTableMetadata";
import { seedDocumentPacketsForEntityHelper } from "./legalOperations";
import { DEFAULT_HOME_JURISDICTION_CODE, registryOnboardingCopy } from "../shared/jurisdictionWorkspace";

async function withLogoUrl(ctx, society) {
  if (!society) return society;
  const logoUrl = society.logoStorageId
    ? await ctx.storage.getUrl(society.logoStorageId)
    : undefined;
  const logoDarkUrl = society.logoDarkStorageId
    ? await ctx.storage.getUrl(society.logoDarkStorageId)
    : undefined;
  const letterheadUrl = society.letterheadStorageId
    ? await ctx.storage.getUrl(society.letterheadStorageId)
    : undefined;
  return {
    ...society,
    logoUrl: logoUrl ?? undefined,
    logoDarkUrl: logoDarkUrl ?? undefined,
    letterheadUrl: letterheadUrl ?? undefined,
  };
}

export const get = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const all = await ctx.db.query("societies").collect();
    return withLogoUrl(ctx, all[0] ?? null);
  },
});

export const list = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const all = await ctx.db.query("societies").collect();
    return Promise.all(all.map((society) => withLogoUrl(ctx, society)));
  },
});

export const getById = query({
  args: { id: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { id }) => withLogoUrl(ctx, await ctx.db.get(id)),
});

export const setLogo = mutation({
  args: {
    societyId: v.id("societies"),
    storageId: v.id("_storage"),
  },
  returns: v.id("societies"),
  handler: async (ctx, { societyId, storageId }) => {
    const society = await ctx.db.get(societyId);
    if (!society) throw new Error("Society not found.");
    if (society.logoStorageId && society.logoStorageId !== storageId) {
      try {
        await ctx.storage.delete(society.logoStorageId);
      } catch {
        // Old blob may have already been removed; not fatal.
      }
    }
    await ctx.db.patch(societyId, { logoStorageId: storageId, updatedAt: Date.now() });
    return societyId;
  },
});

export const clearLogo = mutation({
  args: { societyId: v.id("societies") },
  returns: v.id("societies"),
  handler: async (ctx, { societyId }) => {
    const society = await ctx.db.get(societyId);
    if (!society) throw new Error("Society not found.");
    if (society.logoStorageId) {
      try {
        await ctx.storage.delete(society.logoStorageId);
      } catch {
        // Already gone — no-op.
      }
    }
    await ctx.db.patch(societyId, { logoStorageId: undefined, updatedAt: Date.now() });
    return societyId;
  },
});

export const setDarkLogo = mutation({
  args: {
    societyId: v.id("societies"),
    storageId: v.id("_storage"),
  },
  returns: v.id("societies"),
  handler: async (ctx, { societyId, storageId }) => {
    const society = await ctx.db.get(societyId);
    if (!society) throw new Error("Society not found.");
    if (society.logoDarkStorageId && society.logoDarkStorageId !== storageId) {
      try {
        await ctx.storage.delete(society.logoDarkStorageId);
      } catch {
        // Already gone — no-op.
      }
    }
    await ctx.db.patch(societyId, { logoDarkStorageId: storageId, updatedAt: Date.now() });
    return societyId;
  },
});

export const clearDarkLogo = mutation({
  args: { societyId: v.id("societies") },
  returns: v.id("societies"),
  handler: async (ctx, { societyId }) => {
    const society = await ctx.db.get(societyId);
    if (!society) throw new Error("Society not found.");
    if (society.logoDarkStorageId) {
      try {
        await ctx.storage.delete(society.logoDarkStorageId);
      } catch {
        // Already gone — no-op.
      }
    }
    await ctx.db.patch(societyId, { logoDarkStorageId: undefined, updatedAt: Date.now() });
    return societyId;
  },
});

export const setLetterhead = mutation({
  args: {
    societyId: v.id("societies"),
    storageId: v.id("_storage"),
  },
  returns: v.id("societies"),
  handler: async (ctx, { societyId, storageId }) => {
    const society = await ctx.db.get(societyId);
    if (!society) throw new Error("Society not found.");
    if (society.letterheadStorageId && society.letterheadStorageId !== storageId) {
      try {
        await ctx.storage.delete(society.letterheadStorageId);
      } catch {
        // Already gone — no-op.
      }
    }
    await ctx.db.patch(societyId, { letterheadStorageId: storageId, updatedAt: Date.now() });
    return societyId;
  },
});

export const clearLetterhead = mutation({
  args: { societyId: v.id("societies") },
  returns: v.id("societies"),
  handler: async (ctx, { societyId }) => {
    const society = await ctx.db.get(societyId);
    if (!society) throw new Error("Society not found.");
    if (society.letterheadStorageId) {
      try {
        await ctx.storage.delete(society.letterheadStorageId);
      } catch {
        // Already gone — no-op.
      }
    }
    await ctx.db.patch(societyId, { letterheadStorageId: undefined, updatedAt: Date.now() });
    return societyId;
  },
});

export const setLogoInvertInDarkMode = mutation({
  args: {
    societyId: v.id("societies"),
    invert: v.boolean(),
  },
  returns: v.id("societies"),
  handler: async (ctx, { societyId, invert }) => {
    const society = await ctx.db.get(societyId);
    if (!society) throw new Error("Society not found.");
    await ctx.db.patch(societyId, {
      logoInvertInDarkMode: invert,
      updatedAt: Date.now(),
    });
    return societyId;
  },
});

export const upsert = mutation({
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
      homeJurisdictionCode: rest.homeJurisdictionCode ?? rest.jurisdictionCode,
      anniversaryDate: rest.anniversaryDate ?? rest.incorporationDate,
      updatedAt: Date.now(),
    };
    if (id) {
      await ctx.db.patch(id, payload);
      return id;
    }
    const newId = await ctx.db.insert("societies", payload);
    // Seed record-table object/field/view metadata for the new society so
    // pages that render record tables (Members, Directors, etc.) render
    // immediately instead of showing a "Metadata not seeded" empty state.
    await seedSociety(ctx, newId);
    // Seed an Owner user so the workspace has an admin actor from the start
    // (matches createWorkspace). Without this the Users page is stranded.
    const ownerEmail = rest.officialEmail || `owner@${rest.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.local`;
    await ctx.db.insert("users", {
      societyId: newId,
      email: ownerEmail,
      displayName: rest.privacyOfficerName || "Owner",
      role: "Owner",
      status: "Active",
      createdAtISO: new Date().toISOString(),
    });
    return newId;
  },
});

export const createWorkspace = mutation({
  args: {
    name: v.string(),
    incorporationNumber: v.optional(v.string()),
    incorporationDate: v.optional(v.string()),
    fiscalYearEnd: v.optional(v.string()),
    jurisdictionCode: v.optional(v.string()),
    homeJurisdictionCode: v.optional(v.string()),
    anniversaryDate: v.optional(v.string()),
    corporationKeyVaultItemId: v.optional(v.id("secretVaultItems")),
    entityType: v.optional(v.string()),
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
    // Auto-seed the entity's document packet catalog on creation (default true).
    seedDocumentPackets: v.optional(v.boolean()),
  },
  returns: v.object({
    societyId: v.id("societies"),
    workflowId: v.id("workflows"),
    taskIds: v.array(v.id("tasks")),
  }),
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) throw new Error("Society name is required.");
    if (args.fiscalYearEnd && !/^\d{2}-\d{2}$/.test(args.fiscalYearEnd)) {
      throw new Error("Fiscal year end must use MM-DD format.");
    }
    assertAllowedOption("entityTypes", args.entityType, "Entity type");
    assertAllowedOption("actsFormedUnder", args.actFormedUnder, "Act formed under");
    assertAllowedOption("organizationStatuses", args.organizationStatus, "Organization status");

    const now = new Date().toISOString();
    const jurisdictionCode = args.jurisdictionCode ?? DEFAULT_HOME_JURISDICTION_CODE;
    const homeJurisdictionCode = args.homeJurisdictionCode ?? jurisdictionCode;
    const anniversaryDate = blankToUndefined(args.anniversaryDate) ?? blankToUndefined(args.incorporationDate);

    const societyId = await ctx.db.insert("societies", {
      name,
      incorporationNumber: blankToUndefined(args.incorporationNumber),
      incorporationDate: blankToUndefined(args.incorporationDate),
      fiscalYearEnd: blankToUndefined(args.fiscalYearEnd),
      jurisdictionCode,
      homeJurisdictionCode,
      anniversaryDate,
      corporationKeyVaultItemId: args.corporationKeyVaultItemId,
      entityType: blankToUndefined(args.entityType),
      actFormedUnder: blankToUndefined(args.actFormedUnder),
      officialEmail: blankToUndefined(args.officialEmail),
      numbered: args.numbered,
      distributing: args.distributing,
      solicitingPublicBenefit: args.solicitingPublicBenefit,
      organizationStatus: args.organizationStatus ?? "active",
      registeredOfficeAddress: blankToUndefined(args.registeredOfficeAddress),
      mailingAddress: blankToUndefined(args.mailingAddress),
      purposes: blankToUndefined(args.purposes),
      privacyOfficerName: blankToUndefined(args.privacyOfficerName),
      privacyOfficerEmail: blankToUndefined(args.privacyOfficerEmail),
      isCharity: args.isCharity ?? false,
      isMemberFunded: args.isMemberFunded ?? false,
      updatedAt: Date.now(),
    });
    const homeRegistrationId = await ctx.db.insert("organizationRegistrations", {
      societyId,
      registrationType: "home",
      jurisdiction: homeJurisdictionCode,
      homeJurisdiction: homeJurisdictionCode,
      registrationNumber: blankToUndefined(args.incorporationNumber),
      registrationDate: blankToUndefined(args.incorporationDate),
      officialEmail: blankToUndefined(args.officialEmail),
      representativeIds: [],
      status: "active",
      notes: "Created automatically from the workspace home jurisdiction.",
      createdAtISO: now,
      updatedAtISO: now,
    });
    await ctx.db.patch(societyId, { primaryRegistrationId: homeRegistrationId });
    await seedSociety(ctx, societyId);
    // Seed the entity's document packet catalog (corporation vs society by kind)
    // unless the caller opts out (isolation tests that assert seed counts).
    if (args.seedDocumentPackets !== false) {
      await seedDocumentPacketsForEntityHelper(ctx, societyId);
    }

    // Seed an Owner user so the new workspace has an admin actor from the
    // start. Without this the Users page is stranded: no admin → can't create
    // an admin. The Owner is a placeholder; the operator can rename or replace
    // it via Users & roles.
    const ownerEmail = blankToUndefined(args.officialEmail) ?? blankToUndefined(args.privacyOfficerEmail) ?? `owner@${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.local`;
    await ctx.db.insert("users", {
      societyId,
      email: ownerEmail,
      displayName: blankToUndefined(args.privacyOfficerName) ?? "Owner",
      role: "Owner",
      status: "Active",
      createdAtISO: now,
    });

    const workflowId = await ctx.db.insert("workflows", {
      societyId,
      recipe: "workspace_onboarding",
      name: "Workspace onboarding",
      status: "active",
      provider: "internal",
      nodePreview: buildWorkspaceOnboardingNodes(args),
      trigger: { kind: "manual" },
      config: {
        source: "createWorkspace",
        requiredProfileFields: [
          "name",
          "incorporationNumber",
          "incorporationDate",
          "fiscalYearEnd",
          "registeredOfficeAddress",
          "mailingAddress",
          "privacyOfficerName",
          "privacyOfficerEmail",
        ],
        optionalSections: [
          "registry_verification",
          "annual_calendar",
          "member_register",
          "finance_controls",
          "privacy_records_program",
          "insurance_risk",
          "integrations",
          "board_adoption_packet",
        ],
      },
      createdByUserId: args.actingUserId,
    });

    const taskIds = [];
    for (const task of buildWorkspaceOnboardingTasks(args)) {
      taskIds.push(await ctx.db.insert("tasks", {
        societyId,
        workflowId,
        ...task,
        status: "Todo",
        priority: task.priority,
        tags: ["workspace-onboarding", ...task.tags],
        createdAtISO: now,
      }));
    }

    await ctx.db.insert("activity", {
      societyId,
      actor: "You",
      entityType: "society",
      entityId: societyId,
      action: "created",
      summary: `Created workspace for ${name}`,
      createdAtISO: now,
    });
    await ctx.db.insert("activity", {
      societyId,
      actor: "System",
      entityType: "workflow",
      entityId: workflowId,
      action: "created",
      summary: "Created workspace onboarding workflow",
      createdAtISO: now,
    });

    return { societyId, workflowId, taskIds };
  },
});

export const updateModules = mutation({
  args: {
    societyId: v.id("societies"),
    disabledModules: disabledModulesValidator,
  },
  returns: v.any(),
  handler: async (ctx, { societyId, disabledModules }) => {
    await ctx.db.patch(societyId, {
      disabledModules,
      updatedAt: Date.now(),
    });
    return societyId;
  },
});

// Deep-clone a society's records into a new society (YCN Copy_Entity_*): copies
// the society row + every child register that carries entity-scoped history
// under a fresh societyId. Includes the equity ledger (holdings + transfers),
// dividends, assets (+ events), and the transparency diligence steps — without
// these a clone silently loses the share/dividend/asset/SI history.
const CLONE_CHILD_TABLES = [
  "roleHolders",
  "organizationAddresses",
  "organizationRegistrations",
  "rightsClasses",
  "rightsHoldings",
  "rightsholdingTransfers",
  "dividends",
  "assets",
  "assetEvents",
  "significantIndividualSteps",
  "serviceProviders",
  "societyNameHistory",
  "constatingEvents",
  "shareCertificates",
  "annualFilingLedger",
  "entitySigners",
] as const;

/**
 * Remap a single field value through the old→new Id map. Cloned rows reference
 * each other by Convex Id (e.g. rightsHoldings.rightsClassId → rightsClasses);
 * a flat copy would leave those references pointing at the SOURCE society. We
 * remap any value (scalar or array element) that is an Id of a row we cloned;
 * cross-tenant Ids we did NOT clone (e.g. directoryPersonId → peopleDirectory,
 * sourceDocumentIds → documents) are absent from the map and pass through.
 */
function remapValue(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === "string") {
    return idMap.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? idMap.get(item) ?? item : item));
  }
  return value;
}

export const cloneSociety = mutation({
  args: { sourceSocietyId: v.id("societies"), newName: v.string(), nowISO: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const name = args.newName.trim();
    if (!name) throw new Error("New society name is required.");
    const source = await ctx.db.get(args.sourceSocietyId);
    if (!source) throw new Error("Source society not found.");

    const { _id, _creationTime, ...sourceFields } = source as Record<string, unknown>;
    void _id;
    void _creationTime;
    const newSocietyId = await ctx.db.insert("societies", {
      ...(sourceFields as any),
      name,
      incorporationNumber: undefined, // a clone is a distinct legal entity
      updatedAt: Date.now(),
    });

    // Pass 1: insert every child row under the new society, recording the
    // old→new Id mapping. Cross-references are not yet rewritten.
    const idMap = new Map<string, string>();
    const inserted: Array<{ table: (typeof CLONE_CHILD_TABLES)[number]; newId: string }> = [];
    for (const table of CLONE_CHILD_TABLES) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_society", (q: any) => q.eq("societyId", args.sourceSocietyId))
        .collect();
      for (const row of rows) {
        const { _id: rid, _creationTime: rct, ...fields } = row as Record<string, unknown>;
        void rct;
        const newId = await ctx.db.insert(table, { ...(fields as any), societyId: newSocietyId });
        idMap.set(String(rid), newId as unknown as string);
        inserted.push({ table, newId: newId as unknown as string });
      }
    }

    // Pass 2: rewrite intra-clone Id references now that the full map exists, so
    // cloned holdings/transfers/asset-events point at the cloned rows, not the
    // source society's. Only patch rows that actually carry a remapped value.
    for (const { newId } of inserted) {
      const row = (await ctx.db.get(newId as any)) as Record<string, unknown> | null;
      if (!row) continue;
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (key === "_id" || key === "_creationTime" || key === "societyId") continue;
        const remapped = remapValue(value, idMap);
        if (remapped !== value) patch[key] = remapped;
      }
      if (Object.keys(patch).length > 0) await ctx.db.patch(newId as any, patch);
    }

    return { societyId: newSocietyId, copiedRows: inserted.length };
  },
});

// YCN-style compliance settings (AGM date + financials-prep waiver). Consumed by
// shared/corporationSettings.ts to derive AGM / annual-report deadlines.
export const updateComplianceSettings = mutation({
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
  handler: async (ctx, { societyId, ...settings }) => {
    await ctx.db.patch(societyId, { ...settings, updatedAt: Date.now() });
    return societyId;
  },
});

export const updateInventorySettings = mutation({
  args: {
    societyId: v.id("societies"),
    consumableIntakeCountPromptEnabled: v.boolean(),
  },
  returns: v.id("societies"),
  handler: async (ctx, { societyId, consumableIntakeCountPromptEnabled }) => {
    await ctx.db.patch(societyId, {
      consumableIntakeCountPromptEnabled,
      updatedAt: Date.now(),
    });
    return societyId;
  },
});

export const updateNotificationSettings = mutation({
  args: {
    societyId: v.id("societies"),
    // Days dismissed notifications are retained before purge. 0 = keep forever.
    notificationRetentionDays: v.number(),
  },
  returns: v.id("societies"),
  handler: async (ctx, { societyId, notificationRetentionDays }) => {
    await ctx.db.patch(societyId, {
      notificationRetentionDays: Math.max(0, Math.round(notificationRetentionDays)),
      updatedAt: Date.now(),
    });
    return societyId;
  },
});

function blankToUndefined(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildWorkspaceOnboardingNodes(args: any = {}) {
  const registry = registryOnboardingCopy(args?.jurisdictionCode ?? DEFAULT_HOME_JURISDICTION_CODE);
  return [
    {
      key: "profile",
      type: "form",
      label: "Organization profile",
      description: "Legal name, incorporation number/date, fiscal year end, jurisdiction, governing act, key status flags, and official email.",
      status: "ready",
    },
    {
      key: "registry_optional",
      type: "form",
      label: registry.label,
      description: registry.nodeDescription,
      status: "draft",
    },
    {
      key: "locations",
      type: "form",
      label: "Registered locations",
      description: "Registered office, mailing address, and records location only when records are kept somewhere else.",
      status: "ready",
    },
    {
      key: "documents",
      type: "document_create",
      label: "Governance documents",
      description: "Start with constitution, bylaws, certificate or registry summary, statement of directors/registered office, and latest annual report if available.",
      status: "ready",
    },
    {
      key: "people",
      type: "form",
      label: "People",
      description: "Add directors, known officers, privacy officer, workspace users, and signing authorities if known.",
      status: "ready",
    },
    {
      key: "optional_setup",
      type: "manual_trigger",
      label: "Optional setup",
      description: "Skip or choose later: annual calendar, member register, finance controls, privacy program, insurance/risk, integrations, and board adoption packet.",
      status: "draft",
    },
  ];
}

export function buildWorkspaceOnboardingTasks(args: any) {
  const missingIdentity = [
    !args.incorporationNumber ? "incorporation number" : null,
    !args.incorporationDate ? "incorporation date" : null,
    !args.fiscalYearEnd ? "fiscal year end" : null,
  ].filter(Boolean);
  const registry = registryOnboardingCopy(args?.jurisdictionCode ?? DEFAULT_HOME_JURISDICTION_CODE);
  return [
    {
      title: registry.taskTitle,
      description: `${registry.taskDescription}${missingIdentity.length ? ` Missing profile fields now: ${missingIdentity.join(", ")}.` : ""}`,
      priority: missingIdentity.length ? "High" : "Medium",
      tags: ["optional", "registry"],
    },
    {
      title: "Set registered locations",
      description: "Record registered office delivery and mailing addresses. Add a records location only if records are kept somewhere other than the registered office.",
      priority: args.registeredOfficeAddress ? "Medium" : "High",
      tags: ["addresses", "records"],
    },
    {
      title: "Add governance documents",
      description: "Start with constitution, bylaws, certificate or registry summary, statement of directors/registered office, and latest annual report if available. Other documents can come later.",
      priority: "High",
      tags: ["documents", "governance"],
    },
    {
      title: "Add people and workspace access",
      description: "Add directors, known officers, the privacy officer, and workspace users. Signing authorities and members can be added now if known.",
      priority: "High",
      tags: ["people", "access"],
    },
    {
      title: "Optional: finish advanced setup later",
      description: "Choose only what matters: annual calendar, member register, finance controls, privacy and records program, insurance/risk, integrations, or a board adoption packet.",
      priority: "Low",
      tags: ["optional", "advanced-setup"],
    },
  ];
}
