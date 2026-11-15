/**
 * Zoer's "Awards · <slice>" drill-down: the awards behind a bar, a month, a
 * cell, a tile or a flag, in the catalog's award table, where each award
 * opens its notice in the side panel. The slice is in the URL (`inspect=`),
 * so Back closes it and a link reopens it. The server's analysis pages the
 * awards (ServerInspect); the in-browser one slices its own list (Inspect).
 *
 * From here a slice can become the analysis (Focus), its buyer or supplier
 * can open its page, and either can be left out of the analysis, from the
 * footer or from any row's "⋯".
 */
import { useMemo, useState } from "react";
import { Ban, ExternalLink } from "lucide-react";
import { Modal } from "../../../../components/Modal";
import type { MenuSection } from "../../../../components/Menu";
import { Banner } from "../../../../components/ui";
import { endOfMonth } from "../../../../components/charts";
import { count, counted, isPlaceholderSupplier, normalizeAwards, type Award, type Exclusion, type MarketFilters, type Slice } from "../../lib/market";
import { ANALYSIS_PAGE_SIZE, canonicalProcurementRows, type AnalysisRequest } from "../../../../../shared/procurementAnalytics";
import { useReaderNavigation } from "../routes";
import { useReaderSource, type ListRow } from "../source";
import { NoticeTable } from "../NoticeTable";
import { UNKNOWN_BUYER, UNKNOWN_SUPPLIER, ViewSkeleton, type Inspection } from "./context";
import { EXCLUSION_KINDS, isExcludedParty } from "./exclusions";

export const INSPECT_PARAM = "inspect";

export function readInspection(value: string | null): Inspection | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const { title, slice, all, range } = parsed as Record<string, unknown>;
    if (typeof title !== "string" || !slice || typeof slice !== "object") return null;
    const period = range && typeof range === "object" ? (range as Record<string, unknown>) : null;
    return {
      title, slice: slice as Slice, all: all === true,
      ...(period && typeof period.from === "string" && typeof period.to === "string" ? { range: { from: period.from, to: period.to } } : {}),
    };
  } catch { return null; }
}
export const inspectionParam = (inspection: Inspection) =>
  JSON.stringify({ title: inspection.title, slice: inspection.slice, ...(inspection.all ? { all: true } : {}), ...(inspection.range ? { range: inspection.range } : {}) });

/** The filters a drill-down uses: the analysis's own, with a comparison period's dates in place of its dates. */
export const inspectionFilters = (inspection: Inspection, filters: MarketFilters): MarketFilters =>
  (inspection.range ? { ...filters, ...inspection.range } : filters);

const FOCUSABLE = new Set(["buyer", "supplier", "type", "month", "from", "to"]);
/** The filters that make a slice the whole analysis, where the filters can say it (not a size band or a flag). */
function focusFilters(inspection: Inspection, filters: MarketFilters): MarketFilters | null {
  const { slice } = inspection, keys = Object.keys(slice);
  if (inspection.all || inspection.range || !keys.length || keys.some((key) => !FOCUSABLE.has(key))) return null;
  const month = slice.month ? { from: `${slice.month}-01`, to: endOfMonth(`${slice.month}-01`) } : {};
  return { ...filters, ...(slice.buyer ? { buyer: slice.buyer } : {}), ...(slice.supplier ? { supplier: slice.supplier } : {}), ...(slice.type ? { type: slice.type } : {}), ...(slice.from ? { from: slice.from } : {}), ...(slice.to ? { to: slice.to } : {}), ...month };
}
/** The one buyer, supplier or type a slice is about, which the footer can leave out. */
function sliceParty(slice: Slice): Exclusion | null {
  const parties = (["buyer", "supplier", "type"] as const).filter((field) => slice[field]);
  return parties.length === 1 ? { field: parties[0], name: slice[parties[0]]! } : null;
}

export type InspectActions = {
  filters: MarketFilters;
  setFilters: (next: MarketFilters) => void;
  /** `closeInspection` closes the drill-down in the same step (a second URL change would undo the first). */
  exclude: (item: Exclusion, closeInspection?: boolean) => void;
};

/** A row's "⋯": leave its buyer or its supplier out of the analysis. */
function rowMenu(awards: Map<string, Award>, actions: InspectActions) {
  return (record: Record<string, unknown>): MenuSection[] => {
    const award = awards.get(String(record._id));
    if (!award) return [];
    const items = [
      { field: "buyer" as const, name: award.buyer },
      ...(award.placeholder || award.supplier === UNKNOWN_SUPPLIER ? [] : [{ field: "supplier" as const, name: award.supplier }]),
    ].filter((item) => !isExcludedParty(actions.filters.exclude, item)).map((item) => ({
      id: `exclude-${item.field}`, label: `Exclude ${EXCLUSION_KINDS[item.field].toLowerCase()} ${item.name}`, icon: <Ban size={14} />, onSelect: () => actions.exclude(item),
    }));
    return [{ id: "exclude", label: "Analysis", items }];
  };
}

function Footer({ inspection, actions, close }: { inspection: Inspection; actions: InspectActions; close: () => void }) {
  const nav = useReaderNavigation();
  const { buyer, supplier } = inspection.slice;
  const focus = focusFilters(inspection, actions.filters);
  const party = inspection.all ? null : sliceParty(inspection.slice);
  const excludable = party && !isExcludedParty(actions.filters.exclude, party) ? party : null;
  return <>
    {excludable && (
      <button type="button" className="btn btn--ghost procurement-analytics__reset" onClick={() => actions.exclude(excludable, true)}>
        <Ban size={14} aria-hidden="true" /> Exclude from analysis
      </button>
    )}
    {buyer && buyer !== UNKNOWN_BUYER && <button type="button" className="btn btn--ghost" onClick={() => nav.openParty("organization", buyer)}><ExternalLink size={14} aria-hidden="true" /> Open buyer profile</button>}
    {supplier && supplier !== UNKNOWN_SUPPLIER && !isPlaceholderSupplier(supplier) && <button type="button" className="btn btn--ghost" onClick={() => nav.openParty("supplier", supplier)}><ExternalLink size={14} aria-hidden="true" /> Open supplier page</button>}
    {focus && <button type="button" className="btn" onClick={() => actions.setFilters(focus)}>{inspection.title.length <= 32 ? `Focus on ${inspection.title}` : "Focus the analysis on this"}</button>}
    <button type="button" className="btn btn--accent" onClick={close}>Done</button>
  </>;
}

/** The server's drill-down: one page of the matching awards at a time, by the same rules as the chart. */
export function ServerInspect({ inspection, actions, buyerLevel, close, hidden }: {
  inspection: Inspection; actions: InspectActions; buyerLevel?: AnalysisRequest["buyerLevel"]; close: () => void; hidden: boolean;
}) {
  const source = useReaderSource();
  const [offset, setOffset] = useState(0);
  const filters = inspectionFilters(inspection, actions.filters);
  const result = source.useAnalysis!({ view: "awards", buyerLevel, filters, slice: inspection.slice, all: inspection.all, offset });
  const data = result.result?.type === "awards" ? result.result.data : null;
  // Each row's buyer named as the analysis groups it, so "Exclude buyer" leaves out what the figures show.
  const awards = useMemo(() => new Map(normalizeAwards(canonicalProcurementRows(data?.rows ?? [], buyerLevel)).map((award) => [award.id, award])), [data, buyerLevel]);
  const menu = useMemo(() => rowMenu(awards, actions), [awards, actions]);
  return (
    <Modal open={!hidden} onClose={close} title={`Awards · ${inspection.title}`} size="xl" resizeKey="procurement-analytics-awards" footer={<Footer inspection={inspection} actions={actions} close={close} />}>
      {result.state === "failed" ? <Banner tone="danger">{result.error} <button type="button" className="btn btn--sm" onClick={result.retry}>Retry</button></Banner> : !data ? <ViewSkeleton /> : <>
        <p className="muted procurement-analytics__caption">
          {counted(data.total, "matching award")}{inspection.all ? ", from every published award regardless of filters" : ", by the same filters and rules as the figure"}. Open one for its notice.
        </p>
        <NoticeTable kind="award" rows={data.rows} tableId="procurement-review:analysis:drilldown" view="all" label="Awards" rowMenuSections={menu} />
        {data.total > ANALYSIS_PAGE_SIZE && (
          <div className="btn-group procurement-analytics__pager">
            <button type="button" className="btn btn--sm" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - ANALYSIS_PAGE_SIZE))}>Previous</button>
            <span className="muted">{count(data.total ? offset + 1 : 0)}–{count(offset + data.rows.length)} of {count(data.total)}</span>
            <button type="button" className="btn btn--sm" disabled={offset + data.rows.length >= data.total} onClick={() => setOffset(offset + ANALYSIS_PAGE_SIZE)}>Next</button>
          </div>
        )}
      </>}
    </Modal>
  );
}

/** The in-browser drill-down: the awards already sliced, drawn from the loaded list. */
export function Inspect({ inspection, awards, byKey, partial, actions, close, hidden }: {
  inspection: Inspection; awards: Award[]; byKey: Map<string, ListRow>; partial: boolean; actions: InspectActions; close: () => void; hidden: boolean;
}) {
  const rows = useMemo(() => awards.flatMap((award) => byKey.get(award.id) ?? []), [awards, byKey]);
  const byId = useMemo(() => new Map(awards.map((award) => [award.id, award])), [awards]);
  const menu = useMemo(() => rowMenu(byId, actions), [byId, actions]);
  return (
    <Modal open={!hidden} onClose={close} title={`Awards · ${inspection.title}`} size="xl" resizeKey="procurement-analytics-awards" footer={<Footer inspection={inspection} actions={actions} close={close} />}>
      <p className="muted procurement-analytics__caption">
        {counted(rows.length, "award")}{partial ? " so far" : ""}{inspection.all ? ", from every published award regardless of filters" : ""}. Open one for its notice.
      </p>
      <NoticeTable kind="award" rows={rows} tableId="procurement-review:analytics:awards" view="all" label="Awards" rowMenuSections={menu} />
    </Modal>
  );
}
