import assert from "node:assert/strict";
import { buildAccountingStatements, buildProgramSummary, type StatementLedgerLine } from "../shared/accountingStatements";
const account = (id: string, type: string, currency = "CAD") => ({ _id: id, code: id, name: id, accountType: type, currency });
const line = (id: string, type: string, amountCents: number, side: string, date = "2025-06-30", status = "posted", currency = "CAD"): StatementLedgerLine => ({ account: account(id, type, currency), amountCents, side, entry: { date, status } });
const lines = [
  line("bank", "Bank", 10000, "debit", "2024-12-31"), line("equity", "Equity", 10000, "credit", "2024-12-31"),
  line("bank", "Bank", 3000, "debit"), line("income", "Income", 3000, "credit"),
  line("expense", "Expense", 1000, "debit"), line("bank", "Bank", 1000, "credit"),
  // Transfers do not create income or expense.
  line("term", "Asset", 2000, "debit"), line("bank", "Bank", 2000, "credit"),
  // Refunds retain their signs, unlike sign-only cash summaries.
  line("bank", "Bank", 200, "debit"), line("expense", "Expense", 200, "credit"),
  line("income", "Income", 900000, "credit", "2025-06-30", "draft"),
  line("income", "Income", 900000, "credit", "2025-06-30", "void"),
  line("bank", "Bank", 500, "debit", "2025-07-01"), line("income", "Income", 500, "credit", "2025-07-01"),
  line("usd-bank", "Bank", 700, "debit", "2025-06-30", "posted", "USD"), line("usd-income", "Income", 700, "credit", "2025-06-30", "posted", "USD"),
];
const report = buildAccountingStatements(lines, "2025-01-01", "2025-06-30");
const cad = report.statements.find(s => s.currency === "CAD")!;
assert.equal(cad.totalIncomeCents, 3000); assert.equal(cad.totalExpenseCents, 800); assert.equal(cad.netIncomeCents, 2200);
assert.equal(cad.totalAssetsCents, 12200); assert.equal(cad.totalEquityCents, 10000); assert.equal(cad.unclosedEarningsCents, 2200); assert.equal(cad.balanceDifferenceCents, 0);
assert.equal(report.statements.find(s => s.currency === "USD")!.netIncomeCents, 700);
assert.deepEqual(report.warnings, []);
assert.throws(() => buildAccountingStatements([], "2025-06-31", "2025-07-01"));
assert.throws(() => buildAccountingStatements([], "2025-07-01", "2025-06-30"));
const incomplete = buildAccountingStatements([line("bank", "Bank", 500, "debit"), line("unknown", "Unknown", 500, "credit")], "2025-01-01", "2025-06-30");
assert.equal(incomplete.warnings.length, 1); assert.equal(incomplete.statements[0].balanceDifferenceCents, 500);
// Closing income/expense accounts into equity must not count surplus twice.
const closed = buildAccountingStatements([...lines,
 line("income", "Income", 3000, "debit"), line("expense", "Expense", 800, "credit"), line("equity", "Equity", 2200, "credit"),
], "2025-01-01", "2025-06-30").statements.find(s => s.currency === "CAD")!;
assert.equal(closed.totalEquityCents, 12200); assert.equal(closed.unclosedEarningsCents, 0); assert.equal(closed.balanceDifferenceCents, 0);
console.log("Accounting statements checks passed: opening balances, transfers, refunds, currency isolation, draft/void exclusion, date cutoff, closing entries, incomplete classifications.");

const programs = buildProgramSummary([
  { ...line("income", "Income", 3000, "credit"), programCode: "100" },
  { ...line("expense", "Expense", 1000, "debit"), programCode: "100" },
  line("expense", "Expense", 400, "debit"),
  { ...line("expense", "Expense", 200, "credit"), programCode: "100" },
], [
  { fiscalYear: "2025", programCode: "100", accountId: "expense", currency: "CAD", plannedCents: 1500 },
  { fiscalYear: "2024", programCode: "100", accountId: "expense", currency: "CAD", plannedCents: 900000 },
  { fiscalYear: "2025", programCode: "101", accountId: "future", currency: "CAD", plannedCents: 600 },
  { fiscalYear: "2025", programCode: "100", accountId: "expense", currency: "USD", plannedCents: 900000 },
], "2025-01-01", "2025-06-30", "2025", [account("future", "Expense")]);
assert.equal(programs.find(p => p.programCode === "100" && p.accountType === "Expense")!.actualCents, 800);
assert.equal(programs.find(p => p.programCode === "100" && p.accountType === "Expense")!.budgetCents, 1500);
assert.equal(programs.find(p => p.programCode === "100" && p.accountType === "Expense")!.varianceCents, -700);
assert.equal(programs.find(p => p.programCode === "Unallocated")!.actualCents, 400);
assert.equal(programs.find(p => p.programCode === "101")!.budgetCents, 600);
console.log("Program summary checks passed: account/program grouping, refunds, annual budget year isolation, budget-only accounts, unallocated rows, currency consistency.");

assert.deepEqual(buildProgramSummary([line("expense", "Expense", 500, "debit", "2026-02-30")], [], "2026-01-01", "2026-12-31", "2026"), []);
