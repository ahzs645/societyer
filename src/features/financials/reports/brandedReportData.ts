import type { BooksReport, BooksReportRow, GeneralLedgerReport } from "../../../../shared/booksReports";
import type { BrandedReportChart, BrandedReportData, BrandedReportRow } from "./brandedReportTypes";
import { accountLabel, contraLabel, lineDescription } from "./generalLedgerExport";

const monetary = (value: number | undefined, currency: string) => value === undefined ? "" : new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(value / 100);

/** Flattens every row, including collapsed children, matching Excel/CSV exports. */
export function statementPdfRows(rows: BooksReportRow[], columnKeys: string[], currency: string, depth = 0): BrandedReportRow[] {
  return rows.flatMap((row) => [{
    key: row.id,
    kind: row.kind === "row" ? "data" as const : row.kind,
    depth,
    cells: [`${row.code ? `${row.code} · ` : ""}${row.label}${row.note ? ` — ${row.note}` : ""}`, ...columnKeys.map((key) => monetary(row.values?.[key], currency))],
  }, ...statementPdfRows(row.children ?? [], columnKeys, currency, depth + 1)]);
}

export function statementPdfCharts(report: BooksReport): BrandedReportChart[] {
  const labels = report.summary.map((point) => point.label);
  const series = (label: string, key: string, color: string, plotSign: 1 | -1 = 1) => ({ label, color, plotSign, values: report.summary.map((point) => point.values[key] ?? 0) });
  if (report.kind === "balance_sheet") return [{ title: "Working capital", description: "Current assets less current liabilities at each period end.", kind: "lines", labels, series: [series("Working capital", "workingCapital", "#245c46")] }];
  if (report.kind === "operations") return [{ title: "Revenue and expenses", description: "Revenue above the baseline, expenses below, and excess (deficiency) by period.", kind: "bars", labels, series: [series("Revenue", "revenue", "#245c46"), series("Expenses", "expenses", "#ba5b33", -1), series("Excess (net)", "net", "#315c9a")] }];
  return [
    { title: "Cash at period end", kind: "lines", curve: "step", labels, series: [series("Cash at period end", "ending", "#245c46")] },
    { title: "Cash in and out", kind: "bars", labels, series: [series("Cash in", "cashIn", "#245c46"), series("Cash out", "cashOut", "#ba5b33", -1), series("Net change", "movement", "#315c9a")] },
  ];
}

export function statementPdfData(report: BooksReport, title: string, filterSummary: string[]): BrandedReportData {
  const columns = report.periods.map((period) => ({ key: period.id, label: period.label, align: "right" as const }));
  if (report.totalColumn) columns.push({ key: report.totalColumn, label: "Total", align: "right" });
  return {
    title, currency: report.currency, filterSummary,
    columns: [{ key: "account", label: "Account", width: 2.4 }, ...columns],
    rows: statementPdfRows(report.rows, columns.map((column) => column.key), report.currency),
    charts: statementPdfCharts(report), warnings: report.warnings,
  };
}

export function ledgerPdfData(report: GeneralLedgerReport, filterSummary: string[]): BrandedReportData {
  const withBalance = Boolean(report.account);
  const rows: BrandedReportRow[] = [];
  if (report.account) rows.push({ key: "opening", kind: "subtotal", cells: [report.from, "Opening balance", "", "", "", "", "", monetary(report.account.openingBalanceCents, report.currency)] });
  rows.push(...report.rows.map((row) => ({ key: row.lineId, cells: [row.date, accountLabel(row.account), contraLabel(row), [row.memo, lineDescription(row)].filter(Boolean).join(" — "), row.counterparty ?? "", monetary(row.debitCents, report.currency), monetary(row.creditCents, report.currency), ...(withBalance ? [monetary(row.balanceCents, report.currency)] : [])] })));
  rows.push({ key: "totals", kind: "total", cells: ["", "Totals", "", "", "", monetary(report.totals.debitCents, report.currency), monetary(report.totals.creditCents, report.currency), ...(withBalance ? [""] : [])] });
  if (report.account) rows.push({ key: "closing", kind: "subtotal", cells: [report.to, "Closing balance", "", "", "", "", "", monetary(report.account.closingBalanceCents, report.currency)] });
  return {
    title: "General ledger", subtitle: report.account ? accountLabel(report.account) : "All accounts", currency: report.currency, filterSummary,
    columns: [
      { key: "date", label: "Date", width: 0.9 }, { key: "account", label: "Ledger account", width: 1.2 },
      { key: "contra", label: "Contra account(s)", width: 1.2 }, { key: "memo", label: "Memo / description", width: 1.8 },
      { key: "party", label: "Vendor / customer", width: 1.2 }, { key: "debit", label: "Debit", align: "right" },
      { key: "credit", label: "Credit", align: "right" }, ...(withBalance ? [{ key: "balance", label: "Balance", align: "right" as const }] : []),
    ], rows,
    warnings: [...report.warnings, ...(report.truncated ? [`Showing the first ${report.rows.length.toLocaleString()} lines; this PDF contains the same limited lines as the page. Totals cover every matching line. Narrow the range or choose an account for the rest.`] : [])],
  };
}
