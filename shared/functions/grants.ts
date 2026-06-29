/**
 * PORTABLE FUNCTIONS: the grants domain (read-side queries + summary rollup).
 *
 * Reads over the `grants`, `grantApplications`, `grantTransactions`,
 * `grantReports`, `grantEmployeeLinks`, and `financialAccounts` tables via
 * `ctx.db`. Each handler runs unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle.
 *
 * Role-gated writes (upsertGrant / removeGrant / upsert* / remove* / employee
 * link mutations) and the application lifecycle mutations (submitApplication /
 * reviewApplication / convertApplication) stay on Convex: they depend on
 * `requireRole` / `requireEnabledModule`, which are server-only.
 */

import type { PortableQueryCtx } from "../portable/ctx";

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
