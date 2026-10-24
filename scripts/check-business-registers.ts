/**
 * Business registers gate: the payroll, credit card and investments registers.
 *
 *  - CRA remittance due dates (regular remitters; the user-set schedule for
 *    quarterly and accelerated remitters), T4/T4A/RL-1 filing deadlines and
 *    workers' compensation reminders;
 *  - investment interest, invested reserves and the 30/7-day maturity reminders;
 *  - card statement reconciliation totals and the no-full-card-number rule;
 *  - the payroll provider CSV reader;
 *  - the demo story (pay runs match the bank feed, remittances match the CRA
 *    payments, one statement with a difference) and the portable functions
 *    end to end on the in-browser demo data: deadlines are generated, completed
 *    and never duplicated, and another workspace's rows are refused.
 */
import assert from "node:assert/strict";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import {
  assertCardLast4,
  containsCardNumber,
  holdingStatus,
  interestEarnedCents,
  investedReserves,
  isValidCardLast4,
  maturityReminders,
  nextWorkersCompDueDate,
  parsePayrollCsv,
  payRunDifferenceCents,
  reconcileStatement,
  registerDeadlines,
  remittableCents,
  remittanceDueDate,
  remittancePeriodFor,
  remittanceStatus,
  remittancesFromPayRuns,
  scheduleIsComplete,
  slipFilingDeadline,
  slipTotalsFromPayRuns,
} from "../shared/businessRegisters";
import * as fns from "../shared/functions/businessRegisters";
import { tables as staticTables } from "../src/lib/staticConvexFixtures";

let checks = 0;
const eq = (actual: unknown, expected: unknown, message: string) => { assert.deepEqual(actual, expected, message); checks += 1; };
const ok = (value: unknown, message: string) => { assert.ok(value, message); checks += 1; };
async function rejects(promise: Promise<unknown>, pattern: RegExp, message: string) {
  await assert.rejects(promise, pattern, message);
  checks += 1;
}

/* ------------------------------------------------- remittance due dates */

const regular = { remitterType: "regular" };
eq(remittancePeriodFor("2026-03-31", regular), { start: "2026-03-01", end: "2026-03-31" }, "regular: the pay date's calendar month");
eq(remittanceDueDate({ start: "2026-03-01", end: "2026-03-31" }, regular), "2026-04-15", "regular: the 15th of the following month");
eq(remittanceDueDate({ start: "2026-12-01", end: "2026-12-31" }, regular), "2027-01-15", "regular: December's deductions are due January 15 of the next year");
eq(remittanceDueDate({ start: "2028-02-01", end: "2028-02-29" }, regular), "2028-03-15", "regular: leap-year February");

const quarterly = { remitterType: "quarterly", cadence: "quarterly", dueRule: "day_of_next_month", dueValue: 15 };
eq(remittancePeriodFor("2026-05-10", quarterly), { start: "2026-04-01", end: "2026-06-30" }, "quarterly: calendar quarter");
eq(remittanceDueDate({ start: "2026-04-01", end: "2026-06-30" }, quarterly), "2026-07-15", "quarterly: the user's due day in the month after the quarter");
const twice = { remitterType: "accelerated", cadence: "twice_monthly", dueRule: "days_after_period_end", dueValue: 10 };
eq(remittancePeriodFor("2026-05-10", twice), { start: "2026-05-01", end: "2026-05-15" }, "twice monthly: 1st to 15th");
eq(remittancePeriodFor("2026-05-20", twice), { start: "2026-05-16", end: "2026-05-31" }, "twice monthly: 16th to month end");
eq(remittanceDueDate({ start: "2026-05-01", end: "2026-05-15" }, twice), "2026-05-25", "days after period end");
eq(remittanceDueDate({ start: "2026-05-16", end: "2026-05-31" }, twice), "2026-06-10", "days after period end crosses the month");
eq(remittanceDueDate({ start: "2026-01-01", end: "2026-01-31" }, { remitterType: "accelerated", cadence: "monthly", dueRule: "day_of_next_month", dueValue: 31 }), "2026-03-02", "a due day past month end is clamped, then adjusted for the weekend");
eq(scheduleIsComplete({ remitterType: "quarterly" }), true, "the official quarterly schedule is complete without custom settings");
eq(scheduleIsComplete({ remitterType: "accelerated", cadence: "quarterly", dueRule: "day_of_next_month", dueValue: 40 }), false, "a due day over 31 is refused");
eq(remittanceDueDate({ start: "2026-04-01", end: "2026-06-30" }, { remitterType: "quarterly" }), "2026-07-15", "quarterly follows the published CRA schedule");
eq(remittanceStatus({ amountDueCents: 1000, dueDate: "2026-04-15" }, "2026-04-15"), "due", "due on the due date itself");
eq(remittanceStatus({ amountDueCents: 1000, dueDate: "2026-04-15" }, "2026-04-16"), "overdue", "overdue the day after");
eq(remittanceStatus({ amountDueCents: 1000, paidCents: 400, dueDate: "2026-04-15" }, "2026-04-10"), "partial", "part paid");
eq(remittanceStatus({ amountDueCents: 1000, paidCents: 1000, paidOn: "2026-04-14", dueDate: "2026-04-15" }, "2026-05-01"), "paid", "paid in full");

const run = (payDate: string, gross: number, cpp: number, ei: number, tax: number, net: number) => ({
  payDate, grossCents: gross, cppEmployeeCents: cpp, eiEmployeeCents: ei, incomeTaxCents: tax, cppEmployerCents: cpp, eiEmployerCents: Math.round(ei * 1.4), netCents: net,
});
const marchA = run("2026-03-13", 300000, 17850, 4920, 30000, 247230);
const marchB = run("2026-03-31", 300000, 17850, 4920, 30000, 247230);
eq(payRunDifferenceCents(marchA), 0, "a run adds up when gross − deductions = net");
eq(payRunDifferenceCents({ ...marchA, netCents: marchA.netCents + 5 }), -5, "and reports by how much it doesn't");
eq(remittableCents(marchA), 17850 * 2 + 4920 + 6888 + 30000, "owed: employee CPP, EI, tax + employer CPP, EI");
eq(
  remittancesFromPayRuns([marchA, marchB, run("2026-04-15", 100000, 0, 0, 0, 100000)], regular).map((row) => [row.periodStart, row.dueDate, row.amountDueCents, row.payRunCount]),
  [["2026-03-01", "2026-04-15", remittableCents(marchA) * 2, 2], ["2026-04-01", "2026-05-15", 0, 1]],
  "remittances group the runs by period",
);

/* ------------------------------------------------------ slip deadlines */

eq(slipFilingDeadline(2025), "2026-03-02", "2025 filing deadline moves from Saturday to the next CRA business day");
eq(slipFilingDeadline(2027), "2028-02-29", "a leap-year February ends on the 29th");
const slipRuns = [
  { payDate: "2025-12-31", lines: [{ employeeId: "e1", employeeName: "A", grossCents: 100, cppEmployeeCents: 5, eiEmployeeCents: 2, incomeTaxCents: 10, netCents: 83, cppEmployerCents: 5, eiEmployerCents: 3 }] },
  { payDate: "2026-01-15", lines: [{ employeeId: "e1", employeeName: "A", grossCents: 200, cppEmployeeCents: 10, eiEmployeeCents: 4, incomeTaxCents: 20, netCents: 166, cppEmployerCents: 10, eiEmployerCents: 6 }] },
];
eq([...slipTotalsFromPayRuns(slipRuns, 2026).values()].map((row) => row.employmentIncomeCents), [200], "slip totals follow the pay date's year");

/* ----------------------------------------------------- generated deadlines */

const holdings = [
  { _id: "h1", name: "Reserve GIC", maturityDate: "2026-11-28", status: "active", autoRenew: true },
  { _id: "h2", name: "Old GIC", maturityDate: "2026-01-10", status: "active" },
  { _id: "h3", name: "Redeemed GIC", maturityDate: "2027-01-10", status: "redeemed" },
];
eq(maturityReminders("2026-11-28"), [{ daysBefore: 30, date: "2026-10-29" }, { daysBefore: 7, date: "2026-11-21" }], "maturity reminders 30 and 7 days before");
const input = {
  remittances: [
    { periodStart: "2026-08-01", periodEnd: "2026-08-31", dueDate: "2026-09-15", amountDueCents: 5000, paidCents: 5000, paidOn: "2026-09-14" },
    { periodStart: "2026-09-01", periodEnd: "2026-09-30", dueDate: "2026-10-15", amountDueCents: 6000 },
  ],
  slips: [{ year: 2025, slipType: "T4", status: "filed" }],
  payDates: ["2024-06-30", "2025-12-31", "2026-09-30"],
  roes: [{ _id: "r1", employeeName: "Sam", dueDate: "2026-10-20", status: "to_issue" }, { _id: "r2", employeeName: "Lee", dueDate: "2026-09-01", status: "issued" }],
  settings: { workersCompProvider: "WorkSafeBC", workersCompCadence: "annual", workersCompFirstDueDate: "2026-02-28" },
  holdings,
};
const wanted = registerDeadlines(input, "2026-10-14", []);
const keys = wanted.map((row) => row.sourceKey).sort();
eq(keys, [
  "investments:maturity:h1:30",
  "investments:maturity:h1:7",
  "payroll:remit:2026-09-01",
  "payroll:roe:r1",
  "payroll:slips:T4:2026",
  "payroll:workers-comp:2026-02-28",
].sort(), "only open work becomes a deadline: no paid remittance, filed year, issued ROE, matured or redeemed holding, or long-past year without slips");
eq(wanted.find((row) => row.sourceKey === "payroll:remit:2026-09-01")?.dueDate, "2026-10-15", "the remittance deadline carries the CRA due date");
eq(wanted.find((row) => row.sourceKey === "payroll:slips:T4:2026")?.dueDate, "2027-03-01", "the slip deadline is the first business day after Sunday February 28");
eq(wanted.find((row) => row.sourceKey === "investments:maturity:h1:30")?.dueDate, "2026-10-29", "maturity reminder date");
ok(wanted.every((row) => !row.done), "nothing done is created");
const withOpen = registerDeadlines(input, "2026-10-14", [{ sourceKey: "payroll:remit:2026-08-01", status: "open" }]);
eq(withOpen.find((row) => row.sourceKey === "payroll:remit:2026-08-01")?.done, true, "a paid remittance completes its open deadline");
const afterReport = registerDeadlines(input, "2026-10-14", [{ sourceKey: "payroll:workers-comp:2026-02-28", status: "complete" }]);
eq(afterReport.find((row) => row.sourceKey.startsWith("payroll:workers-comp:"))?.dueDate, "2027-02-28", "completing a workers' compensation report brings up the next one");
eq(nextWorkersCompDueDate("2026-01-31", "quarterly", new Set(["2026-01-31", "2026-04-30"])), "2026-07-31", "quarterly series, month-end clamped");

/* ------------------------------------------------------------ investments */

const gic = { principalCents: 2_500_000, ratePercent: 3.85, compounding: "simple", startDate: "2025-01-01", maturityDate: "2026-01-01" };
eq(interestEarnedCents(gic, "2026-01-01"), 96250, "simple interest: 25,000 × 3.85% for a year");
eq(interestEarnedCents(gic, "2027-06-01"), 96250, "interest stops at maturity");
eq(interestEarnedCents({ ...gic, compounding: "annual", maturityDate: "2027-01-01" }, "2027-01-01"), Math.round(2_500_000 * (1.0385 ** (730 / 365) - 1)), "annual compounding");
eq(holdingStatus({ ...gic, maturityDate: "2026-11-01" }, "2026-10-14"), "maturing", "maturing within 30 days");
eq(holdingStatus({ ...gic }, "2026-10-14"), "matured", "matured once the date passes");
const reserves = investedReserves([
  { ...gic, startDate: "2026-01-01", maturityDate: "2027-01-01", name: "A" },
  { principalCents: 1_000_000, startDate: "2026-01-01", restricted: true, name: "B", maturityDate: "2026-12-01" },
  { principalCents: 500_000, startDate: "2026-01-01", status: "redeemed", name: "C" },
  { principalCents: 300_000, startDate: "2026-01-01", currentValueCents: 320_000, name: "D" },
], "2026-07-02");
eq(reserves.restrictedCents, 1_000_000, "restricted reserves");
eq(reserves.unrestrictedCents, 2_500_000 + interestEarnedCents({ ...gic, startDate: "2026-01-01", maturityDate: "2027-01-01" }, "2026-07-02") + 320_000, "unrestricted: principal + accrued, or market value");
eq(reserves.totalCents, reserves.restrictedCents + reserves.unrestrictedCents, "total = restricted + unrestricted");
eq(reserves.activeCount, 3, "redeemed holdings are left out");
eq(reserves.nextMaturity?.name, "B", "next maturity");

/* ------------------------------------------------------ card statements */

const cardTxns = [
  { date: "2026-08-31", amountCents: -999, receiptStatus: "missing" }, // before the period
  { date: "2026-09-02", amountCents: -12000, receiptStatus: "attached" },
  { date: "2026-09-10", amountCents: -4500, receiptStatus: "missing" },
  { date: "2026-09-12", amountCents: 1500, category: "Refunds" },
  { date: "2026-09-22", amountCents: 30000, category: "Transfer" },
  { date: "2026-09-29", amountCents: -800, status: "pending", receiptStatus: "missing" },
  { date: "2026-10-01", amountCents: -2500 }, // after the period
];
const recon = reconcileStatement({ periodStart: "2026-09-01", periodEnd: "2026-09-30", previousBalanceCents: 30000, statementBalanceCents: 15000 }, cardTxns);
eq([recon.purchasesCents, recon.creditsCents, recon.paymentsCents], [16500, 1500, 30000], "charges, credits and payments for the period");
eq(recon.expectedBalanceCents, 30000 + 16500 - 1500 - 30000, "previous + charges − credits − payments");
eq(recon.differenceCents, 0, "a statement that matches the feed has no difference");
eq(recon.status, "balanced", "ready to reconcile");
eq([recon.transactionCount, recon.pendingCount, recon.receiptsMissing], [4, 1, 1], "pending lines are counted apart; receipts missing on posted charges");
const off = reconcileStatement({ periodStart: "2026-09-01", periodEnd: "2026-09-30", previousBalanceCents: 30000, statementBalanceCents: 15412 }, cardTxns);
eq([off.differenceCents, off.status], [412, "difference"], "an extra fee on the statement shows as a difference");
eq(reconcileStatement({ periodStart: "2026-09-01", periodEnd: "2026-09-30", statementBalanceCents: 1, reconciledAtISO: "2026-10-05T00:00:00Z" }, []).status, "reconciled", "a reconciled statement stays reconciled");

/* ------------------------------------------------------- card numbers */

eq(isValidCardLast4("4417"), true, "four digits");
for (const bad of ["44170", "441", "4111111111111111", "44 17", "abcd", ""]) eq(isValidCardLast4(bad), false, `"${bad.length > 6 ? "a long number" : bad}" is not a last 4`);
assert.throws(() => assertCardLast4("12345"), /last 4 digits/);
checks += 1;
let echoed = "";
try { assertCardLast4("4111111111111111"); } catch (error) { echoed = (error as Error).message; }
ok(echoed && !echoed.includes("4111"), "the error never echoes the number back");
eq(containsCardNumber("4111 1111 1111 1111"), true, "spaced card number");
eq(containsCardNumber("4111-1111-1111-1111"), true, "dashed card number");
eq(containsCardNumber("Visa ending 4417, limit 10000"), false, "last 4 and amounts are fine");

/* ------------------------------------------------------------ CSV import */

const csv = [
  "Pay date,Period start,Period end,Employee,Gross pay,CPP,EI,Income tax,Net pay",
  "2026-01-15,2026-01-01,2026-01-15,Amara Okonkwo,\"3,833.33\",216.04,62.87,520.10,\"3,034.32\"",
  "2026-01-15,2026-01-01,2026-01-15,Jordan Nakamura,3250.00,181.34,53.30,401.20,2614.16",
  "2026-01-30,2026-01-16,2026-01-31,Amara Okonkwo,3833.33,216.04,62.87,520.10,3034.32",
  "30/01/2026,2026-01-16,2026-01-31,Bad Row,1,0,0,0,1",
].join("\r\n");
const parsed = parsePayrollCsv(csv, { standardEmployerShares: true });
eq(parsed.runs.length, 2, "rows with the same period and pay date form one run");
eq(parsed.runs[0].lines.length, 2, "one line per employee");
eq(parsed.runs[0].grossCents, 383333 + 325000, "amounts with thousands separators");
eq(parsed.runs[0].cppEmployerCents, 21604 + 18134, "employer CPP defaults to the employee CPP");
eq(parsed.runs[0].eiEmployerCents, Math.round(6287 * 1.4) + Math.round(5330 * 1.4), "employer EI defaults to 1.4 × employee EI");
eq(parsed.errors, ["Row 5: pay date must be YYYY-MM-DD."], "ambiguous dates are refused, not guessed");
eq(parsePayrollCsv("Name,Amount\nA,1").errors.length, 2, "a file without pay date and gross columns is refused");

/* ------------------------------------------------------------ demo story */

const t = staticTables as Record<string, any[]>;
const societyId = "static_society_riverside";
ok(t.payRuns.length >= 30 && t.payrollRemittances.length >= 15, "the demo has a year and a half of pay runs and remittances");
ok(t.payRuns.every((row) => payRunDifferenceCents(row) === 0), "every demo pay run adds up");
ok(t.payRuns.every((row) => row.lines.reduce((sum: number, line: any) => sum + line.netCents, 0) === row.netCents), "per-employee lines add up to the run");
const txnById = new Map(t.financialTransactions.map((row) => [row._id, row]));
ok(t.payRuns.every((row) => txnById.get(row.transactionId)?.amountCents === -row.netCents), "each run's net pay is the payroll deposit in the bank feed");
const paid = t.payrollRemittances.filter((row) => row.paidOn);
ok(paid.length >= 12 && paid.every((row) => row.paidCents === row.amountDueCents && txnById.get(row.transactionId)?.amountCents === -row.paidCents), "each month's deductions equal the CRA payment in the feed");
ok(t.payrollRemittances.every((row) => row.dueDate === remittanceDueDate({ start: row.periodStart, end: row.periodEnd }, regular)), "demo remittances are due the 15th of the next month");
const card = t.corporateCards.find((row) => row.societyId === societyId);
ok(card && isValidCardLast4(card.last4) && card.agreementDocumentId, "the organization Visa keeps only its last 4 and links its agreement");
const feedCard = t.financialTransactions.filter((row) => row.accountId === card.financialAccountId);
const demoRecon = t.cardStatements.map((row) => reconcileStatement(row, feedCard));
eq(demoRecon.map((row) => row.differenceCents).filter(Boolean), [412], "one demo statement has the foreign transaction fee to find");
ok(t.cardStatements.some((row) => row.reconciledAtISO) && demoRecon.some((row) => row.status === "balanced"), "reconciled and ready-to-reconcile statements");
for (const table of ["corporateCards", "cardStatements", "investmentHoldings", "payRuns"]) {
  ok(t[table].every((row) => !Object.entries(row).some(([key, value]) => !key.startsWith("_") && !/(Id|ISO)$/.test(key) && containsCardNumber(value))), `${table}: no full card numbers in the demo`);
}
const demoReserves = investedReserves(t.investmentHoldings, t.investmentHoldings[0].startDate);
ok(demoReserves.restrictedCents > 0 && demoReserves.unrestrictedCents > 0, "one restricted and one unrestricted GIC");
ok(t.deadlines.some((row) => String(row.sourceKey).startsWith("investments:maturity:")), "maturity reminders are on the Deadlines page");
ok(t.deadlines.some((row) => String(row.sourceKey).startsWith("payroll:slips:")), "the next slip filing is on the Deadlines page");
ok(!t.deadlines.some((row) => /Remit (monthly )?payroll source deductions/.test(row.title) && !row.sourceKey), "the old hand-written remittance deadlines are gone");

/* ------------------------------------------------- portable functions */

function portableCtx(dump: Record<string, any[]>, ownerName: string, extra: Record<string, any[]> = {}) {
  const seed: Record<string, any[]> = JSON.parse(JSON.stringify(dump));
  for (const [table, rows] of Object.entries(extra)) seed[table] = [...(seed[table] ?? []), ...rows];
  seed.users = seed.users.map((u: any) => ({ ...u, status: "Active", authIssuer: "https://issuer.test", authSubject: `sub-${u._id}` }));
  const owner = seed.users.find((u: any) => u.displayName === ownerName && u.societyId === societyId) ?? seed.users.find((u: any) => u.societyId === societyId);
  const db = new MemoryDb({ seed });
  const ctx: any = {
    db,
    principal: { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: `sub-${owner._id}`, issuer: "https://issuer.test", userId: owner._id, societyId: owner.societyId },
    capabilities: makeCapabilities({}),
    runQuery: async () => { throw new Error("nested"); },
  };
  return { db, ctx };
}
const foreignEmployee = { _id: "foreign_employee", societyId: "foreign_society", firstName: "Other", lastName: "Org", role: "x", startDate: "2020-01-01", employmentType: "FullTime", cppExempt: false, eiExempt: false };
const { db, ctx } = portableCtx(t, "Mina Patel", { employees: [foreignEmployee] });
const today = (await fns.payrollWorkspacePortable(ctx, { societyId })).today as string;
const generated = async () => (await db.query("deadlines").collect()).filter((row: any) => /^(payroll|investments):/.test(String(row.sourceKey ?? "")));
const before = (await generated()).length;
eq((await fns.payrollSyncDeadlinesPortable(ctx, { societyId })).created, 0, "the demo's generated deadlines are already in step (no duplicates on first sync)");

// A new pay run for a month without one creates its remittance and an open deadline.
const month = "2031-03";
await fns.payrollSavePayRunPortable(ctx, { societyId, periodStart: `${month}-01`, periodEnd: `${month}-15`, payDate: `${month}-13`, grossCents: 300000, cppEmployeeCents: 17850, eiEmployeeCents: 4920, incomeTaxCents: 30000, cppEmployerCents: 17850, eiEmployerCents: 6888, netCents: 247230 });
const remit = (await db.query("payrollRemittances").collect()).find((row: any) => row.periodStart === `${month}-01`);
eq([remit?.dueDate, remit?.amountDueCents], ["2031-04-15", remittableCents(marchA)], "saving a pay run creates its remittance with the CRA due date");
const remitDeadline = (await generated()).find((row: any) => row.sourceKey === `payroll:remit:${month}-01`);
eq([remitDeadline?.dueDate, remitDeadline?.status, remitDeadline?.category], ["2031-04-15", "open", "Payroll"], "and an open Payroll deadline");
ok((await generated()).some((row: any) => row.sourceKey === "payroll:slips:T4:2031" && row.dueDate === "2032-03-01"), "and the year's slip filing deadline");
await db.patch((await db.query("payrollSettings").collect()).find((row: any) => row.societyId === societyId)!._id, { payrollAccountNumber: "123456789RP0001" }); // Explicit synthetic account for this newly recorded test payment.
await fns.payrollRecordRemittancePortable(ctx, { id: remit._id, paidOn: "2031-04-14", confirmationNumber: "CRA-1" });
eq((await db.get(remitDeadline._id)).status, "complete", "recording the payment completes the deadline");
eq(await fns.payrollSyncDeadlinesPortable(ctx, { societyId }), { created: 0, updated: 0, removed: 0, completed: 0 }, "a second sync changes nothing");

// Holdings: reminders appear, move with the maturity date, and go when redeemed.
const holdingId = await fns.investmentsUpsertPortable(ctx, { societyId, name: "Test GIC", kind: "gic", institution: "Test CU", principalCents: 100000, ratePercent: 4, startDate: today, maturityDate: addMonths(today, 6) });
const reminderKeys = async () => (await generated()).filter((row: any) => String(row.sourceKey).startsWith(`investments:maturity:${holdingId}:`) && row.status === "open").map((row: any) => row.dueDate).sort();
eq((await reminderKeys()).length, 2, "two maturity reminders");
await fns.investmentsUpsertPortable(ctx, { id: holdingId, societyId, name: "Test GIC", kind: "gic", institution: "Test CU", principalCents: 100000, startDate: today, maturityDate: addMonths(today, 7) });
eq(await reminderKeys(), maturityReminders(addMonths(today, 7)).map((row) => row.date).sort(), "reminders follow a changed maturity date");
await fns.investmentsUpsertPortable(ctx, { id: holdingId, societyId, name: "Test GIC", kind: "gic", institution: "Test CU", principalCents: 100000, startDate: today, maturityDate: addMonths(today, 7), status: "redeemed" });
eq((await reminderKeys()).length, 0, "redeeming removes open reminders");

// Cards: the validator rejects anything but the last 4, and a full number in any field.
const cardBase = { societyId, cardholderName: "Test Holder", issuer: "Test Bank" };
await rejects(fns.cardsUpsertCardPortable(ctx, { ...cardBase, last4: "12345" }), /last 4 digits/, "five digits are refused");
await rejects(fns.cardsUpsertCardPortable(ctx, { ...cardBase, last4: "4111111111111111" }), /last 4 digits/, "a full card number in last 4 is refused");
await rejects(fns.cardsUpsertCardPortable(ctx, { ...cardBase, last4: "1111", notes: "Card 4111 1111 1111 1111" }), /remove the card number/, "a full card number in the notes is refused");
await rejects(fns.cardsUpsertCardPortable(ctx, { ...cardBase, last4: "1111", nickname: "4111111111111111" }), /remove the card number/, "or in the card name");
const newCard = await fns.cardsUpsertCardPortable(ctx, { ...cardBase, last4: "1111" });
eq((await db.get(newCard)).last4, "1111", "a valid card stores its last 4");
ok((await db.query("corporateCards").collect()).every((row: any) => !Object.entries(row).some(([key, value]) => !key.startsWith("_") && !/(Id|ISO)$/.test(key) && containsCardNumber(value))), "no full card number reached the table");

// Statements reconcile only when they agree with the feed.
const cards = await fns.cardsWorkspacePortable(ctx, { societyId });
const diffStatement = cards.statements.find((row: any) => row.status === "difference");
await rejects(fns.cardsSetStatementReconciledPortable(ctx, { id: diffStatement._id, reconciled: true }), /higher than the card lines/, "a statement with a difference can't be marked reconciled");
const ready = cards.statements.find((row: any) => row.status === "balanced");
await fns.cardsSetStatementReconciledPortable(ctx, { id: ready._id, reconciled: true });
eq((await fns.cardsWorkspacePortable(ctx, { societyId })).statements.find((row: any) => row._id === ready._id).status, "reconciled", "a matching statement reconciles");
eq(cards.summary.receiptsMissing, cards.statements.filter((row: any) => row.status !== "reconciled").reduce((sum: number, row: any) => sum + row.receiptsMissing, 0), "receipts missing are counted per open statement");

// Tenancy: another workspace's rows are refused without saying whether they exist.
await rejects(fns.payrollSavePayRunPortable(ctx, { societyId, periodStart: "2031-05-01", periodEnd: "2031-05-15", payDate: "2031-05-15", lines: [{ employeeId: "foreign_employee", employeeName: "Other Org", grossCents: 100, cppEmployeeCents: 0, eiEmployeeCents: 0, incomeTaxCents: 0, cppEmployerCents: 0, eiEmployerCents: 0, netCents: 100 }] }), /not found/i, "a pay-run line can't name another workspace's employee");
await rejects(fns.cardsUpsertCardPortable(ctx, { ...cardBase, last4: "2222", employeeId: "foreign_employee" }), /not found/i, "nor can a card");
const after = (await generated()).length;
ok(after >= before, "generated deadlines were added, never lost");

function addMonths(date: string, months: number) {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

console.log(`Business register checks passed: ${checks} assertions (remittance due dates, slip deadlines, maturity reminders, statement reconciliation, card-number guard, CSV import, demo story, portable flow and tenancy).`);
