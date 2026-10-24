import { computeStatementTotals, type ProgramStatement } from "../../../../shared/programStatement";
import { lineTotalCents, type OrgRevenueStatement } from "../../../../shared/orgRevenueStatement";
import { formatMoney } from "../../../lib/money";
import type { BrandedReportData, BrandedReportSection } from "./brandedReportTypes";

type Readiness = { completed: number; total: number; items: Array<{ key: string; label: string; detail: string; ok: boolean; status?: string }> };
type Annual = {
  currency?: string; sourceWarnings?: string[];
  revenueCents: number; expensesCents: number; surplusCents: number; netAssetsCents?: number; restrictedFundsCents?: number;
  approvedByBoardAt?: string; auditStatus?: string; auditorName?: string; financial?: { revenueCents?: number; expensesCents?: number } | null;
  incomeByCategory?: Array<{ category: string; cents: number }>; expenseByCategory?: Array<{ category: string; cents: number }>;
  budgets?: Array<{ category: string; plannedCents: number; actualCents: number; varianceCents: number }>;
  byCounterparty?: Array<{ name: string; incomeCents: number; expenseCents: number }>;
  byGrant?: Array<{ title: string; incomeCents: number; expenseCents: number }>;
  remunerationDisclosures?: Array<{ role: string; amountCents: number }>;
};
type FundAmounts = { openingCents: number; receiptsCents: number; disbursementsCents: number; closingCents: number };
type Restricted = { currency?: string; sourceWarnings?: string[]; funds: Array<FundAmounts & { title: string; funder: string }>; totals: FundAmounts };
const amountColumn = (key: string, label: string) => ({ key, label, align: "right" as const });
const moneyIn = (currency: string) => (value = 0) => formatMoney(value, { currency });
const columnsIn = (currency: string) => [{ key: "label", label: "Category" }, amountColumn("amount", `Amount (${currency})`)];

export function readinessReportDocument(data: Readiness, fiscalYear: string, currency = "CAD"): BrandedReportData {
  return { title: "Year-End Readiness Checklist", currency, filterSummary: [`Fiscal year: ${fiscalYear}`, `${data.completed} of ${data.total} complete`], columns: [{ key: "status", label: "Status", width: 15 }, { key: "label", label: "Requirement", width: 35 }, { key: "detail", label: "Detail", width: 50 }], rows: data.items.map((item) => ({ key: item.key, cells: [item.ok ? "Complete" : item.status === "upcoming" ? "Upcoming" : "Needs attention", item.label, item.detail] })), charts: [{ title: "Readiness progress", kind: "bars", valueUnit: "number", labels: ["Complete", "Remaining"], series: [{ label: "Requirements", color: "#264969", values: [data.completed, Math.max(0, data.total - data.completed)] }] }] };
}

export function annualReportDocument(data: Annual, fiscalYear: string, currency = data.currency ?? "CAD"): BrandedReportData {
  const money = moneyIn(currency), sectionColumns = columnsIn(currency);
  const sections: BrandedReportSection[] = [{ title: "Statement of Operations", description: data.financial ? "Summary from the selected fiscal-year financial statement; see approval status above." : "Summary derived from bank transactions within the selected fiscal year.", columns: sectionColumns, rows: [
    { key: "revenue", cells: ["Total revenue", money(data.revenueCents)] }, { key: "expenses", cells: ["Total expenses", money(data.expensesCents)] }, { key: "surplus", cells: ["Surplus / (Deficit)", money(data.surplusCents)], kind: "total" },
    ...(data.netAssetsCents == null ? [] : [{ key: "assets", cells: ["Net assets", money(data.netAssetsCents)] }]),
    ...(data.restrictedFundsCents == null ? [] : [{ key: "restricted", cells: ["Restricted funds (as reported)", money(data.restrictedFundsCents)] }]),
  ] }];
  for (const [title, rows] of [["Revenue by category", data.incomeByCategory], ["Expenses by category", data.expenseByCategory]] as const) if (rows?.length) sections.push({ title, description: "Bank transactions in the selected fiscal year; this breakdown may differ from a recorded financial-statement summary.", columns: sectionColumns, rows: rows.map((row, index) => ({ key: `${title}-${index}`, cells: [row.category, money(row.cents)] })) });
  if (data.budgets?.length) sections.push({ title: "Budget vs actual", columns: [{ key: "category", label: "Category" }, amountColumn("planned", "Budget"), amountColumn("actual", "Actual"), amountColumn("variance", "Variance")], rows: data.budgets.map((row, index) => ({ key: `budget-${index}`, cells: [row.category, money(row.plannedCents), money(row.actualCents), money(row.varianceCents)] })) });
  const parties = (title: string, rows: Array<{ name: string; incomeCents: number; expenseCents: number }>) => {
    if (rows.length) sections.push({ title, description: "Tagged posted journal lines within the selected fiscal year, independently of the bank-category and recorded-statement sources.", columns: [{ key: "name", label: "Name" }, amountColumn("in", "Income"), amountColumn("out", "Expense")], rows: rows.map((row, index) => ({ key: `${title}-${index}`, cells: [row.name, money(row.incomeCents), money(row.expenseCents)] })) });
  };
  parties("By counterparty", data.byCounterparty ?? []);
  parties("By grant", (data.byGrant ?? []).map((row) => ({ ...row, name: row.title })));
  if (data.remunerationDisclosures?.length) sections.push({ title: "Remuneration disclosure", columns: [{ key: "role", label: "Role" }, amountColumn("amount", "Amount")], rows: data.remunerationDisclosures.map((row, index) => ({ key: `rem-${index}`, cells: [row.role, money(row.amountCents)] })) });
  return {
    title: "Annual Financial Statement", currency, filterSummary: [`Fiscal year: ${fiscalYear}`, `Source currency: ${currency}; no currency conversion`, "Sources: recorded financial statement, bank transactions, and tagged posted accrual journal lines as identified per section", ...(data.approvedByBoardAt ? [`Approved by the board: ${data.approvedByBoardAt}`] : ["Board approval: not recorded"]), ...(data.auditStatus ? [`Audit: ${data.auditStatus}${data.auditorName ? ` · ${data.auditorName}` : ""}`] : [])],
    sections, charts: [{ title: "Revenue and expenses", kind: "bars", labels: [fiscalYear], series: [{ label: "Revenue", color: "#16745b", values: [data.revenueCents] }, { label: "Expenses", color: "#b44b55", values: [data.expensesCents] }] }],
    warnings: ["This annual-statement source differs from the posted-journal books reports. No currency conversion is performed.", ...(data.sourceWarnings ?? [])],
  };
}

export function restrictedReportDocument(data: Restricted, currency = data.currency ?? "CAD"): BrandedReportData {
  const money = moneyIn(currency);
  const cells = (row: FundAmounts) => [money(row.openingCents), money(row.receiptsCents), money(row.disbursementsCents), money(row.closingCents)];
  return { title: "Statement of Restricted Funds", currency, filterSummary: ["Source: grant-linked transactions", `Source currency: ${currency}; no currency conversion`, "Scope: fund opening balances and full recorded grant activity"], columns: [{ key: "fund", label: "Fund / funder", width: 40 }, ...["Opening", "Receipts", "Disbursements", "Closing"].map((label) => amountColumn(label.toLowerCase(), label))], rows: [...data.funds.map((fund, index) => ({ key: `fund-${index}`, cells: [`${fund.title}${fund.funder ? ` (${fund.funder})` : ""}`, ...cells(fund)] })), { key: "total", kind: "total", cells: ["Total", ...cells(data.totals)] }], charts: [{ title: "Restricted fund movement", kind: "bars", labels: data.funds.map((fund) => fund.title), series: [{ label: "Receipts", color: "#16745b", values: data.funds.map((fund) => fund.receiptsCents) }, { label: "Disbursements", color: "#b44b55", values: data.funds.map((fund) => fund.disbursementsCents) }] }], warnings: ["Grant-linked transactions cover a different scope from whole-organization and posted-journal reports. This view is not limited by the fiscal-year selector.", ...(data.sourceWarnings ?? [])] };
}

export function organizationReportDocument(statement: OrgRevenueStatement, currency = statement.currency ?? "CAD"): BrandedReportData {
  const money = moneyIn(currency);
  const columns = [{ key: "label", label: "Category", width: 40 }, amountColumn("general", "General Fund"), amountColumn("restricted", "Restricted Funds"), amountColumn("total", "Total")];
  const totals = (key: string, label: string, row: { generalCents: number; restrictedCents: number; totalCents: number }) => ({ key, cells: [label, money(row.generalCents), money(row.restrictedCents), money(row.totalCents)], kind: "total" as const });
  const sections = ([ ["Revenues", statement.revenues, statement.revenueTotals], ["Expenses", statement.expenses, statement.expenseTotals] ] as const).map(([title, rows, total]): BrandedReportSection => ({ title, columns, rows: [...rows.map((row, index) => ({ key: `${title}-${index}`, cells: [row.label, money(row.generalCents), money(row.restrictedCents), money(lineTotalCents(row))] })), totals(`total-${title}`, `Total ${title}`, total)] }));
  sections.push({ title: "Excess of Revenues over Expenses", columns, rows: [totals("excess", "Surplus / Deficit", statement.excess)] });
  return { title: "Organization Revenue and Expense Statement", currency, filterSummary: [`Fiscal year: ${statement.fiscalYearLabel}`, ...(statement.periodLabel ? [`Period: ${statement.periodLabel}`] : []), "Basis: cash — synced bank transactions", "Funds: General and Restricted", `Source currency: ${currency}; no currency conversion`], sections, charts: [{ title: "Revenue and expenses by fund", kind: "bars", labels: ["General Fund", "Restricted Funds"], series: [{ label: "Revenue", color: "#16745b", values: [statement.revenueTotals.generalCents, statement.revenueTotals.restrictedCents] }, { label: "Expenses", color: "#b44b55", values: [statement.expenseTotals.generalCents, statement.expenseTotals.restrictedCents] }] }], warnings: ["This statement uses synced bank transactions and differs from the posted-journal accrual reports.", ...(statement.sourceWarnings ?? [])] };
}

export function programReportDocument(statement: ProgramStatement, currency = "CAD"): BrandedReportData {
  const money = moneyIn(currency);
  const total = computeStatementTotals(statement);
  const columns = [{ key: "label", label: "Category", width: 48 }, amountColumn("actual", `Actuals ${statement.priorFiscalYearLabel}`), amountColumn("budget", `Budget ${statement.currentFiscalYearLabel}`)];
  const section = (title: string, rows: ProgramStatement["revenues"], actual: number, budget: number): BrandedReportSection => ({ title, columns, rows: [...rows.map((row) => ({ key: row.key, cells: [`${row.label}${row.notes ? ` (${row.notes})` : ""}`, money(row.actualCents), money(row.budgetCents)] })), { key: `total-${title}`, cells: [`Total ${title}`, money(actual), money(budget)], kind: "total" }] });
  return { title: "Program Actual Revenue and Expenses and Budget", currency, subtitle: statement.programName, filterSummary: [`Program: ${statement.programName}`, ...(statement.funderName ? [`Funder: ${statement.funderName}`] : []), `Prior year: ${statement.priorFiscalYearLabel}`, `Budget year: ${statement.currentFiscalYearLabel}`, `Status: ${statement.status ?? "Draft"}`], sections: [section("Revenues", statement.revenues, total.revenueActualCents, total.revenueBudgetCents), section("Expenses", statement.expenses, total.expenseActualCents, total.expenseBudgetCents), { title: "Surplus / Deficit", columns, rows: [{ key: "surplus", cells: ["Surplus / Deficit", money(total.surplusActualCents), money(total.surplusBudgetCents)], kind: "total" }] }, ...(statement.narrative ? [{ title: "Notes", columns: [{ key: "notes", label: "Notes" }], rows: [{ key: "narrative", cells: [statement.narrative] }] }] : [])], charts: [{ title: "Program actuals and budget", kind: "bars", labels: ["Revenues", "Expenses"], series: [{ label: `Actuals ${statement.priorFiscalYearLabel}`, color: "#264969", values: [total.revenueActualCents, total.expenseActualCents] }, { label: `Budget ${statement.currentFiscalYearLabel}`, color: "#8c96a5", values: [total.revenueBudgetCents, total.expenseBudgetCents] }] }], warnings: ["Itemize funding sources without abbreviations or acronyms.", "Community Gaming Grant amounts should match the previous grant used or current requested amount; allocation to organization costs may reduce program amounts."] };
}
