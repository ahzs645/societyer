/**
 * Trends: awards by month, by year and by buyer and month. Every figure lists
 * its awards: a point on the chart, a month or year row, a calendar cell.
 * Dragging across the chart still narrows the whole analysis to those months.
 *
 * A source's first records are often a few scattered awards over years of
 * empty months; the chart and its table start where the awards do, and fold
 * that early stretch into one "earlier" row that still counts every award
 * in it and lists them, with a way to show every month.
 */
import { useMemo, useState } from "react";
import { ChartCard, TimeSeriesChart, endOfMonth, formatMonthLong, type ChartSeries, type TimeRow } from "../../../../components/charts";
import { Select } from "../../../../components/Select";
import { Segmented } from "../../../../components/primitives";
import { count, counted, foldEarlyMonths, money, trends, yearly } from "../../lib/market";
import { filterPatch } from "./filters";
import { Heatmap, RankedList } from "./parts";
import type { ViewContext } from "./context";

export const METRICS = [{ id: "value" as const, label: "Award value" }, { id: "count" as const, label: "Award count" }];
export const readMetric = (params: URLSearchParams): "value" | "count" => (params.get("metric") === "count" ? "count" : "value");
const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-CA", { month: "short", timeZone: "UTC" });
const monthLong = (month: string) => formatMonthLong(`${month}-01`);

export function TrendsView({ ctx }: { ctx: ViewContext }) {
  const { currency, partial, params, update } = ctx;
  const metric = readMetric(params);
  const year = params.get("year") ?? "";
  const [normalized, setNormalized] = useState(false);
  const [everyMonth, setEveryMonth] = useState(false);
  const data = useMemo(() => {
    if (ctx.aggregate?.trends) return ctx.aggregate.trends;
    try { return trends(ctx.rows, year, ctx.today); } catch { return trends(ctx.rows, "", ctx.today); }
  }, [ctx.rows, ctx.today, year, ctx.aggregate]);
  const folded = useMemo(() => foldEarlyMonths(data.series), [data.series]);
  const months = everyMonth ? data.series : folded.shown;
  const earlier = everyMonth ? null : folded.earlier;
  const years = useMemo(() => yearly(data.series).reverse(), [data.series]);
  const yearChoices = useMemo(() => [...new Set([data.year, ...years.map((row) => row.year)])].sort().reverse(), [data.year, years]);
  const series: ChartSeries[] = useMemo(() => [{ key: "awards", label: metric === "value" ? "Recorded award value" : "Awards", color: "var(--dv-cat-1)", variant: "area" }], [metric]);
  const chartRows: TimeRow[] = useMemo(() => months.map((row) => ({ date: `${row.month}-01`, awards: row[metric] })), [months, metric]);
  const format = (value: number) => (metric === "value" ? money(value, currency) : count(value));
  const axis = (value: number) => (metric === "value" ? money(value, currency, true) : count(value));
  const openMonth = (month: string) => ctx.inspect({ slice: { month }, title: monthLong(month) });
  const openEarlier = () => earlier && ctx.inspect({ slice: { from: `${earlier.from}-01`, to: endOfMonth(`${earlier.to}-01`) }, title: `${monthLong(earlier.from)} – ${monthLong(earlier.to)}` });
  const tableRows = [...months].reverse();
  return (
    <>
      <div className="procurement-analytics__toolbar">
        <Segmented value={metric} onChange={(next) => update({ metric: next === "value" ? null : next })} items={METRICS} />
      </div>
      <ChartCard
        title="Awards over time"
        subtitle={[`By award month${partial ? ", so far" : ""}.`, data.undated ? `${counted(data.undated, "undated award")} left out.` : "", "Choose a month for its awards, or drag across the chart to focus on those months."].filter(Boolean).join(" ")}
        headingLevel={3}
        height={260}
        empty={data.series.length < 2}
        emptyMessage="Not enough dated awards for a trend."
        table={{
          caption: "Awards by month",
          columns: [{ key: "month", label: "Month" }, { key: "count", label: "Awards", numeric: true }, { key: "value", label: "Award value", numeric: true }],
          rows: [
            ...tableRows.map((row) => ({ month: monthLong(row.month), count: count(row.count), value: money(row.value, currency) })),
            ...(earlier ? [{ month: `Earlier months, since ${monthLong(earlier.from)}`, count: count(earlier.count), value: money(earlier.value, currency) }] : []),
          ],
          rowAction: (index) => {
            const row = tableRows[index];
            if (row) return row.count ? { label: `Awards in ${monthLong(row.month)}`, onSelect: () => openMonth(row.month) } : null;
            return earlier?.count ? { label: `Awards from ${monthLong(earlier.from)} to ${monthLong(earlier.to)}`, onSelect: openEarlier } : null;
          },
        }}
        footer={folded.earlier ? (
          <span className="procurement-analytics__earlier">
            {everyMonth ? <span className="muted">Showing every month since {monthLong(folded.earlier.from)}.</span> : (
              <>
                <span className="muted">Before {monthLong(months[0]?.month ?? folded.earlier.to)}:</span>{" "}
                {folded.earlier.count ? (
                  <button type="button" className="procurement-analytics__inline-link" onClick={openEarlier}>{counted(folded.earlier.count, "award")} since {monthLong(folded.earlier.from)}</button>
                ) : <span className="muted">no awards</span>}
              </>
            )}
            <button type="button" className="btn btn--ghost btn--sm" aria-pressed={everyMonth} onClick={() => setEveryMonth(!everyMonth)}>
              {everyMonth ? "Start at recent months" : "Show every month"}
            </button>
          </span>
        ) : undefined}
      >
        <TimeSeriesChart
          data={chartRows}
          series={series}
          height={260}
          includeZero
          integerAxis={metric === "count"}
          formatValue={format}
          formatAxis={axis}
          formatDate={formatMonthLong}
          ariaLabel={`${metric === "value" ? "Recorded award value" : "Awards"} by month, ${months[0] ? monthLong(months[0].month) : ""} to ${months.at(-1) ? monthLong(months.at(-1)!.month) : ""}`}
          selection={null}
          onRangeChange={(range) => { if (range) update({ ...filterPatch({ ...ctx.filters, from: range.start, to: endOfMonth(range.end) }), year: range.end.slice(0, 4), inspect: null }); }}
          minSelectionDays={28}
          canSelectPoint={(_, index) => (months[index]?.count ?? 0) > 0}
          onPointSelect={(_, index) => openMonth(months[index].month)}
        />
      </ChartCard>
      <ChartCard title="By year" subtitle={`Calendar years, newest first${partial ? ", so far" : ""}. Choose one for its awards.`} headingLevel={3} empty={!years.length} emptyMessage="No dated awards.">
        <RankedList
          rows={years.map((row) => ({ key: row.year, label: row.year, value: Math.max(0, row[metric]), detail: metric === "value" ? counted(row.count, "award") : money(row.value, currency, true) }))}
          ariaLabel="Awards by year"
          formatValue={axis}
          exactValue={metric === "value" ? format : undefined}
          onSelect={(row) => ctx.inspect({ slice: { from: `${row.key}-01-01`, to: `${row.key}-12-31` }, title: row.key })}
          selectLabel={(row) => `Awards in ${row.label}`}
          menu={(row) => [{
            id: "focus",
            items: [{
              id: "focus", label: `Focus the analysis on ${row.key}`,
              // The calendar follows the year chosen.
              onSelect: () => update({ ...filterPatch({ ...ctx.filters, from: `${row.key}-01-01`, to: `${row.key}-12-31` }), year: row.key, inspect: null }),
            }],
          }]}
        />
      </ChartCard>
      <ChartCard
        title="Buyer spending calendar"
        subtitle={`Top ${data.buyers.length} buyers in ${data.year}: ${count(data.shownCount)} of ${counted(data.yearCount, "award")} that year. Choose a month for its awards.`}
        headingLevel={3}
        actions={<Select<string> size="sm" aria-label="Calendar year" value={data.year} onChange={(next) => update({ year: next })} options={yearChoices.map((value) => ({ value, label: value }))} />}
      >
        <label className="procurement-analytics__check"><input type="checkbox" checked={normalized} onChange={(event) => setNormalized(event.target.checked)} /> Share within each buyer’s row</label>
        <Heatmap
          rows={data.buyers.map((row) => row.name)} columns={data.months} cells={data.cells} metric={metric} currency={currency} normalized={normalized}
          columnLabel={monthName} caption={`Top buyers by month in ${data.year}`}
          onCell={(cell) => ctx.inspect({ slice: cell.slice, title: `${cell.row} · ${monthLong(cell.column)}` })} onRow={ctx.openBuyer}
        />
      </ChartCard>
    </>
  );
}
