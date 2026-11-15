/**
 * The award views that rank: overview, the buyer and supplier directories,
 * award sizes, the procurement mix and the period comparison. Every figure
 * opens what's behind it: a tile its awards (or the directory behind a
 * count), a buyer or supplier its page or awards, a type or size band its
 * awards. A row's "⋯" holds the rest, including leaving it out of the analysis.
 */
import { useMemo, useState } from "react";
import { ChartCard } from "../../../../components/charts";
import { StatTile } from "../../../../components/StatTile";
import { Segmented } from "../../../../components/primitives";
import { Field } from "../../../../components/ui";
import { count, counted, distribution, matrix, money, overview, percent, rank } from "../../lib/market";
import { ANALYSIS_PAGE_SIZE, type AwardAnalytics } from "../../../../../shared/procurementAnalytics";
import { Amount, Heatmap, RankedCard, RankedList, foldRanked } from "./parts";
import { Party, entityTable, partyMenu, rankedRows, soFar, type ViewContext } from "./context";
import { METRICS, readMetric } from "./TrendsView";

const ALL = { slice: {}, title: "Current filters" };

export function OverviewView({ ctx }: { ctx: ViewContext }) {
  const data = useMemo(() => ctx.aggregate?.overview ?? overview(ctx.rows), [ctx.rows, ctx.aggregate]);
  const { currency, partial } = ctx;
  const compactOf = (v: number) => money(v, currency, true);
  const exactOf = (v: number) => money(v, currency);
  const buyerPrimary = ctx.aggregate ? "awards" : "page";
  const buyers = foldRanked(rankedRows(data.buyers, (row) => counted(row.count, "award"), Infinity, (row) => ({ href: ctx.buyerHref(row.name) })), 8);
  const suppliers = foldRanked(rankedRows(data.suppliers, (row) => counted(row.count, "award"), Infinity, (row) => ({ href: ctx.supplierHref(row.name), badge: ctx.badge(row.name) })), 8);
  const types = foldRanked(rankedRows(data.types, (row) => counted(row.count, "award"), Infinity), 8);
  const leader = data.suppliers[0];
  const all = () => ctx.inspect(ALL);
  return (
    <>
      <div className="stat-grid stat-grid--3 procurement-analytics__stats">
        <StatTile label="Award value" value={<Amount value={data.value} currency={currency} />} sub={soFar(partial, `${count(data.valuedCount)} valued records`)} onClick={data.count ? all : undefined} actionLabel="List the awards behind this value" />
        <StatTile label="Awards" value={count(data.count)} sub={soFar(partial)} onClick={data.count ? all : undefined} actionLabel="List these awards" />
        <StatTile label="Median award" value={<Amount value={data.median} currency={currency} />} sub={soFar(partial)} onClick={data.count ? all : undefined} actionLabel="List the awards behind the median" />
        <StatTile label="Buyers" value={count(data.buyerCount)} sub={soFar(partial)} onClick={() => ctx.showView("buyers")} actionLabel="Open the buyer directory" />
        <StatTile label="Suppliers" value={count(data.supplierCount)} sub={soFar(partial)} onClick={() => ctx.showView("suppliers")} actionLabel="Open the supplier directory" />
        <StatTile
          label="Suppliers holding 80% of value"
          value={data.suppliersFor80 === null ? "—" : `${count(data.suppliersFor80)} of ${count(data.supplierCount)}`}
          sub={soFar(partial, "Positive values only")}
          onClick={() => ctx.showView("suppliers")}
          actionLabel="Open the supplier directory, largest first"
        />
      </div>
      <ChartCard title={`Market signals${partial ? " so far" : ""}`} headingLevel={3}>
        <ul className="procurement-analytics__signals">
          <li>{leader ? <><strong><Party field="supplier" name={leader.name} ctx={ctx} /></strong> won the most by recorded value: <Amount value={leader.value} currency={currency} /> across {counted(leader.count, "award")}, {percent(leader.share)} of the total.</> : "No suppliers match the current filters."}</li>
          <li>{data.buyers[0] ? <><strong><Party field="organization" name={data.buyers[0].name} ctx={ctx} /></strong> is the largest buyer by recorded award value: <Amount value={data.buyers[0].value} currency={currency} /> across {counted(data.buyers[0].count, "award")}.</> : "No buyers match the current filters."}</li>
          <li>{data.types[0] ? <><strong><button type="button" className="procurement-analytics__inline-link" onClick={() => ctx.inspect({ slice: { type: data.types[0].name }, title: data.types[0].name })}>{data.types[0].name}</button></strong> is the largest procurement type by recorded value: <Amount value={data.types[0].value} currency={currency} />.</> : "No procurement types match the current filters."}</li>
        </ul>
      </ChartCard>
      <div className="procurement-analytics__columns">
        <RankedCard
          title="Leading buyers"
          subtitle={`By recorded value. ${ctx.aggregate ? "Choose one for awards matching these filters." : "Open one for its notices and awards."}`}
          headingLevel={3}
          empty={!data.buyers.length}
          emptyMessage="No buyers match these filters."
          table={{ ...entityTable(data.buyers, "Buyer", "Suppliers", currency), rowAction: (index) => rowAwards(ctx, "buyer", data.buyers[index]?.name) }}
        >
          {(showTable) => <RankedList rows={buyers.rows} rest={buyers.rest} onMore={showTable} ariaLabel="Leading buyers by award value" formatValue={compactOf} exactValue={exactOf} onSelect={(row) => ctx.openBuyer(row.key)} selectLabel={(row) => `Open buyer ${row.label}`} menu={(row) => partyMenu(ctx, "buyer", row.key, buyerPrimary)} />}
        </RankedCard>
        <RankedCard
          title="Leading suppliers"
          subtitle="Recorded winners by value. Open one for everything it won, and from whom."
          headingLevel={3}
          empty={!data.suppliers.length}
          emptyMessage="No suppliers match these filters."
          table={{ ...entityTable(data.suppliers, "Supplier", "Buyers", currency), rowAction: (index) => rowAwards(ctx, "supplier", data.suppliers[index]?.name) }}
        >
          {(showTable) => <RankedList rows={suppliers.rows} rest={suppliers.rest} onMore={showTable} ariaLabel="Leading suppliers by award value" formatValue={compactOf} exactValue={exactOf} onSelect={(row) => ctx.openSupplier(row.key)} selectLabel={(row) => `Open supplier ${row.label}`} menu={(row) => partyMenu(ctx, "supplier", row.key, "page")} />}
        </RankedCard>
      </div>
      <TypesCard ctx={ctx} types={data.types} folded={types} limit={8} title="Leading procurement types" />
    </>
  );
}

/** A table row's heading lists the party's or type's awards. */
const rowAwards = (ctx: ViewContext, field: "buyer" | "supplier" | "type", name: string | undefined) =>
  (name ? { label: `Awards for ${name}`, onSelect: () => ctx.inspect({ slice: { [field]: name }, title: name }) } : null);

function TypesCard({ ctx, types, folded, limit, title }: { ctx: ViewContext; types: ReturnType<typeof rank>; folded?: ReturnType<typeof foldRanked>; limit: number; title: string }) {
  const { currency } = ctx;
  return (
    <RankedCard
      title={title}
      subtitle="By recorded value. Choose one for its awards."
      headingLevel={3}
      empty={!types.length}
      emptyMessage="No procurement types match these filters."
      table={{ ...entityTable(types, "Procurement type", "Suppliers", currency), rowAction: (index) => rowAwards(ctx, "type", types[index]?.name) }}
    >
      {(showTable) => {
        const shown = folded ?? foldRanked(rankedRows(types, (row) => `${counted(row.count, "award")} · ${counted(row.counterparties, "supplier")}`, Infinity), limit);
        return <RankedList rows={shown.rows} rest={shown.rest} onMore={showTable} ariaLabel={`${title} by award value`} formatValue={(v) => money(v, currency, true)} exactValue={(v) => money(v, currency)} onSelect={(row) => ctx.inspect({ slice: { type: row.key }, title: row.label })} selectLabel={(row) => `Awards for ${row.label}`} menu={(row) => partyMenu(ctx, "type", row.key, "awards")} />;
      }}
    </RankedCard>
  );
}

const PAGE = 25;
export function EntityView({ ctx, kind }: { ctx: ViewContext; kind: "buyer" | "supplier" }) {
  const { currency, partial } = ctx;
  const data = useMemo(() => ctx.aggregate?.overview ?? overview(ctx.rows), [ctx.rows, ctx.aggregate]);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const all = kind === "buyer" ? data.buyers : data.suppliers;
  const remote = ctx.aggregate?.directory;
  const term = search.trim().toLowerCase();
  const rows = useMemo(() => remote?.rows ?? (term ? all.filter((row) => row.name.toLowerCase().includes(term)) : all), [all, term, remote]);
  const other = kind === "buyer" ? "supplier" : "buyer";
  const reliant = remote?.reliant ?? all.filter((row) => row.count >= 3 && (row.dependence ?? 0) >= 0.8).length;
  const partyCount = kind === "buyer" ? data.buyerCount : data.supplierCount;
  const leader = all[0];
  return (
    <>
      <div className="stat-grid stat-grid--3 procurement-analytics__stats">
        <StatTile label={kind === "buyer" ? "Buyers" : "Suppliers"} value={count(partyCount)} sub={soFar(partial)} />
        <StatTile label={kind === "buyer" ? "Largest buyer" : "Largest supplier"} compact value={leader ? <Party field={kind === "buyer" ? "organization" : "supplier"} name={leader.name} ctx={ctx} /> : "—"} sub={leader ? <><Amount value={leader.value} currency={currency} /> · {percent(leader.share)} of value{partial && " · so far"}</> : undefined} />
        {kind === "buyer"
          ? <StatTile label="Rely on one supplier" value={count(reliant)} sub={soFar(partial, "3+ awards, 80%+ of value to one supplier")} />
          : <StatTile label="Suppliers holding 80% of value" value={data.suppliersFor80 === null ? "—" : `${count(data.suppliersFor80)} of ${count(data.supplierCount)}`} sub={soFar(partial, "Positive values only")} />}
      </div>
      <ChartCard
        title={kind === "buyer" ? "Buyer directory" : "Supplier directory"}
        subtitle={kind === "buyer"
          ? ctx.aggregate ? "By recorded award value. Choose a buyer for matching awards. Shares and dependence use positive values only." : "By recorded award value. Open a buyer for everything it has published. Shares and dependence use positive values only."
          : "Recorded winners only, not every bidder. Open a supplier for everything it won, and from whom."}
        headingLevel={3}
        table={{ ...entityTable(rows, kind === "buyer" ? "Buyer" : "Supplier", kind === "buyer" ? "Suppliers" : "Buyers", currency), rowAction: (index) => rowAwards(ctx, kind, rows[index]?.name) }}
      >
        <Field label={kind === "buyer" ? "Search buyers" : "Search suppliers"} className="procurement-analytics__search">
          <input className="input" type="search" value={remote ? ctx.params.get("rankq") ?? "" : search} onChange={(event) => { if (remote) ctx.update({ rankq: event.target.value || null, rankpage: null }); else { setSearch(event.target.value); setLimit(PAGE); } }} placeholder="Search names" />
        </Field>
        <p className="muted procurement-analytics__caption">{remote ? `${count(remote.offset + 1)}–${count(remote.offset + rows.length)} of ${count(remote.total)} matching` : count(rows.length)} of {counted(partyCount, kind)}.</p>
        {rows.length === 0 ? <p className="muted procurement-analytics__empty">No {kind}s match “{search}”.</p> : (
          <RankedList
            rows={rankedRows(rows, (row) => [
              counted(row.count, "award"), counted(row.counterparties, other), `median ${money(row.median, currency, true)}`,
              row.leading && row.dependence !== null ? `top ${other} ${row.leading} (${percent(row.dependence)})` : "",
            ].filter(Boolean).join(" · "), remote ? ANALYSIS_PAGE_SIZE : limit,
            (row) => (kind === "buyer" ? { href: ctx.buyerHref(row.name) } : { href: ctx.supplierHref(row.name), badge: ctx.badge(row.name) }))}
            ariaLabel={kind === "buyer" ? "Buyers by award value" : "Suppliers by award value"}
            formatValue={(v) => money(v, currency, true)}
            exactValue={(v) => money(v, currency)}
            onSelect={(row) => (kind === "buyer" ? ctx.openBuyer(row.key) : ctx.openSupplier(row.key))}
            selectLabel={(row) => (kind === "buyer" ? `Open buyer ${row.label}` : `Open supplier ${row.label}`)}
            menu={(row) => partyMenu(ctx, kind, row.key, kind === "buyer" && ctx.aggregate ? "awards" : "page")}
          />
        )}
        {remote && <div className="btn-group"><button type="button" className="btn btn--sm" disabled={!remote.offset} onClick={() => ctx.update({ rankpage: String(Math.max(0, remote.offset - ANALYSIS_PAGE_SIZE)) })}>Previous</button><button type="button" className="btn btn--sm" disabled={remote.offset + rows.length >= remote.total} onClick={() => ctx.update({ rankpage: String(remote.offset + ANALYSIS_PAGE_SIZE) })}>Next</button></div>}
        {!remote && rows.length > limit && <button type="button" className="btn btn--sm procurement-analytics__more" onClick={() => setLimit(limit + PAGE * 4)}>Show more ({count(rows.length - limit)} left)</button>}
      </ChartCard>
    </>
  );
}

export function SizesView({ ctx }: { ctx: ViewContext }) {
  const { currency, partial, params, update } = ctx;
  const metric = params.get("metric") === "value" ? "value" : "count";
  const data = useMemo(() => ctx.aggregate?.sizes ?? distribution(ctx.rows), [ctx.rows, ctx.aggregate]);
  return (
    <>
      <div className="stat-grid stat-grid--3 procurement-analytics__stats">
        <StatTile label="Median award" value={<Amount value={data.median} currency={currency} />} sub={soFar(partial)} onClick={data.known ? () => ctx.inspect(ALL) : undefined} actionLabel="List the awards behind the median" />
        <StatTile
          label="Middle 50% of values"
          value={<><Amount value={data.q1} currency={currency} /> – <Amount value={data.q3} currency={currency} /></>}
          sub={soFar(partial)}
          onClick={data.q1 !== null && data.q3 !== null ? () => ctx.inspect({ slice: { min: data.q1!, atMost: data.q3! }, title: `${money(data.q1, currency, true)} – ${money(data.q3, currency, true)}` }) : undefined}
          actionLabel="List the awards in the middle half"
        />
        <StatTile label="Largest recorded award" value={<Amount value={data.max} currency={currency} />} sub={soFar(partial)} onClick={data.max !== null ? () => ctx.inspect({ slice: { exact: data.max! }, title: `Largest, ${money(data.max, currency, true)}` }) : undefined} actionLabel="Open the largest award" />
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
          rowAction: (index) => { const bin = data.bins[index]; return bin?.count ? { label: `Awards of ${bin.label}`, onSelect: () => ctx.inspect({ slice: bin.slice, title: `Award sizes · ${bin.label}` }) } : null; },
        }}
        footer={data.missing > 0 ? <span className="muted">{counted(data.missing, "award")} {data.missing === 1 ? "has" : "have"} no numeric value.</span> : undefined}
      >
        <RankedList
          rows={data.bins.map((bin) => ({ key: bin.label, label: bin.label, value: Math.abs(bin[metric]), detail: metric === "count" ? money(bin.value, currency, true) : counted(bin.count, "award") }))}
          ariaLabel="Awards by size"
          formatValue={(v) => (metric === "count" ? count(v) : money(v, currency, true))}
          exactValue={metric === "count" ? undefined : (v) => money(v, currency)}
          onSelect={(row) => { const bin = data.bins.find((item) => item.label === row.key); if (bin) ctx.inspect({ slice: bin.slice, title: `Award sizes · ${bin.label}` }); }}
          selectLabel={(row) => `Awards of ${row.label}`}
        />
      </ChartCard>
    </>
  );
}

export function MixView({ ctx }: { ctx: ViewContext }) {
  const { currency, params, update } = ctx;
  const metric = readMetric(params);
  const [normalized, setNormalized] = useState(false);
  const types = useMemo(() => ctx.aggregate?.overview.types ?? rank(ctx.rows, "type"), [ctx.rows, ctx.aggregate]);
  const data = useMemo(() => ctx.aggregate?.mix ?? matrix(ctx.rows, "type"), [ctx.rows, ctx.aggregate]);
  return (
    <>
      <TypesCard ctx={ctx} types={types} limit={12} title="Procurement types" />
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
          onCell={(cell) => ctx.inspect({ slice: cell.slice, title: `${cell.row} · ${cell.column}` })} onRow={ctx.openBuyer}
        />
      </ChartCard>
    </>
  );
}

/** Two equal periods side by side (server analysis only); each period's tiles list its awards. */
export function ComparisonView({ data, ctx }: { data: AwardAnalytics; ctx: ViewContext }) {
  const comparison = data.comparison;
  if (!comparison) return null;
  const { currency } = ctx;
  const { current, previous } = comparison;
  const open = (period: typeof current, name: string) => ctx.inspect({ slice: {}, title: `${name} · ${period.from} to ${period.to}`, range: { from: period.from, to: period.to } });
  return (
    <ChartCard title="Equal-length period comparison" subtitle={`${current.from} to ${current.to}, compared with ${previous.from} to ${previous.to}. Same currency and inclusion rules; medians and distinct parties recomputed from each period. Choose a period for its awards.`} headingLevel={3}>
      <div className="stat-grid procurement-analytics__stats">
        <StatTile label="Current recorded value" value={<Amount value={current.value} currency={currency} />} sub={counted(current.count, "award")} onClick={current.count ? () => open(current, "Current period") : undefined} actionLabel="List the current period's awards" />
        <StatTile label="Previous recorded value" value={<Amount value={previous.value} currency={currency} />} sub={counted(previous.count, "award")} onClick={previous.count ? () => open(previous, "Previous period") : undefined} actionLabel="List the previous period's awards" />
        <StatTile label="Value change" value={<Amount value={comparison.valueChange} currency={currency} />} sub={comparison.valuePercent === null ? "No positive comparison baseline" : percent(comparison.valuePercent)} />
        <StatTile label="Award count change" value={count(comparison.countChange)} />
      </div>
      <p className="muted">Current median <Amount value={current.median} currency={currency} />; previous median <Amount value={previous.median} currency={currency} />. Collection coverage may differ between periods.</p>
    </ChartCard>
  );
}
