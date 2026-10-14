import { useMemo, useState } from "react";
import {
  BudgetBars,
  ChartCard,
  FlowBarChart,
  TimeSeriesChart,
  formatMonthLong,
  type ChartSeries,
  type DateRange,
  type FlowRow,
  type TimeRow,
} from "../../../components/charts";
import { todayDateOnly } from "../../../lib/format";
import { budgetVariance, formatMoney } from "../../../lib/money";
import type { BudgetKind } from "../lib/budgetKind";
import { FinanceRangeBar } from "./FinanceRangeBar";
import { FinanceRangeStats } from "./FinanceRangeStats";
import {
  balanceLookup,
  balanceRows,
  defaultPreset,
  flowTotals,
  monthEndBalances,
  monthlyFlowRows,
  presetRange,
  previousRange,
  type RangePreset,
} from "./series";
import { useFinanceInsightsData } from "./useFinanceInsightsData";

type Society = { _id: string; fiscalYearEnd?: string | null };

const BALANCE_SERIES: ChartSeries = { key: "balance", label: "Cash balance", color: "var(--dv-cat-1)", variant: "area" };
const PREVIOUS_SERIES: ChartSeries = { key: "previous", label: "Previous period", color: "var(--dv-previous)", comparison: true };

/**
 * Financials overview trends: range presets, cash over time (with
 * drag-to-select), money in vs out by month, range stat tiles and budget vs
 * actual bars. Renders nothing for a workspace with no bank data at all.
 */
export function FinancialInsights({ society }: { society: Society }) {
  const data = useFinanceInsightsData(society._id);
  const today = todayDateOnly();
  const [presetChoice, setPresetChoice] = useState<RangePreset | null>(null);
  const [compare, setCompare] = useState(false);
  const [selection, setSelection] = useState<DateRange | null>(null);
  const preset = presetChoice ?? defaultPreset(data.txns, today);
  const range = useMemo(() => presetRange(preset, today, { earliest: data.earliest, fiscalYearEnd: society.fiscalYearEnd }), [data.earliest, preset, society.fiscalYearEnd, today]);
  const focus = selection ?? range;
  const view = useInsightSeries(data.txns, data.currentBalance, range, focus, selection, compare);

  if (!data.loading && !data.hasAnyFinance) return null;
  const notEnough = !data.loading && data.txns.length < 2;

  return (
    <section className="insights" aria-label="Financial trends">
      <FinanceRangeBar
        preset={preset}
        onPreset={(next) => {
          setPresetChoice(next);
          setSelection(null);
        }}
        compare={compare}
        onCompare={setCompare}
        range={range}
        selection={selection}
        onClearSelection={() => setSelection(null)}
        compareNote={compare && !data.loading && !view.previousCovered ? "The previous period predates the imported transactions, so totals are not compared." : undefined}
      />
      {!notEnough && !data.loading && <FinanceRangeStats totals={view.totals} previous={compare && view.previousCovered ? view.previousTotals : null} closingBalance={view.closing} previousClosing={view.previousClosing} />}
      <div className="insights__grid insights__grid--two">
        <ChartCard
          title="Cash over time"
          subtitle="Bank and card balances, worked back from today's balance through imported transactions."
          loading={data.loading}
          empty={notEnough}
          table={view.cashTable}
        >
          <TimeSeriesChart
            data={view.cashRows}
            series={compare ? [BALANCE_SERIES, PREVIOUS_SERIES] : [BALANCE_SERIES]}
            curve="step"
            average={{ key: "balance", label: "Avg" }}
            ariaLabel={view.cashSummary}
            selection={selection}
            onRangeChange={setSelection}
          />
        </ChartCard>
        <ChartCard
          title="Money in vs out by month"
          subtitle={selection ? "Months outside the selected range are faded." : "Deposits above the line, payments below, with the net change."}
          loading={data.loading}
          empty={notEnough}
          table={view.flowTable}
        >
          <FlowBarChart rows={view.flowRows} showNet ariaLabel={view.flowSummary} />
        </ChartCard>
      </div>
      <BudgetVsActualCard rows={data.budgetRows} loading={data.loading} />
    </section>
  );
}

function useInsightSeries(txns: ReturnType<typeof useFinanceInsightsData>["txns"], currentBalance: number, range: DateRange, focus: DateRange, selection: DateRange | null, compare: boolean) {
  return useMemo(() => {
    const cashRows: TimeRow[] = balanceRows(txns, currentBalance, range, compare);
    const flowRows: FlowRow[] = monthlyFlowRows(txns, range, selection);
    const totals = flowTotals(txns, focus);
    const prior = previousRange(focus);
    const previousTotals = flowTotals(txns, prior);
    const balanceAt = balanceLookup(txns, currentBalance);
    const closing = balanceAt(focus.end);
    const previousClosing = balanceAt(prior.end);
    // Only compare against a previous period the imported history fully covers.
    const previousCovered = txns.length > 0 && prior.start >= txns[0].date.slice(0, 7) + "-01";
    const months = monthEndBalances(cashRows);
    const known = months.filter((m) => m.value != null);
    const first = known[0];
    const last = known[known.length - 1];
    const cashSummary = last && first
      ? `Cash balance from ${formatMonthLong(first.month)} to ${formatMonthLong(last.month)}, moving from ${formatMoney(first.value!, { trimWholeCents: true })} to ${formatMoney(last.value!, { trimWholeCents: true })}`
      : "Cash balance over time: no transactions in this range";
    const totalIn = flowRows.reduce((sum, r) => sum + r.inflow, 0);
    const totalOut = flowRows.reduce((sum, r) => sum + r.outflow, 0);
    const flowSummary = `Money in and out across ${flowRows.length} months: ${formatMoney(totalIn, { trimWholeCents: true })} in, ${formatMoney(totalOut, { trimWholeCents: true })} out`;
    return {
      cashRows,
      flowRows,
      totals,
      previousTotals,
      closing,
      previousClosing,
      previousCovered,
      cashSummary,
      flowSummary,
      cashTable: {
        caption: "Month-end cash balance",
        columns: [
          { key: "month", label: "Month" },
          { key: "balance", label: "Closing balance", numeric: true },
          ...(compare ? [{ key: "previous", label: "Previous period", numeric: true }] : []),
        ],
        rows: months.map((m) => ({ month: formatMonthLong(m.month), balance: formatMoney(m.value), ...(compare ? { previous: formatMoney(m.previous ?? null) } : {}) })),
      },
      flowTable: {
        caption: "Money in and out by month",
        columns: [
          { key: "month", label: "Month" },
          { key: "inflow", label: "Money in", numeric: true },
          { key: "outflow", label: "Money out", numeric: true },
          { key: "net", label: "Net change", numeric: true },
        ],
        rows: flowRows.map((r) => ({ month: r.tooltipLabel ?? r.label, inflow: formatMoney(r.inflow), outflow: formatMoney(r.outflow), net: formatMoney(r.inflow - r.outflow, { signDisplay: "exceptZero" }) })),
      },
    };
  }, [compare, currentBalance, focus, range, selection, txns]);
}

function BudgetVsActualCard({ rows, loading }: { rows: Array<{ _id: string; category: string; fiscalYear: string; plannedCents: number; actualCents: number; kind: BudgetKind }>; loading: boolean }) {
  const latestYear = rows.reduce<string | null>((max, r) => (max == null || r.fiscalYear > max ? r.fiscalYear : max), null);
  const yearRows = rows.filter((r) => r.fiscalYear === latestYear);
  if (!loading && yearRows.length === 0) return null;
  return (
    <ChartCard
      title="Budget vs actuals"
      subtitle={latestYear ? `FY ${latestYear} · actuals against plan by category` : undefined}
      loading={loading}
      height={120}
      table={{
        caption: `Budget vs actuals${latestYear ? `, FY ${latestYear}` : ""}`,
        columns: [
          { key: "category", label: "Category" },
          { key: "planned", label: "Budget", numeric: true },
          { key: "actual", label: "Actual", numeric: true },
          { key: "variance", label: "Variance", numeric: true },
        ],
        rows: yearRows.map((r) => ({ category: r.category, planned: formatMoney(r.plannedCents), actual: formatMoney(r.actualCents), variance: formatMoney(budgetVariance(r.plannedCents, r.actualCents, r.kind).cents, { signDisplay: "exceptZero" }) })),
      }}
    >
      <BudgetBars rows={yearRows.map((r) => ({ key: String(r._id), label: r.category, planned: r.plannedCents, actual: r.actualCents, kind: r.kind }))} ariaLabel={`Budget vs actual by category${latestYear ? ` for FY ${latestYear}` : ""}`} />
    </ChartCard>
  );
}
