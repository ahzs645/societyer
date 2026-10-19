/**
 * Zoer's Market analysis (`dashboard/market/MarketAnalysis.tsx`) over the
 * published awards: overview, trends, buyers, suppliers, award sizes,
 * procurement mix and data quality, with the same filters and defaults (CAD
 * only; placeholder suppliers and future-dated awards left out). Everything
 * is computed here from the award list (lib/market.ts), only for the view on
 * screen. Filters live in the URL; a buyer opens its buyer page, a supplier or
 * type focuses the analysis, and a cell or range lists its awards.
 */
import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { List, SlidersHorizontal } from "lucide-react";
import { ChartCard, TimeSeriesChart, endOfMonth, formatMonthLong, type ChartSeries, type TimeRow } from "../../../../components/charts";
import { Modal } from "../../../../components/Modal";
import { Select } from "../../../../components/Select";
import { StatTile } from "../../../../components/StatTile";
import { Segmented } from "../../../../components/primitives";
import { Banner, Field, Pill } from "../../../../components/ui";
import { FilterChips, FiltersDialog, activeCount, filterPatch, readFilters } from "./filters";
import {
  QUALITY_DETAILS, QUALITY_LABELS, count, counted, defaultFilters, distribution, filterAwards, matrix, metadata, money, normalizeAwards, overview, percent,
  rank, sliceAwards, trends, validateFilters, yearly, type Award, type MarketFilters, type QualityFlag, type Ranked, type Slice,
} from "../../lib/market";
import { formatSourceDate, zoneToday } from "../../lib/notice";
import { useReaderNavigation } from "../routes";
import { useReaderSource, type ListRow } from "../source";
import { NoticeTable } from "../NoticeTable";
import { Heatmap, LoadingLine, RankedList, type RankedRow } from "./parts";

export type AwardView = "overview" | "trends" | "buyers" | "suppliers" | "sizes" | "mix" | "quality";
const UNKNOWN_BUYER = "Unknown buyer";

const INSPECT_PARAM = "inspect";

type Inspection = { title: string; slice: Slice; all?: boolean };
function readInspection(value: string | null): Inspection | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const { title, slice, all } = parsed as Record<string, unknown>;
    return typeof title === "string" && slice && typeof slice === "object" ? { title, slice: slice as Slice, all: all === true } : null;
  } catch { return null; }
}

export function AwardAnalysis({ view, title }: { view: AwardView; title: string }) {
  const source = useReaderSource();
  const nav = useReaderNavigation();
  const list = source.useList("award");
  // Chunks land while the list loads; the figures follow without blocking typing or scrolling.
  const loaded = useDeferredValue(list?.rows);
  const all = useMemo(() => normalizeAwards(loaded ?? []), [loaded]);
  const byKey = useMemo(() => new Map((loaded ?? []).map((row) => [row.recordKey, row])), [loaded]);
  const today = useMemo(() => zoneToday(), []);
  const filters = readFilters(nav.params);
  const filterKey = JSON.stringify(filters);
  const filtered = useMemo(() => {
    try { return { rows: filterAwards(all, filters, today), error: "" }; }
    catch (error) { return { rows: [] as Award[], error: error instanceof Error ? error.message : "These filters can't be applied." }; }
  }, [all, filterKey, today]); // eslint-disable-line react-hooks/exhaustive-deps -- `filterKey` names every filter
  const [filtersOpen, setFiltersOpen] = useState(false);
  const meta = useMemo(() => (filtersOpen || view === "quality" ? metadata(all, today) : null), [all, filtersOpen, today, view]);
  const inspection = readInspection(nav.params.get(INSPECT_PARAM));
  const partial = !list?.done;

  const setFilters = (next: MarketFilters) => nav.update({ ...filterPatch(next), [INSPECT_PARAM]: null });
  const focus = (key: "supplier" | "type", name: string) => setFilters({ ...filters, [key]: name });
  const inspect = (slice: Slice, inspectTitle: string, everything = false) => nav.update({ [INSPECT_PARAM]: JSON.stringify({ title: inspectTitle, slice, ...(everything ? { all: true } : {}) }) });
  const openBuyer = (name: string) => { if (name === UNKNOWN_BUYER) inspect({ buyer: name }, name); else nav.openParty("organization", name); };
  const ctx: ViewContext = { rows: filtered.rows, all, currency: filters.currency, filters, today, partial, setFilters, focus, inspect, openBuyer, params: nav.params, update: nav.update };

  const active = activeCount(filters);
  const shown = filtered.rows.length;
  return (
    <>
      <header className="procurement-analytics__header">
        <div className="procurement-analytics__heading">
          <h2>{title}</h2>
          <p className="muted">
            {!list ? "Reading the published awards…"
              : view === "quality" ? `${counted(all.length, "published award")}${partial ? " so far" : ""}, regardless of filters`
              : `${counted(shown, "award")} in this analysis, of ${count(all.length)} published${partial ? " so far" : ""}`}
          </p>
        </div>
        <div className="procurement-analytics__actions">
          {view !== "quality" && (
            <button type="button" className="btn btn--sm" aria-haspopup="dialog" aria-label={active ? `Filters, ${active} active` : "Filters"} onClick={() => setFiltersOpen(true)}>
              <SlidersHorizontal size={14} aria-hidden="true" /> <span className="procurement-analytics__action-label">Filters</span>
              {active > 0 && <Pill size="sm">{active}</Pill>}
            </button>
          )}
          <button type="button" className="btn btn--sm" aria-label="Matching awards" disabled={!list} onClick={() => (view === "quality" ? inspect({}, "All published awards", true) : inspect({}, "Current filters"))}>
            <List size={14} aria-hidden="true" /> <span className="procurement-analytics__action-label">Matching awards</span>
          </button>
        </div>
      </header>
      {view !== "quality" && <FilterChips filters={filters} onChange={setFilters} />}
      <LoadingLine list={list} noun="awards" />
      {filtered.error && <Banner tone="danger">{filtered.error} <button type="button" className="btn btn--sm btn--ghost" onClick={() => setFilters(defaultFilters)}>Reset filters</button></Banner>}
      {!list ? <ViewSkeleton /> : (
        <div className="procurement-analytics__stack">
          {view === "overview" && <OverviewView ctx={ctx} />}
          {view === "trends" && <TrendsView ctx={ctx} />}
          {(view === "buyers" || view === "suppliers") && <EntityView key={view} ctx={ctx} kind={view === "buyers" ? "buyer" : "supplier"} />}
          {view === "sizes" && <SizesView ctx={ctx} />}
          {view === "mix" && <MixView ctx={ctx} />}
          {view === "quality" && meta && <QualityView ctx={ctx} meta={meta} />}
        </div>
      )}
      {filtersOpen && meta && <FiltersDialog value={filters} meta={meta} close={() => setFiltersOpen(false)} apply={(next) => { setFilters(next); setFiltersOpen(false); }} />}
      {inspection && (
        <Inspect
          inspection={inspection}
          awards={inspection.all ? sliceAwards(all, inspection.slice, today) : sliceAwards(filtered.rows, inspection.slice, today)}
          byKey={byKey}
          partial={partial}
          close={() => nav.update({ [INSPECT_PARAM]: null })}
          hidden={Boolean(nav.params.get("notice") || nav.params.get("buyer") || nav.params.get("issuedFor"))}
        />
      )}
    </>
  );
}

type ViewContext = {
  rows: Award[]; all: Award[]; currency: string; filters: MarketFilters; today: string; partial: boolean;
  setFilters: (next: MarketFilters) => void; focus: (key: "supplier" | "type", name: string) => void;
  inspect: (slice: Slice, title: string, everything?: boolean) => void; openBuyer: (name: string) => void;
  params: URLSearchParams; update: (patch: Record<string, string | null>) => void;
};

function ViewSkeleton() {
  return (
    <div className="procurement-analytics__skeleton" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => <span key={i} />)}
      <span className="procurement-analytics__skeleton-wide" />
    </div>
  );
}

/** "so far" on a figure while the list is still loading: never shown as final. */
const soFar = (partial: boolean, text?: string) => (partial ? [text, "so far"].filter(Boolean).join(" · ") : text);

const rankedRows = (rows: Ranked[], detail: (row: Ranked) => ReactNode, limit: number): RankedRow[] =>
  rows.slice(0, limit).map((row) => ({ key: row.name, label: row.name, value: Math.max(0, row.value), share: row.share, detail: detail(row) }));

function OverviewView({ ctx }: { ctx: ViewContext }) {
  const data = useMemo(() => overview(ctx.rows), [ctx.rows]);
  const { currency, partial } = ctx;
  return (
    <>
      <div className="stat-grid stat-grid--3 procurement-analytics__stats">
        <StatTile label="Award value" value={money(data.value, currency, true)} sub={soFar(partial, `${count(data.valuedCount)} valued records`)} />
        <StatTile label="Awards" value={count(data.count)} sub={soFar(partial)} />
        <StatTile label="Median award" value={money(data.median, currency)} sub={soFar(partial)} />
        <StatTile label="Buyers" value={count(data.buyerCount)} sub={soFar(partial)} />
        <StatTile label="Suppliers" value={count(data.supplierCount)} sub={soFar(partial)} />
        <StatTile label="Top 10 supplier share" value={data.positiveTotal > 0 ? percent(data.top10Share) : "—"} sub={soFar(partial, "Positive value only")} />
      </div>
      <ChartCard title={`Market signals${partial ? " so far" : ""}`} headingLevel={3}>
          <ul className="procurement-analytics__signals">
            <li>
              <strong>{data.suppliersFor80 === null ? "No positive award value." : `${counted(data.suppliersFor80, "supplier")} ${data.suppliersFor80 === 1 ? "accounts" : "account"} for 80% of positive award value.`}</strong>
              {data.suppliersFor80 !== null && ` That is ${percent(data.suppliersFor80 / Math.max(1, data.supplierCount))} of the suppliers here.`}
            </li>
            <li>{data.buyers[0] ? <><strong>{data.buyers[0].name}</strong> is the largest buyer by recorded award value: {money(data.buyers[0].value, currency)} across {counted(data.buyers[0].count, "award")}.</> : "No buyers match the current filters."}</li>
            <li>{data.types[0] ? <><strong>{data.types[0].name}</strong> is the largest procurement type by recorded value.</> : "No procurement types match the current filters."}</li>
          </ul>
      </ChartCard>
      <div className="procurement-analytics__columns">
        <ChartCard
          title="Leading buyers"
          subtitle={`Top ${Math.min(8, data.buyerCount)} of ${count(data.buyerCount)} by recorded value. Open one for its notices and awards.`}
          headingLevel={3}
          empty={!data.buyers.length}
          emptyMessage="No buyers match these filters."
          table={entityTable(data.buyers, "Buyer", "Suppliers", currency)}
        >
          <RankedList rows={rankedRows(data.buyers, (row) => counted(row.count, "award"), 8)} ariaLabel="Leading buyers by award value" formatValue={(v) => money(v, currency, true)} onSelect={(row) => ctx.openBuyer(row.key)} selectLabel={(row) => `Open buyer ${row.label}`} />
        </ChartCard>
        <ChartCard
          title="Leading procurement types"
          subtitle="By recorded value. Choose one to focus the analysis on it."
          headingLevel={3}
          empty={!data.types.length}
          emptyMessage="No procurement types match these filters."
          table={entityTable(data.types, "Procurement type", "Suppliers", currency)}
        >
          <RankedList rows={rankedRows(data.types, (row) => counted(row.count, "award"), 8)} ariaLabel="Leading procurement types by award value" formatValue={(v) => money(v, currency, true)} onSelect={(row) => ctx.focus("type", row.key)} selectLabel={(row) => `Focus on ${row.label}`} />
        </ChartCard>
      </div>
    </>
  );
}

function entityTable(rows: Ranked[], name: string, counterparties: string, currency: string) {
  return {
    caption: `${name}s by recorded award value`,
    columns: [
      { key: "name", label: name }, { key: "count", label: "Awards", numeric: true }, { key: "value", label: "Award value", numeric: true },
      { key: "share", label: "Value share", numeric: true }, { key: "counterparties", label: counterparties, numeric: true },
      { key: "median", label: "Median award", numeric: true }, { key: "leading", label: "Leading counterparty" }, { key: "dependence", label: "Its share", numeric: true },
    ],
    rows: rows.slice(0, 200).map((row) => ({
      name: row.name, count: count(row.count), value: money(row.value, currency), share: percent(row.share), counterparties: count(row.counterparties),
      median: money(row.median, currency), leading: row.leading, dependence: percent(row.dependence),
    })),
  };
}

const METRICS = [{ id: "value" as const, label: "Award value" }, { id: "count" as const, label: "Award count" }];
const readMetric = (params: URLSearchParams): "value" | "count" => (params.get("metric") === "count" ? "count" : "value");
const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-CA", { month: "short", timeZone: "UTC" });

function TrendsView({ ctx }: { ctx: ViewContext }) {
  const { currency, partial, params, update } = ctx;
  const metric = readMetric(params);
  const year = params.get("year") ?? "";
  const [normalized, setNormalized] = useState(false);
  const data = useMemo(() => {
    try { return trends(ctx.rows, year, ctx.today); } catch { return trends(ctx.rows, "", ctx.today); }
  }, [ctx.rows, ctx.today, year]);
  const years = useMemo(() => yearly(data.series).reverse(), [data.series]);
  const yearChoices = useMemo(() => [...new Set([data.year, ...years.map((row) => row.year)])].sort().reverse(), [data.year, years]);
  const series: ChartSeries[] = useMemo(() => [{ key: "awards", label: metric === "value" ? "Recorded award value" : "Awards", color: "var(--dv-cat-1)", variant: "area" }], [metric]);
  const chartRows: TimeRow[] = useMemo(() => data.series.map((row) => ({ date: `${row.month}-01`, awards: row[metric] })), [data.series, metric]);
  const format = (value: number) => (metric === "value" ? money(value, currency) : count(value));
  const axis = (value: number) => (metric === "value" ? money(value, currency, true) : count(value));
  return (
    <>
      <div className="procurement-analytics__toolbar">
        <Segmented value={metric} onChange={(next) => update({ metric: next === "value" ? null : next })} items={METRICS} />
      </div>
      <ChartCard
        title="Awards over time"
        subtitle={[`By award month${partial ? ", so far" : ""}.`, data.undated ? `${counted(data.undated, "undated award")} left out.` : "", "Drag across the chart to focus on those months."].filter(Boolean).join(" ")}
        headingLevel={3}
        height={260}
        empty={chartRows.length < 2}
        emptyMessage="Not enough dated awards for a trend."
        table={{
          caption: "Awards by month",
          columns: [{ key: "month", label: "Month" }, { key: "count", label: "Awards", numeric: true }, { key: "value", label: "Award value", numeric: true }],
          rows: [...data.series].reverse().map((row) => ({ month: formatMonthLong(`${row.month}-01`), count: count(row.count), value: money(row.value, currency) })),
        }}
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
          ariaLabel={`${metric === "value" ? "Recorded award value" : "Awards"} by month, ${data.series[0] ? formatMonthLong(`${data.series[0].month}-01`) : ""} to ${data.series.at(-1) ? formatMonthLong(`${data.series.at(-1)!.month}-01`) : ""}`}
          selection={null}
          onRangeChange={(range) => { if (range) update({ ...filterPatch({ ...ctx.filters, from: range.start, to: endOfMonth(range.end) }), year: range.end.slice(0, 4), inspect: null }); }}
          minSelectionDays={28}
        />
      </ChartCard>
        <ChartCard title="By year" subtitle={`Calendar years, newest first${partial ? ", so far" : ""}. Choose one to focus on it.`} headingLevel={3} empty={!years.length} emptyMessage="No dated awards.">
          <RankedList
            rows={years.map((row) => ({ key: row.year, label: row.year, value: Math.max(0, row[metric]), detail: metric === "value" ? counted(row.count, "award") : money(row.value, currency, true) }))}
            ariaLabel="Awards by year"
            formatValue={axis}
            // The calendar follows the year chosen.
            onSelect={(row) => update({ ...filterPatch({ ...ctx.filters, from: `${row.key}-01-01`, to: `${row.key}-12-31` }), year: row.key, inspect: null })}
            selectLabel={(row) => `Focus on ${row.label}`}
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
            onCell={(cell) => ctx.inspect(cell.slice, `${cell.row} · ${formatMonthLong(`${cell.column}-01`)}`)} onRow={ctx.openBuyer}
          />
        </ChartCard>
    </>
  );
}

const PAGE = 25;
function EntityView({ ctx, kind }: { ctx: ViewContext; kind: "buyer" | "supplier" }) {
  const { currency, partial } = ctx;
  const data = useMemo(() => overview(ctx.rows), [ctx.rows]);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const all = kind === "buyer" ? data.buyers : data.suppliers;
  const term = search.trim().toLowerCase();
  const rows = useMemo(() => (term ? all.filter((row) => row.name.toLowerCase().includes(term)) : all), [all, term]);
  const other = kind === "buyer" ? "supplier" : "buyer";
  const reliant = all.filter((row) => row.count >= 3 && (row.dependence ?? 0) >= 0.8).length;
  const leader = all[0];
  return (
    <>
      <div className="stat-grid stat-grid--3 procurement-analytics__stats">
        <StatTile label={kind === "buyer" ? "Buyers" : "Suppliers"} value={count(all.length)} sub={soFar(partial)} />
        <StatTile label={kind === "buyer" ? "Largest buyer" : "Largest supplier"} compact value={leader?.name ?? "—"} sub={leader ? soFar(partial, `${money(leader.value, currency, true)} · ${percent(leader.share)} of value`) : undefined} />
        {kind === "buyer"
          ? <StatTile label="Rely on one supplier" value={count(reliant)} sub={soFar(partial, "3+ awards, 80%+ of value to one supplier")} />
          : <StatTile label="Suppliers for 80% of value" value={data.suppliersFor80 === null ? "—" : count(data.suppliersFor80)} sub={soFar(partial, `Top 10 hold ${data.positiveTotal > 0 ? percent(data.top10Share) : "—"}`)} />}
      </div>
      <ChartCard
        title={kind === "buyer" ? "Buyer directory" : "Supplier directory"}
        subtitle={kind === "buyer"
          ? "By recorded award value. Open a buyer for everything it has published. Shares and dependence use positive values only."
          : "Recorded winners only, not every bidder. Choose a supplier to focus the analysis on it."}
        headingLevel={3}
        table={entityTable(rows, kind === "buyer" ? "Buyer" : "Supplier", kind === "buyer" ? "Suppliers" : "Buyers", currency)}
      >
        <Field label={kind === "buyer" ? "Search buyers" : "Search suppliers"} className="procurement-analytics__search">
          <input className="input" type="search" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(PAGE); }} placeholder="Search names" />
        </Field>
        <p className="muted procurement-analytics__caption">{count(rows.length)} of {counted(all.length, kind)}.</p>
        {rows.length === 0 ? <p className="muted procurement-analytics__empty">No {kind}s match “{search}”.</p> : (
          <RankedList
            rows={rankedRows(rows, (row) => [
              counted(row.count, "award"), counted(row.counterparties, other), `median ${money(row.median, currency, true)}`,
              row.leading && row.dependence !== null ? `top ${other} ${row.leading} (${percent(row.dependence)})` : "",
            ].filter(Boolean).join(" · "), limit)}
            ariaLabel={kind === "buyer" ? "Buyers by award value" : "Suppliers by award value"}
            formatValue={(v) => money(v, currency, true)}
            onSelect={(row) => (kind === "buyer" ? ctx.openBuyer(row.key) : ctx.focus("supplier", row.key))}
            selectLabel={(row) => (kind === "buyer" ? `Open buyer ${row.label}` : `Focus on ${row.label}`)}
          />
        )}
        {rows.length > limit && <button type="button" className="btn btn--sm procurement-analytics__more" onClick={() => setLimit(limit + PAGE * 4)}>Show more ({count(rows.length - limit)} left)</button>}
      </ChartCard>
    </>
  );
}

function SizesView({ ctx }: { ctx: ViewContext }) {
  const { currency, partial, params, update } = ctx;
  const metric = params.get("metric") === "value" ? "value" : "count";
  const data = useMemo(() => distribution(ctx.rows), [ctx.rows]);
  return (
    <>
      <div className="stat-grid stat-grid--3 procurement-analytics__stats">
        <StatTile label="Median award" value={money(data.median, currency)} sub={soFar(partial)} />
        <StatTile label="Middle 50% of values" value={`${money(data.q1, currency, true)} – ${money(data.q3, currency, true)}`} sub={soFar(partial)} />
        <StatTile label="Largest recorded award" value={money(data.max, currency, true)} sub={soFar(partial)} />
      </div>
      <ChartCard
        title="Award-size distribution"
        subtitle={`${count(data.known)} of ${counted(data.count, "award")} have values. Ranges exclude their upper bound. Choose a range for its awards.`}
        headingLevel={3}
        actions={<Segmented value={metric} onChange={(next) => update({ metric: next === "count" ? null : next })} items={[{ id: "count", label: "Award count" }, { id: "value", label: "Net value" }]} />}
        table={{
          caption: "Awards by size",
          columns: [{ key: "range", label: "Range" }, { key: "count", label: "Awards", numeric: true }, { key: "value", label: "Net value", numeric: true }],
          rows: data.bins.map((bin) => ({ range: bin.label, count: count(bin.count), value: money(bin.value, currency) })),
        }}
        footer={data.missing > 0 ? <span className="muted">{counted(data.missing, "award")} {data.missing === 1 ? "has" : "have"} no numeric value.</span> : undefined}
      >
        <RankedList
          rows={data.bins.map((bin) => ({ key: bin.label, label: bin.label, value: Math.abs(bin[metric]), detail: metric === "count" ? money(bin.value, currency, true) : counted(bin.count, "award") }))}
          ariaLabel="Awards by size"
          formatValue={(v) => (metric === "count" ? count(v) : money(v, currency, true))}
          onSelect={(row) => { const bin = data.bins.find((item) => item.label === row.key); if (bin) ctx.inspect(bin.slice, `Award sizes · ${bin.label}`); }}
          selectLabel={(row) => `Awards of ${row.label}`}
        />
      </ChartCard>
    </>
  );
}

function MixView({ ctx }: { ctx: ViewContext }) {
  const { currency, params, update } = ctx;
  const metric = readMetric(params);
  const [normalized, setNormalized] = useState(false);
  const types = useMemo(() => rank(ctx.rows, "type"), [ctx.rows]);
  const data = useMemo(() => matrix(ctx.rows, "type"), [ctx.rows]);
  return (
    <>
      <ChartCard
        title="Procurement types"
        subtitle="By recorded value. Choose one to focus the analysis on it."
        headingLevel={3}
        empty={!types.length}
        emptyMessage="No awards match these filters."
        table={entityTable(types, "Procurement type", "Suppliers", currency)}
      >
        <RankedList rows={rankedRows(types, (row) => `${counted(row.count, "award")} · ${counted(row.counterparties, "supplier")}`, 12)} ariaLabel="Procurement types by award value" formatValue={(v) => money(v, currency, true)} onSelect={(row) => ctx.focus("type", row.key)} selectLabel={(row) => `Focus on ${row.label}`} />
      </ChartCard>
      <ChartCard
        title="Buyer × procurement type"
        subtitle={`Top ${data.rows.length} of ${count(data.buyerCount)} buyers × top ${data.columns.length} of ${count(data.columnCount)} types: ${count(data.shownCount)} of ${counted(data.totalCount, "award")}. Choose a cell for its awards.`}
        headingLevel={3}
        actions={<Segmented value={metric} onChange={(next) => update({ metric: next === "value" ? null : next })} items={METRICS} />}
      >
        <label className="procurement-analytics__check"><input type="checkbox" checked={normalized} onChange={(event) => setNormalized(event.target.checked)} /> Share within each buyer’s row</label>
        <Heatmap
          rows={data.rows} columns={data.columns} cells={data.cells} metric={metric} currency={currency} normalized={normalized}
          columnLabel={(column) => column} caption="Top buyers by procurement type"
          onCell={(cell) => ctx.inspect(cell.slice, `${cell.row} · ${cell.column}`)} onRow={ctx.openBuyer}
        />
      </ChartCard>
    </>
  );
}

/** Why the default filters leave an award out, counted over every published award. */
function exclusions(all: Award[], filters: MarketFilters, today: string) {
  const reasons = [
    { label: `Not in ${filters.currency}`, count: all.filter((r) => r.currencyCode !== filters.currency).length, note: "Currencies are never converted or combined." },
    { label: "Placeholder supplier", count: filters.includePlaceholders ? 0 : all.filter((r) => r.placeholder).length, note: "Missing or “Migrated supplier” names." },
    { label: "Dated after today", count: filters.includeFuture ? 0 : all.filter((r) => !!r.date && r.date > today).length, note: "Future award dates usually need checking at the source." },
  ];
  const left = filterAwards(all, filters, today).length;
  return { reasons, left, out: all.length - left };
}

function QualityView({ ctx, meta }: { ctx: ViewContext; meta: ReturnType<typeof metadata> }) {
  const { partial } = ctx;
  const gone = useMemo(() => exclusions(ctx.all, (() => { try { return validateFilters(ctx.filters); } catch { return defaultFilters; } })(), ctx.today), [ctx.all, ctx.filters, ctx.today]);
  return (
    <>
      <div className="stat-grid procurement-analytics__stats">
        <StatTile label="Published awards" value={count(meta.count)} sub={soFar(partial)} />
        <StatTile label="Date range" compact value={meta.firstDate ? `${formatSourceDate(meta.firstDate)} – ${formatSourceDate(meta.lastDate)}` : "No valid dates"} />
        <StatTile label="Procurement types" value={count(meta.types.length)} />
        <StatTile label="Currencies" compact value={meta.currencies.map((code) => (code === "UNSPECIFIED" ? "not stated" : code)).join(", ") || "—"} />
      </div>
      <ChartCard
        title="Left out of the figures"
        subtitle={`${counted(gone.out, "award")} of ${count(meta.count)} with the current filters${partial ? ", so far" : ""}; ${count(gone.left)} remain. An award can be left out for more than one reason.`}
        headingLevel={3}
      >
        <ul className="procurement-analytics__reasons">
          {gone.reasons.map((reason) => <li key={reason.label}><strong>{count(reason.count)}</strong> <span>{reason.label}</span> <span className="muted">{reason.note}</span></li>)}
        </ul>
      </ChartCard>
      <div className="stat-grid procurement-analytics__stats procurement-analytics__quality">
        {meta.quality.map(({ flag, count: n }) => (
          <StatTile
            key={flag}
            label={QUALITY_LABELS[flag as QualityFlag]}
            value={<>{count(n)} <small className="muted">({percent(meta.count ? n / meta.count : 0)})</small></>}
            sub={QUALITY_DETAILS[flag as QualityFlag]}
            onClick={n ? () => ctx.inspect({ quality: flag }, QUALITY_LABELS[flag as QualityFlag], true) : undefined}
            actionLabel={`List ${QUALITY_LABELS[flag as QualityFlag].toLowerCase()}`}
          />
        ))}
      </div>
      <ChartCard title="How to read these figures" headingLevel={3}>
          <ul className="procurement-analytics__signals">
            <li>Totals are recorded award amounts on their award date, not actual spend.</li>
            <li>Buyers appear under the names the source publishes; Zoer’s proposed buyer grouping isn’t applied here.</li>
            <li>Concentration uses positive values only. Currencies are not converted.</li>
            <li>Winner records say nothing about bidder counts, win rates, or compliance.</li>
          </ul>
      </ChartCard>
    </>
  );
}

/** Zoer's "Awards · <slice>" list: the awards behind a bar, cell or flag, in the catalog's award table; each opens its notice. */
function Inspect({ inspection, awards, byKey, partial, close, hidden }: {
  inspection: Inspection; awards: Award[]; byKey: Map<string, ListRow>; partial: boolean; close: () => void; hidden: boolean;
}) {
  const rows = useMemo(() => awards.flatMap((award) => byKey.get(award.id) ?? []), [awards, byKey]);
  return (
    <Modal open={!hidden} onClose={close} title={`Awards · ${inspection.title}`} size="xl" resizeKey="procurement-analytics-awards" footer={<button type="button" className="btn" onClick={close}>Done</button>}>
      <p className="muted procurement-analytics__caption">
        {counted(rows.length, "award")}{partial ? " so far" : ""}{inspection.all ? ", from every published award regardless of filters" : ""}. Open one for its notice.
      </p>
      <NoticeTable kind="award" rows={rows} tableId="procurement-review:analytics:awards" view="all" label="Awards" />
    </Modal>
  );
}
