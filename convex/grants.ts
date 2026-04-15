import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireRole } from "./users";
import { requireEnabledModule } from "./lib/moduleSettings";

function isoNow() {
  return new Date().toISOString();
}

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("grants")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const publicOpenings = query({
  args: { societyId: v.id("societies") },
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
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("grantApplications")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const transactions = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("grantTransactions")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const reports = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("grantReports")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const summary = query({
  args: { societyId: v.id("societies") },
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
    publicDescription: v.optional(v.string()),
    allowPublicApplications: v.optional(v.boolean()),
    applicationInstructions: v.optional(v.string()),
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
    return await ctx.db.insert("grants", {
      ...rest,
      createdAtISO: isoNow(),
    });
  },
});

export const removeGrant = mutation({
  args: { id: v.id("grants"), actingUserId: v.optional(v.id("users")) },
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
