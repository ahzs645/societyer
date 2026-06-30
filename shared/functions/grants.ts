/**
 * PORTABLE FUNCTIONS: the grants domain (read-side queries + summary rollup +
 * the role-gated write/workflow surface).
 *
 * Reads and writes over the `grants`, `grantApplications`, `grantTransactions`,
 * `grantReports`, and `grantEmployeeLinks` tables via `ctx.db`. Each handler
 * runs unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. Role gating goes through `requireRolePortable`, and module
 * enablement is checked with the dep-free `normalizeModuleSettings` helper.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { requireRolePortable } from "./access";
import { MODULES_BY_KEY, normalizeModuleSettings, type ModuleKey } from "../../src/lib/modules";

function isoNow() {
  return new Date().toISOString();
}

async function requireEnabledModulePortable(ctx: PortableMutationCtx, societyId: string, key: ModuleKey) {
  const society = await ctx.db.get(societyId);
  if (!society) throw new Error("Society not found.");
  if (!normalizeModuleSettings(society as any)[key]) {
    throw new Error(`${MODULES_BY_KEY[key].label} is disabled for this workspace.`);
  }
  return society;
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("grants")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function getPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  return ctx.db.get(id);
}

export async function publicOpeningsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const rows = await ctx.db
    .query("grants")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return rows.filter((grant) => grant.allowPublicApplications);
}

export async function applicationsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("grantApplications")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function transactionsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("grantTransactions")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function reportsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("grantReports")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function employeeLinksPortable(
  ctx: PortableQueryCtx,
  { societyId, grantId }: { societyId: string; grantId?: string },
) {
  if (grantId) {
    return await ctx.db
      .query("grantEmployeeLinks")
      .withIndex("by_grant", (q) => q.eq("grantId", grantId))
      .collect();
  }
  return await ctx.db
    .query("grantEmployeeLinks")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function summaryPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const [grants, reports, accounts, applications, ledger] = await Promise.all([
    ctx.db
      .query("grants")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("grantReports")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("financialAccounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("grantApplications")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("grantTransactions")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
  ]);

  const now = Date.now();
  const active = grants.filter((grant) => ["Awarded", "Active"].includes(grant.status));
  const linkedRestrictedBalance = active.reduce((sum, grant) => {
    if (!grant.linkedFinancialAccountId) return sum;
    const account = accounts.find((row) => row._id === grant.linkedFinancialAccountId);
    return sum + (account?.balanceCents ?? 0);
  }, 0);
  const spentCents = ledger
    .filter((row) => row.direction === "outflow")
    .reduce((sum, row) => sum + row.amountCents, 0);

  return {
    total: grants.length,
    pipeline: grants.filter((grant) =>
      ["Prospecting", "Drafting", "Submitted"].includes(grant.status),
    ).length,
    active: active.length,
    awardedCents: active.reduce(
      (sum, grant) => sum + (grant.amountAwardedCents ?? 0),
      0,
    ),
    linkedRestrictedBalanceCents: linkedRestrictedBalance,
    pendingApplications: applications.filter((row) =>
      ["Submitted", "Reviewing", "Shortlisted"].includes(row.status),
    ).length,
    ledgerSpendCents: spentCents,
    overdueReports: reports.filter((report) => {
      if (report.status === "Submitted") return false;
      return new Date(report.dueAtISO).getTime() < now;
    }).length,
    dueSoonReports: reports.filter((report) => {
      if (report.status === "Submitted") return false;
      const due = new Date(report.dueAtISO).getTime();
      return due >= now && due <= now + 30 * 24 * 60 * 60 * 1000;
    }).length,
  };
}

export async function upsertEmployeeLinkPortable(
  ctx: PortableMutationCtx,
  { id, societyId, grantId, employeeId, patch, actingUserId }: {
    id?: string;
    societyId: string;
    grantId: string;
    employeeId: string;
    patch?: Record<string, any>;
    actingUserId?: string;
  },
) {
  await requireRolePortable(ctx, { actingUserId, societyId, required: "Director" });
  const now = isoNow();
  if (id) {
    await ctx.db.patch(id, { ...(patch ?? {}), updatedAtISO: now });
    return id;
  }
  const existing = await ctx.db
    .query("grantEmployeeLinks")
    .withIndex("by_grant_employee", (q) => q.eq("grantId", grantId).eq("employeeId", employeeId))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, { ...(patch ?? {}), updatedAtISO: now });
    return existing._id;
  }
  return await ctx.db.insert("grantEmployeeLinks", {
    societyId,
    grantId,
    employeeId,
    status: patch?.status ?? "hired",
    source: patch?.source ?? "manual",
    role: patch?.role,
    fundedHoursPerWeek: patch?.fundedHoursPerWeek,
    fundedHourlyWageCents: patch?.fundedHourlyWageCents,
    startDate: patch?.startDate,
    endDate: patch?.endDate,
    notes: patch?.notes,
    createdAtISO: now,
    updatedAtISO: now,
  });
}

export async function removeEmployeeLinkPortable(
  ctx: PortableMutationCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const link = await ctx.db.get(id);
  if (!link) return;
  await requireRolePortable(ctx, { actingUserId, societyId: String(link.societyId), required: "Director" });
  await ctx.db.delete(id);
}

export async function submitApplicationPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    grantId?: string;
    memberId?: string;
    applicantName: string;
    organizationName?: string;
    email: string;
    phone?: string;
    amountRequestedCents?: number;
    projectTitle: string;
    projectSummary: string;
    proposedUseOfFunds?: string;
    expectedOutcomes?: string;
    source?: string;
  },
) {
  await requireEnabledModulePortable(ctx, args.societyId, "grants");
  return await ctx.db.insert("grantApplications", {
    ...args,
    source: args.source ?? "public",
    status: "Submitted",
    submittedAtISO: isoNow(),
  });
}

export async function reviewApplicationPortable(
  ctx: PortableMutationCtx,
  { id, status, notes, actingUserId }: { id: string; status: string; notes?: string; actingUserId?: string },
) {
  const application = await ctx.db.get(id);
  if (!application) throw new Error("Application not found.");
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(application.societyId),
    required: "Director",
  });
  await ctx.db.patch(id, {
    status,
    notes,
    reviewedAtISO: isoNow(),
    reviewedByUserId: actingUserId ?? undefined,
  });
}

export async function convertApplicationPortable(
  ctx: PortableMutationCtx,
  { id, funder, program, actingUserId }: { id: string; funder: string; program?: string; actingUserId?: string },
) {
  const application = await ctx.db.get(id);
  if (!application) throw new Error("Application not found.");
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(application.societyId),
    required: "Director",
  });

  const grantId =
    application.linkedGrantId ??
    (await ctx.db.insert("grants", {
      societyId: String(application.societyId),
      title: application.projectTitle,
      funder,
      program,
      status: "Drafting",
      amountRequestedCents: application.amountRequestedCents,
      restrictedPurpose: application.proposedUseOfFunds,
      notes: application.projectSummary,
      createdAtISO: isoNow(),
    }));

  await ctx.db.patch(id, {
    linkedGrantId: grantId,
    status: "Converted",
    reviewedAtISO: isoNow(),
    reviewedByUserId: actingUserId ?? undefined,
  });

  return grantId;
}

export async function upsertGrantPortable(ctx: PortableMutationCtx, args: Record<string, any>) {
  await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Director",
  });
  const { id, actingUserId, ...rest } = args;
  void actingUserId;
  const now = isoNow();
  if (id) {
    await ctx.db.patch(id, { ...rest, updatedAtISO: now });
    return id;
  }
  return await ctx.db.insert("grants", {
    ...rest,
    createdAtISO: now,
    updatedAtISO: now,
  });
}

export async function importGcosProjectSnapshotPortable(
  ctx: PortableMutationCtx,
  { societyId, normalizedGrant, snapshot, actingUserId }: {
    societyId: string;
    normalizedGrant: any;
    snapshot?: any;
    actingUserId?: string;
  },
) {
  await requireRolePortable(ctx, {
    actingUserId,
    societyId,
    required: "Director",
  });

  const now = isoNow();
  const sourceExternalIds = Array.isArray(normalizedGrant?.sourceExternalIds)
    ? normalizedGrant.sourceExternalIds.filter((value: unknown): value is string => typeof value === "string" && value.length > 0)
    : [];
  const existing = sourceExternalIds.length
    ? (await ctx.db
      .query("grants")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect())
      .find((grant: Record<string, any>) => (grant.sourceExternalIds ?? []).some((id: string) => sourceExternalIds.includes(id)))
    : undefined;

  const payload = {
    societyId,
    title: String(normalizedGrant?.title ?? "GCOS project"),
    funder: String(normalizedGrant?.funder ?? "Employment and Social Development Canada"),
    program: typeof normalizedGrant?.program === "string" ? normalizedGrant.program : undefined,
    status: String(normalizedGrant?.status ?? "Submitted"),
    opportunityType: "Government",
    opportunityUrl: typeof normalizedGrant?.opportunityUrl === "string" ? normalizedGrant.opportunityUrl : undefined,
    confirmationCode: typeof normalizedGrant?.confirmationCode === "string" ? normalizedGrant.confirmationCode : undefined,
    amountRequestedCents: typeof normalizedGrant?.amountRequestedCents === "number" ? normalizedGrant.amountRequestedCents : undefined,
    amountAwardedCents: typeof normalizedGrant?.amountAwardedCents === "number" ? normalizedGrant.amountAwardedCents : undefined,
    startDate: typeof normalizedGrant?.startDate === "string" ? normalizedGrant.startDate : undefined,
    endDate: typeof normalizedGrant?.endDate === "string" ? normalizedGrant.endDate : undefined,
    sourceImportedAtISO: now,
    sourceFileCount: Number(snapshot?.agreement?.downloadedAgreementPdfs?.downloadedCount ?? 0),
    sourceExternalIds,
    confidence: "browser-snapshot",
    sensitivity: "contains-government-funding-records",
    riskFlags: ["Review imported GCOS data before relying on deadlines or amounts."],
    keyFacts: Array.isArray(normalizedGrant?.keyFacts) ? normalizedGrant.keyFacts.filter((value: unknown) => typeof value === "string") : undefined,
    requirements: Array.isArray(normalizedGrant?.requirements) ? normalizedGrant.requirements : undefined,
    timelineEvents: Array.isArray(normalizedGrant?.timelineEvents) ? normalizedGrant.timelineEvents : undefined,
    complianceFlags: Array.isArray(normalizedGrant?.complianceFlags) ? normalizedGrant.complianceFlags : undefined,
    useOfFunds: Array.isArray(normalizedGrant?.useOfFunds) ? normalizedGrant.useOfFunds : undefined,
    nextSteps: Array.isArray(normalizedGrant?.nextSteps) ? normalizedGrant.nextSteps : undefined,
    nextAction: typeof normalizedGrant?.nextAction === "string" ? normalizedGrant.nextAction : undefined,
    nextReportDueAtISO: typeof normalizedGrant?.nextReportDueAtISO === "string" ? normalizedGrant.nextReportDueAtISO : undefined,
    sourceNotes: typeof normalizedGrant?.sourceNotes === "string" ? normalizedGrant.sourceNotes : undefined,
    notes: `Imported from GCOS at ${now}. Sensitive employee and banking fields were not imported.`,
  };

  if (existing) {
    await ctx.db.patch(existing._id, {
      ...payload,
      updatedAtISO: now,
    });
    return { grantId: existing._id, created: false, sourceExternalIds };
  }

  const grantId = await ctx.db.insert("grants", {
    ...payload,
    createdAtISO: now,
    updatedAtISO: now,
  });
  return { grantId, created: true, sourceExternalIds };
}

export async function removeGrantPortable(
  ctx: PortableMutationCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const grant = await ctx.db.get(id);
  if (!grant) return;
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(grant.societyId),
    required: "Director",
  });
  const [reports, ledger] = await Promise.all([
    ctx.db
      .query("grantReports")
      .withIndex("by_grant", (q) => q.eq("grantId", id))
      .collect(),
    ctx.db
      .query("grantTransactions")
      .withIndex("by_grant", (q) => q.eq("grantId", id))
      .collect(),
  ]);
  for (const report of reports) await ctx.db.delete(report._id);
  for (const row of ledger) await ctx.db.delete(row._id);
  await ctx.db.delete(id);
}

export async function upsertReportPortable(ctx: PortableMutationCtx, args: Record<string, any>) {
  await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Director",
  });
  const { id, actingUserId, ...rest } = args;
  void actingUserId;
  if (id) {
    await ctx.db.patch(id, rest);
    return id;
  }
  return await ctx.db.insert("grantReports", rest);
}

export async function removeReportPortable(
  ctx: PortableMutationCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const report = await ctx.db.get(id);
  if (!report) return;
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(report.societyId),
    required: "Director",
  });
  await ctx.db.delete(id);
}

export async function upsertTransactionPortable(ctx: PortableMutationCtx, args: Record<string, any>) {
  await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Director",
  });
  const { id, actingUserId, ...rest } = args;
  void actingUserId;
  if (id) {
    await ctx.db.patch(id, rest);
    return id;
  }
  return await ctx.db.insert("grantTransactions", rest);
}

export async function removeTransactionPortable(
  ctx: PortableMutationCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const row = await ctx.db.get(id);
  if (!row) return;
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(row.societyId),
    required: "Director",
  });
  await ctx.db.delete(id);
}
