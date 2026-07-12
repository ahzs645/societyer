/**
 * PORTABLE FUNCTIONS: the treasury domain
 * (profitAndLoss / budgetVariance / restrictedFunds).
 *
 * Read-only financial reports over `ctx.db`. Each handler runs unchanged on
 * hosted Convex, the local Dexie runtime, and the convex-test oracle.
 */

import type { PortableQueryCtx } from "../portable/ctx";

export async function profitAndLossPortable(
  ctx: PortableQueryCtx,
  { societyId, from, to }: { societyId: string; from: string; to: string },
) {
  const txns = await ctx.db
    .query("financialTransactions")
    .withIndex("by_society_date", (q) =>
      q.eq("societyId", societyId).gte("date", from).lte("date", to),
    )
    .collect();

  const accounts = await ctx.db
    .query("financialAccounts")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();

  const accountMap = new Map<string, any>((accounts as any[]).map((a) => [String(a._id), a]));

  const incomeByCategory = new Map<string, number>();
  const expenseByCategory = new Map<string, number>();
  let totalIncome = 0;
  let totalExpense = 0;

  for (const txn of txns) {
    const account = accountMap.get(String(txn.accountId));
    const type = account?.accountType ?? "Other";
    const cat = txn.category ?? type;
    const cents = txn.amountCents;

    if (type === "Income" || cents > 0) {
      incomeByCategory.set(cat, (incomeByCategory.get(cat) ?? 0) + Math.abs(cents));
      totalIncome += Math.abs(cents);
    } else {
      expenseByCategory.set(cat, (expenseByCategory.get(cat) ?? 0) + Math.abs(cents));
      totalExpense += Math.abs(cents);
    }
  }

  // Return category breakdowns as arrays rather than records keyed by
  // category name. Wave-imported categories include non-ASCII typographic
  // characters like the en-dash in "Payroll – Salary & Wages", which Convex
  // rejects as an object field name (`validateObjectField` only accepts
  // plain ASCII). Arrays sidestep that validation without dropping data.
  return {
    from,
    to,
    totalIncomeCents: totalIncome,
    totalExpenseCents: totalExpense,
    netCents: totalIncome - totalExpense,
    incomeByCategory: Array.from(incomeByCategory, ([category, cents]) => ({ category, cents })),
    expenseByCategory: Array.from(expenseByCategory, ([category, cents]) => ({ category, cents })),
    transactionCount: txns.length,
  };
}

/**
 * Resolve a fiscal-year label to its inclusive [start, end] date window for
 * this society. Accepts both label shapes the app uses — a 4-digit fiscal-year
 * END year ("2027", the Treasurer default) and a hyphenated span ("2024-2025")
 * — and anchors the window on the society's actual fiscal year end ("MM-DD",
 * default 12-31) rather than assuming a calendar year. The window runs from the
 * day after the prior year's fiscal end through the label's fiscal end, so a
 * March-31 society's "2027" resolves to 2026-04-01 … 2027-03-31.
 */
function fiscalWindow(
  fiscalYear: string,
  fiscalYearEnd: string | undefined,
): { start: string; end: string } {
  const label = String(fiscalYear ?? "").trim();
  const span = /^(\d{4})\s*-\s*(\d{4})$/.exec(label);
  const endYear = span ? Number(span[2]) : /^\d{4}$/.test(label) ? Number(label) : NaN;
  if (Number.isNaN(endYear)) return { start: "0000-01-01", end: "9999-12-31" };

  const fye = /^\d{2}-\d{2}$/.test(String(fiscalYearEnd ?? "")) ? (fiscalYearEnd as string) : "12-31";
  const [month, day] = fye.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");

  const end = `${endYear}-${pad(month)}-${pad(day)}`;
  // Day after the previous fiscal-year end; UTC math handles month/day rollover.
  const start = new Date(Date.UTC(endYear - 1, month - 1, day + 1)).toISOString().slice(0, 10);
  return { start, end };
}

export async function budgetVariancePortable(
  ctx: PortableQueryCtx,
  { societyId, fiscalYear }: { societyId: string; fiscalYear: string },
) {
  const budgets = await ctx.db
    .query("budgets")
    .withIndex("by_society_fy", (q) =>
      q.eq("societyId", societyId).eq("fiscalYear", fiscalYear),
    )
    .collect();

  const society: any = await ctx.db.get(societyId);
  const { start: yearStart, end: yearEnd } = fiscalWindow(fiscalYear, society?.fiscalYearEnd);

  const txns = await ctx.db
    .query("financialTransactions")
    .withIndex("by_society_date", (q) =>
      q.eq("societyId", societyId).gte("date", yearStart).lte("date", yearEnd),
    )
    .collect();

  const actualByCategory = new Map<string, number>();
  for (const txn of txns) {
    const cat = txn.category ?? "Uncategorized";
    actualByCategory.set(cat, (actualByCategory.get(cat) ?? 0) + Math.abs(txn.amountCents));
  }

  return budgets.map((b: any) => ({
    category: b.category,
    plannedCents: b.plannedCents,
    actualCents: actualByCategory.get(b.category) ?? 0,
    varianceCents: (actualByCategory.get(b.category) ?? 0) - b.plannedCents,
    notes: b.notes,
  }));
}

export async function restrictedFundsPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
) {
  const grants = await ctx.db
    .query("grants")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();

  const restricted = grants.filter(
    (g: any) => g.restrictedPurpose && ["Awarded", "Active"].includes(g.status),
  );

  const results: Array<{
    grantId: string;
    title: string;
    funder: string;
    purpose: string;
    awardedCents: number;
    inflowCents: number;
    outflowCents: number;
    balanceCents: number;
    startDate: string | undefined;
    endDate: string | undefined;
    status: string;
  }> = [];
  for (const grant of restricted) {
    const txns = await ctx.db
      .query("grantTransactions")
      .withIndex("by_grant", (q) => q.eq("grantId", grant._id))
      .collect();

    let inflowCents = 0;
    let outflowCents = 0;
    for (const t of txns) {
      if (t.direction === "inflow") inflowCents += t.amountCents;
      else if (t.direction === "outflow") outflowCents += Math.abs(t.amountCents);
    }

    results.push({
      grantId: grant._id,
      title: grant.title,
      funder: grant.funder,
      purpose: grant.restrictedPurpose!,
      awardedCents: grant.amountAwardedCents ?? 0,
      inflowCents,
      outflowCents,
      balanceCents: inflowCents - outflowCents,
      startDate: grant.startDate,
      endDate: grant.endDate,
      status: grant.status,
    });
  }

  return results;
}
