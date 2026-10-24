/**
 * PORTABLE FUNCTIONS: the year-end reporting domain
 * (annualStatement / orgRevenueExpense / restrictedFundStatement / readiness).
 *
 * Year-end reporting queries. These are DERIVED from existing finance/grant
 * data — the annual financial statement, the statement of restricted funds, and
 * the year-end readiness checklist all read live tables rather than storing a
 * separate copy. The one stored year-end report (the Program Actuals & Budget
 * statement) lives in convex/programStatements.ts.
 *
 * Each handler runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle.
 */

import { countLabel, humanDate } from "../humanDate";
import type { PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership } from "./access";
import { entityMeetingWording } from "../entityMeetingWording";
import { organizationRuleScope } from "../entityRuleScope";
import { isInternalTransfer } from "../transferCategories";
import { entryCountsForBasis } from "../booksReports";
import { yearEndCurrency, yearEndCurrencyScope, yearEndRowCurrency } from "../yearEndCurrency";
import {
  buildOrgRevenueStatement,
  deriveFiscalRange as deriveRange,
} from "../orgRevenueStatement";

const deriveFiscalRange = deriveRange;

async function loadCurrencyContext(ctx: PortableQueryCtx, societyId: string, requested?: string) {
  const [accounts, society, settings] = await Promise.all([
    ctx.db.query("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.get(societyId, "societies"),
    ctx.db.query("invoiceSettings").withIndex("by_society", (q) => q.eq("societyId", societyId)).first(),
  ]);
  const scope = yearEndCurrencyScope(accounts, { requested, receivableAccountId: settings?.receivableAccountId, organizationCurrency: society?.currency });
  return { accounts, society, ...scope, accountMap: new Map<string, any>(accounts.map((account) => [String(account._id), account])) };
}

export async function annualStatementPortable(
  ctx: PortableQueryCtx,
  { societyId, fiscalYear, currency: requestedCurrency }: { societyId: string; fiscalYear: string; currency?: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const { accountMap, currency, baseCurrency, currencies } = await loadCurrencyContext(ctx, societyId, requestedCurrency);
  const financialRows = await ctx.db
    .query("financials")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const financial =
    financialRows
      .filter((row) => row.fiscalYear === fiscalYear && yearEndCurrency(row.currency, baseCurrency) === currency)
      .sort((a, b) => String(b.periodEnd ?? "").localeCompare(String(a.periodEnd ?? "")))[0] ?? null;

  const allBudgets = await ctx.db
    .query("budgets")
    .withIndex("by_society_fy", (q) => q.eq("societyId", societyId).eq("fiscalYear", fiscalYear))
    .collect();
  const budgets = allBudgets.filter((budget) => yearEndCurrency(budget.currency ?? accountMap.get(String(budget.accountId))?.currency, baseCurrency) === currency);

  const allTxns = await ctx.db
    .query("financialTransactions")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const { start, end } = deriveFiscalRange(fiscalYear);
  // An empty fiscal year stays empty; activity in another year is not a fallback.
  const txns = allTxns.filter((t) => t.date >= start && t.date <= end && yearEndRowCurrency(t, accountMap, baseCurrency) === currency);

  const incomeByCategory = new Map<string, number>();
  const expenseByCategory = new Map<string, number>();
  const actualByCategory = new Map<string, number>();
  for (const txn of txns) {
    if (isInternalTransfer(txn)) continue;
    const account = accountMap.get(String(txn.accountId));
    const type = account?.accountType ?? "Other";
    const cat = txn.category ?? (type === "Bank" || type === "Credit" ? "Uncategorized" : type);
    const cents = Math.abs(txn.amountCents);
    actualByCategory.set(cat, (actualByCategory.get(cat) ?? 0) + cents);
    if (type === "Income" || txn.amountCents > 0) {
      incomeByCategory.set(cat, (incomeByCategory.get(cat) ?? 0) + cents);
    } else {
      expenseByCategory.set(cat, (expenseByCategory.get(cat) ?? 0) + cents);
    }
  }

  // Counterparty / grant breakdowns from posted journal lines tagged in the
  // accounting workbench. Derived separately from the category breakdown above
  // (which comes from bank transactions) so the new line tags surface here.
  const [counterpartyRows, grantRows, postedEntries, journalLines] = await Promise.all([
    ctx.db.query("accountingCounterparties").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("grants").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("journalEntries").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "posted")).collect(),
    ctx.db.query("journalLines").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  const counterpartyName = new Map<string, string>((counterpartyRows as any[]).map((c) => [String(c._id), c.name]));
  const grantTitle = new Map<string, string>((grantRows as any[]).map((g) => [String(g._id), g.title]));
  const matchedPosted = (postedEntries as any[]).filter((e) => e.date >= start && e.date <= end && entryCountsForBasis(e, "accrual"));
  const entryInFy = new Set(matchedPosted.map((e) => String(e._id)));
  const byCounterparty = new Map<string, { incomeCents: number; expenseCents: number }>();
  const byGrant = new Map<string, { incomeCents: number; expenseCents: number }>();
  const bucket = (map: Map<string, { incomeCents: number; expenseCents: number }>, key: string, type: string, cents: number) => {
    const cur = map.get(key) ?? { incomeCents: 0, expenseCents: 0 };
    if (type === "Income") cur.incomeCents += cents;
    else if (type === "Expense") cur.expenseCents += cents;
    map.set(key, cur);
  };
  for (const line of journalLines as any[]) {
    if (!entryInFy.has(String(line.journalEntryId))) continue;
    if (yearEndRowCurrency(line, accountMap, baseCurrency) !== currency) continue;
    const type = accountMap.get(String(line.accountId))?.accountType ?? "Other";
    if (line.counterpartyId) bucket(byCounterparty, String(line.counterpartyId), type, line.amountCents);
    if (line.grantId) bucket(byGrant, String(line.grantId), type, line.amountCents);
  }

  const presentedAtMeeting = financial?.presentedAtMeetingId
    ? await getOwned(ctx, "meetings", financial.presentedAtMeetingId, societyId)
    : null;

  const revenueCents = financial?.revenueCents ?? Array.from(incomeByCategory.values()).reduce((a, b) => a + b, 0);
  const expensesCents = financial?.expensesCents ?? Array.from(expenseByCategory.values()).reduce((a, b) => a + b, 0);

  return {
    fiscalYear,
    currency,
    baseCurrency,
    currencies,
    sourceWarnings: [
      `Only ${currency} source accounts and budgets are included; no currency conversion is performed.`,
      `Recorded financial statements, remuneration disclosures, and budgets without a denomination are recorded in the workspace base currency (${baseCurrency}).`,
      ...(currency !== baseCurrency ? [`Base-currency financial statements and remuneration disclosures are excluded from this ${currency} statement.`] : []),
    ],
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
    byCounterparty: Array.from(byCounterparty, ([id, v]) => ({ id, name: counterpartyName.get(id) ?? "Unknown", ...v }))
      .sort((a, b) => (b.incomeCents + b.expenseCents) - (a.incomeCents + a.expenseCents)),
    byGrant: Array.from(byGrant, ([id, v]) => ({ id, title: grantTitle.get(id) ?? "Unknown", ...v }))
      .sort((a, b) => (b.incomeCents + b.expenseCents) - (a.incomeCents + a.expenseCents)),
  };
}

export async function orgRevenueExpensePortable(
  ctx: PortableQueryCtx,
  { societyId, fiscalYear, currency: requestedCurrency }: { societyId: string; fiscalYear: string; currency?: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const { society, accounts, currency, baseCurrency } = await loadCurrencyContext(ctx, societyId, requestedCurrency);
  const transactions = await ctx.db
    .query("financialTransactions")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return buildOrgRevenueStatement({
    organizationName: society?.name ?? "",
    fiscalYearLabel: fiscalYear,
    transactions: transactions as any,
    accounts: accounts as any,
    currency,
    baseCurrency,
  });
}

export async function restrictedFundStatementPortable(
  ctx: PortableQueryCtx,
  { societyId, currency: requestedCurrency }: { societyId: string; fiscalYear?: string; currency?: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const { accountMap, currency, baseCurrency, currencies } = await loadCurrencyContext(ctx, societyId, requestedCurrency);
  const grants = await ctx.db
    .query("grants")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const restrictedIds = new Set(grants.filter(
    (g) => g.restrictedPurpose && ["Awarded", "Active", "Closed"].includes(g.status),
  ).map((grant) => String(grant._id)));

  const funds: Array<Record<string, any>> = [];
  const programGrantScopes: Array<{ grantId: string; currency: string; transactionIds: string[] }> = [];
  const sourceWarnings = new Set([
    `Only ${currency} grant transactions are included; no currency conversion is performed.`,
    `Grant amounts use the linked financial account's currency, or ${baseCurrency} when no account is linked. A linked bank transaction supplies its own account denomination.`,
  ]);
  for (const grant of grants) {
    const grantCurrency = yearEndCurrency(accountMap.get(String(grant.linkedFinancialAccountId))?.currency ?? grant.currency, baseCurrency);
    const txns = await ctx.db
      .query("grantTransactions")
      .withIndex("by_grant", (q) => q.eq("grantId", grant._id))
      .collect();
    let receiptsCents = 0;
    let disbursementsCents = 0;
    const transactionIds: string[] = [];
    const programTransactionIds: string[] = [];
    for (const t of txns) {
      if (String(t.societyId) !== societyId) continue;
      let transactionCurrency = yearEndCurrency(t.currency, grantCurrency);
      if (t.financialTransactionId) {
        const source = await ctx.db.get(t.financialTransactionId, "financialTransactions");
        if (!source || String(source.societyId) !== societyId) {
          sourceWarnings.add("Grant transactions with unavailable linked bank transactions are excluded until their source can be verified.");
          continue;
        }
        transactionCurrency = yearEndRowCurrency(source, accountMap, baseCurrency);
      }
      if (transactionCurrency === grantCurrency) programTransactionIds.push(String(t._id));
      if (transactionCurrency !== currency) continue;
      transactionIds.push(String(t._id));
      if (t.direction === "inflow") receiptsCents += Math.abs(t.amountCents);
      else if (t.direction === "outflow") disbursementsCents += Math.abs(t.amountCents);
    }
    programGrantScopes.push({ grantId: String(grant._id), currency: grantCurrency, transactionIds: programTransactionIds });
    if (!restrictedIds.has(String(grant._id))) continue;
    if (grantCurrency !== currency && transactionIds.length === 0) continue;
    // Opening balance is not separately tracked yet; treat the fund as opening
    // at zero for the period so closing = receipts − disbursements.
    const openingCents = 0;
    funds.push({
      grantId: grant._id,
      currency,
      transactionIds,
      title: grant.title,
      funder: grant.funder,
      purpose: grant.restrictedPurpose,
      awardedCents: grantCurrency === currency ? grant.amountAwardedCents ?? 0 : 0,
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

  return { funds, totals, currency, baseCurrency, currencies, sourceWarnings: [...sourceWarnings], programGrantScopes };
}

export async function readinessPortable(
  ctx: PortableQueryCtx,
  { societyId, fiscalYear }: { societyId: string; fiscalYear: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const society = await ctx.db.get(societyId, "societies");

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

  // Society: AGM of members. Corporation: annual meeting of shareholders.
  // Custom entity: neutral "annual meeting" without naming who attends.
  const wording = entityMeetingWording(society);
  const am = wording.annualMeeting;
  const presentedTo = wording.holders ? ` to ${wording.holders}` : "";
  const annualReportLabel = organizationRuleScope(society).isBcHome ? "BC annual report filed" : "Annual registry report or return filed";

  const items = [
    item(
      "financialsApproved",
      "Year-end financial statements approved by the board",
      Boolean(financial?.approvedByBoardAt),
      financial?.approvedByBoardAt
        ? `Approved ${humanDate(financial.approvedByBoardAt)}.`
        : "No board approval date recorded for this fiscal year.",
      "/app/financials",
    ),
    item(
      "financialsPresented",
      `Financial statements presented${presentedTo} at the ${am}`,
      Boolean(financial?.presentedAtMeetingId),
      financial?.presentedAtMeetingId
        ? wording.isSociety ? "Linked to an AGM meeting record." : `Linked to an ${am} record.`
        : `Not yet linked to an ${am}.`,
      "/app/financials",
    ),
    item(
      "annualReport",
      annualReportLabel,
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
      `${wording.annualMeetingLong.charAt(0).toUpperCase()}${wording.annualMeetingLong.slice(1)} held`,
      agmHeld,
      agmHeld ? `An ${am} is recorded as held.` : `No held ${am} found.`,
      "/app/meetings",
    ),
    item(
      "grantReports",
      "Grant reports submitted",
      outstandingReports.length === 0,
      outstandingReports.length === 0
        ? "All grant reports submitted."
        : `${countLabel(outstandingReports.length, "grant report")} outstanding.`,
      "/app/grants",
      outstandingReports.length === 0 ? "complete" : "attention",
    ),
    item(
      "programStatements",
      "Program actuals & budget statements prepared",
      statements.length > 0,
      statements.length > 0
        ? `${countLabel(statements.length, "program statement")} prepared.`
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
}
