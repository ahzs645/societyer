/**
 * Canonical model for the "Organization Revenue and Expense Statement"
 * (Statement of Revenues & Expenses), modelled on the BC Community Gaming Grants
 * supporting document
 * (https://www2.gov.bc.ca/assets/gov/sports-recreation-arts-and-culture/gambling/grants/example-grants-org-revenue-and-expenses.pdf).
 *
 * Unlike the per-program "Program Actuals & Budget" statement (two columns:
 * actuals vs budget), this is an ORGANISATION-WIDE statement of operations for
 * the most recently completed fiscal year, presented as fund accounting:
 * General Fund | Gaming Fund | Total. Program Grant and Capital Project Grant
 * applications require this org-level statement.
 *
 * Single source of truth shared by the Convex schema/seed, the static demo
 * fixtures, the editor UI, and the export renderer. Pure TypeScript — no DOM or
 * Node dependencies. The Total column and "Excess of Revenues over Expenses"
 * are always computed, never stored.
 */

export type OrgStatementLine = {
  /** Stable category key, or "custom:<id>" for itemized extra rows. */
  key: string;
  label: string;
  generalCents: number;
  gamingCents: number;
  notes?: string;
};

export type OrgRevenueStatement = {
  _id?: string;
  societyId?: string;
  organizationName: string;
  fiscalYearLabel: string;
  /** e.g. "April 1, 2024 to March 31, 2025". */
  periodLabel?: string;
  revenues: OrgStatementLine[];
  expenses: OrgStatementLine[];
  narrative?: string;
  status?: string; // Draft | Final
};

export type OrgStatementCategory = {
  key: string;
  label: string;
  /** Hint that this line is normally a gaming-fund source. */
  gaming?: boolean;
};

/**
 * Revenue categories in the BC example order. Gaming funds (footnote 2) include
 * Community Gaming Grants and licensed gaming events; everything else is General
 * Fund by default. "Itemize and identify all sources of funding. Do not use
 * abbreviations or acronyms" (footnote 3).
 */
export const ORG_REVENUE_CATEGORIES: OrgStatementCategory[] = [
  { key: "federal", label: "Federal" },
  { key: "provincial", label: "Provincial" },
  { key: "municipal", label: "Municipal" },
  { key: "communityGamingGrant", label: "Community Gaming Grant", gaming: true },
  { key: "licensedGaming", label: "Licensed Gaming", gaming: true },
  { key: "donations", label: "Donations" },
  { key: "registrationFees", label: "Registration Fees" },
  { key: "fundraising", label: "Fundraising" },
  { key: "membershipFees", label: "Membership Fees" },
  { key: "interestOther", label: "Interest & Other" },
];

export const ORG_EXPENSE_CATEGORIES: OrgStatementCategory[] = [
  { key: "advertising", label: "Advertising" },
  { key: "bankCharges", label: "Bank Charges" },
  { key: "heatLight", label: "Heat & Light" },
  { key: "insurance", label: "Insurance" },
  { key: "legal", label: "Legal" },
  { key: "miscellaneous", label: "Miscellaneous" },
  { key: "officeSupplies", label: "Office Supplies" },
  { key: "equipmentRentals", label: "Equipment Rentals" },
  { key: "rent", label: "Rent" },
  { key: "telephone", label: "Telephone" },
  { key: "wagesBenefits", label: "Wages & Benefits" },
];

export type OrgStatementColumnTotals = { generalCents: number; gamingCents: number; totalCents: number };
export type OrgStatementTotals = {
  revenue: OrgStatementColumnTotals;
  expense: OrgStatementColumnTotals;
  excess: OrgStatementColumnTotals;
};

export function lineTotalCents(line: OrgStatementLine): number {
  return (line.generalCents || 0) + (line.gamingCents || 0);
}

function sumColumns(lines: OrgStatementLine[]): OrgStatementColumnTotals {
  return lines.reduce(
    (acc, line) => ({
      generalCents: acc.generalCents + (line.generalCents || 0),
      gamingCents: acc.gamingCents + (line.gamingCents || 0),
      totalCents: acc.totalCents + lineTotalCents(line),
    }),
    { generalCents: 0, gamingCents: 0, totalCents: 0 },
  );
}

export function computeOrgStatementTotals(statement: {
  revenues: OrgStatementLine[];
  expenses: OrgStatementLine[];
}): OrgStatementTotals {
  const revenue = sumColumns(statement.revenues);
  const expense = sumColumns(statement.expenses);
  return {
    revenue,
    expense,
    excess: {
      generalCents: revenue.generalCents - expense.generalCents,
      gamingCents: revenue.gamingCents - expense.gamingCents,
      totalCents: revenue.totalCents - expense.totalCents,
    },
  };
}

function blankLines(categories: OrgStatementCategory[]): OrgStatementLine[] {
  return categories.map((category) => ({ key: category.key, label: category.label, generalCents: 0, gamingCents: 0 }));
}

export function blankOrgStatement(input: {
  organizationName?: string;
  fiscalYearLabel: string;
  periodLabel?: string;
}): OrgRevenueStatement {
  return {
    organizationName: input.organizationName ?? "",
    fiscalYearLabel: input.fiscalYearLabel,
    periodLabel: input.periodLabel,
    revenues: blankLines(ORG_REVENUE_CATEGORIES),
    expenses: blankLines(ORG_EXPENSE_CATEGORIES),
    status: "Draft",
  };
}

const REVENUE_MATCHERS: Array<{ key: string; test: RegExp }> = [
  { key: "communityGamingGrant", test: /gaming grant/i },
  { key: "licensedGaming", test: /licen|raffle|gaming event/i },
  { key: "federal", test: /federal/i },
  { key: "provincial", test: /provincial|ministry/i },
  { key: "municipal", test: /municipal|city of/i },
  { key: "donations", test: /donat/i },
  { key: "registrationFees", test: /registration|user fee/i },
  { key: "fundraising", test: /fundrais/i },
  { key: "membershipFees", test: /member/i },
  { key: "interestOther", test: /interest|other|misc/i },
];
const EXPENSE_MATCHERS: Array<{ key: string; test: RegExp }> = [
  { key: "advertising", test: /advert|marketing|promo/i },
  { key: "bankCharges", test: /bank|merchant fee/i },
  { key: "heatLight", test: /heat|light|hydro|utilit/i },
  { key: "insurance", test: /insurance/i },
  { key: "legal", test: /legal|lawyer/i },
  { key: "officeSupplies", test: /office|supplies|stationery/i },
  { key: "equipmentRentals", test: /equipment/i },
  { key: "rent", test: /rent|lease|facilit/i },
  { key: "telephone", test: /phone|telephone|internet|comms?/i },
  { key: "wagesBenefits", test: /wage|salar|payroll|benefit|honorar/i },
];

function matchKey(matchers: Array<{ key: string; test: RegExp }>, category: string, fallback: string): string {
  return matchers.find((m) => m.test.test(category))?.key ?? fallback;
}

/**
 * Best-effort prefill of the General Fund column from a profit-and-loss
 * category breakdown, plus the Gaming Fund column from gaming-grant receipts.
 * Unmatched categories fall into "Interest & Other" (revenue) or "Miscellaneous"
 * (expense) so no amount is dropped.
 */
export function buildOrgStatementFromFinances(input: {
  organizationName?: string;
  fiscalYearLabel: string;
  periodLabel?: string;
  incomeByCategory?: Array<{ category: string; cents: number }>;
  expenseByCategory?: Array<{ category: string; cents: number }>;
  gamingGrantCents?: number;
  licensedGamingCents?: number;
}): OrgRevenueStatement {
  const statement = blankOrgStatement(input);
  const revByKey = new Map(statement.revenues.map((l) => [l.key, l]));
  const expByKey = new Map(statement.expenses.map((l) => [l.key, l]));

  for (const row of input.incomeByCategory ?? []) {
    const key = matchKey(REVENUE_MATCHERS, row.category, "interestOther");
    const line = revByKey.get(key);
    if (line) line.generalCents += row.cents;
  }
  for (const row of input.expenseByCategory ?? []) {
    const key = matchKey(EXPENSE_MATCHERS, row.category, "miscellaneous");
    let line = expByKey.get(key);
    if (!line && key === "miscellaneous") {
      line = { key: "miscellaneous", label: "Miscellaneous", generalCents: 0, gamingCents: 0 };
      statement.expenses.push(line);
      expByKey.set("miscellaneous", line);
    }
    if (line) line.generalCents += row.cents;
  }
  if (input.gamingGrantCents) {
    const line = revByKey.get("communityGamingGrant");
    if (line) line.gamingCents += input.gamingGrantCents;
  }
  if (input.licensedGamingCents) {
    const line = revByKey.get("licensedGaming");
    if (line) line.gamingCents += input.licensedGamingCents;
  }
  return statement;
}

/**
 * The seeded Riverside Community Society example, using the exact figures from
 * the BC Organization Revenue and Expense Statement so the demo reproduces the
 * reference document 1:1. Amounts are in cents.
 */
export function riversideOrgStatement(input: {
  societyId: string;
  fiscalYearLabel: string;
  periodLabel?: string;
}): OrgRevenueStatement {
  return {
    societyId: input.societyId,
    organizationName: "Riverside Community Society",
    fiscalYearLabel: input.fiscalYearLabel,
    periodLabel: input.periodLabel,
    status: "Final",
    revenues: [
      { key: "federal", label: "Federal XYZ Department", generalCents: 400000, gamingCents: 0 },
      { key: "provincial", label: "Provincial ABC Ministry", generalCents: 200000, gamingCents: 0 },
      { key: "municipal", label: "Municipal Funding", generalCents: 100000, gamingCents: 0 },
      { key: "communityGamingGrant", label: "Community Gaming Grant", generalCents: 0, gamingCents: 400000 },
      { key: "licensedGaming", label: "Licensed Gaming", generalCents: 0, gamingCents: 100000 },
      { key: "donations", label: "Donations", generalCents: 100000, gamingCents: 0 },
      { key: "registrationFees", label: "Registration Fees", generalCents: 1500000, gamingCents: 0 },
      { key: "fundraising", label: "Fundraising", generalCents: 200000, gamingCents: 0 },
      { key: "membershipFees", label: "Membership Fees", generalCents: 100000, gamingCents: 0 },
      { key: "interestOther", label: "Interest & Other", generalCents: 125000, gamingCents: 25000 },
    ],
    expenses: [
      { key: "advertising", label: "Advertising", generalCents: 75000, gamingCents: 0 },
      { key: "bankCharges", label: "Bank Charges", generalCents: 6000, gamingCents: 5000 },
      { key: "heatLight", label: "Heat & Light", generalCents: 50000, gamingCents: 100000 },
      { key: "insurance", label: "Insurance", generalCents: 150000, gamingCents: 0 },
      { key: "legal", label: "Legal", generalCents: 25000, gamingCents: 0 },
      { key: "miscellaneous", label: "Miscellaneous", generalCents: 7500, gamingCents: 0 },
      { key: "officeSupplies", label: "Office Supplies", generalCents: 120000, gamingCents: 0 },
      { key: "equipmentRentals", label: "Equipment Rentals", generalCents: 79300, gamingCents: 0 },
      { key: "rent", label: "Rent", generalCents: 400000, gamingCents: 380000 },
      { key: "telephone", label: "Telephone", generalCents: 62200, gamingCents: 0 },
      { key: "wagesBenefits", label: "Wages & Benefits", generalCents: 1300000, gamingCents: 0 },
    ],
    narrative:
      "Organization-wide statement of operations covering all programs and services for the most recently completed fiscal year.",
  };
}
