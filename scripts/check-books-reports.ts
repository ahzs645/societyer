// Books reports gate: the pure multi-period report maths in
// shared/booksReports.ts (period bucketing including the running MTD/QTD/YTD
// column, account-hierarchy subtotals, cash vs accrual basis, cash flow,
// dimension filters, the general ledger), the runway and insight sentences in
// shared/financeNarrative.ts, the books close date refusing every journal
// write path, and the reports' tag filter (URL state, one dimension per tag
// group, tagged demo bank and bill lines found by it). Runs on a MemoryDb; no
// live backend.

import assert from "node:assert/strict";
import { MemoryDb, PortableRuntime, definePortableMutation, definePortableQuery, makeCapabilities } from "../shared/portable/index";
import type { PortableMutationCtx, PortableQueryCtx } from "../shared/portable/ctx";
import {
  buildBalanceSheet,
  buildCashFlow,
  buildChartRegister,
  buildGeneralLedgerReport,
  buildJournalRegister,
  buildReportPeriods,
  buildStatementOfOperations,
  closedBooksError,
  entryCountsForBasis,
  fiscalYearStartMonth,
  journalBasisOf,
  lineMatchesFilter,
  reportDrillLines,
  TOTAL_COLUMN,
  type BooksAccount,
  type BooksEntry,
  type BooksLine,
  type BooksReport,
  type BooksReportRow,
} from "../shared/booksReports";
import { comparisonRange, moneyOutTrend, runway, topMoneyInSources } from "../shared/financeNarrative";
import {
  backfillFinancialTransactionsToJournalPortable,
  closeFiscalPeriodPortable,
  postOpeningBalancesPortable,
  reopenFiscalPeriodPortable,
  updateBooksSettingsPortable,
  upsertJournalEntryPortable,
  voidJournalEntryPortable,
  booksReportPortable,
  booksSettingsPortable,
  generalLedgerReportPortable,
} from "../shared/functions/accounting";
import { describeFilter, dimensionParamValue, readFilterState, toReportFilter } from "../src/features/financials/reports/reportFilters";
import { portableTestPrincipal, seedPortableTestMembership } from "./portable-test-fixture";

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`✓ ${label}`);
}
async function checkAsync(label: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`✓ ${label}`);
}

/* ---------------------------------------------------------- period buckets */

check("monthly columns end with a running MTD column", () => {
  const periods = buildReportPeriods({ from: "2026-01-01", to: "2026-12-31", frequency: "month", today: "2026-10-18" });
  assert.equal(periods.length, 10);
  assert.deepEqual(periods.slice(0, 2).map((p) => [p.label, p.start, p.end]), [["Jan 2026", "2026-01-01", "2026-01-31"], ["Feb 2026", "2026-02-01", "2026-02-28"]]);
  const last = periods[periods.length - 1];
  assert.equal(last.label, "Oct MTD");
  assert.equal(last.toDate, "MTD");
  assert.equal(last.start, "2026-10-01");
  assert.equal(last.end, "2026-10-18");
  assert.equal(last.clipped, false);
});

check("quarters and years follow the fiscal year; the running one is QTD / YTD", () => {
  assert.equal(fiscalYearStartMonth("03-31"), 4);
  assert.equal(fiscalYearStartMonth("12-31"), 1);
  assert.equal(fiscalYearStartMonth(null), 1);
  assert.equal(fiscalYearStartMonth("06-30"), 7);
  const calendar = buildReportPeriods({ from: "2026-01-01", to: "2026-10-18", frequency: "quarter", today: "2026-10-18" });
  assert.deepEqual(calendar.map((p) => p.label), ["Q1 2026", "Q2 2026", "Q3 2026", "Q4 QTD"]);
  const fiscal = buildReportPeriods({ from: "2026-01-01", to: "2026-10-18", frequency: "quarter", today: "2026-10-18", fiscalStartMonth: 4 });
  assert.deepEqual(fiscal.map((p) => [p.label, p.start, p.end]), [
    ["Q4 FY2025-26", "2026-01-01", "2026-03-31"],
    ["Q1 FY2026-27", "2026-04-01", "2026-06-30"],
    ["Q2 FY2026-27", "2026-07-01", "2026-09-30"],
    ["Q3 QTD", "2026-10-01", "2026-10-18"],
  ]);
  const years = buildReportPeriods({ from: "2025-04-01", to: "2026-10-18", frequency: "year", today: "2026-10-18", fiscalStartMonth: 4 });
  assert.deepEqual(years.map((p) => [p.label, p.toDate]), [["FY2025-26", null], ["FY2026-27 YTD", "YTD"]]);
});

check("a past range ends where it was cut, without a to-date label", () => {
  const periods = buildReportPeriods({ from: "2026-01-15", to: "2026-06-15", frequency: "month", today: "2026-10-18" });
  assert.equal(periods[0].clipped, true);
  assert.equal(periods[0].start, "2026-01-15");
  const last = periods[periods.length - 1];
  assert.deepEqual([last.label, last.end, last.toDate, last.clipped], ["Jun 2026", "2026-06-15", null, true]);
  assert.throws(() => buildReportPeriods({ from: "2026-02-01", to: "2026-01-01", frequency: "month", today: "2026-10-18" }), /valid report date range/);
  assert.throws(() => buildReportPeriods({ from: "2000-01-01", to: "2026-01-01", frequency: "month", today: "2026-10-18" }), /more than 60 columns/);
});

/* -------------------------------------------------------- a small ledger */

const accounts: BooksAccount[] = [
  { _id: "cash", code: "1000", name: "Operating chequing", accountType: "Bank", currency: "CAD" },
  { _id: "savings", code: "1010", name: "Reserve savings", accountType: "Bank", currency: "CAD" },
  { _id: "ar", code: "1100", name: "Accounts receivable", accountType: "Asset", subtype: "receivable", currency: "CAD" },
  { _id: "equipment", code: "1500", name: "Capital assets", accountType: "Asset", subtype: "fixed_asset", currency: "CAD" },
  { _id: "visa", code: "2100", name: "Organization Visa", accountType: "Credit", subtype: "credit_card", currency: "CAD", normalBalance: "credit" },
  { _id: "net_assets", code: "3000", name: "Unrestricted net assets", accountType: "Equity", currency: "CAD" },
  { _id: "donations", code: "4000", name: "Donations", accountType: "Income", currency: "CAD" },
  { _id: "programs", code: "4300", name: "Program fees", accountType: "Income", currency: "CAD" },
  { _id: "facilities", code: "5200", name: "Facilities and utilities", accountType: "Expense", currency: "CAD" },
  { _id: "venue", code: "5210", name: "Hall and venue rental", accountType: "Expense", currency: "CAD", parentAccountId: "facilities" },
  { _id: "hydro", code: "5220", name: "Hydro and utilities", accountType: "Expense", currency: "CAD", parentAccountId: "facilities" },
  { _id: "supplies", code: "5000", name: "Program supplies", accountType: "Expense", currency: "CAD" },
];

const entries: BooksEntry[] = [];
const lines: BooksLine[] = [];
function post(id: string, date: string, legs: Array<[string, "debit" | "credit", number, Partial<BooksLine>?]>, extra: Partial<BooksEntry> = {}) {
  entries.push({ _id: id, date, status: "posted", source: "manual", memo: id, ...extra });
  legs.forEach(([accountId, side, amountCents, more], index) => lines.push({ _id: `${id}:${index}`, journalEntryId: id, accountId, side, amountCents, lineOrder: index, ...more }));
}
post("opening", "2026-01-01", [["cash", "debit", 1_000_000], ["net_assets", "credit", 1_000_000]], { source: "opening_balance" });
post("donation-jan", "2026-01-10", [["cash", "debit", 200_000], ["donations", "credit", 200_000, { programCode: "GALA" }]]);
post("rent-jan", "2026-01-15", [["venue", "debit", 50_000], ["cash", "credit", 50_000]]);
post("hydro-feb", "2026-02-03", [["hydro", "debit", 12_000], ["cash", "credit", 12_000]]);
post("parent-feb", "2026-02-05", [["facilities", "debit", 3_000], ["cash", "credit", 3_000]]);
post("projector-feb", "2026-02-20", [["equipment", "debit", 90_000], ["cash", "credit", 90_000]]);
post("transfer-feb", "2026-02-25", [["savings", "debit", 100_000], ["cash", "credit", 100_000]]);
post("card-mar", "2026-03-02", [["supplies", "debit", 25_000, { tagIds: ["tag-youth"], programCode: "YOUTH" }], ["visa", "credit", 25_000]]);
post("card-payment-mar", "2026-03-20", [["visa", "debit", 25_000], ["cash", "credit", 25_000]]);
// An invoice: accrued in January, paid in March, with the cash-basis recognition on payment.
post("invoice", "2026-01-20", [["ar", "debit", 40_000, { counterpartyId: "cp-school" }], ["programs", "credit", 40_000]], { basis: "accrual-only" });
post("invoice-payment", "2026-03-05", [["cash", "debit", 40_000], ["ar", "credit", 40_000]], { source: "invoice_payment", basis: "both" });
post("invoice-cash", "2026-03-05", [["ar", "debit", 40_000], ["programs", "credit", 40_000]], { source: "invoice_cash_basis" });
// Neither drafts nor voided entries count.
entries.push({ _id: "draft", date: "2026-02-10", status: "draft", source: "manual" });
lines.push({ _id: "draft:0", journalEntryId: "draft", accountId: "cash", side: "debit", amountCents: 999 }, { _id: "draft:1", journalEntryId: "draft", accountId: "donations", side: "credit", amountCents: 999 });

const quarterOne = buildReportPeriods({ from: "2026-01-01", to: "2026-03-31", frequency: "month", today: "2026-10-18" });
const [jan, feb, mar] = quarterOne.map((period) => period.id);
const base = { accounts, entries, lines, periods: quarterOne };

function find(rows: BooksReportRow[], id: string): BooksReportRow {
  for (const row of rows) {
    if (row.id === id) return row;
    const nested = row.children ? findOrNull(row.children, id) : null;
    if (nested) return nested;
  }
  throw new Error(`row ${id} not found`);
}
function findOrNull(rows: BooksReportRow[], id: string): BooksReportRow | null {
  try { return find(rows, id); } catch { return null; }
}
const values = (report: BooksReport, id: string) => find(report.rows, id).values ?? {};

check("statement of operations nests sub-accounts with subtotals and a Total column", () => {
  const report = buildStatementOfOperations({ ...base, basis: "accrual" });
  assert.equal(report.totalColumn, TOTAL_COLUMN);
  const facilities = find(report.rows, "expenses:facilities");
  assert.deepEqual(facilities.children?.map((row) => row.id), ["expenses:facilities:own", "expenses:venue", "expenses:hydro"]);
  assert.deepEqual(facilities.values, { [jan]: 50_000, [feb]: 15_000, [mar]: 0, [TOTAL_COLUMN]: 65_000 });
  assert.deepEqual(find(report.rows, "expenses:facilities:own").values?.[feb], 3_000);
  assert.deepEqual(facilities.drill?.accountIds.sort(), ["facilities", "hydro", "venue"]);
  assert.deepEqual(values(report, "subtotal:revenue"), { [jan]: 240_000, [feb]: 0, [mar]: 0, [TOTAL_COLUMN]: 240_000 });
  assert.deepEqual(values(report, "subtotal:expenses"), { [jan]: 50_000, [feb]: 15_000, [mar]: 25_000, [TOTAL_COLUMN]: 90_000 });
  assert.deepEqual(values(report, "total:net"), { [jan]: 190_000, [feb]: -15_000, [mar]: -25_000, [TOTAL_COLUMN]: 150_000 });
  assert.deepEqual(report.summary.map((point) => point.values.net), [190_000, -15_000, -25_000]);
});

check("balance sheet: closing balances, current vs capital assets, unclosed surplus, and it balances", () => {
  const report = buildBalanceSheet({ ...base, basis: "accrual" });
  assert.equal(report.totalColumn, null);
  assert.deepEqual(report.warnings, []);
  // Cash: 10,000 + 2,000 − 500 (Jan) − 120 − 30 − 900 − 1,000 (Feb) + 400 − 250 (Mar).
  assert.deepEqual(values(report, "current_assets:cash"), { [jan]: 1_150_000, [feb]: 945_000, [mar]: 960_000 });
  // Invoiced in January, paid in March.
  assert.deepEqual(values(report, "current_assets:ar"), { [jan]: 40_000, [feb]: 40_000, [mar]: 0 });
  assert.deepEqual(values(report, "subtotal:capital_assets"), { [jan]: 0, [feb]: 90_000, [mar]: 90_000 });
  const unclosed = values(report, "net_assets:unclosed");
  assert.deepEqual(unclosed, { [jan]: 190_000, [feb]: 175_000, [mar]: 150_000 });
  for (const id of [jan, feb, mar]) {
    assert.equal(values(report, "subtotal:assets")[id], values(report, "total:liabilities_net_assets")[id], `balanced in ${id}`);
  }
  assert.equal(report.summary[1].values.workingCapital, 945_000 + 100_000 + 40_000);
  assert.equal(report.summary[2].values.workingCapital, 960_000 + 100_000);
});

check("cash basis drops the accrual and recognises revenue on payment", () => {
  assert.equal(journalBasisOf({ source: "invoice" }), "accrual-only");
  assert.equal(journalBasisOf({ source: "bill_cash_basis" }), "cash-only");
  assert.equal(journalBasisOf({ source: "manual" }), "both");
  assert.equal(journalBasisOf({ source: "invoice", basis: "both" }), "both");
  assert.equal(entryCountsForBasis({ basis: "accrual-only" }, "cash"), false);
  assert.equal(entryCountsForBasis({ basis: "cash-only" }, "accrual"), false);
  const accrual = buildStatementOfOperations({ ...base, basis: "accrual" });
  const cash = buildStatementOfOperations({ ...base, basis: "cash" });
  assert.deepEqual(values(accrual, "revenue:programs"), { [jan]: 40_000, [feb]: 0, [mar]: 0, [TOTAL_COLUMN]: 40_000 });
  assert.deepEqual(values(cash, "revenue:programs"), { [jan]: 0, [feb]: 0, [mar]: 40_000, [TOTAL_COLUMN]: 40_000 });
  const cashSheet = buildBalanceSheet({ ...base, basis: "cash" });
  assert.equal(findOrNull(cashSheet.rows, "current_assets:ar"), null, "no receivable under cash basis");
  assert.deepEqual(cashSheet.warnings, []);
});

check("cash flow: opening balances start the cash, activities add up, transfers net out", () => {
  const report = buildCashFlow({ ...base, basis: "accrual" });
  assert.deepEqual(report.warnings, []);
  const begin = values(report, "cash:beginning");
  const end = values(report, "cash:ending");
  // Opening balance (10,000) is starting cash, not a flow. The savings transfer is cash to cash.
  assert.deepEqual(begin, { [jan]: 1_000_000, [feb]: 1_150_000, [mar]: 1_045_000, [TOTAL_COLUMN]: 1_000_000 });
  assert.deepEqual(end, { [jan]: 1_150_000, [feb]: 1_045_000, [mar]: 1_060_000, [TOTAL_COLUMN]: 1_060_000 });
  assert.deepEqual(values(report, "subtotal:investing"), { [jan]: 0, [feb]: -90_000, [mar]: 0, [TOTAL_COLUMN]: -90_000 });
  assert.deepEqual(values(report, "operating:visa"), { [jan]: 0, [feb]: 0, [mar]: -25_000, [TOTAL_COLUMN]: -25_000 });
  assert.deepEqual(values(report, "total:movement"), { [jan]: 150_000, [feb]: -105_000, [mar]: 15_000, [TOTAL_COLUMN]: 60_000 });
  assert.equal(findOrNull(report.rows, "financing:net_assets"), null, "the opening entry is not a financing inflow");
  const drill = reportDrillLines({ accounts, entries, lines, basis: "accrual", accountIds: ["ar"], scope: "cash", start: "2026-03-01", end: "2026-03-31" });
  assert.deepEqual(drill.map((line) => line._id), ["invoice-payment:1"], "cash drilldown shows the other side of the cash entry");
});

check("a filtered cash flow starts from all cash and ends at start plus the filtered change", () => {
  const gala = buildCashFlow({ ...base, basis: "accrual", filter: { dimensions: [{ kind: "programCode", values: ["GALA"] }] } });
  assert.deepEqual(values(gala, "cash:beginning"), { [jan]: 1_000_000, [feb]: 1_150_000, [mar]: 1_045_000, [TOTAL_COLUMN]: 1_000_000 }, "bank lines carry no program, so the starting cash is unfiltered");
  assert.deepEqual(values(gala, "total:movement"), { [jan]: 200_000, [feb]: 0, [mar]: 0, [TOTAL_COLUMN]: 200_000 });
  assert.deepEqual(values(gala, "cash:ending"), { [jan]: 1_200_000, [feb]: 1_150_000, [mar]: 1_045_000, [TOTAL_COLUMN]: 1_200_000 }, "ending cash is the start plus the filtered net change");
  assert.deepEqual(gala.warnings, [], "the books balance, so no mismatch warning under a filter either");
  assert.match(String(gala.rows.find((row) => row.id === "cash:ending")?.note), /filtered net change/);
  const broken = buildCashFlow({ ...base, basis: "accrual", lines: [...lines, { _id: "orphan", journalEntryId: "donation-jan", accountId: "cash", side: "debit", amountCents: 1, lineOrder: 9 }], filter: { dimensions: [{ kind: "programCode", values: ["GALA"] }] } });
  assert.equal(broken.warnings.length, 1, "an unbalanced cash entry is still flagged with a filter on");
});

check("the chart register counts each invoice once, on the books' basis", () => {
  for (const basis of ["accrual", "cash"] as const) {
    const register = buildChartRegister({ accounts, entries, lines, basis });
    assert.equal(register.find((row) => row._id === "programs")?.balanceCents, 40_000, `${basis}: the accrual or its cash-basis recognition, not both`);
    assert.equal(register.find((row) => row._id === "ar")?.balanceCents, 0);
  }
});

check("fund and dimension filters narrow lines; unknown dimensions are refused", () => {
  const youth = buildStatementOfOperations({ ...base, basis: "accrual", filter: { dimensions: [{ kind: "programCode", values: ["YOUTH"] }] } });
  assert.deepEqual(values(youth, "subtotal:expenses")[TOTAL_COLUMN], 25_000);
  assert.equal(youth.filtered, true);
  const tagged = buildStatementOfOperations({ ...base, basis: "accrual", filter: { dimensions: [{ kind: "tag", values: ["tag-youth"] }] } });
  assert.deepEqual(values(tagged, "subtotal:expenses")[TOTAL_COLUMN], 25_000);
  const unallocated = buildStatementOfOperations({ ...base, basis: "accrual", filter: { dimensions: [{ kind: "programCode", values: ["Unallocated"] }] } });
  assert.deepEqual(values(unallocated, "subtotal:revenue")[TOTAL_COLUMN], 40_000);
  assert.throws(() => buildStatementOfOperations({ ...base, basis: "accrual", filter: { dimensions: [{ kind: "colour", values: ["red"] }] } }), /Unsupported report filter/);
});

check("general ledger: contra accounts, counterparties and a running balance for one account", () => {
  const ledger = buildGeneralLedgerReport({
    accounts, entries, lines, basis: "accrual", from: "2026-02-01", to: "2026-03-31", accountId: "facilities",
    counterpartyNames: new Map([["cp-school", "Riverside School"]]),
  });
  assert.equal(ledger.account?.openingBalanceCents, 50_000);
  assert.deepEqual(ledger.rows.map((row) => [row.account.code, row.debitCents, row.balanceCents]), [["5220", 12_000, 62_000], ["5200", 3_000, 65_000]]);
  assert.deepEqual(ledger.rows[0].contraAccounts.map((ref) => ref.code), ["1000"]);
  assert.equal(ledger.account?.closingBalanceCents, 65_000);
  const all = buildGeneralLedgerReport({ accounts, entries, lines, basis: "accrual", from: "2026-01-01", to: "2026-01-31", counterpartyNames: new Map([["cp-school", "Riverside School"]]) });
  assert.equal(all.rows.find((row) => row.lineId === "invoice:1")?.counterparty, "Riverside School", "a line inherits its entry's counterparty");
  assert.equal(all.rows[0].balanceCents, undefined, "no running balance across accounts");
  assert.equal(all.totals.debitCents, all.totals.creditCents);
});

check("journal register lists debit and credit accounts, sections and lock state", () => {
  const register = buildJournalRegister({ accounts, entries, lines, closeDate: "2026-01-31" });
  const card = register.find((row) => row.entryId === "card-mar");
  assert.deepEqual(card?.debitAccounts.map((ref) => ref.code), ["5000"]);
  assert.deepEqual(card?.creditAccounts.map((ref) => ref.code), ["2100"]);
  assert.deepEqual(card?.sections.sort(), ["expenses", "liabilities"]);
  assert.equal(card?.amountCents, 25_000);
  assert.equal(register.find((row) => row.entryId === "rent-jan")?.locked, true);
  assert.equal(card?.locked, false);
  assert.equal(register.find((row) => row.entryId === "invoice")?.basis, "accrual-only");
});

/* ------------------------------------------------------------ runway maths */

check("runway: balance over the average net burn of the last 3 completed months", () => {
  const txns = [
    { date: "2026-06-15", amountCents: 500_000, category: "Grant revenue" },
    { date: "2026-07-05", amountCents: 100_000, category: "Donations" },
    { date: "2026-07-20", amountCents: -400_000, category: "Wages" },
    { date: "2026-08-05", amountCents: 100_000, category: "Donations" },
    { date: "2026-08-20", amountCents: -400_000, category: "Wages" },
    { date: "2026-09-05", amountCents: 100_000, category: "Donations" },
    { date: "2026-09-20", amountCents: -400_000, category: "Wages" },
    { date: "2026-09-25", amountCents: -999_999, category: "Transfer" },
    // The running month is not part of the window.
    { date: "2026-10-02", amountCents: -5_000_000, category: "Wages" },
  ];
  const result = runway(txns, 3_000_000, "2026-10-18");
  assert.equal(result.status, "burning");
  assert.deepEqual(result.window, { start: "2026-07-01", end: "2026-09-30" });
  assert.equal(result.averageNetBurnCents, 300_000);
  assert.equal(result.runwayMonths, 10);
  assert.match(result.sentence, /total \$30\.0K with a net burn of \$3,000 a month, so cash lasts about 10 months/);
  assert.match(result.sentence, /last 3 fully completed months \(Jul–Sep 2026\)/);
});

check("runway is not applicable without a burn, and waits for enough history", () => {
  const growing = runway([
    { date: "2026-06-30", amountCents: 1 },
    { date: "2026-07-10", amountCents: 200_000 }, { date: "2026-07-11", amountCents: -100_000 },
    { date: "2026-08-10", amountCents: 200_000 }, { date: "2026-08-11", amountCents: -100_000 },
    { date: "2026-09-10", amountCents: 200_000 }, { date: "2026-09-11", amountCents: -100_000 },
  ], 500_000, "2026-10-18");
  assert.equal(growing.status, "not_burning");
  assert.equal(growing.runwayMonths, null);
  assert.match(growing.sentence, /no burn and runway isn't applicable/);
  const young = runway([{ date: "2026-08-10", amountCents: -100 }], 500_000, "2026-10-18");
  assert.equal(young.status, "not_enough_history");
  assert.equal(young.runwayMonths, null);
});

check("money-out trend and top money-in sources", () => {
  const txns = [
    { date: "2025-09-10", amountCents: -100_000 },
    { date: "2026-08-10", amountCents: -100_000 },
    { date: "2026-09-10", amountCents: -150_000 },
    { date: "2026-09-12", amountCents: 300_000, category: "Grant revenue" },
    { date: "2026-09-13", amountCents: 100_000, category: "Donations" },
    { date: "2026-09-14", amountCents: 100_000, category: "" , counterparty: "Harbour Print" },
  ];
  const september = { start: "2026-09-01", end: "2026-09-30" };
  assert.deepEqual(comparisonRange(september, "previous"), { start: "2026-08-02", end: "2026-08-31" });
  assert.deepEqual(comparisonRange(september, "lastYear"), { start: "2025-09-01", end: "2025-09-30" });
  assert.match(moneyOutTrend(txns, september, "lastYear").sentence, /up 50\.0% from \$1,000 in the same period last year/);
  const top = topMoneyInSources(txns, september);
  assert.deepEqual(top.rows.map((row) => [row.label, Math.round(row.share * 100)]), [["Grant revenue", 60], ["Donations", 20], ["Harbour Print", 20]]);
  assert.match(top.sentence, /Grant revenue \$3,000 \(60%\)/);
});

/* ---------------------------------------------------- the lock date (writes) */

check("closedBooksError names the close date and the admin fix", () => {
  assert.equal(closedBooksError(null, ["2026-01-01"]), null);
  assert.equal(closedBooksError("2026-03-31", ["2026-04-01"]), null);
  assert.match(closedBooksError("2026-03-31", ["2026-04-01", "2026-03-31"]) ?? "", /closed through 2026-03-31, so entries dated 2026-03-31 can't be posted, edited or voided\. An admin can move the close date in Books settings\./);
});

const db = new MemoryDb({ seed: {} });
const caps = makeCapabilities({});
let counter = 0;
const runtime = () => new PortableRuntime({ db, capabilities: caps, principalProvider: portableTestPrincipal });
function mutate<R>(handler: (ctx: PortableMutationCtx) => Promise<R>): Promise<R> {
  const name = `books:m${(counter += 1)}`;
  return runtime().register(definePortableMutation({ name, handler: (ctx: PortableMutationCtx) => handler(ctx) })).runMutation<R>(name, {});
}
function read<R>(handler: (ctx: PortableQueryCtx) => Promise<R>): Promise<R> {
  const name = `books:q${(counter += 1)}`;
  return runtime().register(definePortableQuery({ name, handler: (ctx: PortableQueryCtx) => handler(ctx) })).runQuery<R>(name, {});
}
async function refused(label: string, pattern: RegExp, fn: () => Promise<unknown>) {
  await assert.rejects(fn, (error: unknown) => {
    assert.ok(error instanceof Error, label);
    assert.match(error.message, pattern, label);
    return true;
  }, label);
}

const ids = await mutate(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "Lock Co", fiscalYearEnd: "12-31" });
  await seedPortableTestMembership(ctx, societyId);
  const connectionId = await ctx.db.insert("financialConnections", { societyId, provider: "societyer", status: "connected", accountLabel: "Ledger", syncMode: "internal", connectedAtISO: "2026-01-01T00:00:00.000Z", demo: false });
  const account = (code: string, name: string, accountType: string) => ctx.db.insert("financialAccounts", { societyId, connectionId, externalId: `societyer:${code}`, code, name, currency: "CAD", accountType, balanceCents: 0, isRestricted: false });
  const cash = await account("1000", "Chequing", "Bank");
  const revenue = await account("4000", "Donations", "Income");
  const equity = await account("3000", "Net assets", "Equity");
  const expense = await account("5000", "Supplies", "Expense");
  const period = await ctx.db.insert("accountingFiscalPeriods", { societyId, fiscalYear: "2026", periodLabel: "Q1 2026", startDate: "2026-01-01", endDate: "2026-03-31", status: "open", createdAtISO: "2026-01-01T00:00:00.000Z", updatedAtISO: "2026-01-01T00:00:00.000Z" });
  const transaction = await ctx.db.insert("financialTransactions", { societyId, connectionId, accountId: cash, externalId: "tx-1", date: "2026-02-10", description: "Supplies", amountCents: -5_000, category: "Supplies" });
  await ctx.db.insert("financialTransactions", { societyId, connectionId, accountId: cash, externalId: "tx-2", date: "2026-05-10", description: "Supplies", amountCents: -7_000, category: "Supplies" });
  await ctx.db.insert("accountingAccountMappings", { societyId, provider: "societyer", externalAccountName: "Supplies", externalCategory: "Supplies", financialAccountId: expense, status: "active", createdAtISO: "2026-01-01T00:00:00.000Z", updatedAtISO: "2026-01-01T00:00:00.000Z" });
  return { societyId, cash, revenue, equity, expense, period, transaction };
});

const journal = (date: string, id?: string) => mutate((ctx) => upsertJournalEntryPortable(ctx, {
  id,
  societyId: ids.societyId,
  date,
  memo: "Donation",
  source: "manual",
  status: "posted",
  lines: [
    { accountId: ids.cash, side: "debit", amountCents: 10_000 },
    { accountId: ids.revenue, side: "credit", amountCents: 10_000 },
  ],
}));

await checkAsync("the close date refuses posting, editing, voiding and opening balances on or before it", async () => {
  const february = await journal("2026-02-15");
  const april = await journal("2026-04-15");
  await mutate((ctx) => updateBooksSettingsPortable(ctx, { societyId: ids.societyId, closeDate: "2026-03-31" }));
  const settings = await read((ctx) => booksSettingsPortable(ctx, { societyId: ids.societyId }));
  assert.equal(settings.closeDate, "2026-03-31");
  await refused("post into the closed books", /closed through 2026-03-31, so entries dated 2026-03-15 can't be posted/, () => journal("2026-03-15"));
  await refused("edit a locked entry", /can't be posted or edited/, () => journal("2026-04-20", february));
  await refused("move an open entry into the locked range", /closed through 2026-03-31/, () => journal("2026-03-01", april));
  await journal("2026-04-20", april);
  await refused("void a locked entry", /can't be voided/, () => mutate((ctx) => voidJournalEntryPortable(ctx, { id: february })));
  await refused("opening balances in the closed books", /closed through/, () => mutate((ctx) => postOpeningBalancesPortable(ctx, {
    societyId: ids.societyId,
    date: "2026-01-01",
    lines: [{ accountId: ids.cash, side: "debit", amountCents: 1 }, { accountId: ids.equity, side: "credit", amountCents: 1 }],
  })));
  await refused("reopen a period the close date covers", /Move the close date in Books settings before reopening/, () => mutate((ctx) => reopenFiscalPeriodPortable(ctx, { id: ids.period })));
  await refused("a close date in the future", /can't be in the future/, () => mutate((ctx) => updateBooksSettingsPortable(ctx, { societyId: ids.societyId, closeDate: "2999-01-01" })));
});

await checkAsync("the bank backfill skips transactions in the closed books", async () => {
  const result = await mutate((ctx) => backfillFinancialTransactionsToJournalPortable(ctx, { societyId: ids.societyId }));
  assert.equal(result.skippedLocked, 1);
  assert.equal(result.posted, 1);
});

await checkAsync("moving the close date back reopens the books; closing a period can lock them", async () => {
  await mutate((ctx) => updateBooksSettingsPortable(ctx, { societyId: ids.societyId, closeDate: null }));
  await journal("2026-03-15");
  await mutate((ctx) => closeFiscalPeriodPortable(ctx, { id: ids.period, lockBooks: true }));
  const settings = await read((ctx) => booksSettingsPortable(ctx, { societyId: ids.societyId }));
  assert.equal(settings.closeDate, "2026-03-31");
  assert.equal(settings.lastClosedPeriod?.endDate, "2026-03-31");
  await refused("locked again", /closed through 2026-03-31/, () => journal("2026-03-16"));
});

await checkAsync("journal edits check the old date's period and the source; a future period can't lock the books", async () => {
  const q2 = await mutate((ctx) => ctx.db.insert("accountingFiscalPeriods", { societyId: ids.societyId, fiscalYear: "2026", periodLabel: "Q2 2026", startDate: "2026-04-01", endDate: "2026-06-30", status: "closed", createdAtISO: "2026-07-01T00:00:00.000Z", updatedAtISO: "2026-07-01T00:00:00.000Z" }));
  const [april] = await read(async (ctx) => (await ctx.db.query("journalEntries").collect()).filter((entry) => entry.date === "2026-04-20").map((entry) => String(entry._id)));
  await refused("move an entry out of a closed period", /Fiscal period Q2 2026 is closed/, () => journal("2026-07-15", april));
  await mutate((ctx) => ctx.db.patch(q2, { status: "open" }));
  const invoiceEntry = await mutate((ctx) => ctx.db.insert("journalEntries", { societyId: ids.societyId, date: "2026-05-01", memo: "Invoice INV-1", source: "invoice", status: "posted", createdAtISO: "2026-05-01T00:00:00.000Z", updatedAtISO: "2026-05-01T00:00:00.000Z" }));
  await refused("rewrite an invoice's entry", /Only manual journal entries and adjustments can be edited here/, () => journal("2026-05-01", invoiceEntry));
  const future = await mutate((ctx) => ctx.db.insert("accountingFiscalPeriods", { societyId: ids.societyId, fiscalYear: "2999", periodLabel: "FY 2999", startDate: "2999-01-01", endDate: "2999-12-31", status: "open", createdAtISO: "2026-07-01T00:00:00.000Z", updatedAtISO: "2026-07-01T00:00:00.000Z" }));
  await refused("lock the books through a period that hasn't ended", /hasn't ended yet, so the books can't be locked through 2999-12-31/, () => mutate((ctx) => closeFiscalPeriodPortable(ctx, { id: future, lockBooks: true })));
  assert.equal((await read((ctx) => ctx.db.get(future)))?.status, "open", "the refused close changed nothing");
  assert.equal((await read((ctx) => booksSettingsPortable(ctx, { societyId: ids.societyId }))).closeDate, "2026-03-31");
  await mutate(async (ctx) => { await ctx.db.delete(future); await ctx.db.delete(q2); await ctx.db.delete(invoiceEntry); });
});

await checkAsync("the report query honours the books basis and the dimension filter", async () => {
  const report = await read((ctx) => booksReportPortable(ctx, { societyId: ids.societyId, report: "operations", from: "2026-01-01", to: "2026-06-30", frequency: "quarter", asOf: "2026-10-18" }));
  assert.equal(report.basis, "accrual");
  assert.deepEqual(report.periods.map((period) => period.label), ["Q1 2026", "Q2 2026"]);
  assert.equal(values(report, "subtotal:revenue")[TOTAL_COLUMN], 30_000, "February, March and the edited April donation");
  await mutate((ctx) => updateBooksSettingsPortable(ctx, { societyId: ids.societyId, accountingBasis: "cash" }));
  const cash = await read((ctx) => booksReportPortable(ctx, { societyId: ids.societyId, report: "operations", from: "2026-01-01", to: "2026-06-30", frequency: "quarter", asOf: "2026-10-18" }));
  assert.equal(cash.basis, "cash");
  await assert.rejects(read((ctx) => booksReportPortable(ctx, { societyId: ids.societyId, report: "operations", from: "2026-01-01", to: "2026-06-30", frequency: "week", asOf: "2026-10-18" })), /monthly, quarterly or yearly/);
});

check("the tag filter: URL values, one dimension per tag group, and its summary", () => {
  const state = readFilterState(new URLSearchParams("tag=t-youth,t-garden,t-harbour,t-youth&program=YOUTH&fund=unrestricted"));
  assert.deepEqual(state.dimensions.tag, ["t-youth", "t-garden", "t-harbour"], "comma-separated, de-duplicated");
  assert.deepEqual(state.dimensions.programCode, ["YOUTH"]);
  assert.equal(dimensionParamValue("tag", ["t-youth", "t-garden"]), "t-youth,t-garden");
  assert.equal(dimensionParamValue("tag", []), null, "no tags clears the parameter");
  assert.equal(dimensionParamValue("programCode", ["A", "B"]), "A", "programs stay single");
  const groupOf = (id: string) => ({ "t-youth": "program", "t-garden": "program", "t-harbour": "grant" } as Record<string, string>)[id];
  assert.deepEqual(toReportFilter(state, groupOf), {
    fund: "unrestricted",
    dimensions: [{ kind: "programCode", values: ["YOUTH"] }, { kind: "tag", values: ["t-youth", "t-garden"] }, { kind: "tag", values: ["t-harbour"] }],
  }, "any tag within a group, every group chosen");
  assert.deepEqual(toReportFilter({ fund: "all", dimensions: { tag: ["t-youth", "t-harbour"] } }), { dimensions: [{ kind: "tag", values: ["t-youth", "t-harbour"] }] }, "without groups, one tag dimension");
  const names: Record<string, string> = { "t-youth": "Youth mentoring", "t-garden": "Community garden", "t-harbour": "Harbour Foundation 2026" };
  const groups: Record<string, string> = { program: "Program", grant: "Grant" };
  assert.equal(
    describeFilter({ fund: "all", dimensions: { tag: ["t-youth", "t-garden", "t-harbour"] } }, new Map(), { tagName: (id) => names[id], groupName: (id) => groups[groupOf(id) ?? ""] }),
    "Program: Youth mentoring, Community garden · Grant: Harbour Foundation 2026",
  );
  const lines = [
    { _id: "l1", journalEntryId: "e", accountId: "a", amountCents: 1, side: "debit", tagIds: ["t-youth", "t-harbour"] },
    { _id: "l2", journalEntryId: "e", accountId: "a", amountCents: 1, side: "debit", tagIds: ["t-garden"] },
    { _id: "l3", journalEntryId: "e", accountId: "a", amountCents: 1, side: "debit", tagIds: ["t-harbour"] },
  ] as BooksLine[];
  const filter = toReportFilter(state, groupOf)!;
  const tagOnly = { dimensions: filter.dimensions!.filter((dimension) => dimension.kind === "tag") };
  assert.deepEqual(lines.filter((line) => lineMatchesFilter(line, tagOnly)).map((line) => line._id), ["l1"], "a line needs a chosen program tag and the chosen grant tag");
});

await checkAsync("tagged demo journal lines (bank feed and bills) show up when the reports filter by tag", async () => {
  const { tables } = await import("../src/lib/staticConvexFixtures");
  const seed: Record<string, Array<Record<string, unknown> & { _id: string }>> = {};
  for (const [table, rows] of Object.entries(tables as Record<string, Array<Record<string, unknown> & { _id: string }>>)) seed[table] = JSON.parse(JSON.stringify(rows));
  seed.users = seed.users.map((user) => ({ ...user, status: "Active", authIssuer: "https://issuer.test", authSubject: `sub-${user._id}` }));
  const demoDb = new MemoryDb({ seed });
  const S = String(seed.users[0].societyId);
  const demo = {
    db: demoDb,
    principal: { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: `sub-${seed.users[0]._id}`, issuer: "https://issuer.test", userId: seed.users[0]._id, societyId: S },
    capabilities: makeCapabilities({}),
    runQuery: async () => { throw new Error("nested"); },
  } as unknown as PortableQueryCtx;
  const youth = "static_tag_youth_mentoring";
  const harbour = "static_tag_harbour_2026";
  const ledger = (basis: "accrual" | "cash", dimensions: Array<{ kind: string; values: string[] }>) =>
    generalLedgerReportPortable(demo, { societyId: S, from: "2000-01-01", to: "2999-12-31", basis, filter: { dimensions }, limit: 10_000 });
  const accrual = await ledger("accrual", [{ kind: "tag", values: [youth] }]);
  assert.ok(accrual.rows.length > 0, "the demo has youth-mentoring lines");
  assert.ok(accrual.rows.every((row) => row.tagIds?.includes(youth)), "only tagged lines pass, and they say so");
  assert.ok(accrual.rows.some((row) => row.financialTransactionId && row.source !== "bill"), "posted bank lines carry their tags");
  assert.ok(accrual.rows.some((row) => row.source === "bill"), "the bill approvals carry their lines' tags");
  assert.ok(!accrual.rows.some((row) => row.source === "bill_cash_basis"), "accrual basis leaves out cash-only entries");
  const cash = await ledger("cash", [{ kind: "tag", values: [youth] }]);
  assert.ok(cash.rows.some((row) => row.source === "bill_cash_basis"), "cash basis shows the paid share of a tagged bill line");
  assert.ok(!cash.rows.some((row) => row.source === "bill"), "and never the accrual");
  const both = await ledger("accrual", [{ kind: "tag", values: [youth] }, { kind: "tag", values: [harbour] }]);
  assert.ok(both.rows.length > 0 && both.rows.length < accrual.rows.length, "a second tag group narrows the lines");
  assert.ok(both.rows.every((row) => row.tagIds?.includes(youth) && row.tagIds?.includes(harbour)));
  const gala = await read(() => booksReportPortable(demo, { societyId: S, report: "operations", from: "2024-04-01", to: "2028-03-31", frequency: "year", basis: "accrual", filter: { dimensions: [{ kind: "tag", values: ["static_tag_fall_gala"] }] }, asOf: "2028-03-31" }));
  assert.equal(gala.filtered, true);
  assert.ok(gala.postedLineCount > 0 && gala.summary.some((point) => point.values.expenses > 0 || point.values.revenue > 0), "the fall gala tag shows up in the statement of operations");
});

await checkAsync("every Create menu item lands on a routed page that opens its create screen", async () => {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { FINANCE_CREATE_ITEMS, financeCreateSections } = await import("../src/lib/financeCreateItems");
  const routes = [...readFileSync("src/main.tsx", "utf8").matchAll(/<Route path="([^"]+)"/g)].map((match) => `/app/${match[1]}`);
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name)) sources.push(readFileSync(path, "utf8"));
    }
  };
  walk("src");
  const source = sources.join("\n");
  assert.deepEqual(financeCreateSections().map((group) => group.label), ["Create", "Import", "Add"]);
  for (const item of FINANCE_CREATE_ITEMS) {
    const url = new URL(item.to, "https://app.test");
    assert.ok(routes.includes(url.pathname), `${item.label}: ${url.pathname} is a route`);
    const intent = url.searchParams.get("intent");
    const handled = (name: string) => source.includes(`useCreateIntent("${name}"`) || new RegExp(`intent[A-Za-z]*\\)?\\s*[!=]==\\s*"${name}"`).test(source);
    if (intent) assert.ok(handled(intent), `${item.label}: some page handles ?intent=${intent}`);
  }
  assert.ok(new Set(FINANCE_CREATE_ITEMS.map((item) => item.id)).size === FINANCE_CREATE_ITEMS.length, "item ids are unique");
});

console.log(`\nbooks reports check passed (${passed} checks).`);
