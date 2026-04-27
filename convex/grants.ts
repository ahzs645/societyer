import { v } from "convex/values";
import { mutation, query } from "./lib/untypedServer";
import { requireRole } from "./users";
import { requireEnabledModule } from "./lib/moduleSettings";

function isoNow() {
  return new Date().toISOString();
}

const grantRequirement = v.object({
  id: v.string(),
  category: v.string(),
  label: v.string(),
  status: v.string(),
  dueDate: v.optional(v.string()),
  documentId: v.optional(v.id("documents")),
  notes: v.optional(v.string()),
});

const grantUseOfFundsLine = v.object({
  label: v.string(),
  amountCents: v.optional(v.number()),
  notes: v.optional(v.string()),
});

const grantTimelineEvent = v.object({
  label: v.string(),
  date: v.string(),
  status: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const grantComplianceFlag = v.object({
  label: v.string(),
  status: v.string(),
  notes: v.optional(v.string()),
  requirementId: v.optional(v.string()),
});

const grantNextStep = v.object({
  id: v.string(),
  label: v.string(),
  status: v.string(),
  priority: v.string(),
  dueHint: v.optional(v.string()),
  source: v.optional(v.string()),
  actionLabel: v.optional(v.string()),
  reason: v.optional(v.string()),
});

const grantEmployeeLinkPatch = v.object({
  role: v.optional(v.string()),
  status: v.optional(v.string()),
  source: v.optional(v.string()),
  fundedHoursPerWeek: v.optional(v.number()),
  fundedHourlyWageCents: v.optional(v.number()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const grantContact = v.object({
  role: v.string(),
  name: v.optional(v.string()),
  organization: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const grantAnswerLibraryItem = v.object({
  section: v.string(),
  title: v.string(),
  body: v.string(),
});

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("grants")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const get = query({
  args: { id: v.id("grants") },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const publicOpenings = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("grants")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return rows.filter((grant) => grant.allowPublicApplications);
  },
});

export const applications = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("grantApplications")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const transactions = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("grantTransactions")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const reports = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("grantReports")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const employeeLinks = query({
  args: { societyId: v.id("societies"), grantId: v.optional(v.id("grants")) },
  returns: v.any(),
  handler: async (ctx, { societyId, grantId }) => {
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
  },
});

export const upsertEmployeeLink = mutation({
  args: {
    id: v.optional(v.id("grantEmployeeLinks")),
    societyId: v.id("societies"),
    grantId: v.id("grants"),
    employeeId: v.id("employees"),
    patch: v.optional(grantEmployeeLinkPatch),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, societyId, grantId, employeeId, patch, actingUserId }) => {
    await requireRole(ctx, { actingUserId, societyId, required: "Director" });
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
  },
});

export const removeEmployeeLink = mutation({
  args: { id: v.id("grantEmployeeLinks"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { id, actingUserId }) => {
    const link = await ctx.db.get(id);
    if (!link) return;
    await requireRole(ctx, { actingUserId, societyId: link.societyId, required: "Director" });
    await ctx.db.delete(id);
  },
});

export const summary = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
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
  },
});

export const submitApplication = mutation({
  args: {
    societyId: v.id("societies"),
    grantId: v.optional(v.id("grants")),
    memberId: v.optional(v.id("members")),
    applicantName: v.string(),
    organizationName: v.optional(v.string()),
    email: v.string(),
    phone: v.optional(v.string()),
    amountRequestedCents: v.optional(v.number()),
    projectTitle: v.string(),
    projectSummary: v.string(),
    proposedUseOfFunds: v.optional(v.string()),
    expectedOutcomes: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireEnabledModule(ctx, args.societyId, "grants");
    return await ctx.db.insert("grantApplications", {
      ...args,
      source: args.source ?? "public",
      status: "Submitted",
      submittedAtISO: isoNow(),
    });
  },
});

export const reviewApplication = mutation({
  args: {
    id: v.id("grantApplications"),
    status: v.string(),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, status, notes, actingUserId }) => {
    const application = await ctx.db.get(id);
    if (!application) throw new Error("Application not found.");
    await requireRole(ctx, {
      actingUserId,
      societyId: application.societyId,
      required: "Director",
    });
    await ctx.db.patch(id, {
      status,
      notes,
      reviewedAtISO: isoNow(),
      reviewedByUserId: actingUserId ?? undefined,
    });
  },
});

export const convertApplication = mutation({
  args: {
    id: v.id("grantApplications"),
    funder: v.string(),
    program: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, funder, program, actingUserId }) => {
    const application = await ctx.db.get(id);
    if (!application) throw new Error("Application not found.");
    await requireRole(ctx, {
      actingUserId,
      societyId: application.societyId,
      required: "Director",
    });

    const grantId =
      application.linkedGrantId ??
      (await ctx.db.insert("grants", {
        societyId: application.societyId,
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
  },
});

export const upsertGrant = mutation({
  args: {
    id: v.optional(v.id("grants")),
    societyId: v.id("societies"),
    committeeId: v.optional(v.id("committees")),
    boardOwnerUserId: v.optional(v.id("users")),
    linkedFinancialAccountId: v.optional(v.id("financialAccounts")),
    opportunityUrl: v.optional(v.string()),
    opportunityType: v.optional(v.string()),
    priority: v.optional(v.string()),
    fitScore: v.optional(v.number()),
    nextAction: v.optional(v.string()),
    publicDescription: v.optional(v.string()),
    allowPublicApplications: v.optional(v.boolean()),
    applicationInstructions: v.optional(v.string()),
    requirements: v.optional(v.array(grantRequirement)),
    confirmationCode: v.optional(v.string()),
    sourcePath: v.optional(v.string()),
    sourceImportedAtISO: v.optional(v.string()),
    sourceFileCount: v.optional(v.number()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    confidence: v.optional(v.string()),
    sensitivity: v.optional(v.string()),
    riskFlags: v.optional(v.array(v.string())),
    sourceNotes: v.optional(v.string()),
    keyFacts: v.optional(v.array(v.string())),
    useOfFunds: v.optional(v.array(grantUseOfFundsLine)),
    timelineEvents: v.optional(v.array(grantTimelineEvent)),
    complianceFlags: v.optional(v.array(grantComplianceFlag)),
    nextSteps: v.optional(v.array(grantNextStep)),
    contacts: v.optional(v.array(grantContact)),
    answerLibrary: v.optional(v.array(grantAnswerLibraryItem)),
    title: v.string(),
    funder: v.string(),
    program: v.optional(v.string()),
    status: v.string(),
    amountRequestedCents: v.optional(v.number()),
    amountAwardedCents: v.optional(v.number()),
    restrictedPurpose: v.optional(v.string()),
    applicationDueDate: v.optional(v.string()),
    submittedAtISO: v.optional(v.string()),
    decisionAtISO: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    nextReportDueAtISO: v.optional(v.string()),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Director",
    });
    const { id, actingUserId, ...rest } = args;
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
  },
});

export const importGcosProjectSnapshot = mutation({
  args: {
    societyId: v.id("societies"),
    normalizedGrant: v.any(),
    snapshot: v.optional(v.any()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, normalizedGrant, snapshot, actingUserId }) => {
    await requireRole(ctx, {
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
        .find((grant) => (grant.sourceExternalIds ?? []).some((id) => sourceExternalIds.includes(id)))
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
  },
});

export const removeGrant = mutation({
  args: { id: v.id("grants"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { id, actingUserId }) => {
    const grant = await ctx.db.get(id);
    if (!grant) return;
    await requireRole(ctx, {
      actingUserId,
      societyId: grant.societyId,
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
  },
});

export const upsertReport = mutation({
  args: {
    id: v.optional(v.id("grantReports")),
    societyId: v.id("societies"),
    grantId: v.id("grants"),
    title: v.string(),
    dueAtISO: v.string(),
    submittedAtISO: v.optional(v.string()),
    status: v.string(),
    spendingToDateCents: v.optional(v.number()),
    outcomeSummary: v.optional(v.string()),
    documentId: v.optional(v.id("documents")),
    submittedByUserId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Director",
    });
    const { id, actingUserId, ...rest } = args;
    if (id) {
      await ctx.db.patch(id, rest);
      return id;
    }
    return await ctx.db.insert("grantReports", rest);
  },
});

export const removeReport = mutation({
  args: { id: v.id("grantReports"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { id, actingUserId }) => {
    const report = await ctx.db.get(id);
    if (!report) return;
    await requireRole(ctx, {
      actingUserId,
      societyId: report.societyId,
      required: "Director",
    });
    await ctx.db.delete(id);
  },
});

export const upsertTransaction = mutation({
  args: {
    id: v.optional(v.id("grantTransactions")),
    societyId: v.id("societies"),
    grantId: v.id("grants"),
    financialTransactionId: v.optional(v.id("financialTransactions")),
    documentId: v.optional(v.id("documents")),
    date: v.string(),
    direction: v.string(),
    amountCents: v.number(),
    description: v.string(),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Director",
    });
    const { id, actingUserId, ...rest } = args;
    if (id) {
      await ctx.db.patch(id, rest);
      return id;
    }
    return await ctx.db.insert("grantTransactions", rest);
  },
});

export const removeTransaction = mutation({
  args: { id: v.id("grantTransactions"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { id, actingUserId }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    await requireRole(ctx, {
      actingUserId,
      societyId: row.societyId,
      required: "Director",
    });
    await ctx.db.delete(id);
  },
});
