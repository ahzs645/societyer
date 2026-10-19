import { useMemo } from "react";
import { ChartCard, FlowBarChart, TimeSeriesChart, type ChartSeries, type ChartTable, type FlowRow, type TimeRow } from "../../../components/charts";
import { Money } from "../../../components/Money";
import { formatDate } from "../../../lib/format";
import { formatMoney } from "../../../lib/money";
import type { BooksReport, BooksReportKind, BooksReportSummaryPoint } from "../../../../shared/booksReports";
import { formatPeriodRange } from "./reportPeriods";

const CHART_HEIGHT = 160;
const WORKING_CAPITAL: ChartSeries = { key: "value", label: "Working capital", color: "var(--dv-cat-1)", variant: "area" };
const ENDING_CASH: ChartSeries = { key: "value", label: "Cash at period end", color: "var(--dv-cat-1)", variant: "area" };
const OPERATIONS_LABELS = { inflow: "Revenue", outflow: "Expenses", net: "Excess (net)" };
const CASH_LABELS = { inflow: "Cash in", outflow: "Cash out", net: "Net change" };

const money = (cents: number, currency: string) => formatMoney(cents, { currency, trimWholeCents: true });

function balanceRows(summary: BooksReportSummaryPoint[], key: string): TimeRow[] {
  return summary.map((point) => ({ date: point.end, value: point.values[key] ?? 0 }));
}

function balanceTable(caption: string, summary: BooksReportSummaryPoint[], key: string, currency: string): ChartTable {
  return {
    caption,
    columns: [
      { key: "period", label: "Period" },
      { key: "end", label: "As at" },
      { key: "value", label: caption, numeric: true },
    ],
    rows: summary.map((point) => ({ period: point.label, end: formatDate(point.end), value: formatMoney(point.values[key] ?? 0, { currency }) })),
  };
}

function flowRows(summary: BooksReportSummaryPoint[], inKey: string, outKey: string, periodRanges: Map<string, string>): FlowRow[] {
  return summary.map((point) => ({
    key: point.periodId,
    label: point.label,
    tooltipLabel: `${point.label} (${periodRanges.get(point.periodId) ?? formatDate(point.end)})`,
    inflow: point.values[inKey] ?? 0,
    outflow: point.values[outKey] ?? 0,
  }));
}

function flowTable(caption: string, rows: FlowRow[], labels: { inflow: string; outflow: string; net: string }, currency: string): ChartTable {
  return {
    caption,
    columns: [
      { key: "period", label: "Period" },
      { key: "inflow", label: labels.inflow, numeric: true },
      { key: "outflow", label: labels.outflow, numeric: true },
      { key: "net", label: labels.net, numeric: true },
    ],
    rows: rows.map((row) => ({
      period: row.label,
      inflow: formatMoney(row.inflow, { currency }),
      outflow: formatMoney(row.outflow, { currency }),
      net: formatMoney(row.inflow - row.outflow, { currency, signDisplay: "exceptZero" }),
    })),
  };
}

function trendSummary(subject: string, rows: TimeRow[], currency: string) {
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) return `${subject}: nothing to show for this range`;
  const from = typeof first.value === "number" ? first.value : 0;
  const to = typeof last.value === "number" ? last.value : 0;
  if (rows.length === 1) return `${subject} at ${formatDate(last.date)}: ${money(to, currency)}`;
  return `${subject} from ${formatDate(first.date)} to ${formatDate(last.date)}, moving from ${money(from, currency)} to ${money(to, currency)}`;
}

function flowSummary(subject: string, rows: FlowRow[], labels: { inflow: string; outflow: string; net: string }, currency: string) {
  const inflow = rows.reduce((sum, row) => sum + row.inflow, 0);
  const outflow = rows.reduce((sum, row) => sum + row.outflow, 0);
  return `${subject} across ${rows.length} ${rows.length === 1 ? "period" : "periods"}: ${labels.inflow} ${money(inflow, currency)}, ${labels.outflow} ${money(outflow, currency)}, ${labels.net} ${money(inflow - outflow, currency)}`;
}

/** "As at Oct 18, 2026 · $12,300" beside a balance chart's title. */
function LatestStat({ label, cents, currency }: { label: string; cents: number; currency: string }) {
  return (
    <span className="books-report-charts__stat">
      <span className="books-report-charts__stat-label">{label}</span>
      <Money cents={cents} currency={currency} variant="hero" trimWholeCents />
    </span>
  );
}

/**
 * Compact charts above a statement: working capital for the balance sheet,
 * revenue vs expenses for the statement of operations, and ending cash plus
 * cash in vs out for cash flow. Each has a "View as table" twin.
 */
export function ReportChartStrip({ kind, report }: { kind: BooksReportKind; report: BooksReport | undefined }) {
  const loading = report === undefined;
  const currency = report?.currency ?? "CAD";
  const view = useMemo(() => {
    const summary = report?.summary ?? [];
    const periodRanges = new Map((report?.periods ?? []).map((period) => [period.id, formatPeriodRange(period.start, period.end)]));
    const last = summary[summary.length - 1];
    const workingCapital = balanceRows(summary, "workingCapital");
    const endingCash = balanceRows(summary, "ending");
    const operations = flowRows(summary, "revenue", "expenses", periodRanges);
    const cashMoves = flowRows(summary, "cashIn", "cashOut", periodRanges);
    return {
      empty: summary.length === 0,
      last,
      workingCapital,
      workingCapitalTable: balanceTable("Working capital", summary, "workingCapital", currency),
      workingCapitalSummary: trendSummary("Working capital", workingCapital, currency),
      endingCash,
      endingCashTable: balanceTable("Cash at period end", summary, "ending", currency),
      endingCashSummary: trendSummary("Cash at period end", endingCash, currency),
      operations,
      operationsTable: flowTable("Revenue and expenses by period", operations, OPERATIONS_LABELS, currency),
      operationsSummary: flowSummary("Revenue and expenses", operations, OPERATIONS_LABELS, currency),
      cashMoves,
      cashMovesTable: flowTable("Cash in and out by period", cashMoves, CASH_LABELS, currency),
      cashMovesSummary: flowSummary("Cash in and out", cashMoves, CASH_LABELS, currency),
    };
  }, [currency, report]);
  const formatValue = useMemo(() => (value: number) => formatMoney(value, { currency }), [currency]);
  const empty = !loading && view.empty;
  const shared = { headingLevel: 3 as const, height: CHART_HEIGHT, loading, empty, emptyMessage: "No periods in this range." };
  const latest = (key: string) => (view.last ? <LatestStat label={`As at ${formatDate(view.last.end)}`} cents={view.last.values[key] ?? 0} currency={currency} /> : undefined);

  if (kind === "balance_sheet") {
    return (
      <div className="books-report-charts">
        <ChartCard {...shared} title="Working capital" subtitle="Current assets less current liabilities at each period end." table={view.workingCapitalTable} actions={latest("workingCapital")}>
          <TimeSeriesChart data={view.workingCapital} series={[WORKING_CAPITAL]} height={CHART_HEIGHT} includeZero formatValue={formatValue} ariaLabel={view.workingCapitalSummary} />
        </ChartCard>
      </div>
    );
  }

  if (kind === "operations") {
    return (
      <div className="books-report-charts">
        <ChartCard {...shared} title="Revenue and expenses" subtitle="Revenue above the line, expenses below, with the excess (deficiency) for each period." table={view.operationsTable}>
          <FlowBarChart rows={view.operations} showNet labels={OPERATIONS_LABELS} height={CHART_HEIGHT} formatValue={formatValue} ariaLabel={view.operationsSummary} />
        </ChartCard>
      </div>
    );
  }

  return (
    <div className="books-report-charts books-report-charts--two">
      <ChartCard {...shared} title="Cash at period end" subtitle="Cash and bank balances at the end of each period." table={view.endingCashTable} actions={latest("ending")}>
        <TimeSeriesChart data={view.endingCash} series={[ENDING_CASH]} height={CHART_HEIGHT} curve="step" includeZero formatValue={formatValue} ariaLabel={view.endingCashSummary} />
      </ChartCard>
      <ChartCard {...shared} title="Cash in and out" subtitle="Money into and out of cash and bank accounts, with the net change." table={view.cashMovesTable}>
        <FlowBarChart rows={view.cashMoves} showNet labels={CASH_LABELS} height={CHART_HEIGHT} formatValue={formatValue} ariaLabel={view.cashMovesSummary} />
      </ChartCard>
    </div>
  );
}
