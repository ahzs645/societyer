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
import { NarrativeInsights } from "./NarrativeInsights";
import { OperatingReserveTile } from "./OperatingReserveTile";
import { TopFlowsCard } from "./TopFlowsCard";
import { topFlows } from "./topFlows";
import {
  balanceLookup,
  balanceRows,
  compareLabel,
  compareRange,
  defaultPreset,
  flowTotals,
  monthEndBalances,
  monthlyFlowRows,
  presetRange,
  type CompareChoice,
  type RangePreset,
} from "./series";
import { useFinanceInsightsData } from "./useFinanceInsightsData";
import { useFinancePermissions } from "../../../hooks/useFinancePermissions";
import { ReportPdfDownload } from "../reports/ReportPdfDownload";
import { financialOverviewDocument } from "./financialOverviewDocument";

type Society = { _id: string; fiscalYearEnd?: string | null };

/** Page figures that join the range tiles' "More metrics" fold on phones. */
export type FinanceMoreMetrics = { tiles: ReactNode; count: number; note?: ReactNode };

/** Whole dollars for the one-line fold summaries ("$55,651"), which must fit a phone row. */
const dollars = (cents: number, signDisplay?: "exceptZero", currency = "CAD") => formatMoney(Math.round(cents / 100) * 100, { currency, trimWholeCents: true, signDisplay });

const BALANCE_SERIES: ChartSeries = { key: "balance", label: "Cash balance", color: "var(--dv-cat-1)", variant: "area" };
const PREVIOUS_SERIES: ChartSeries = { key: "previous", label: "Previous period", color: "var(--dv-previous)", comparison: true };

/** What the comparison note says when the history does not reach the comparison window. */
const UNCOVERED_NOTE: Record<Exclude<CompareChoice, "off">, string> = {
  previous: "The previous period predates the imported transactions, so totals are not compared.",
  lastYear: "The same period last year predates the imported transactions, so totals are not compared.",
};

/**
 * Financials overview trends: range presets, cash over time (with
 * drag-to-select), money in vs out by month, range stat tiles, written
 * insights (runway, money-out trend, top money-in sources) and budget vs
 * actual bars. "Compare to" switches the comparison between the previous
 * period and the same period last year. Renders nothing for a workspace with no bank data at all.
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
  const [currencyChoice, setCurrencyChoice] = useState<string | undefined>();
  const data = useFinanceInsightsData(society._id, true, currencyChoice, society.fiscalYearEnd ?? undefined);
  const { canExport } = useFinancePermissions();
  const isMobile = useIsMobile();
  const today = todayDateOnly();
  const [presetChoice, setPresetChoice] = useState<RangePreset | null>(null);
  const [compareMode, setCompareMode] = useState<CompareChoice>("off");
  const compare = compareMode !== "off";
  const [selection, setSelection] = useState<DateRange | null>(null);
  const preset = presetChoice ?? defaultPreset(data.txns, today);
  const range = useMemo(() => presetRange(preset, today, { earliest: data.earliest, fiscalYearEnd: society.fiscalYearEnd }), [data.earliest, preset, society.fiscalYearEnd, today]);
  const focus = selection ?? range;
  const view = useInsightSeries(data.txns, data.currentBalance, range, focus, selection, compareMode, data.currency);
  const overviewReport = useMemo(() => financialOverviewDocument({
    ...view, txns: data.txns, currentBalance: data.currentBalance, range, focus, compareMode,
    budgetRows: hideBudgetChart ? [] : data.budgetRows, truncated: data.truncated,
    currency: data.currency, sourceCurrencies: data.sourceCurrencies,
  }), [view, data, range, focus, compareMode, hideBudgetChart]);

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
      <div className="row" style={{ gap: 12, marginBottom: 10, flexWrap: "wrap" }}><label>Chart currency <select className="input" aria-label="Chart currency" value={data.currency} onChange={(event) => { setCurrencyChoice(event.target.value); setSelection(null); }}>{data.availableCurrencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label><button className="btn btn--sm" onClick={data.refreshSource}>Refresh complete chart sources</button>{data.loading && <span>Loading {data.sourceProgress.toLocaleString()} records…</span>}{data.sourceError && <span role="alert" className="field__error">{data.sourceError}</span>}</div>
      <FinanceRangeBar
        preset={preset}
        onPreset={(next) => {
          setPresetChoice(next);
          setSelection(null);
        }}
        compare={compareMode}
        onCompare={setCompareMode}
        range={range}
        selection={selection}
        onClearSelection={() => setSelection(null)}
        compareNote={compareMode !== "off" && !data.loading && !view.previousCovered ? UNCOVERED_NOTE[compareMode] : undefined}
      />
      <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
        <ReportPdfDownload societyId={society._id} report={overviewReport} filename={`financial-overview-${focus.start}-${focus.end}`} disabled={data.loading || !canExport} label="Overview PDF" />
      </div>
      {showStats && (
        <FinanceRangeStats
          currency={data.currency}
          totals={view.totals}
          previous={compare && view.previousCovered ? view.previousTotals : null}
          closingBalance={view.closing}
          previousClosing={view.previousClosing}
          currentBalance={data.currentBalance}
          compareLabel={compareMode === "lastYear" ? "vs same period last year" : "vs previous period"}
          headline={isMobile}
          more={(tiles, count) => moreFold(tiles, count)}
        >
          <OperatingReserveTile currency={data.currency} societyId={society._id} txns={data.txns} unrestrictedCents={data.unrestrictedBalance} today={today} />
        </FinanceRangeStats>
      )}
      {showStats && (
        <NarrativeInsights txns={data.txns} balanceCents={data.currentBalance} range={focus} mode={compareMode === "off" ? "previous" : compareMode} today={today} />
      )}
      {/* Too little history for range tiles: the bank balance joins the page figures. */}
      {isMobile && notEnough && moreFold(<StatTile label="Bank balance" value={<Money currency={data.currency} variant="hero" trimWholeCents cents={data.currentBalance} />} />, 1)}
      <div className="insights__grid insights__grid--two">
        <ChartCard
          title="Cash over time"
          subtitle="Bank and card balances, worked back from today's balance through imported transactions."
          loading={data.loading}
          empty={notEnough}
          table={view.cashTable}
        >
          <TimeSeriesChart
            formatValue={(value) => formatMoney(value, { currency: data.currency })}
            data={view.cashRows}
            series={compareMode === "off" ? [BALANCE_SERIES] : [BALANCE_SERIES, { ...PREVIOUS_SERIES, label: compareLabel(compareMode) }]}
            curve="step"
            average={{ key: "balance", label: "Avg" }}
            ariaLabel={view.cashSummary}
            selection={selection}
            onRangeChange={setSelection}
          />
        </ChartCard>
        <MobileFold title="Money in vs out by month" summary={showStats ? `Net ${dollars(view.flowRows.reduce((sum, r) => sum + r.inflow - r.outflow, 0), "exceptZero", data.currency)} over ${view.flowRows.length} ${view.flowRows.length === 1 ? "month" : "months"}` : undefined}>
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
          <MobileFold title="Top payees" summary={isMobile ? largestFlowSummary(data.txns, focus, "payee", data.currency) : undefined}>
            <TopFlowsCard currency={data.currency} grouping="payee" txns={data.txns} range={focus} loading={data.loading} />
          </MobileFold>
          <MobileFold title="Top categories" summary={isMobile ? largestFlowSummary(data.txns, focus, "category", data.currency) : undefined}>
            <TopFlowsCard currency={data.currency} grouping="category" txns={data.txns} range={focus} loading={data.loading} />
          </MobileFold>
        </div>
      )}
      {!notEnough && (
        <MobileFold title="Where the money came from and went" summary={showStats ? `${dollars(view.totals.inflow, undefined, data.currency)} in · ${dollars(view.totals.outflow, undefined, data.currency)} out, by category` : undefined}>
          <CashFlowSankeyCard currency={data.currency} societyId={society._id} range={focus} />
        </MobileFold>
      )}
      {!hideBudgetChart && <BudgetVsActualCard currency={data.currency} rows={data.budgetRows} loading={data.loading} />}
    </section>
  );
}

/** "Biggest spend: Brightwave Payroll, $55,651" (money out, the cards' default direction). */
function largestFlowSummary(txns: ReturnType<typeof useFinanceInsightsData>["txns"], range: DateRange, grouping: "payee" | "category", currency = "CAD"): string {
  const top = topFlows(txns, range, grouping, "out", 1).rows[0];
  return top ? `Biggest spend: ${top.label}, ${dollars(top.cents, undefined, currency)}` : "No money out in this range";
}

function useInsightSeries(txns: ReturnType<typeof useFinanceInsightsData>["txns"], currentBalance: number, range: DateRange, focus: DateRange, selection: DateRange | null, compareMode: CompareChoice, currency = "CAD") {
  return useMemo(() => {
    const compare = compareMode !== "off";
    // With comparison off, the (unused) comparison figures default to the previous period.
    const mode = compareMode === "off" ? "previous" : compareMode;
    const cashRows: TimeRow[] = balanceRows(txns, currentBalance, range, compare && mode);
    const flowRows: FlowRow[] = monthlyFlowRows(txns, range, selection);
    const totals = flowTotals(txns, focus);
    const prior = compareRange(focus, mode);
    const previousTotals = flowTotals(txns, prior);
    const balanceAt = balanceLookup(txns, currentBalance);
    const closing = balanceAt(focus.end);
    const previousClosing = balanceAt(prior.end);
    // Only compare against a period the imported history fully covers.
    const previousCovered = txns.length > 0 && prior.start >= txns[0].date.slice(0, 7) + "-01";
    const months = monthEndBalances(cashRows);
    const known = months.filter((m) => m.value != null);
    const first = known[0];
    const last = known[known.length - 1];
    const cashSummary = last && first
      ? `Cash balance from ${formatMonthLong(first.month)} to ${formatMonthLong(last.month)}, moving from ${formatMoney(first.value!, { currency, trimWholeCents: true })} to ${formatMoney(last.value!, { currency, trimWholeCents: true })}`
      : "Cash balance over time: no transactions in this range";
    const totalIn = flowRows.reduce((sum, r) => sum + r.inflow, 0);
    const totalOut = flowRows.reduce((sum, r) => sum + r.outflow, 0);
    const flowSummary = `Money in and out across ${flowRows.length} months: ${formatMoney(totalIn, { currency, trimWholeCents: true })} in, ${formatMoney(totalOut, { currency, trimWholeCents: true })} out`;
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
          ...(compare ? [{ key: "previous", label: compareLabel(mode), numeric: true }] : []),
        ],
        rows: months.map((m) => ({ month: formatMonthLong(m.month), balance: formatMoney(m.value, { currency }), ...(compare ? { previous: formatMoney(m.previous ?? null, { currency }) } : {}) })),
      },
      flowTable: {
        caption: "Money in and out by month",
        columns: [
          { key: "month", label: "Month" },
          { key: "inflow", label: "Money in", numeric: true },
          { key: "outflow", label: "Money out", numeric: true },
          { key: "net", label: "Net change", numeric: true },
        ],
        rows: flowRows.map((r) => ({ month: r.tooltipLabel ?? r.label, inflow: formatMoney(r.inflow, { currency }), outflow: formatMoney(r.outflow, { currency }), net: formatMoney(r.inflow - r.outflow, { currency, signDisplay: "exceptZero" }) })),
      },
    };
  }, [currency, compareMode, currentBalance, focus, range, selection, txns]);
}

function BudgetVsActualCard({ rows, loading, currency = "CAD" }: { currency?: string; rows: Array<{ _id: string; category: string; fiscalYear: string; plannedCents: number; actualCents: number; kind: BudgetKind }>; loading: boolean }) {
  const latestYear = rows.reduce<string | null>((max, r) => (max == null || r.fiscalYear > max ? r.fiscalYear : max), null);
  const yearRows = rows.filter((r) => r.fiscalYear === latestYear);
  if (!loading && yearRows.length === 0) return null;
  const planned = yearRows.reduce((sum, r) => sum + r.plannedCents, 0);
  const actual = yearRows.reduce((sum, r) => sum + r.actualCents, 0);
  return (
    <MobileFold title="Budget vs actuals" summary={loading ? undefined : `${latestYear ? `FY ${latestYear} · ` : ""}${dollars(actual, undefined, currency)} of ${dollars(planned, undefined, currency)} planned · ${yearRows.length} ${yearRows.length === 1 ? "category" : "categories"}`}>
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
          rows: yearRows.map((r) => ({ category: r.category, planned: formatMoney(r.plannedCents, { currency }), actual: formatMoney(r.actualCents, { currency }), variance: formatMoney(budgetVariance(r.plannedCents, r.actualCents, r.kind).cents, { currency, signDisplay: "exceptZero" }) })),
        }}
      >
        <BudgetBars formatValue={(value) => formatMoney(value, { currency })} rows={yearRows.map((r) => ({ key: String(r._id), label: r.category, planned: r.plannedCents, actual: r.actualCents, kind: r.kind }))} ariaLabel={`Budget vs actual by category${latestYear ? ` for FY ${latestYear}` : ""}`} />
      </ChartCard>
    </MobileFold>
  );
}
