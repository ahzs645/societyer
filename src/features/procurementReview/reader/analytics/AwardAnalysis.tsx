/**
 * Zoer's Market analysis (`dashboard/market/MarketAnalysis.tsx`) over the
 * published awards: overview, trends, buyers, suppliers, award sizes,
 * procurement mix and data quality, with the same filters and defaults (CAD
 * only; placeholder suppliers and future-dated awards left out). The hosted
 * reader asks the catalog service (or Convex) for each view's figures; the
 * demo computes them here from the award list (lib/market.ts). Both run the
 * same shared code, so filters, buyer grouping and exclusions give the same
 * figures either way. Filters live in the URL.
 *
 * Every figure opens the awards behind it in one drill-down (inspect.tsx);
 * a buyer or supplier opens its page, and any of them can be left out of the
 * analysis (exclusions.tsx). Every amount shows compact ("$59.9M") with the
 * exact figure as its tooltip. Where the analysis runs here, "Our work"
 * (OurWork.tsx) can narrow it to the work this organisation bids on; the
 * server's analysis can't filter by keywords, so it always covers the whole
 * market.
 *
 * A commodity (a UNSPSC code) narrows it to the awards classified under it.
 * Where the awards carry no codes, or an older server ignores the filter,
 * the analysis says so instead of showing figures for every commodity.
 */
import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { Crosshair, List, SlidersHorizontal } from "lucide-react";
import { InfoPopover } from "../../../../components/InfoPopover";
import { Banner, Pill } from "../../../../components/ui";
import { count, counted, defaultFilters, filterAwards, metadata, normalizeAwards, sliceAwards, type Award, type MarketFilters } from "../../lib/market";
import { useIsOurOrganisation } from "../../lib/ourOrganisation";
import { zoneToday } from "../../lib/notice";
import { useReaderSource } from "../source";
import { useProcurementClock } from "../../lib/clock";
import { buyerMappings, canonicalProcurementRows } from "../../../../../shared/procurementAnalytics";
import { LoadingLine } from "./parts";
import { MARKET_PARAM, OurWorkBar, OurWorkDialog, type MarketScope } from "./OurWork";
import { ourWorkMatcher, useOurWork } from "./ourWorkStore";
import { viewPatch } from "./analysisParam";
import { UNKNOWN_BUYER, ViewSkeleton, supplierLinks, type AwardView, type Inspection, type ViewContext } from "./context";
import { ExclusionsDialog } from "./exclusions";
import { FilterChips, FiltersDialog, activeCount, type BuyerLevel, type FilterChoices } from "./filters";
import { useCommodityTitle } from "../commodity/titles";
import { INSPECT_PARAM, Inspect, ServerInspect, inspectionFilters, inspectionParam, readInspection, type InspectActions } from "./inspect";
import { QualityView } from "./QualityView";
import { TrendsView } from "./TrendsView";
import { useAnalysisFilters } from "./useAnalysisFilters";
import { ComparisonView, EntityView, MixView, OverviewView, SizesView } from "./views";

export type { AwardView } from "./context";

export function AwardAnalysis(props: { view: AwardView; title: string }) {
  const source = useReaderSource();
  return source.useAnalysis ? <ServerAwardAnalysis {...props} /> : <LocalAwardAnalysis {...props} />;
}

/** Whether a notice, party or commodity page is open over the analysis, which hides the drill-down until it closes. */
const covered = (params: URLSearchParams) => Boolean(params.get("notice") || params.get("buyer") || params.get("issuedFor") || params.get("supplier") || params.get("commodity"));

/**
 * Where the buyer names come from, as a small ⓘ beside the heading: the
 * grouping follows mappings the publication proposes from source labels,
 * which are not a verified register of legal entities.
 */
function MappingInfo({ mappings }: { mappings: ReturnType<typeof buyerMappings> | undefined }) {
  if (!mappings?.proposed) return null;
  return (
    <InfoPopover hover label="About buyer names">
      <p>
        Buyers are grouped using proposed matches between the names sources use and the organizations behind them
        {mappings.versions.length ? ` (mapping ${mappings.versions.join(", ")})` : ""}. They are a best guess, not a verified list of legal organizations.
      </p>
    </InfoPopover>
  );
}

/** The heading, its line of counts, and the Our work / Filters / Matching awards buttons. */
function Header({ title, summary, info, filters, active, onFilters, onAll, ready, children }: {
  title: string; summary: string; info?: ReactNode;
  /** Whether this view offers the Filters button (data quality doesn't). */
  filters: boolean; active: number; onFilters: () => void; onAll: () => void;
  /** False until there are figures to filter or list. */
  ready: boolean; children?: ReactNode;
}) {
  return (
    <header className="procurement-analytics__header">
      <div className="procurement-analytics__heading">
        <h2>{title}{info && <> {info}</>}</h2>
        <p className="muted">{summary}</p>
      </div>
      <div className="procurement-analytics__actions">
        {children}
        {filters && (
          <button type="button" className="btn btn--sm" aria-haspopup="dialog" aria-label={active ? `Filters, ${active} active` : "Filters"} onClick={onFilters} disabled={!ready}>
            <SlidersHorizontal size={14} aria-hidden="true" /> <span className="procurement-analytics__action-label">Filters</span>
            {active > 0 && <Pill size="sm">{active}</Pill>}
          </button>
        )}
        <button type="button" className="btn btn--sm" aria-label="Matching awards" disabled={!ready} onClick={onAll}>
          <List size={14} aria-hidden="true" /> <span className="procurement-analytics__action-label">Matching awards</span>
        </button>
      </div>
    </header>
  );
}

/** "12 left out by you" after the counts, when exclusions remove any awards. */
const byYou = (n: number) => (n ? `; ${count(n)} left out by your exclusions` : "");

/**
 * Why a commodity filter has no figures to show: the analysis can't apply it
 * (an older server would return every commodity's awards, so its figures are
 * held back), or no award carries a code to match.
 */
function CommodityProblem({ code, unsupported, onClear }: { code: string; unsupported: boolean; onClear: () => void }) {
  return (
    <Banner tone={unsupported ? "warn" : "info"}>
      {unsupported
        ? `This catalog's analysis can't narrow awards by commodity yet, so figures for ${code} aren't shown.`
        : `None of the published awards carry a commodity code, so none fall under ${code}.`}{" "}
      <button type="button" className="btn btn--sm" onClick={onClear}>Remove the commodity filter</button>
    </Banner>
  );
}
const withoutCommodity = ({ commodity: _cleared, ...rest }: MarketFilters): MarketFilters => rest;

function ServerAwardAnalysis({ view, title }: { view: AwardView; title: string }) {
  const source = useReaderSource(), now = useProcurementClock(), today = zoneToday(now);
  const { nav, filters, buyerLevel, setFilters, setBuyerLevel, setExclusions, exclude } = useAnalysisFilters();
  const [dialog, setDialog] = useState<"filters" | "exclusions" | null>(null);
  const result = source.useAnalysis!({ view, buyerLevel, filters, year: nav.params.get("year") ?? "", search: nav.params.get("rankq") ?? "", offset: Number(nav.params.get("rankpage") ?? 0) });
  const data = result.result?.type === "award" ? result.result.data : null;
  // An analysis from before the commodity filter returns no commodity choices, and ignores the filter.
  const choices: FilterChoices | null = data?.meta ?? null;
  const commodityUnsupported = !!filters.commodity && !!choices && !choices.commodities;
  const commodityUnmatched = !!filters.commodity && !!choices?.commodities && choices.commodities.classified === 0;
  const commodityTitle = useCommodityTitle(filters.commodity ?? "");
  const inspect = (inspection: Inspection) => nav.update({ [INSPECT_PARAM]: inspectionParam(inspection) });
  const inspection = readInspection(nav.params.get(INSPECT_PARAM));
  const ours = useIsOurOrganisation();
  const ctx: ViewContext = { rows: [], all: [], currency: filters.currency, filters, today, partial: false, setFilters,
    focus: (key, name) => setFilters({ ...filters, [key]: name }), inspect, exclude,
    // Here a buyer lists its matching awards rather than opening its page.
    openBuyer: name => inspect({ slice: { buyer: name }, title: name }), openBuyerPage: name => nav.openParty("organization", name), buyerHref: () => undefined,
    ...supplierLinks(nav, ours, (name) => setFilters({ ...filters, supplier: name })),
    showView: next => nav.update(viewPatch(next)),
    params: nav.params, update: nav.update, aggregate: data ?? undefined };
  const actions: InspectActions = { filters, setFilters, exclude };
  const leftByYou = data?.exclusions.find((row) => row.reason === "excluded")?.count ?? 0;
  return <>
    <Header
      title={title}
      info={<MappingInfo mappings={data?.mappings} />}
      summary={!data ? "Preparing publication metrics…" : view === "quality" ? `${counted(data.published, "published award")}, regardless of filters` : `${counted(data.included, "award")} in this analysis, of ${count(data.published)} published${byYou(leftByYou)}.`}
      filters={view !== "quality"} active={activeCount(filters, buyerLevel)} onFilters={() => setDialog("filters")}
      onAll={() => inspect(view === "quality" ? { slice: {}, title: "All published awards", all: true } : { slice: {}, title: "Current filters" })} ready={!!data}
    />
    {view !== "quality" && <FilterChips filters={filters} commodityTitle={commodityTitle} onChange={(next, level) => setFilters(next, { buyerLevel: level })} buyerLevel={buyerLevel} onBuyerLevel={setBuyerLevel} onShowExclusions={() => setDialog("exclusions")} />}
    {view !== "quality" && filters.commodity && (commodityUnsupported || commodityUnmatched) && <CommodityProblem code={filters.commodity} unsupported={commodityUnsupported} onClear={() => setFilters(withoutCommodity(filters))} />}
    {result.state === "failed" ? <Banner tone="danger">{result.error} <button type="button" className="btn btn--sm" onClick={result.retry}>Retry analysis</button></Banner> : !data ? <ViewSkeleton /> : commodityUnsupported && view !== "quality" ? null : <div className="procurement-analytics__stack">
      <AwardViews view={view} ctx={ctx} />
      {view === "compare" && <ComparisonView data={data} ctx={ctx} />}
      {view === "quality" && <QualityView ctx={ctx} meta={data.meta} />}
    </div>}
    {dialog === "filters" && data && <FiltersDialog value={filters} meta={data.meta} buyerLevel={buyerLevel} close={() => setDialog(null)} apply={(next, level) => { setFilters(next, { buyerLevel: level }); setDialog(null); }} />}
    {dialog === "exclusions" && <ExclusionsDialog list={filters.exclude ?? []} onChange={(next) => setExclusions(next)} close={() => setDialog(null)} />}
    {inspection && <ServerInspect key={JSON.stringify([inspection, inspectionFilters(inspection, filters), buyerLevel])} inspection={inspection} actions={actions} buyerLevel={buyerLevel} close={() => nav.update({ [INSPECT_PARAM]: null })} hidden={covered(nav.params)} />}
  </>;
}

/** The views both analyses draw the same way; comparison and quality need the source's own data. */
function AwardViews({ view, ctx }: { view: AwardView; ctx: ViewContext }) {
  return <>
    {view === "overview" && <OverviewView ctx={ctx} />}
    {view === "trends" && <TrendsView ctx={ctx} />}
    {(view === "buyers" || view === "suppliers") && <EntityView key={view} ctx={ctx} kind={view === "buyers" ? "buyer" : "supplier"} />}
    {view === "sizes" && <SizesView ctx={ctx} />}
    {view === "mix" && <MixView ctx={ctx} />}
  </>;
}

function LocalAwardAnalysis({ view, title }: { view: AwardView; title: string }) {
  const source = useReaderSource();
  const { nav, filters, buyerLevel, setFilters, setBuyerLevel, setExclusions, exclude } = useAnalysisFilters();
  const list = source.useList("award");
  // Chunks land while the list loads; the figures follow without blocking typing or scrolling.
  const loaded = useDeferredValue(list?.rows);
  // Buyers named at the chosen grouping, as the server's analysis names them.
  const all = useMemo(() => normalizeAwards(canonicalProcurementRows(loaded ?? [], buyerLevel)), [loaded, buyerLevel]);
  const mappings = useMemo(() => (list?.done && loaded ? buyerMappings(loaded) : undefined), [list?.done, loaded]);
  // Whether any award carries a commodity code for the commodity filter to match.
  const classified = useMemo(() => all.some((award) => award.commodities?.length), [all]);
  const commodityTitle = useCommodityTitle(filters.commodity ?? "", loaded);
  // "Our work" applies once it is set, unless the reader asked for the whole market.
  const { work, save: saveWork } = useOurWork();
  const [editingWork, setEditingWork] = useState(false);
  const scope: MarketScope = work && nav.params.get(MARKET_PARAM) !== "all" ? "ours" : "all";
  const narrowed = scope === "ours" && view !== "quality";
  const ourRows = useMemo(() => {
    if (!work) return null;
    const matches = ourWorkMatcher(work);
    const keys = new Set((loaded ?? []).filter(matches).map((row) => row.recordKey));
    return all.filter((award) => keys.has(award.id));
  }, [work, loaded, all]);
  const analysed = narrowed && ourRows ? ourRows : all;
  const byKey = useMemo(() => new Map((loaded ?? []).map((row) => [row.recordKey, row])), [loaded]);
  const now = useProcurementClock();
  const today = zoneToday(now);
  const filterKey = JSON.stringify(filters);
  const filtered = useMemo(() => {
    try { return { rows: filterAwards(analysed, filters, today), error: "" }; }
    catch (error) { return { rows: [] as Award[], error: error instanceof Error ? error.message : "These filters can't be applied." }; }
  }, [analysed, filterKey, today]); // eslint-disable-line react-hooks/exhaustive-deps -- `filterKey` names every filter
  // Awards the person's exclusions take out, of those the other filters keep.
  const leftByYou = useMemo(() => {
    if (!filters.exclude?.length || filtered.error) return 0;
    const { exclude: _all, ...rest } = filters;
    return filterAwards(analysed, rest, today).length - filtered.rows.length;
  }, [analysed, filtered, filterKey, today]); // eslint-disable-line react-hooks/exhaustive-deps -- `filterKey` names every filter
  const [dialog, setDialog] = useState<"filters" | "exclusions" | null>(null);
  const meta = useMemo(() => (dialog === "filters" || view === "quality" ? metadata(all, today) : null), [all, dialog, today, view]);
  const inspection = readInspection(nav.params.get(INSPECT_PARAM));
  const partial = !list?.done;

  const focus = (key: "supplier" | "type", name: string) => setFilters({ ...filters, [key]: name });
  const inspect = (next: Inspection) => nav.update({ [INSPECT_PARAM]: inspectionParam(next) });
  const openBuyerPage = (name: string) => nav.openParty("organization", name);
  const openBuyer = (name: string) => { if (name === UNKNOWN_BUYER) inspect({ slice: { buyer: name }, title: name }); else openBuyerPage(name); };
  const buyerHref = (name: string) => (name === UNKNOWN_BUYER ? undefined : nav.partyHref("organization", name));
  const ours = useIsOurOrganisation();
  const ctx: ViewContext = { rows: filtered.rows, all, currency: filters.currency, filters, today, partial, setFilters, focus, inspect, exclude, openBuyer, openBuyerPage, buyerHref,
    ...supplierLinks(nav, ours, (name) => focus("supplier", name)),
    showView: (next) => nav.update(viewPatch(next)),
    params: nav.params, update: nav.update };
  const actions: InspectActions = { filters, setFilters, exclude };
  const inspected = useMemo(() => {
    if (!inspection) return [];
    if (inspection.all) return sliceAwards(all, inspection.slice, today, filters);
    const rows = inspection.range ? filterAwards(analysed, inspectionFilters(inspection, filters), today) : filtered.rows;
    return sliceAwards(rows, inspection.slice, today, filters);
  }, [inspection && inspectionParam(inspection), all, analysed, filtered, today, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps -- the inspection and filters are named by their text

  const shown = filtered.rows.length;
  return (
    <>
      <Header
        title={title}
        info={<MappingInfo mappings={mappings} />}
        summary={!list ? "Reading the published awards…"
          : view === "quality" ? `${counted(all.length, "published award")}${partial ? " so far" : ""}, regardless of filters`
          : narrowed ? `${counted(shown, "award")} matching our work, of ${count(all.length)} published${partial ? " so far" : ""}${byYou(leftByYou)}`
          : `${counted(shown, "award")} in this analysis, of ${count(all.length)} published${partial ? " so far" : ""}${byYou(leftByYou)}`}
        filters={view !== "quality"} active={activeCount(filters, buyerLevel)} onFilters={() => setDialog("filters")}
        onAll={() => inspect(view === "quality" ? { slice: {}, title: "All published awards", all: true } : { slice: {}, title: "Current filters" })} ready={!!list}
      >
        {view !== "quality" && !work && (
          <button type="button" className="btn btn--sm" aria-haspopup="dialog" aria-label="Our work" onClick={() => setEditingWork(true)}>
            <Crosshair size={14} aria-hidden="true" /> <span className="procurement-analytics__action-label">Our work</span>
          </button>
        )}
      </Header>
      {view !== "quality" && work && (
        <OurWorkBar work={work} scope={scope} onScope={(next) => nav.update({ [MARKET_PARAM]: next === "all" ? "all" : null, [INSPECT_PARAM]: null })} onEdit={() => setEditingWork(true)} />
      )}
      {view !== "quality" && <FilterChips filters={filters} commodityTitle={commodityTitle} onChange={(next, level) => setFilters(next, { buyerLevel: level })} buyerLevel={buyerLevel} onBuyerLevel={setBuyerLevel} onShowExclusions={() => setDialog("exclusions")} />}
      {view !== "quality" && filters.commodity && list?.done && !classified && <CommodityProblem code={filters.commodity} unsupported={false} onClear={() => setFilters(withoutCommodity(filters))} />}
      <LoadingLine list={list} noun="awards" />
      {filtered.error && <Banner tone="danger">{filtered.error} <button type="button" className="btn btn--sm btn--ghost" onClick={() => setFilters(defaultFilters)}>Reset filters</button></Banner>}
      {!list ? <ViewSkeleton /> : (
        <div className="procurement-analytics__stack">
          <AwardViews view={view} ctx={ctx} />
          {view === "quality" && meta && <QualityView ctx={ctx} meta={meta} />}
        </div>
      )}
      {dialog === "filters" && meta && <FiltersDialog value={filters} meta={meta} rows={loaded} buyerLevel={buyerLevel} close={() => setDialog(null)} apply={(next: MarketFilters, level: BuyerLevel) => { setFilters(next, { buyerLevel: level }); setDialog(null); }} />}
      {dialog === "exclusions" && <ExclusionsDialog list={filters.exclude ?? []} onChange={(next) => setExclusions(next)} close={() => setDialog(null)} />}
      {editingWork && <OurWorkDialog work={work} save={(next) => { saveWork(next); nav.update({ [MARKET_PARAM]: null, [INSPECT_PARAM]: null }); }} close={() => setEditingWork(false)} />}
      {inspection && (
        <Inspect inspection={inspection} awards={inspected} byKey={byKey} partial={partial} actions={actions} close={() => nav.update({ [INSPECT_PARAM]: null })} hidden={covered(nav.params)} />
      )}
    </>
  );
}
