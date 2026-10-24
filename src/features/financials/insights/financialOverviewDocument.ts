import type { TimeRow, FlowRow, DateRange } from "../../../components/charts";
import { budgetVariance, formatMoney } from "../../../lib/money";
import type { BudgetKind } from "../lib/budgetKind";
import type { BrandedReportData, BrandedReportSection } from "../reports/brandedReportTypes";
import { balanceRows, compareLabel, flowTotals, monthEndBalances, monthlyFlowRows, type CompareChoice, type FinanceTxn } from "./series";
import { topFlows } from "./topFlows";

type BudgetRow = { category: string; fiscalYear: string; plannedCents: number; actualCents: number; kind: BudgetKind };
export type OverviewDocumentInput = {
  txns: FinanceTxn[]; currentBalance: number; range: DateRange; focus: DateRange;
  compareMode: CompareChoice; previousCovered: boolean; closing: number | null;
  cashRows: TimeRow[]; flowRows: FlowRow[]; budgetRows: BudgetRow[]; truncated: boolean;
  currency?: string; sourceCurrencies?: string[];
};

/** Export selected-range values and explicitly retain each source's different scope. */
export function financialOverviewDocument(input: OverviewDocumentInput): BrandedReportData {
  const { range, focus, compareMode } = input;
  const currency = input.currency ?? "CAD";
  const money = (value: number | null) => value == null ? "—" : formatMoney(value, { currency });
  const totals = flowTotals(input.txns, focus);
  // The screen fades months outside the drag selection. Export only its selected range.
  const cashRows = focus === range || (focus.start === range.start && focus.end === range.end)
    ? input.cashRows : balanceRows(input.txns, input.currentBalance, focus, compareMode !== "off" && compareMode);
  const months = monthEndBalances(cashRows);
  const flowRows = monthlyFlowRows(input.txns, focus);
  const withPrevious = compareMode !== "off" && input.previousCovered;
  const columns = [{ key: "month", label: "Month" }, { key: "balance", label: "Closing cash", align: "right" as const }, { key: "in", label: "Money in", align: "right" as const }, { key: "out", label: "Money out", align: "right" as const }, { key: "net", label: "Net", align: "right" as const }, ...(withPrevious ? [{ key: "previous", label: compareLabel(compareMode), align: "right" as const }] : [])];
  const sections: BrandedReportSection[] = [{
    title: "Selected-range totals", columns: [{ key: "metric", label: "Metric" }, { key: "amount", label: `Amount (${currency})`, align: "right" }],
    rows: [{ key: "in", cells: ["Money in", money(totals.inflow)] }, { key: "out", cells: ["Money out", money(totals.outflow)] }, { key: "net", cells: ["Net change", money(totals.net)], kind: "total" }, { key: "closing", cells: ["Closing cash balance", money(input.closing)] }],
  }, {
    title: "Monthly cash and flows", columns,
    rows: months.map((month, index) => { const flow = flowRows[index]; return { key: month.month, cells: [month.month, money(month.value), money(flow?.inflow ?? 0), money(flow?.outflow ?? 0), money((flow?.inflow ?? 0) - (flow?.outflow ?? 0)), ...(withPrevious ? [money(month.previous ?? null)] : [])] }; }),
  }];
  for (const grouping of ["payee", "category"] as const) {
    const top = topFlows(input.txns, focus, grouping, "out", 10);
    sections.push({ title: grouping === "payee" ? "Top payees" : "Top categories", columns: [{ key: "name", label: grouping === "payee" ? "Payee" : "Category" }, { key: "amount", label: "Money out", align: "right" }], rows: top.rows.map((row, index) => ({ key: `${grouping}-${index}`, cells: [row.label, money(row.cents)] })) });
  }
  const charts: NonNullable<BrandedReportData["charts"]> = [
    { title: "Cash over time", kind: "lines", curve: "step", labels: months.map((month) => month.month), series: [{ label: "Cash balance", color: "#264969", values: months.map((month) => month.value) }, ...(withPrevious ? [{ label: compareLabel(compareMode), color: "#8c96a5", values: months.map((month) => month.previous ?? null) }] : [])] },
    { title: "Money in vs out by month", kind: "bars", labels: flowRows.map((row) => row.label), series: [{ label: "Money in", color: "#16745b", values: flowRows.map((row) => row.inflow) }, { label: "Money out", color: "#b44b55", plotSign: -1, values: flowRows.map((row) => row.outflow) }] },
  ];
  const year = input.budgetRows.reduce<string | null>((latest, row) => latest == null || row.fiscalYear > latest ? row.fiscalYear : latest, null);
  const budgets = input.budgetRows.filter((row) => row.fiscalYear === year);
  if (budgets.length) {
    sections.push({ title: `Budget vs actuals — FY ${year}`, description: "Budget data uses its stated fiscal year, independently of the selected bank trend range.", columns: [{ key: "category", label: "Category" }, { key: "planned", label: "Budget", align: "right" }, { key: "actual", label: "Actual", align: "right" }, { key: "variance", label: "Variance", align: "right" }], rows: budgets.map((row, index) => ({ key: `budget-${index}`, cells: [row.category, money(row.plannedCents), money(row.actualCents), money(budgetVariance(row.plannedCents, row.actualCents, row.kind).cents)] })) });
    charts.push({ title: `Budget vs actuals — FY ${year}`, kind: "bars", labels: budgets.map((row) => row.category), series: [{ label: "Budget", color: "#8c96a5", values: budgets.map((row) => row.plannedCents) }, { label: "Actual", color: "#264969", values: budgets.map((row) => row.actualCents) }] });
  }
  return {
    title: "Financial overview", currency,
    subtitle: "Bank and card trends, selected-range figures, and fiscal-year budget",
    filterSummary: [`Date range: ${focus.start} to ${focus.end}`, `Currency: ${currency}`, "Source: bank/card transactions and current balances", compareMode === "off" ? "Comparison: off" : `Comparison: ${compareLabel(compareMode)}${withPrevious ? "" : " (history unavailable)"}`],
    sections, charts,
    warnings: [...(input.truncated ? ["Transaction history reached the 5,000-row source limit; earlier activity may be omitted."] : []), ...(input.sourceCurrencies && input.sourceCurrencies.length > 1 ? [`The source overview combines nominal amounts in ${input.sourceCurrencies.join(", ")}; no currency conversion is performed. Use a currency-filtered books report for financial statements.`] : []), "Bank trend totals are a different source from the posted-journal financial statements. Internal transfers are included in gross bank flows; the cash-flow diagram excludes them."],
  };
}
