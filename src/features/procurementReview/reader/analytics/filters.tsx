/** The award analysis filters: kept in the URL, shown as removable chips, edited in Zoer's Filters dialog. */
import { useState } from "react";
import { X } from "lucide-react";
import { Modal } from "../../../../components/Modal";
import { Select } from "../../../../components/Select";
import { DatePicker } from "../../../../components/DatePicker";
import { Field } from "../../../../components/ui";
import { defaultFilters, money, validateFilters, type MarketFilters, type metadata } from "../../lib/market";
import { shortSourceDate } from "../../lib/notice";

/** Filters in the URL, named apart from the list's and the buyer page's own parameters. */
const FILTER_PARAMS: Record<keyof MarketFilters, string> = {
  from: "awardFrom", to: "awardTo", buyer: "awardBuyer", supplier: "awardSupplier", type: "awardType",
  currency: "currency", includePlaceholders: "placeholders", includeFuture: "future", minValue: "minValue",
};
const FILTER_KEYS = Object.keys(FILTER_PARAMS) as (keyof MarketFilters)[];
export function readFilters(params: URLSearchParams): MarketFilters {
  const read = (key: keyof MarketFilters) => params.get(FILTER_PARAMS[key]);
  return {
    from: read("from") ?? "", to: read("to") ?? "", buyer: read("buyer") ?? "", supplier: read("supplier") ?? "", type: read("type") ?? "",
    currency: read("currency") || defaultFilters.currency, includePlaceholders: read("includePlaceholders") === "1", includeFuture: read("includeFuture") === "1", minValue: read("minValue") ?? "",
  };
}
export function filterPatch(filters: MarketFilters): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    patch[FILTER_PARAMS[key]] = value === defaultFilters[key] ? null : typeof value === "boolean" ? "1" : value;
  }
  return patch;
}
export const activeCount = (filters: MarketFilters) => FILTER_KEYS.filter((key) => filters[key] !== defaultFilters[key]).length;

export function FilterChips({ filters, onChange }: { filters: MarketFilters; onChange: (next: MarketFilters) => void }) {
  const chips: { key: keyof MarketFilters; label: string }[] = [];
  if (filters.from || filters.to) chips.push({ key: "from", label: filters.from && filters.to ? `${shortSourceDate(filters.from)} – ${shortSourceDate(filters.to)}` : filters.from ? `From ${shortSourceDate(filters.from)}` : `To ${shortSourceDate(filters.to)}` });
  if (filters.buyer) chips.push({ key: "buyer", label: `Buyer: ${filters.buyer}` });
  if (filters.supplier) chips.push({ key: "supplier", label: `Supplier: ${filters.supplier}` });
  if (filters.type) chips.push({ key: "type", label: `Type: ${filters.type}` });
  if (filters.currency !== defaultFilters.currency) chips.push({ key: "currency", label: filters.currency === "UNSPECIFIED" ? "Currency not stated" : filters.currency });
  if (filters.minValue) chips.push({ key: "minValue", label: `At least ${money(Number(filters.minValue), filters.currency)}` });
  if (filters.includePlaceholders) chips.push({ key: "includePlaceholders", label: "With placeholder suppliers" });
  if (filters.includeFuture) chips.push({ key: "includeFuture", label: "With future-dated awards" });
  if (!chips.length) return null;
  const clear = (key: keyof MarketFilters) => onChange({ ...filters, [key]: defaultFilters[key], ...(key === "from" ? { to: "" } : {}) });
  return (
    <div className="procurement-analytics__chips" aria-label="Active filters">
      {chips.map((chip) => (
        <button key={chip.key} type="button" className="btn btn--sm procurement-analytics__chip" onClick={() => clear(chip.key)} aria-label={`Remove filter ${chip.label}`}>
          <span>{chip.label}</span><X size={12} aria-hidden="true" />
        </button>
      ))}
      {chips.length > 1 && <button type="button" className="btn btn--sm btn--ghost" onClick={() => onChange(defaultFilters)}>Clear all</button>}
    </div>
  );
}

/** Zoer's Filters dialog: a draft until Apply. */
export function FiltersDialog({ value, meta, apply, close }: { value: MarketFilters; meta: ReturnType<typeof metadata>; apply: (next: MarketFilters) => void; close: () => void }) {
  const [draft, setDraft] = useState(value);
  const set = <K extends keyof MarketFilters>(key: K, next: MarketFilters[K]) => setDraft({ ...draft, [key]: next });
  let error = "";
  try { validateFilters(draft); } catch (problem) { error = problem instanceof Error ? problem.message : "Check the filters."; }
  const options = (values: string[]) => values.map((item) => ({ value: item, label: item }));
  return (
    <Modal
      open
      onClose={close}
      title="Filters"
      footer={<>
        <button type="button" className="btn btn--ghost procurement-analytics__reset" disabled={!activeCount(draft) && !activeCount(value)} onClick={() => apply(defaultFilters)}>Reset</button>
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <button type="button" className="btn btn--accent" disabled={Boolean(error)} onClick={() => apply(draft)}>Apply</button>
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
      </div>
      <div className="procurement-analytics__checks">
        <label className="procurement-analytics__check"><input type="checkbox" checked={draft.includePlaceholders} onChange={(event) => set("includePlaceholders", event.target.checked)} /> Include placeholder suppliers</label>
        <label className="procurement-analytics__check"><input type="checkbox" checked={draft.includeFuture} onChange={(event) => set("includeFuture", event.target.checked)} /> Include future-dated awards</label>
      </div>
      {error && <p className="field__error" role="alert">{error}</p>}
    </Modal>
  );
}
