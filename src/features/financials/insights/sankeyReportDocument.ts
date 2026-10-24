import type { DateRange } from "../../../components/charts";
import { formatMoney } from "../../../lib/money";
import type { BrandedReportData } from "../reports/brandedReportTypes";
import { sankeyReportVector } from "../reports/sankeyReportVector";
import { FUND_LABELS, type CashFlowSankeyModel, type CategoryFlow } from "./cashFlowSankey";

export function sankeyReportDocument(model: CashFlowSankeyModel, range: DateRange, options: { currency?: string; selectedFlow?: CategoryFlow | null; truncated?: boolean; sourceCurrencies?: string[] } = {}): BrandedReportData {
  const currency = options.currency ?? "CAD";
  const money = (cents: number) => formatMoney(cents, { currency });
  const columns = [{ key: "category", label: "Category" }, { key: "direction", label: "Direction" }, ...model.funds.map((fund) => ({ key: fund, label: FUND_LABELS[fund], align: "right" as const })), { key: "amount", label: "Net amount", align: "right" as const }, { key: "refunds", label: "Refunds netted", align: "right" as const }];
  const flows = [...model.allInflows, ...model.allOutflows];
  return {
    title: "Where the money came from and went", currency,
    subtitle: "Money in, through funds/accounts, to money out. Bands show the relative net amount; the table provides every category.",
    filterSummary: [`Date range: ${range.start} to ${range.end}`, `Currency: ${currency}`, `Grouping: ${model.funds.length > 1 ? "By fund" : "Combined accounts"}`, `Transactions: ${model.transactionCount}`, `Internal transfers excluded: ${model.excludedTransfers}`, ...(options.selectedFlow ? [`Highlighted category: ${options.selectedFlow.category}`] : [])],
    charts: [{ title: "Cash-flow diagram", kind: "svg", description: `From left to right: ${model.inflows.map((flow) => flow.category).join(", ") || "no inflows"}; through ${model.funds.map((fund) => FUND_LABELS[fund]).join(", ")}; to ${model.outflows.map((flow) => flow.category).join(", ") || "no outflows"}. Money in ${money(model.totalIn)}, money out ${money(model.totalOut)}, net change ${money(model.net)}.`, svg: sankeyReportVector(model.nodes, model.links, 500, 300, currency) }],
    sections: [{
      title: "Cash-flow totals", columns: [{ key: "metric", label: "Metric" }, { key: "amount", label: `Amount (${currency})`, align: "right" }],
      rows: [{ key: "in", cells: ["Money in", money(model.totalIn)] }, { key: "out", cells: ["Money out", money(model.totalOut)] }, { key: "net", cells: ["Net change", money(model.net)], kind: "total" }],
    }, {
      title: "All categories", columns,
      rows: flows.map((flow) => ({ key: flow.id, cells: [flow.category, flow.direction === "in" ? "Money in" : "Money out", ...model.funds.map((fund) => money(flow.byFund[fund] ?? 0)), money(flow.cents), money(flow.offsetCents)] })),
    }],
    warnings: ["Refunds and reversals reduce their original category; transfers between your own accounts are excluded. Balancing nodes represent net increase or use of cash on hand.", ...(options.truncated ? ["The source reached its 5,000-transaction history limit; earlier activity may be omitted."] : []), ...(options.sourceCurrencies && options.sourceCurrencies.length > 1 ? [`The source overview combines nominal amounts in ${options.sourceCurrencies.join(", ")}; no currency conversion is performed.`] : [])],
  };
}
