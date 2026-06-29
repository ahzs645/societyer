import { v } from "convex/values";
import { query } from "./lib/untypedServer";
import { buildOrgRevenueStatement, deriveFiscalRange as deriveRange } from "../shared/orgRevenueStatement";

/**
 * Year-end reporting queries. These are DERIVED from existing finance/grant
 * data — the annual financial statement, the statement of restricted funds, and
 * the year-end readiness checklist all read live tables rather than storing a
 * separate copy. The one stored year-end report (the Program Actuals & Budget
 * statement) lives in convex/programStatements.ts.
 */

const deriveFiscalRange = deriveRange;

export const annualStatement = query({
  args: { societyId: v.id("societies"), fiscalYear: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, fiscalYear }) => {
    const financialRows = await ctx.db
      .query("financials")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const financial =
      financialRows
        .filter((row) => row.fiscalYear === fiscalYear)
        .sort((a, b) => String(b.periodEnd ?? "").localeCompare(String(a.periodEnd ?? "")))[0] ?? null;

    const budgets = await ctx.db
      .query("budgets")
      .withIndex("by_society_fy", (q) => q.eq("societyId", societyId).eq("fiscalYear", fiscalYear))
      .collect();

    const allTxns = await ctx.db
      .query("financialTransactions")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const { start, end } = deriveFiscalRange(fiscalYear);
    const inRange = allTxns.filter((t) => t.date >= start && t.date <= end);
    // Fall back to all transactions when none fall inside the parsed range so a
    // sparsely-dated demo dataset still produces a category breakdown.
    const txns = inRange.length > 0 ? inRange : allTxns;

    const accounts = await ctx.db
      .query("financialAccounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const accountMap = new Map<string, any>((accounts as any[]).map((a) => [String(a._id), a]));

    const incomeByCategory = new Map<string, number>();
    const expenseByCategory = new Map<string, number>();
    const actualByCategory = new Map<string, number>();
    for (const txn of txns) {
      const account = accountMap.get(String(txn.accountId));
      const type = account?.accountType ?? "Other";
      const cat = txn.category ?? type;
      const cents = Math.abs(txn.amountCents);
      actualByCategory.set(cat, (actualByCategory.get(cat) ?? 0) + cents);
      if (type === "Income" || txn.amountCents > 0) {
        incomeByCategory.set(cat, (incomeByCategory.get(cat) ?? 0) + cents);
      } else {
        expenseByCategory.set(cat, (expenseByCategory.get(cat) ?? 0) + cents);
      }
    }

    const presentedAtMeeting = financial?.presentedAtMeetingId
      ? await ctx.db.get(financial.presentedAtMeetingId)
      : null;

    const revenueCents = financial?.revenueCents ?? Array.from(incomeByCategory.values()).reduce((a, b) => a + b, 0);
    const expensesCents = financial?.expensesCents ?? Array.from(expenseByCategory.values()).reduce((a, b) => a + b, 0);

    return {
      fiscalYear,
      financial,
      revenueCents,
      expensesCents,
      surplusCents: revenueCents - expensesCents,
      netAssetsCents: financial?.netAssetsCents ?? null,
      restrictedFundsCents: financial?.restrictedFundsCents ?? null,
      auditStatus: financial?.auditStatus ?? null,
      auditorName: financial?.auditorName ?? null,
      approvedByBoardAt: financial?.approvedByBoardAt ?? null,
      remunerationDisclosures: financial?.remunerationDisclosures ?? [],
      presentedAtMeeting,
      budgets: budgets.map((b) => ({
        category: b.category,
        plannedCents: b.plannedCents,
        actualCents: actualByCategory.get(b.category) ?? 0,
        varianceCents: (actualByCategory.get(b.category) ?? 0) - b.plannedCents,
        notes: b.notes,
      })),
      incomeByCategory: Array.from(incomeByCategory, ([category, cents]) => ({ category, cents })),
      expenseByCategory: Array.from(expenseByCategory, ([category, cents]) => ({ category, cents })),
    };
  },
});

export const orgRevenueExpense = query({
  args: { societyId: v.id("societies"), fiscalYear: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, fiscalYear }) => {
    const society = await ctx.db.get(societyId);
    const transactions = await ctx.db
      .query("financialTransactions")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const accounts = await ctx.db
      .query("financialAccounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return buildOrgRevenueStatement({
      organizationName: society?.name ?? "",
      fiscalYearLabel: fiscalYear,
      transactions: transactions as any,
      accounts: accounts as any,
    });
  },
});

export const restrictedFundStatement = query({
  args: { societyId: v.id("societies"), fiscalYear: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const grants = await ctx.db
      .query("grants")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const restricted = grants.filter(
      (g) => g.restrictedPurpose && ["Awarded", "Active", "Closed"].includes(g.status),
    );

    const funds: Array<Record<string, any>> = [];
    for (const grant of restricted) {
      const txns = await ctx.db
        .query("grantTransactions")
        .withIndex("by_grant", (q) => q.eq("grantId", grant._id))
        .collect();
      let receiptsCents = 0;
      let disbursementsCents = 0;
      for (const t of txns) {
        if (t.direction === "inflow") receiptsCents += Math.abs(t.amountCents);
        else if (t.direction === "outflow") disbursementsCents += Math.abs(t.amountCents);
      }
      // Opening balance is not separately tracked yet; treat the fund as opening
      // at zero for the period so closing = receipts − disbursements.
      const openingCents = 0;
      funds.push({
        grantId: grant._id,
        title: grant.title,
        funder: grant.funder,
        purpose: grant.restrictedPurpose,
        awardedCents: grant.amountAwardedCents ?? 0,
        openingCents,
        receiptsCents,
        disbursementsCents,
        closingCents: openingCents + receiptsCents - disbursementsCents,
        status: grant.status,
      });
    }

    const totals = funds.reduce(
      (acc, f) => ({
        openingCents: acc.openingCents + f.openingCents,
        receiptsCents: acc.receiptsCents + f.receiptsCents,
        disbursementsCents: acc.disbursementsCents + f.disbursementsCents,
        closingCents: acc.closingCents + f.closingCents,
      }),
      { openingCents: 0, receiptsCents: 0, disbursementsCents: 0, closingCents: 0 },
    );

    return { funds, totals };
  },
});

export const readiness = query({
  args: { societyId: v.id("societies"), fiscalYear: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, fiscalYear }) => {
    const society = await ctx.db.get(societyId);

    const financialRows = await ctx.db
      .query("financials")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const financial = financialRows.find((row) => row.fiscalYear === fiscalYear) ?? null;

    const filings = await ctx.db
      .query("filings")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const isFiled = (predicate: (kind: string) => boolean) =>
      filings.some((f) => predicate(String(f.kind ?? "").toLowerCase()) && /filed|complete|submitted/i.test(String(f.status ?? "")));

    const meetings = await ctx.db
      .query("meetings")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const agmHeld = meetings.some(
      (m) => /agm|annual/i.test(String(m.type ?? "")) && /held|complete|past|done/i.test(String(m.status ?? "")),
    );

    const grantReports = await ctx.db
      .query("grantReports")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const outstandingReports = grantReports.filter((r) => !/submitted|complete/i.test(String(r.status ?? "")));

    const statements = await ctx.db
      .query("programStatements")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();

    const item = (
      key: string,
      label: string,
      ok: boolean,
      detail: string,
      href: string,
      tone: "complete" | "attention" | "upcoming" = ok ? "complete" : "attention",
    ) => ({ key, label, status: tone, ok, detail, href });

    const items = [
      item(
        "financialsApproved",
        "Year-end financial statements approved by the board",
        Boolean(financial?.approvedByBoardAt),
        financial?.approvedByBoardAt
          ? `Approved ${financial.approvedByBoardAt}.`
          : "No board approval date recorded for this fiscal year.",
        "/app/financials",
      ),
      item(
        "financialsPresented",
        "Financial statements presented to members at the AGM",
        Boolean(financial?.presentedAtMeetingId),
        financial?.presentedAtMeetingId ? "Linked to an AGM meeting record." : "Not yet linked to an AGM.",
        "/app/financials",
      ),
      item(
        "annualReport",
        "BC annual report filed",
        isFiled((k) => k.includes("annual")),
        isFiled((k) => k.includes("annual")) ? "Annual report marked filed." : "Annual report not marked filed.",
        "/app/filings",
      ),
      ...(society?.isCharity
        ? [
            item(
              "t3010",
              "CRA T3010 charity return filed",
              isFiled((k) => k.includes("t3010") || k.includes("charity")),
              isFiled((k) => k.includes("t3010") || k.includes("charity"))
                ? "T3010 marked filed."
                : "T3010 not marked filed.",
              "/app/filings",
            ),
          ]
        : []),
      item(
        "agm",
        "Annual general meeting held",
        agmHeld,
        agmHeld ? "An AGM is recorded as held." : "No held AGM found.",
        "/app/meetings",
      ),
      item(
        "grantReports",
        "Grant reports submitted",
        outstandingReports.length === 0,
        outstandingReports.length === 0
          ? "All grant reports submitted."
          : `${outstandingReports.length} grant report(s) outstanding.`,
        "/app/grants",
        outstandingReports.length === 0 ? "complete" : "attention",
      ),
      item(
        "programStatements",
        "Program actuals & budget statements prepared",
        statements.length > 0,
        statements.length > 0
          ? `${statements.length} program statement(s) prepared.`
          : "No program actuals/budget statements prepared yet.",
        "/app/financials/year-end",
        statements.length > 0 ? "complete" : "upcoming",
      ),
    ];

    const completed = items.filter((i) => i.ok).length;
    return {
      fiscalYear,
      items,
      completed,
      total: items.length,
      ready: items.every((i) => i.ok),
    };
  },
});
