/**
 * Demo general ledger for Riverside Community Society: the opening-balance
 * entry at the start of the bank feed, then one posted journal entry per
 * categorised bank or card line (the same entries "Post bank transactions to
 * journal" would make), so the books reports have real monthly activity:
 * balance sheet, statement of operations, cash flow and the general ledger.
 *
 *  - Opening balances on 2026-01-01, when the society moved its books into
 *    Societyer: operating and restricted cash and the card balance owed,
 *    against unrestricted and restricted net assets. Earlier bank lines stay
 *    unposted ("before opening balances" in the backfill review).
 *  - Each categorised line posts the bank account against the chart account
 *    its category maps to (DEMO_CATEGORY_ACCOUNTS); restricted-fund lines are
 *    tagged to the youth resilience fund, and program lines carry a program
 *    code, so the fund and program filters have something to show.
 *  - Card payments from chequing post once (Dr card, Cr chequing); the card's
 *    "payment received" leg is the same movement and is skipped.
 *  - Pending and uncategorised ("To review") lines stay unposted, which is
 *    why the ledger trails the bank by those lines until they are reviewed.
 *
 * Also the demo fiscal periods (one per fiscal year, April to March, all still
 * open: the FY 2025-2026 year-end close is the treasurer's next step) and
 * Books settings (books start at the opening entry, accrual basis, no close
 * date yet).
 *
 * Shared by the in-browser demo (src/lib/staticConvexFixtures.ts) and the
 * server seed (shared/functions/seed.ts); callers supply ids. Pure TypeScript:
 * no Convex, DOM or Node imports.
 */
import { isInternalTransfer } from "../transferCategories";
import type { DemoFeedAccountKey } from "./bankFeed";

export type DemoLedgerKey =
  | "netAssets"
  | "restrictedNetAssets"
  | "donations"
  | "grants"
  | "dues"
  | "programFees"
  | "otherIncome"
  | "programSupplies"
  | "payroll"
  | "facilities"
  | "venue"
  | "utilities"
  | "insurance"
  | "professionalFees"
  | "technology"
  | "office"
  | "programEquipment"
  | "advertising"
  | "fundraisingCosts"
  | "travel"
  | "bankFees";

/**
 * Chart accounts the demo ledger posts to (besides the three bank accounts).
 * Callers reuse an existing account with the same code; `parent` makes a
 * sub-account (statements roll it up into the parent).
 */
export const DEMO_LEDGER_ACCOUNTS: Array<{ key: DemoLedgerKey; code: string; name: string; accountType: "Equity" | "Income" | "Expense"; subtype: string; normalBalance: "debit" | "credit"; parent?: DemoLedgerKey }> = [
  { key: "netAssets", code: "3000", name: "Unrestricted net assets", accountType: "Equity", subtype: "net_assets", normalBalance: "credit" },
  { key: "restrictedNetAssets", code: "3100", name: "Restricted net assets", accountType: "Equity", subtype: "restricted_net_assets", normalBalance: "credit" },
  { key: "donations", code: "4000", name: "Donations and fundraising", accountType: "Income", subtype: "donations", normalBalance: "credit" },
  { key: "grants", code: "4100", name: "Grant revenue", accountType: "Income", subtype: "grants", normalBalance: "credit" },
  { key: "dues", code: "4200", name: "Membership dues", accountType: "Income", subtype: "dues", normalBalance: "credit" },
  { key: "programFees", code: "4300", name: "Program fees", accountType: "Income", subtype: "program_revenue", normalBalance: "credit" },
  { key: "otherIncome", code: "4900", name: "Interest and other income", accountType: "Income", subtype: "other_income", normalBalance: "credit" },
  { key: "programSupplies", code: "5000", name: "Program supplies", accountType: "Expense", subtype: "program", normalBalance: "debit" },
  { key: "payroll", code: "5100", name: "Wages and benefits", accountType: "Expense", subtype: "payroll", normalBalance: "debit" },
  { key: "facilities", code: "5200", name: "Facilities and utilities", accountType: "Expense", subtype: "facilities", normalBalance: "debit" },
  { key: "venue", code: "5210", name: "Hall and venue rental", accountType: "Expense", subtype: "facilities", normalBalance: "debit" },
  { key: "utilities", code: "5220", name: "Hydro and utilities", accountType: "Expense", subtype: "facilities", normalBalance: "debit" },
  { key: "insurance", code: "5300", name: "Insurance", accountType: "Expense", subtype: "insurance", normalBalance: "debit" },
  { key: "professionalFees", code: "5400", name: "Professional fees", accountType: "Expense", subtype: "professional_fees", normalBalance: "debit" },
  { key: "technology", code: "5500", name: "Equipment and technology", accountType: "Expense", subtype: "equipment", normalBalance: "debit" },
  { key: "office", code: "5510", name: "Office and software", accountType: "Expense", subtype: "equipment", normalBalance: "debit", parent: "technology" },
  { key: "programEquipment", code: "5520", name: "Program equipment", accountType: "Expense", subtype: "equipment", normalBalance: "debit", parent: "technology" },
  { key: "advertising", code: "5600", name: "Advertising and outreach", accountType: "Expense", subtype: "advertising", normalBalance: "debit" },
  { key: "fundraisingCosts", code: "5700", name: "Fundraising costs", accountType: "Expense", subtype: "fundraising", normalBalance: "debit" },
  { key: "travel", code: "5800", name: "Travel", accountType: "Expense", subtype: "travel", normalBalance: "debit" },
  { key: "bankFees", code: "5900", name: "Bank and processing fees", accountType: "Expense", subtype: "bank_fees", normalBalance: "debit" },
];

/** Bank-feed category → chart account. Facilities splits into venue and utilities by payee. */
export const DEMO_CATEGORY_ACCOUNTS: Record<string, DemoLedgerKey> = {
  Donations: "donations",
  Fundraising: "donations",
  Sponsorship: "donations",
  "Grant revenue": "grants",
  "Membership fees": "dues",
  "Program fees": "programFees",
  "Registration fees": "programFees",
  "Interest & other": "otherIncome",
  "Rental income": "otherIncome",
  // Supplier refunds and reversals are recoveries, shown with other income.
  Refunds: "otherIncome",
  "Program supplies": "programSupplies",
  "Program delivery": "programSupplies",
  "Wages & benefits": "payroll",
  Facilities: "facilities",
  Insurance: "insurance",
  "Professional fees": "professionalFees",
  "Office & technology": "office",
  "Program equipment": "programEquipment",
  Advertising: "advertising",
  "Fundraising costs": "fundraisingCosts",
  Travel: "travel",
  "Bank & processing fees": "bankFees",
};

/** Program / project codes on the demo's income and expense lines. */
export const DEMO_PROGRAM_CODES = {
  programs: "200 - COMMUNITY PROGRAMS",
  youth: "300 - YOUTH RESILIENCE",
  fundraising: "400 - FUNDRAISING",
} as const;

export type DemoLedgerTransaction = {
  /** Id of the stored financialTransactions row. */
  transactionId: string;
  account: DemoFeedAccountKey;
  date: string;
  description: string;
  amountCents: number;
  category?: string;
  status?: string;
};

export type DemoJournalLine = {
  /** A bank account, or a chart account from DEMO_LEDGER_ACCOUNTS. */
  account: DemoFeedAccountKey | DemoLedgerKey;
  side: "debit" | "credit";
  amountCents: number;
  description: string;
  programCode?: string;
  /** Tag the line to the demo's restricted fund. */
  restrictedFund?: boolean;
  transactionId?: string;
};

export type DemoJournalEntry = {
  key: string;
  date: string;
  entryNumber: string;
  memo: string;
  source: "opening_balance" | "financialTransactionBackfill";
  fiscalYear: string;
  transactionId?: string;
  lines: DemoJournalLine[];
};

const FACILITY_VENUE = /hall|rent|venue|room|church|centre|center|booking/i;
const FACILITY_UTILITIES = /hydro|utilit|fortis|gas|water|electric|telus|shaw|rogers|internet|phone/i;

export function demoLedgerAccountFor(row: Pick<DemoLedgerTransaction, "category" | "description">): DemoLedgerKey | null {
  const key = row.category ? DEMO_CATEGORY_ACCOUNTS[row.category] : undefined;
  if (key !== "facilities") return key ?? null;
  if (FACILITY_VENUE.test(row.description)) return "venue";
  if (FACILITY_UTILITIES.test(row.description)) return "utilities";
  return "facilities";
}

function programCodeFor(row: DemoLedgerTransaction, ledger: DemoLedgerKey): string | undefined {
  if (row.account === "restricted") return DEMO_PROGRAM_CODES.youth;
  if (row.category === "Fundraising" || row.category === "Sponsorship" || ledger === "fundraisingCosts") return DEMO_PROGRAM_CODES.fundraising;
  if (ledger === "programFees" || ledger === "programSupplies") return DEMO_PROGRAM_CODES.programs;
  return undefined;
}

/** "2025-2026" for a fiscal year starting in April 2025 (`startMonth` 4); "2026" for a calendar year. */
export function demoFiscalYearLabel(date: string, startMonth = 4) {
  const year = Number(date.slice(0, 4));
  const startYear = Number(date.slice(5, 7)) >= startMonth ? year : year - 1;
  return startMonth === 1 ? String(startYear) : `${startYear}-${startYear + 1}`;
}

/**
 * The opening-balance entry and one entry per categorised, posted bank line
 * between `openingDate` and `asOf`, in date order and numbered JE-1001, ….
 */
export function buildDemoJournal(input: {
  transactions: DemoLedgerTransaction[];
  openingDate: string;
  openingBalances: Record<DemoFeedAccountKey, number>;
  asOf: string;
  fiscalStartMonth?: number;
}): DemoJournalEntry[] {
  const startMonth = input.fiscalStartMonth ?? 4;
  const fiscalYear = (date: string) => demoFiscalYearLabel(date, startMonth);
  const { operating, restricted, card } = input.openingBalances;
  // A negative card balance is what the society owes on it.
  const cardOwed = Math.max(0, -card);
  const opening: DemoJournalEntry = {
    key: "opening",
    date: input.openingDate,
    entryNumber: `OB-${fiscalYear(input.openingDate)}`,
    memo: "Opening balances",
    source: "opening_balance",
    fiscalYear: fiscalYear(input.openingDate),
    lines: [
      { account: "operating", side: "debit", amountCents: operating, description: "Opening operating cash" },
      { account: "restricted", side: "debit", amountCents: restricted, description: "Opening restricted grant cash", restrictedFund: true },
      ...(cardOwed ? [{ account: "card" as const, side: "credit" as const, amountCents: cardOwed, description: "Opening card balance owed" }] : []),
      { account: "restrictedNetAssets", side: "credit", amountCents: restricted, description: "Opening restricted net assets", restrictedFund: true },
      { account: "netAssets", side: "credit", amountCents: operating - cardOwed, description: "Opening unrestricted net assets" },
    ],
  };
  const rows = input.transactions
    .filter((row) => row.date >= input.openingDate && row.date <= input.asOf && row.status !== "pending" && row.amountCents !== 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.transactionId.localeCompare(b.transactionId));
  const entries: DemoJournalEntry[] = [];
  for (const row of rows) {
    const absolute = Math.abs(row.amountCents);
    const inflow = row.amountCents > 0;
    if (isInternalTransfer(row)) {
      // Paying the card from chequing; the card's "payment received" leg is the same movement.
      if (row.account !== "operating" || inflow) continue;
      entries.push({
        key: row.transactionId,
        date: row.date,
        entryNumber: "",
        memo: row.description,
        source: "financialTransactionBackfill",
        fiscalYear: fiscalYear(row.date),
        transactionId: row.transactionId,
        lines: [
          { account: "card", side: "debit", amountCents: absolute, description: row.description, transactionId: row.transactionId },
          { account: "operating", side: "credit", amountCents: absolute, description: row.description, transactionId: row.transactionId },
        ],
      });
      continue;
    }
    const ledger = demoLedgerAccountFor(row);
    if (!ledger) continue;
    const restrictedFund = row.account === "restricted" || undefined;
    const programCode = programCodeFor(row, ledger);
    entries.push({
      key: row.transactionId,
      date: row.date,
      entryNumber: "",
      memo: row.description,
      source: "financialTransactionBackfill",
      fiscalYear: fiscalYear(row.date),
      transactionId: row.transactionId,
      lines: [
        { account: row.account, side: inflow ? "debit" : "credit", amountCents: absolute, description: row.description, restrictedFund, transactionId: row.transactionId },
        { account: ledger, side: inflow ? "credit" : "debit", amountCents: absolute, description: row.category ?? row.description, programCode, restrictedFund, transactionId: row.transactionId },
      ],
    });
  }
  entries.forEach((entry, index) => { entry.entryNumber = `JE-${1001 + index}`; });
  return [opening, ...entries];
}

export type DemoFiscalPeriod = { key: string; fiscalYear: string; periodLabel: string; startDate: string; endDate: string; status: "open" };

/** One open period per fiscal year from the opening date through `asOf`. */
export function demoFiscalPeriods(openingDate: string, asOf: string, startMonth = 4): DemoFiscalPeriod[] {
  const periods: DemoFiscalPeriod[] = [];
  let startYear = Number(demoFiscalYearLabel(openingDate, startMonth).slice(0, 4));
  for (;;) {
    const startDate = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
    if (startDate > asOf) break;
    const endYear = startMonth === 1 ? startYear : startYear + 1;
    const endMonth = startMonth === 1 ? 12 : startMonth - 1;
    const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-${String(new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate()).padStart(2, "0")}`;
    const fiscalYear = demoFiscalYearLabel(startDate, startMonth);
    periods.push({ key: fiscalYear, fiscalYear, periodLabel: `FY ${fiscalYear}`, startDate, endDate, status: "open" });
    startYear += 1;
  }
  return periods;
}

/** Books settings for the demo: the books start at the opening entry, on the accrual basis. */
export function demoBooksSettings(openingDate: string) {
  return { booksStartDate: openingDate, accountingBasis: "accrual" as const };
}

/** Bank balances at the end of `date`, from the feed's opening balances and rows (fixed rows included). */
export function demoBalancesAt(feed: { rows: Array<{ account: DemoFeedAccountKey; date: string; amountCents: number }>; openingBalances: Record<DemoFeedAccountKey, number> }, date: string, extraRows: Array<{ account: DemoFeedAccountKey; date: string; amountCents: number }> = []) {
  const balances = { ...feed.openingBalances };
  for (const row of [...feed.rows, ...extraRows]) if (row.date <= date) balances[row.account] += row.amountCents;
  return balances;
}
