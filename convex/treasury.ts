import { query } from "./lib/untypedServer";
import { v } from "convex/values";

export const profitAndLoss = query({
  args: {
    societyId: v.id("societies"),
    from: v.string(),
    to: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, from, to }) => {
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
  },
});

export const budgetVariance = query({
  args: {
    societyId: v.id("societies"),
    fiscalYear: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, fiscalYear }) => {
    const budgets = await ctx.db
      .query("budgets")
      .withIndex("by_society_fy", (q) =>
        q.eq("societyId", societyId).eq("fiscalYear", fiscalYear),
      )
      .collect();

    const yearStart = fiscalYear.includes("-") ? fiscalYear : `${fiscalYear}-01-01`;
    const yearEnd = fiscalYear.includes("-") ? `${fiscalYear.slice(0, 4)}-12-31` : `${fiscalYear}-12-31`;

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

    return budgets.map((b) => ({
      category: b.category,
      plannedCents: b.plannedCents,
      actualCents: actualByCategory.get(b.category) ?? 0,
      varianceCents: (actualByCategory.get(b.category) ?? 0) - b.plannedCents,
      notes: b.notes,
    }));
  },
});

export const restrictedFunds = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const grants = await ctx.db
      .query("grants")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();

    const restricted = grants.filter(
      (g) => g.restrictedPurpose && ["Awarded", "Active"].includes(g.status),
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
  },
});
