/**
 * Canonical model for the "Program Actual Revenue and Expenses and Budget"
 * statement, modelled on the BC Community Gaming Grants supporting document
 * (https://www2.gov.bc.ca/assets/gov/sports-recreation-arts-and-culture/gambling/grants/example-grants-program-actuals-and-budgets.pdf).
 *
 * Single source of truth shared by the Convex schema/seed, the static demo
 * fixtures, the editor UI, and the export renderers so categories and totals
 * can never drift. Pure TypeScript — no DOM or Node dependencies.
 */

export type ProgramStatementLine = {
  /** Stable category key, or "custom:<id>" for itemized extra rows. */
  key: string;
  label: string;
  actualCents: number;
  budgetCents: number;
  notes?: string;
};

export type ProgramStatement = {
  _id?: string;
  societyId?: string;
  grantId?: string;
  programName: string;
  funderName?: string;
  priorFiscalYearLabel: string;
  currentFiscalYearLabel: string;
  revenues: ProgramStatementLine[];
  expenses: ProgramStatementLine[];
  narrative?: string;
  status?: string;
};

export type ProgramStatementCategory = {
  key: string;
  label: string;
  /** True when the funder may not be abbreviated and should be itemized. */
  itemize?: boolean;
};

/**
 * Revenue categories in the BC fillable form order. Funding sources must be
 * itemized without abbreviations (footnote 1 on the BC form). "Community Gaming
 * Grant" carries the special meaning in footnote 2 (the program grant used /
 * requested), so it is kept as a distinct fixed row.
 */
export const REVENUE_CATEGORIES: ProgramStatementCategory[] = [
  { key: "federal", label: "Federal", itemize: true },
  { key: "provincial", label: "Provincial", itemize: true },
  { key: "municipal", label: "Municipal", itemize: true },
  { key: "communityGamingGrant", label: "Community Gaming Grant" },
  { key: "corporate", label: "Corporate" },
  { key: "registrationFees", label: "Registration/User fees" },
  { key: "fundraising", label: "Fundraising" },
  { key: "other", label: "Other" },
];

/** Expense categories in the BC fillable form order. */
export const EXPENSE_CATEGORIES: ProgramStatementCategory[] = [
  { key: "wagesBenefits", label: "Wages & Benefits" },
  { key: "rent", label: "Rent" },
  { key: "utilities", label: "Utilities" },
  { key: "insurance", label: "Insurance" },
  { key: "officeSupplies", label: "Office Supplies" },
  { key: "equipmentRentals", label: "Equipment Rentals" },
  { key: "bankCharges", label: "Bank Charges" },
  { key: "telephoneInternet", label: "Telephone/Internet" },
  { key: "advertising", label: "Advertising" },
  { key: "other", label: "Other" },
];

export type ProgramStatementTotals = {
  revenueActualCents: number;
  revenueBudgetCents: number;
  expenseActualCents: number;
  expenseBudgetCents: number;
  surplusActualCents: number;
  surplusBudgetCents: number;
};

const sum = (lines: ProgramStatementLine[], pick: (line: ProgramStatementLine) => number) =>
  lines.reduce((total, line) => total + (Number.isFinite(pick(line)) ? pick(line) : 0), 0);

export function computeStatementTotals(statement: {
  revenues: ProgramStatementLine[];
  expenses: ProgramStatementLine[];
}): ProgramStatementTotals {
  const revenueActualCents = sum(statement.revenues, (l) => l.actualCents);
  const revenueBudgetCents = sum(statement.revenues, (l) => l.budgetCents);
  const expenseActualCents = sum(statement.expenses, (l) => l.actualCents);
  const expenseBudgetCents = sum(statement.expenses, (l) => l.budgetCents);
  return {
    revenueActualCents,
    revenueBudgetCents,
    expenseActualCents,
    expenseBudgetCents,
    surplusActualCents: revenueActualCents - expenseActualCents,
    surplusBudgetCents: revenueBudgetCents - expenseBudgetCents,
  };
}

function blankLines(categories: ProgramStatementCategory[]): ProgramStatementLine[] {
  return categories.map((category) => ({
    key: category.key,
    label: category.label,
    actualCents: 0,
    budgetCents: 0,
  }));
}

/** A fresh, empty statement with every BC category row present. */
export function blankProgramStatement(input: {
  programName?: string;
  funderName?: string;
  priorFiscalYearLabel: string;
  currentFiscalYearLabel: string;
}): ProgramStatement {
  return {
    programName: input.programName ?? "",
    funderName: input.funderName,
    priorFiscalYearLabel: input.priorFiscalYearLabel,
    currentFiscalYearLabel: input.currentFiscalYearLabel,
    revenues: blankLines(REVENUE_CATEGORIES),
    expenses: blankLines(EXPENSE_CATEGORIES),
    status: "Draft",
  };
}

/**
 * Prefill a statement from an existing grant record. Pulls the requested /
 * awarded amount into the Community Gaming Grant revenue row, sums recorded
 * grant cash transactions for prior-year actuals, and seeds expense budget rows
 * from the grant's use-of-funds. Expense actuals are left for the treasurer to
 * allocate; the unallocated total is surfaced in the narrative so nothing is
 * silently dropped.
 */
export function buildStatementFromGrant(
  grant: {
    _id?: string;
    title?: string;
    program?: string;
    funder?: string;
    amountAwardedCents?: number;
    amountRequestedCents?: number;
    useOfFunds?: Array<{ label: string; amountCents?: number; notes?: string }>;
  },
  transactions: Array<{ direction?: string; amountCents?: number }> = [],
  input?: { priorFiscalYearLabel?: string; currentFiscalYearLabel?: string },
): ProgramStatement {
  const inflowCents = transactions
    .filter((t) => t.direction === "inflow")
    .reduce((total, t) => total + Math.abs(t.amountCents ?? 0), 0);
  const outflowCents = transactions
    .filter((t) => t.direction === "outflow")
    .reduce((total, t) => total + Math.abs(t.amountCents ?? 0), 0);

  const statement = blankProgramStatement({
    programName: grant.program || grant.title || "Program",
    funderName: grant.funder,
    priorFiscalYearLabel: input?.priorFiscalYearLabel ?? "Previous fiscal year",
    currentFiscalYearLabel: input?.currentFiscalYearLabel ?? "Current fiscal year",
  });

  const gamingRow = statement.revenues.find((line) => line.key === "communityGamingGrant");
  if (gamingRow) {
    gamingRow.actualCents = inflowCents || grant.amountAwardedCents || 0;
    gamingRow.budgetCents = grant.amountRequestedCents ?? grant.amountAwardedCents ?? 0;
  }

  const extraExpenses: ProgramStatementLine[] = (grant.useOfFunds ?? [])
    .filter((line) => line && line.label)
    .map((line, index) => ({
      key: `custom:useOfFunds:${index}`,
      label: line.label,
      actualCents: 0,
      budgetCents: line.amountCents ?? 0,
      notes: line.notes,
    }));
  if (extraExpenses.length > 0) {
    // Drop the placeholder "Other" expense row in favour of the itemized lines.
    statement.expenses = statement.expenses.filter((line) => line.key !== "other").concat(extraExpenses);
  }

  if (outflowCents > 0) {
    statement.narrative =
      `Recorded grant spending to date totals ${(outflowCents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" })}. ` +
      `Allocate these actuals across the expense categories before submitting.`;
  }

  return statement;
}

/**
 * The seeded Riverside Community Society example, using the exact figures from
 * the BC Community Gaming Grants supporting document so the demo reproduces the
 * reference form 1:1. Amounts are in cents.
 */
export function riversideGamingProgramStatement(input: {
  societyId: string;
  grantId?: string;
  priorFiscalYearLabel: string;
  currentFiscalYearLabel: string;
}): ProgramStatement {
  return {
    societyId: input.societyId,
    grantId: input.grantId,
    programName: "Community Hall Programs",
    funderName: "BC Community Gaming Grants",
    priorFiscalYearLabel: input.priorFiscalYearLabel,
    currentFiscalYearLabel: input.currentFiscalYearLabel,
    status: "Final",
    revenues: [
      { key: "federal", label: "Federal XYZ Department", actualCents: 200000, budgetCents: 400000 },
      { key: "provincial", label: "Provincial ABC Ministry", actualCents: 100000, budgetCents: 300000 },
      { key: "municipal", label: "Municipal Funding", actualCents: 100000, budgetCents: 300000 },
      { key: "communityGamingGrant", label: "Community Gaming Grant", actualCents: 400000, budgetCents: 500000 },
      { key: "corporate", label: "Corporate", actualCents: 100000, budgetCents: 100000 },
      { key: "registrationFees", label: "Registration fees", actualCents: 502305, budgetCents: 500000 },
      { key: "fundraising", label: "Fundraising", actualCents: 145536, budgetCents: 200000 },
    ],
    expenses: [
      { key: "wagesBenefits", label: "Wages & Benefits", actualCents: 66651, budgetCents: 110000 },
      { key: "rent", label: "Rent", actualCents: 6283, budgetCents: 15000 },
      { key: "utilities", label: "Utilities", actualCents: 113131, budgetCents: 150000 },
      { key: "insurance", label: "Insurance", actualCents: 130000, budgetCents: 152000 },
      { key: "officeSupplies", label: "Office Supplies", actualCents: 85000, budgetCents: 120000 },
      { key: "equipmentRentals", label: "Equipment Rentals", actualCents: 125000, budgetCents: 220000 },
      { key: "bankCharges", label: "Bank Charges", actualCents: 330000, budgetCents: 330000 },
      { key: "telephoneInternet", label: "Telephone/Internet", actualCents: 44052, budgetCents: 63000 },
      { key: "advertising", label: "Advertising", actualCents: 611488, budgetCents: 1140000 },
    ],
    narrative:
      "Prior-year actuals reconcile to the FY2024-25 program ledger. The current-year budget assumes a renewed Community Gaming Grant of $5,000.",
  };
}
