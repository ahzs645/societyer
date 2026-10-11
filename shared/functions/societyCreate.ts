/**
 * PORTABLE FUNCTION: `society:createWorkspace` (A4/O-3).
 *
 * Organization setup used to run on hosted Convex from convex/society.ts and,
 * offline, from a hand-written mirror in src/lib/staticLegacyDispatch.ts
 * ("served by legacy demo fallback"). The two had drifted (owner id on the
 * onboarding workflow, activity rows, address normalization, option checks).
 * This is now the one handler for both runtimes.
 *
 * Record-table metadata is seeded by the caller (`hooks.seedRecordTableMetadata`):
 * the definitions live with the Convex schema, and the local client seeds the
 * new society itself right after this mutation.
 */

import type { PortableMutationCtx } from "../portable/ctx";
import { normalizeAddressText } from "../structuredAddress";
import { readOnboardingAnswersJson, validateInitialOrganizationProfile } from "../onboarding";
import { entitySetupFields, validateEntitySetup, validateFormationEvidence } from "../entitySetup";
import { validateWorkspaceLegalIdentity } from "../organizationDomain";
import { assertAllowedOption } from "../orgHubOptions";
import {
  DEFAULT_HOME_JURISDICTION_CODE,
  workspaceOnboardingWorkflowConfig,
  buildWorkspaceOnboardingNodes,
  buildWorkspaceOnboardingTasks,
} from "../jurisdictionWorkspace";
import { assertWorkspaceCreator, seedNewSocietyOwnerPortable } from "./society";
import { getOwned } from "./access";
import { seedDocumentPacketsForEntityPortable } from "./legalDocuments";

export type CreateWorkspaceArgs = {
  name: string;
  onboardingAnswersJson?: string;
  incorporationNumber?: string;
  incorporationDate?: string;
  fiscalYearEnd?: string;
  jurisdictionCode?: string;
  homeJurisdictionCode?: string;
  anniversaryDate?: string;
  corporationKeyVaultItemId?: string;
  entityType?: string;
  legalSubtype?: string;
  formationStatus?: string;
  actFormedUnder?: string;
  officialEmail?: string;
  numbered?: boolean;
  distributing?: boolean;
  solicitingPublicBenefit?: boolean;
  organizationStatus?: string;
  registeredOfficeAddress?: string;
  mailingAddress?: string;
  purposes?: string;
  privacyOfficerName?: string;
  privacyOfficerEmail?: string;
  isCharity?: boolean;
  isMemberFunded?: boolean;
  actingUserId?: string;
  continuanceDate?: string;
  amalgamationDate?: string;
  /** Auto-seed the entity's document packet catalog on creation (default true). */
  seedDocumentPackets?: boolean;
  [key: string]: unknown;
};

export type CreateWorkspaceHooks = {
  seedRecordTableMetadata?: (societyId: string) => Promise<void>;
};

function blankToUndefined(value?: unknown) {
  const trimmed = typeof value === "string" ? value.trim() : undefined;
  return trimmed ? trimmed : undefined;
}

export async function createWorkspacePortable(
  ctx: PortableMutationCtx,
  args: CreateWorkspaceArgs,
  hooks: CreateWorkspaceHooks = {},
): Promise<{ societyId: string; workflowId: string; taskIds: string[] }> {
  await assertWorkspaceCreator(ctx, args.actingUserId);
  readOnboardingAnswersJson(args.onboardingAnswersJson, args);
  if (args.onboardingAnswersJson) validateInitialOrganizationProfile(args);
  const name = String(args.name ?? "").trim();
  if (!name) throw new Error("Society name is required.");
  if (args.fiscalYearEnd && !/^\d{2}-\d{2}$/.test(args.fiscalYearEnd)) {
    throw new Error("Fiscal year end must use MM-DD format.");
  }
  validateEntitySetup(args);
  validateFormationEvidence(args);
  validateWorkspaceLegalIdentity({ ...args, jurisdictionCode: args.jurisdictionCode ?? args.homeJurisdictionCode ?? DEFAULT_HOME_JURISDICTION_CODE });
  assertAllowedOption("entityTypes", args.entityType, "Entity type");
  assertAllowedOption("actsFormedUnder", args.actFormedUnder, "Act formed under");
  assertAllowedOption("organizationStatuses", args.organizationStatus, "Organization status");

  const now = new Date().toISOString();
  const jurisdictionCode = args.jurisdictionCode ?? args.homeJurisdictionCode ?? DEFAULT_HOME_JURISDICTION_CODE;
  const homeJurisdictionCode = args.homeJurisdictionCode ?? jurisdictionCode;
  const anniversaryDate = blankToUndefined(args.anniversaryDate) ?? blankToUndefined(args.incorporationDate);

  const societyId = await ctx.db.insert("societies", {
    name,
    onboardingAnswersJson: args.onboardingAnswersJson,
    incorporationNumber: blankToUndefined(args.incorporationNumber),
    incorporationDate: blankToUndefined(args.incorporationDate),
    fiscalYearEnd: blankToUndefined(args.fiscalYearEnd),
    jurisdictionCode,
    homeJurisdictionCode,
    anniversaryDate,
    corporationKeyVaultItemId: args.corporationKeyVaultItemId,
    continuanceDate: blankToUndefined(args.continuanceDate),
    amalgamationDate: blankToUndefined(args.amalgamationDate),
    ...entitySetupFields(args),
    formationStatus: args.formationStatus || "preparing",
    entityType: blankToUndefined(args.entityType),
    actFormedUnder: blankToUndefined(args.actFormedUnder),
    officialEmail: blankToUndefined(args.officialEmail),
    numbered: args.numbered,
    distributing: args.distributing,
    solicitingPublicBenefit: args.solicitingPublicBenefit,
    organizationStatus: args.organizationStatus ?? "active",
    registeredOfficeAddress: normalizeAddressText(args.registeredOfficeAddress),
    mailingAddress: normalizeAddressText(args.mailingAddress),
    purposes: blankToUndefined(args.purposes),
    privacyOfficerName: blankToUndefined(args.privacyOfficerName),
    privacyOfficerEmail: blankToUndefined(args.privacyOfficerEmail),
    isCharity: args.isCharity ?? false,
    isMemberFunded: args.isMemberFunded ?? false,
    updatedAt: Date.now(),
  });
  if (args.corporationKeyVaultItemId) {
    await getOwned(ctx, "secretVaultItems", args.corporationKeyVaultItemId, societyId);
  }
  const preIncorporation = args.organizationStatus === "pre_incorporation";
  const homeRegistrationId = await ctx.db.insert("organizationRegistrations", {
    societyId,
    registrationType: "home",
    jurisdiction: homeJurisdictionCode,
    homeJurisdiction: homeJurisdictionCode,
    registrationNumber: blankToUndefined(args.incorporationNumber),
    registrationDate: blankToUndefined(args.incorporationDate),
    officialEmail: blankToUndefined(args.officialEmail),
    representativeIds: [],
    status: preIncorporation ? "pending" : "active",
    notes: preIncorporation ? "Planned home jurisdiction; incorporation has not been confirmed." : "Created automatically from the workspace home jurisdiction.",
    createdAtISO: now,
    updatedAtISO: now,
  });
  await ctx.db.patch(societyId, { primaryRegistrationId: homeRegistrationId });
  await hooks.seedRecordTableMetadata?.(societyId);
  // Seed the entity's document packet catalog (corporation vs society by kind)
  // unless the caller opts out (isolation tests that assert seed counts).
  if (args.seedDocumentPackets !== false) {
    await seedDocumentPacketsForEntityPortable(ctx, societyId);
  }

  // A hosted verified creator becomes the initial Owner immediately. Local
  // trusted-workspace callers retain the placeholder behavior.
  const ownerEmail = blankToUndefined(args.officialEmail) ?? blankToUndefined(args.privacyOfficerEmail) ?? `owner@${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.local`;
  const ownerUserId = await seedNewSocietyOwnerPortable(ctx, {
    societyId,
    placeholderEmail: ownerEmail,
    placeholderDisplayName: blankToUndefined(args.privacyOfficerName) ?? "Owner",
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
    config: workspaceOnboardingWorkflowConfig(args ?? {}),
    createdByUserId: ownerUserId,
  });

  const taskIds: string[] = [];
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
    subjectId: societyId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: societyId,
    action: "created",
    summary: `Created workspace for ${name}`,
    createdAtISO: now,
  });
  await ctx.db.insert("activity", {
    societyId,
    actor: "System",
    entityType: "workflow",
    subjectId: workflowId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: workflowId,
    action: "created",
    summary: "Created workspace onboarding workflow",
    createdAtISO: now,
  });

  return { societyId, workflowId, taskIds };
}
