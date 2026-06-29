/**
 * Organization Revenue & Expense Statement — a general, organisation-wide
 * Statement of Revenues & Expenses for a fiscal year, DERIVED from the finance
 * section (financial transactions + accounts). Presented as society fund
 * accounting: General Fund (unrestricted) | Restricted Funds | Total, with an
 * "Excess of Revenues over Expenses" per fund.
 *
 * This is a financial report, not a hand-entered form: the line items, fund
 * split, totals, and surplus/deficit are all computed from the ledger. Pure
 * TypeScript (no DOM/Node) so the Convex query and the static demo client can
 * share one derivation. The fund split keys off each transaction's account
 * `isRestricted` flag — money held in a restricted fund/account is Restricted,
 * everything else is General.
 */

export type OrgStatementLine = {
  label: string;
  generalCents: number;
  restrictedCents: number;
};

export type OrgStatementColumnTotals = { generalCents: number; restrictedCents: number; totalCents: number };

export type OrgRevenueStatement = {
  organizationName: string;
  fiscalYearLabel: string;
  /** e.g. "April 1, 2024 to March 31, 2025". */
  periodLabel?: string;
  revenues: OrgStatementLine[];
  expenses: OrgStatementLine[];
  revenueTotals: OrgStatementColumnTotals;
  expenseTotals: OrgStatementColumnTotals;
  excess: OrgStatementColumnTotals;
  /** True when no transactions were found for the period. */
  empty: boolean;
};

export function lineTotalCents(line: OrgStatementLine): number {
  return (line.generalCents || 0) + (line.restrictedCents || 0);
}

/** Best-effort [start, end] ISO date range for a fiscal-year label. */
export function deriveFiscalRange(fiscalYear: string): { start: string; end: string } {
  const match = /^(\d{4})\s*-\s*(\d{4})$/.exec((fiscalYear ?? "").trim());
  if (match) {
    // Society fiscal years run April 1 → March 31 by convention.
    return { start: `${match[1]}-04-01`, end: `${match[2]}-03-31` };
  }
  if (/^\d{4}$/.test((fiscalYear ?? "").trim())) {
    return { start: `${fiscalYear}-01-01`, end: `${fiscalYear}-12-31` };
  }
  return { start: "0000-01-01", end: "9999-12-31" };
}

type LedgerTransaction = {
  date?: string;
  amountCents?: number;
  category?: string;
  accountId?: string;
};
type LedgerAccount = { _id?: string; isRestricted?: boolean };

function sumColumns(lines: OrgStatementLine[]): OrgStatementColumnTotals {
  return lines.reduce(
    (acc, line) => ({
      generalCents: acc.generalCents + (line.generalCents || 0),
      restrictedCents: acc.restrictedCents + (line.restrictedCents || 0),
      totalCents: acc.totalCents + lineTotalCents(line),
    }),
    { generalCents: 0, restrictedCents: 0, totalCents: 0 },
  );
}

/**
 * Build the statement from raw ledger rows. Revenues are positive flows,
 * expenses negative; each is grouped by category and split General vs Restricted
 * by the transaction account's `isRestricted` flag. Transactions outside the
 * fiscal range are excluded, unless none fall inside it (a sparsely-dated demo),
 * in which case all rows are used so the statement is never blank for no reason.
 */
export function buildOrgRevenueStatement(input: {
  organizationName: string;
  fiscalYearLabel: string;
  periodLabel?: string;
  transactions: LedgerTransaction[];
  accounts: LedgerAccount[];
}): OrgRevenueStatement {
  const restrictedById = new Map<string, boolean>(
    input.accounts.map((a) => [String(a._id), Boolean(a.isRestricted)]),
  );
  const { start, end } = deriveFiscalRange(input.fiscalYearLabel);
  const inRange = input.transactions.filter((t) => (t.date ?? "") >= start && (t.date ?? "") <= end);
  const rows = inRange.length > 0 ? inRange : input.transactions;

  const revenueByCategory = new Map<string, OrgStatementLine>();
  const expenseByCategory = new Map<string, OrgStatementLine>();
  for (const txn of rows) {
    const cents = txn.amountCents ?? 0;
    if (cents === 0) continue;
    const restricted = restrictedById.get(String(txn.accountId)) ?? false;
    const target = cents > 0 ? revenueByCategory : expenseByCategory;
    const label = txn.category || "Uncategorized";
    const line = target.get(label) ?? { label, generalCents: 0, restrictedCents: 0 };
    const amount = Math.abs(cents);
    if (restricted) line.restrictedCents += amount;
    else line.generalCents += amount;
    target.set(label, line);
  }

  const byTotalDesc = (a: OrgStatementLine, b: OrgStatementLine) => lineTotalCents(b) - lineTotalCents(a);
  const revenues = Array.from(revenueByCategory.values()).sort(byTotalDesc);
  const expenses = Array.from(expenseByCategory.values()).sort(byTotalDesc);
  const revenueTotals = sumColumns(revenues);
  const expenseTotals = sumColumns(expenses);

  return {
    organizationName: input.organizationName,
    fiscalYearLabel: input.fiscalYearLabel,
    periodLabel: input.periodLabel,
    revenues,
    expenses,
    revenueTotals,
    expenseTotals,
    excess: {
      generalCents: revenueTotals.generalCents - expenseTotals.generalCents,
      restrictedCents: revenueTotals.restrictedCents - expenseTotals.restrictedCents,
      totalCents: revenueTotals.totalCents - expenseTotals.totalCents,
    },
    empty: revenues.length === 0 && expenses.length === 0,
  };
}
