/**
 * What every award view is handed (`ViewContext`), whether the analysis runs
 * on the server or here, and the small pieces they share: ranked rows, the
 * entity table, a party named in a sentence, and the "⋯" actions a buyer,
 * supplier or type row offers (its awards, its page, leaving it out).
 */
import type { ReactNode } from "react";
import { Ban, ExternalLink, Filter, List } from "lucide-react";
import type { MenuSection } from "../../../../components/Menu";
import { count, isPlaceholderSupplier, money, percent, type Award, type Exclusion, type ExclusionField, type MarketFilters, type Ranked, type Slice } from "../../lib/market";
import type { AwardAnalytics } from "../../../../../shared/procurementAnalytics";
import type { useReaderNavigation } from "../routes";
import { PartyLink, UsBadge } from "../party/parts";
import type { RankedRow } from "./parts";
import { isExcludedParty } from "./exclusions";

export type AwardView = "overview" | "trends" | "buyers" | "suppliers" | "sizes" | "mix" | "quality" | "compare";
export const UNKNOWN_BUYER = "Unknown buyer";
export const UNKNOWN_SUPPLIER = "Unknown supplier";

/**
 * The awards behind one figure, as the drill-down lists them: a slice of the
 * filtered awards (or of every published award, `all`), titled "Awards ·
 * <title>". `range` replaces the filters' dates, for a comparison period.
 */
export type Inspection = { title: string; slice: Slice; all?: boolean; range?: { from: string; to: string } };

export type ViewContext = {
  rows: Award[]; all: Award[]; currency: string; filters: MarketFilters; today: string; partial: boolean;
  setFilters: (next: MarketFilters) => void; focus: (key: "supplier" | "type", name: string) => void;
  inspect: (inspection: Inspection) => void;
  /** What choosing a buyer does: its page, or (on the server's analysis) its matching awards. */
  openBuyer: (name: string) => void;
  openBuyerPage: (name: string) => void;
  /** A buyer's page, where a row opens it (not where it lists the buyer's awards instead). */
  buyerHref: (name: string) => string | undefined;
  openSupplier: (name: string) => void; supplierHref: (name: string) => string | undefined;
  /** "Us" beside the workspace's own organisation. */
  badge: (name: string) => ReactNode;
  /** Leaves a buyer, supplier or type out of the analysis; `closeInspection` also closes the drill-down. */
  exclude: (item: Exclusion, closeInspection?: boolean) => void;
  /** Another view of the analysis, such as the buyer directory behind the overview's buyer count. */
  showView: (view: AwardView) => void;
  params: URLSearchParams; update: (patch: Record<string, string | null>) => void;
  aggregate?: AwardAnalytics;
};

const realSupplier = (name: string) => !isPlaceholderSupplier(name) && name !== UNKNOWN_SUPPLIER;
/**
 * A supplier opens its page, where everything it won is; an unknown or
 * migrated supplier name has no page, so it focuses the analysis instead.
 */
export function supplierLinks(nav: ReturnType<typeof useReaderNavigation>, ours: (name: string) => boolean, focus: (name: string) => void) {
  return {
    openSupplier: (name: string) => { if (realSupplier(name)) nav.openParty("supplier", name); else focus(name); },
    supplierHref: (name: string) => (realSupplier(name) ? nav.partyHref("supplier", name) : undefined),
    badge: (name: string) => (ours(name) ? <UsBadge /> : undefined),
  };
}

export function ViewSkeleton() {
  return (
    <div className="procurement-analytics__skeleton" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => <span key={i} />)}
      <span className="procurement-analytics__skeleton-wide" />
    </div>
  );
}

/** "so far" on a figure while the list is still loading: never shown as final. */
export const soFar = (partial: boolean, text?: string) => (partial ? [text, "so far"].filter(Boolean).join(" · ") : text);

export const rankedRows = (rows: Ranked[], detail: (row: Ranked) => ReactNode, limit: number, link?: Pick<RankedRow, "href" | "badge"> | ((row: Ranked) => Pick<RankedRow, "href" | "badge">)): RankedRow[] =>
  rows.slice(0, limit).map((row) => ({ key: row.name, label: row.name, value: Math.max(0, row.value), share: row.share, detail: detail(row), ...(typeof link === "function" ? link(row) : link) }));

export function entityTable(rows: Ranked[], name: string, counterparties: string, currency: string) {
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

/** A buyer or supplier named in a sentence: a link to its page where there is one, marked "Us" when it's ours. */
export function Party({ field, name, ctx }: { field: "organization" | "supplier"; name: string; ctx: ViewContext }) {
  const href = field === "supplier" ? ctx.supplierHref(name) : ctx.buyerHref(name);
  return href ? <PartyLink field={field} name={name} /> : <>{name}</>;
}

const NOUNS: Record<ExclusionField, string> = { buyer: "buyer", supplier: "supplier", type: "type" };
/**
 * The "⋯" of a buyer, supplier or type row: whichever of its awards and its
 * page the row itself doesn't open, focusing a type, and leaving it out.
 * `primary` says what a click on the row already does.
 */
export function partyMenu(ctx: ViewContext, field: ExclusionField, name: string, primary: "page" | "awards" | "focus"): MenuSection[] {
  const slice: Slice = { [field]: name };
  const items: MenuSection["items"] = [];
  if (primary !== "awards") items.push({ id: "awards", label: "Matching awards", icon: <List size={14} />, onSelect: () => ctx.inspect({ slice, title: name }) });
  if (primary !== "page" && field === "buyer" && name !== UNKNOWN_BUYER) items.push({ id: "page", label: "Open buyer profile", icon: <ExternalLink size={14} />, onSelect: () => ctx.openBuyerPage(name) });
  if (primary !== "page" && field === "supplier" && realSupplier(name)) items.push({ id: "page", label: "Open supplier page", icon: <ExternalLink size={14} />, onSelect: () => ctx.openSupplier(name) });
  if (primary !== "focus" && field !== "buyer") items.push({ id: "focus", label: `Focus the analysis on this ${NOUNS[field]}`, icon: <Filter size={14} />, onSelect: () => ctx.focus(field, name) });
  const excluded = isExcludedParty(ctx.filters.exclude, { field, name });
  return [
    { id: "open", items },
    { id: "exclude", items: excluded ? [] : [{ id: "exclude", label: "Exclude from analysis", icon: <Ban size={14} />, onSelect: () => ctx.exclude({ field, name }) }] },
  ];
}
