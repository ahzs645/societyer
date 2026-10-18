import { useMemo, useState, type ReactNode } from "react";
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
import { MobileFold } from "../../../components/MobileFold";
import { Money } from "../../../components/Money";
import { StatTile } from "../../../components/StatTile";
import { todayDateOnly } from "../../../lib/format";
import { useIsMobile } from "../../../lib/useIsMobile";
import { budgetVariance, formatMoney } from "../../../lib/money";
import type { BudgetKind } from "../lib/budgetKind";
import { CashFlowSankeyCard } from "./CashFlowSankeyCard";
import { FinanceRangeBar } from "./FinanceRangeBar";
import { FinanceRangeStats } from "./FinanceRangeStats";
import { OperatingReserveTile } from "./OperatingReserveTile";
import { TopFlowsCard } from "./TopFlowsCard";
import { topFlows } from "./topFlows";
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

/** Page figures that join the range tiles' "More metrics" fold on phones. */
export type FinanceMoreMetrics = { tiles: ReactNode; count: number; note?: ReactNode };

/** Whole dollars for the one-line fold summaries ("$55,651"), which must fit a phone row. */
const dollars = (cents: number, signDisplay?: "exceptZero") => formatMoney(Math.round(cents / 100) * 100, { trimWholeCents: true, signDisplay });

const BALANCE_SERIES: ChartSeries = { key: "balance", label: "Cash balance", color: "var(--dv-cat-1)", variant: "area" };
const PREVIOUS_SERIES: ChartSeries = { key: "previous", label: "Previous period", color: "var(--dv-previous)", comparison: true };

/**
 * Financials overview trends: range presets, cash over time (with
 * drag-to-select), money in vs out by month, range stat tiles and budget vs
 * actual bars. Renders nothing for a workspace with no bank data at all.
 *
 * Phones: four headline tiles, every other figure (plus the page's
 * `moreMetrics`) in a "More metrics" fold, and each section after the first
 * chart folded behind a one-line summary.
 */
export function FinancialInsights({
  society,
  moreMetrics,
  hideBudgetChart = false,
}: {
  society: Society;
  /** Phones: the page's own summary tiles, shown in the "More metrics" fold. */
  moreMetrics?: FinanceMoreMetrics;
  /** Skip the budget bars (phones, where the page's budget table carries the same figures). */
  hideBudgetChart?: boolean;
}) {
  const data = useFinanceInsightsData(society._id);
  const isMobile = useIsMobile();
  const today = todayDateOnly();
  const [presetChoice, setPresetChoice] = useState<RangePreset | null>(null);
  const [compare, setCompare] = useState(false);
  const [selection, setSelection] = useState<DateRange | null>(null);
  const preset = presetChoice ?? defaultPreset(data.txns, today);
  const range = useMemo(() => presetRange(preset, today, { earliest: data.earliest, fiscalYearEnd: society.fiscalYearEnd }), [data.earliest, preset, society.fiscalYearEnd, today]);
  const focus = selection ?? range;
  const view = useInsightSeries(data.txns, data.currentBalance, range, focus, selection, compare);

  const notEnough = !data.loading && data.txns.length < 2;
  const showStats = !notEnough && !data.loading;
  const moreFold = (tiles: ReactNode, count: number, open = false) => {
    const total = count + (moreMetrics?.count ?? 0);
    if (total === 0) return null;
    return (
      <MobileFold title={`More metrics (${total})`} summary="Ledger, funds, reserves and other figures" defaultOpen={open}>
        <div className="stat-grid">
          {tiles}
          {moreMetrics?.tiles}
        </div>
        {moreMetrics?.note && <p className="mobile-fold__note">{moreMetrics.note}</p>}
      </MobileFold>
    );
  };
  if (!data.loading && !data.hasAnyFinance) {
    // No bank data: the page's own figures are all there is, so show them open.
    return isMobile && moreMetrics ? <section className="insights" aria-label="Financial summary">{moreFold(null, 0, true)}</section> : null;
  }

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
      {showStats && (
        <FinanceRangeStats
          totals={view.totals}
          previous={compare && view.previousCovered ? view.previousTotals : null}
          closingBalance={view.closing}
          previousClosing={view.previousClosing}
          currentBalance={data.currentBalance}
          headline={isMobile}
          more={(tiles, count) => moreFold(tiles, count)}
        >
          <OperatingReserveTile societyId={society._id} txns={data.txns} unrestrictedCents={data.unrestrictedBalance} today={today} />
        </FinanceRangeStats>
      )}
      {/* Too little history for range tiles: the bank balance joins the page figures. */}
      {isMobile && notEnough && moreFold(<StatTile label="Bank balance" value={<Money variant="hero" trimWholeCents cents={data.currentBalance} />} />, 1)}
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
        <MobileFold title="Money in vs out by month" summary={showStats ? `Net ${dollars(view.flowRows.reduce((sum, r) => sum + r.inflow - r.outflow, 0), "exceptZero")} over ${view.flowRows.length} ${view.flowRows.length === 1 ? "month" : "months"}` : undefined}>
          <ChartCard
            title="Money in vs out by month"
            subtitle={selection ? "Months outside the selected range are faded." : "Deposits above the line, payments below, with the net change."}
            loading={data.loading}
            empty={notEnough}
            table={view.flowTable}
          >
            <FlowBarChart rows={view.flowRows} showNet ariaLabel={view.flowSummary} />
          </ChartCard>
        </MobileFold>
      </div>
      {!notEnough && (
        <div className="insights__grid insights__grid--two">
          <MobileFold title="Top payees" summary={isMobile ? largestFlowSummary(data.txns, focus, "payee") : undefined}>
            <TopFlowsCard grouping="payee" txns={data.txns} range={focus} loading={data.loading} />
          </MobileFold>
          <MobileFold title="Top categories" summary={isMobile ? largestFlowSummary(data.txns, focus, "category") : undefined}>
            <TopFlowsCard grouping="category" txns={data.txns} range={focus} loading={data.loading} />
          </MobileFold>
        </div>
      )}
      {!notEnough && (
        <MobileFold title="Where the money came from and went" summary={showStats ? `${dollars(view.totals.inflow)} in · ${dollars(view.totals.outflow)} out, by category` : undefined}>
          <CashFlowSankeyCard societyId={society._id} range={focus} />
        </MobileFold>
      )}
      {!hideBudgetChart && <BudgetVsActualCard rows={data.budgetRows} loading={data.loading} />}
    </section>
  );
}

/** "Biggest spend: Brightwave Payroll, $55,651" (money out, the cards' default direction). */
function largestFlowSummary(txns: ReturnType<typeof useFinanceInsightsData>["txns"], range: DateRange, grouping: "payee" | "category"): string {
  const top = topFlows(txns, range, grouping, "out", 1).rows[0];
  return top ? `Biggest spend: ${top.label}, ${dollars(top.cents)}` : "No money out in this range";
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
  const planned = yearRows.reduce((sum, r) => sum + r.plannedCents, 0);
  const actual = yearRows.reduce((sum, r) => sum + r.actualCents, 0);
  return (
    <MobileFold title="Budget vs actuals" summary={loading ? undefined : `${latestYear ? `FY ${latestYear} · ` : ""}${dollars(actual)} of ${dollars(planned)} planned · ${yearRows.length} ${yearRows.length === 1 ? "category" : "categories"}`}>
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
    </MobileFold>
  );
}
