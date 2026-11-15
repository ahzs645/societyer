/**
 * The award analysis filters: kept in the URL, shown as removable chips,
 * edited in Zoer's Filters dialog. How buyers are grouped (`buyerLevel`) and
 * what's left out of the analysis (`exclude`) are filters too, so the dialog
 * holds every choice that changes the figures and a link carries all of them.
 */
import { useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { Modal } from "../../../../components/Modal";
import { Select } from "../../../../components/Select";
import { DatePicker } from "../../../../components/DatePicker";
import { Field } from "../../../../components/ui";
import { defaultFilters, money, validateFilters, type MarketFilters, type metadata } from "../../lib/market";
import { shortSourceDate } from "../../lib/notice";
import type { AnalysisRequest } from "../../../../../shared/procurementAnalytics";
import { parseExclusions } from "./exclusionStore";
import { ExclusionList, ExclusionPicker, describeExclusions, withExclusion, withoutExclusion } from "./exclusions";

export type BuyerLevel = NonNullable<AnalysisRequest["buyerLevel"]>;
export const BUYER_LEVEL_PARAM = "buyerLevel";
export const DEFAULT_BUYER_LEVEL: BuyerLevel = "organization";
export const BUYER_LEVELS: { value: BuyerLevel; label: string; chip: string }[] = [
  { value: "organization", label: "Organization", chip: "organization" },
  { value: "office", label: "Office", chip: "office" },
  { value: "group", label: "Group", chip: "group" },
  { value: "type", label: "Buyer type", chip: "buyer type" },
  { value: "source", label: "Source name", chip: "source name" },
];
export const readBuyerLevel = (params: URLSearchParams): BuyerLevel =>
  BUYER_LEVELS.find((level) => level.value === params.get(BUYER_LEVEL_PARAM))?.value ?? DEFAULT_BUYER_LEVEL;

/** Filters in the URL, named apart from the list's and the buyer page's own parameters. */
const FILTER_PARAMS: Record<keyof MarketFilters, string> = {
  from: "awardFrom", to: "awardTo", buyer: "awardBuyer", supplier: "awardSupplier", type: "awardType",
  currency: "currency", includePlaceholders: "placeholders", includeFuture: "future", minValue: "minValue", exclude: "exclude",
};
export const EXCLUDE_PARAM = FILTER_PARAMS.exclude;
const FILTER_KEYS = Object.keys(FILTER_PARAMS) as (keyof MarketFilters)[];
export function readFilters(params: URLSearchParams): MarketFilters {
  const read = (key: keyof MarketFilters) => params.get(FILTER_PARAMS[key]);
  const exclude = parseExclusions(read("exclude"));
  return {
    from: read("from") ?? "", to: read("to") ?? "", buyer: read("buyer") ?? "", supplier: read("supplier") ?? "", type: read("type") ?? "",
    currency: read("currency") || defaultFilters.currency, includePlaceholders: read("includePlaceholders") === "1", includeFuture: read("includeFuture") === "1", minValue: read("minValue") ?? "",
    ...(exclude.length ? { exclude } : {}),
  };
}
const isDefault = (filters: MarketFilters, key: keyof MarketFilters) => (key === "exclude" ? !filters.exclude?.length : filters[key] === defaultFilters[key]);
export function filterPatch(filters: MarketFilters): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    patch[FILTER_PARAMS[key]] = isDefault(filters, key) ? null : typeof value === "boolean" ? "1" : typeof value === "string" ? value : JSON.stringify(value);
  }
  return patch;
}
/** Each filter that differs from the defaults, the buyer grouping among them. */
export const activeCount = (filters: MarketFilters, buyerLevel: BuyerLevel = DEFAULT_BUYER_LEVEL) =>
  FILTER_KEYS.filter((key) => !isDefault(filters, key)).length + (buyerLevel === DEFAULT_BUYER_LEVEL ? 0 : 1);

export function FilterChips({ filters, onChange, buyerLevel = DEFAULT_BUYER_LEVEL, onBuyerLevel, onShowExclusions }: {
  filters: MarketFilters;
  /** With `buyerLevel`, the grouping changes in the same step (Clear all). */
  onChange: (next: MarketFilters, buyerLevel?: BuyerLevel) => void;
  buyerLevel?: BuyerLevel;
  onBuyerLevel?: (next: BuyerLevel) => void;
  /** Opens the list of exclusions; the chip lists rather than clears them. */
  onShowExclusions?: () => void;
}) {
  const chips: { key: keyof MarketFilters | "buyerLevel"; label: string }[] = [];
  if (filters.from || filters.to) chips.push({ key: "from", label: filters.from && filters.to ? `${shortSourceDate(filters.from)} – ${shortSourceDate(filters.to)}` : filters.from ? `From ${shortSourceDate(filters.from)}` : `To ${shortSourceDate(filters.to)}` });
  if (filters.buyer) chips.push({ key: "buyer", label: `Buyer: ${filters.buyer}` });
  if (filters.supplier) chips.push({ key: "supplier", label: `Supplier: ${filters.supplier}` });
  if (filters.type) chips.push({ key: "type", label: `Type: ${filters.type}` });
  if (filters.currency !== defaultFilters.currency) chips.push({ key: "currency", label: filters.currency === "UNSPECIFIED" ? "Currency not stated" : filters.currency });
  if (filters.minValue) chips.push({ key: "minValue", label: `At least ${money(Number(filters.minValue), filters.currency)}` });
  if (filters.includePlaceholders) chips.push({ key: "includePlaceholders", label: "With placeholder suppliers" });
  if (filters.includeFuture) chips.push({ key: "includeFuture", label: "With future-dated awards" });
  if (onBuyerLevel && buyerLevel !== DEFAULT_BUYER_LEVEL) chips.push({ key: "buyerLevel", label: `Buyers by ${BUYER_LEVELS.find((level) => level.value === buyerLevel)?.chip ?? buyerLevel}` });
  const exclusions = filters.exclude ?? [];
  if (!chips.length && !exclusions.length) return null;
  const clear = (key: keyof MarketFilters | "buyerLevel") => {
    if (key === "buyerLevel") onBuyerLevel?.(DEFAULT_BUYER_LEVEL);
    else onChange({ ...filters, [key]: defaultFilters[key], ...(key === "from" ? { to: "" } : {}) });
  };
  return (
    <div className="procurement-analytics__chips" aria-label="Active filters">
      {exclusions.length > 0 && (
        <button type="button" className="btn btn--sm procurement-analytics__chip procurement-analytics__chip--exclusions" aria-haspopup="dialog" onClick={onShowExclusions}>
          <span>Excluding {describeExclusions(exclusions)}</span><ChevronRight size={12} aria-hidden="true" />
        </button>
      )}
      {chips.map((chip) => (
        <button key={chip.key} type="button" className="btn btn--sm procurement-analytics__chip" onClick={() => clear(chip.key)} aria-label={`Remove filter ${chip.label}`}>
          <span>{chip.label}</span><X size={12} aria-hidden="true" />
        </button>
      ))}
      {chips.length + (exclusions.length ? 1 : 0) > 1 && (
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => onChange(defaultFilters, DEFAULT_BUYER_LEVEL)}>Clear all</button>
      )}
    </div>
  );
}

/**
 * Zoer's Filters dialog: a draft until Apply. `buyerLevel` is offered where
 * the analysis can regroup buyers; the exclusions section lists what's left
 * out and searches every buyer, supplier and type to add one.
 */
export function FiltersDialog({ value, meta, apply, close, buyerLevel = DEFAULT_BUYER_LEVEL }: {
  value: MarketFilters;
  meta: ReturnType<typeof metadata> & { choicesTruncated?: boolean };
  apply: (next: MarketFilters, buyerLevel: BuyerLevel) => void;
  close: () => void;
  buyerLevel?: BuyerLevel;
}) {
  const [draft, setDraft] = useState(value);
  const [level, setLevel] = useState(buyerLevel);
  const set = <K extends keyof MarketFilters>(key: K, next: MarketFilters[K]) => setDraft({ ...draft, [key]: next });
  let error = "";
  try { validateFilters(draft); } catch (problem) { error = problem instanceof Error ? problem.message : "Check the filters."; }
  const options = (values: string[]) => values.map((item) => ({ value: item, label: item }));
  const exclusions = draft.exclude ?? [];
  const setExclusions = (next: typeof exclusions) => {
    const { exclude: _dropped, ...rest } = draft;
    setDraft(next.length ? { ...rest, exclude: next } : rest);
  };
  return (
    <Modal
      open
      onClose={close}
      title="Filters"
      footer={<>
        <button type="button" className="btn btn--ghost procurement-analytics__reset" disabled={!activeCount(draft, level) && !activeCount(value, buyerLevel)} onClick={() => apply(defaultFilters, DEFAULT_BUYER_LEVEL)}>Reset</button>
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <button type="button" className="btn btn--accent" disabled={Boolean(error)} onClick={() => apply(draft, level)}>Apply</button>
      </>}
    >
      <div className="procurement-analytics__filter-grid">
        <Field label="Award date from"><DatePicker value={draft.from} onChange={(next) => set("from", next)} max={draft.to || undefined} /></Field>
        <Field label="Award date to"><DatePicker value={draft.to} onChange={(next) => set("to", next)} min={draft.from || undefined} /></Field>
        <Field label="Buyer"><Select<string> value={draft.buyer} onChange={(next) => set("buyer", next)} options={options(meta.buyers)} searchable clearable clearLabel="All buyers" placeholder="All buyers" /></Field>
        <Field label="Supplier"><Select<string> value={draft.supplier} onChange={(next) => set("supplier", next)} options={options(meta.suppliers)} searchable clearable clearLabel="All suppliers" placeholder="All suppliers" /></Field>
        <Field label="Procurement type"><Select<string> value={draft.type} onChange={(next) => set("type", next)} options={options(meta.types)} searchable clearable clearLabel="All types" placeholder="All types" /></Field>
        <Field label="Currency">
          <Select<string> value={draft.currency} onChange={(next) => set("currency", next || defaultFilters.currency)} options={(meta.currencies.length ? meta.currencies : ["CAD"]).map((code) => ({ value: code, label: code === "UNSPECIFIED" ? "Not stated (not converted)" : code }))} />
        </Field>
        <Field label="Minimum award value"><input className="input" type="number" min="0" step="any" inputMode="decimal" placeholder="No minimum" value={draft.minValue} onChange={(event) => set("minValue", event.target.value)} /></Field>
        <Field label="Group buyers by" hint="Which name buyers are counted under: the organization, its office, a wider group, the kind of buyer, or the name the source used.">
          <Select<BuyerLevel> value={level} onChange={setLevel} options={BUYER_LEVELS.map(({ value: item, label }) => ({ value: item, label }))} />
        </Field>
      </div>
      <div className="procurement-analytics__checks">
        {meta.choicesTruncated && <p className="muted">Suggestions show the first 200 names. The buyer and supplier directories search every party.</p>}
        <label className="procurement-analytics__check"><input type="checkbox" checked={draft.includePlaceholders} onChange={(event) => set("includePlaceholders", event.target.checked)} /> Include placeholder suppliers</label>
        <label className="procurement-analytics__check"><input type="checkbox" checked={draft.includeFuture} onChange={(event) => set("includeFuture", event.target.checked)} /> Include future-dated awards</label>
      </div>
      <section className="procurement-analytics__exclude" aria-labelledby="procurement-analytics-exclude">
        <h3 id="procurement-analytics-exclude">Exclude from analysis</h3>
        <p className="muted procurement-analytics__caption">Leave out a buyer, supplier or type that skews the figures, such as one very large contract or your own organisation.</p>
        <ExclusionPicker list={exclusions} choices={meta} onAdd={(item) => setExclusions(withExclusion(exclusions, item))} />
        <ExclusionList list={exclusions} onRemove={(item) => setExclusions(withoutExclusion(exclusions, item))} />
      </section>
      {error && <p className="field__error" role="alert">{error}</p>}
    </Modal>
  );
}
