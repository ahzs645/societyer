// @ts-nocheck
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { disabledModulesValidator } from "./lib/moduleSettings";
import { assertAllowedOption } from "./lib/orgHubOptions";
import { seedSociety } from "./seedRecordTableMetadata";

export const get = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const all = await ctx.db.query("societies").collect();
    return all[0] ?? null;
  },
});

export const list = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => ctx.db.query("societies").collect(),
});

export const getById = query({
  args: { id: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("societies")),
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
    const payload = { ...rest, updatedAt: Date.now() };
    if (id) {
      await ctx.db.patch(id, payload);
      return id;
    }
    const newId = await ctx.db.insert("societies", payload);
    // Seed record-table object/field/view metadata for the new society so
    // pages that render record tables (Members, Directors, etc.) render
    // immediately instead of showing a "Metadata not seeded" empty state.
    await seedSociety(ctx, newId);
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
    entityType: v.optional(v.string()),
    actFormedUnder: v.optional(v.string()),
    officialEmail: v.optional(v.string()),
    organizationStatus: v.optional(v.string()),
    registeredOfficeAddress: v.optional(v.string()),
    mailingAddress: v.optional(v.string()),
    purposes: v.optional(v.string()),
    privacyOfficerName: v.optional(v.string()),
    privacyOfficerEmail: v.optional(v.string()),
    isCharity: v.optional(v.boolean()),
    isMemberFunded: v.optional(v.boolean()),
    actingUserId: v.optional(v.id("users")),
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
    const societyId = await ctx.db.insert("societies", {
      name,
      incorporationNumber: blankToUndefined(args.incorporationNumber),
      incorporationDate: blankToUndefined(args.incorporationDate),
      fiscalYearEnd: blankToUndefined(args.fiscalYearEnd),
      jurisdictionCode: args.jurisdictionCode ?? "CA-BC",
      entityType: blankToUndefined(args.entityType),
      actFormedUnder: blankToUndefined(args.actFormedUnder),
      officialEmail: blankToUndefined(args.officialEmail),
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
    await seedSociety(ctx, societyId);

    const workflowId = await ctx.db.insert("workflows", {
      societyId,
      recipe: "workspace_onboarding",
      name: "Workspace onboarding",
      status: "active",
      provider: "internal",
      nodePreview: workspaceOnboardingNodes(),
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
    for (const task of workspaceOnboardingTasks(args)) {
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

function blankToUndefined(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function workspaceOnboardingNodes() {
  return [
    {
      key: "profile",
      type: "form",
      label: "Society profile",
      description: "Legal name, incorporation number/date, fiscal year end, jurisdiction, purposes, charity/member-funded flags, and official email.",
      status: "ready",
    },
    {
      key: "registry_optional",
      type: "form",
      label: "Registry verification",
      description: "Optional check for registry status, last annual report, filing history, key custody, authorized filers, and BC Registry connector setup.",
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

function workspaceOnboardingTasks(args: any) {
  const missingIdentity = [
    !args.incorporationNumber ? "incorporation number" : null,
    !args.incorporationDate ? "incorporation date" : null,
    !args.fiscalYearEnd ? "fiscal year end" : null,
  ].filter(Boolean);
  return [
    {
      title: "Optional: verify BC Registry access",
      description: `Confirm registry status, last annual report, filing history, registry key custody, authorized filers, and whether to connect the BC Registry browser workspace.${missingIdentity.length ? ` Missing profile fields now: ${missingIdentity.join(", ")}.` : ""}`,
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
