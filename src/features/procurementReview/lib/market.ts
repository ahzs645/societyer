/**
 * The award market model, computed in the browser from the reader's award
 * list. A faithful port of Zoer's `dashboard/market/model.ts` (and the label
 * and placeholder rules it imports from `packages/shared/src/contractAwardsAnalysis.ts`),
 * so the numbers here match Zoer's Market analysis for the same catalog.
 *
 * Adapted, not extended: rows are the reader's `ListRow`s (`organization`,
 * `supplier`, `value`, `currency`, `procurementType`, `date`) instead of raw
 * BC Bid award objects. Left out, because the published list doesn't carry
 * what they need: Zoer's buyer registry (buyer levels, drill-down trail,
 * buyer search and the mapping view), URL exclusions, the contract-number
 * and justification quality flags, and the period comparison.
 */
import type { ListRow } from "../reader/source";
import { decodeHtmlEntities } from "../../../../shared/htmlEntities";
import { isUnspscCode, underUnspsc, unspscCodesOf, unspscCounts } from "../../../../shared/unspsc";

/**
 * A buyer, supplier or procurement type someone chose to leave out of the
 * analysis: one huge contract, an internal transfer, their own organisation.
 * Matched by name the way parties are everywhere (entities decoded, case and
 * punctuation ignored); a buyer matches on any of its mapped labels, so
 * leaving out an organisation still holds when buyers are grouped by office.
 */
export type ExclusionField = "buyer" | "supplier" | "type";
export type Exclusion = { field: ExclusionField; name: string };
/** Enough for any real analysis, and small enough that the request stays under the service's 8 KB body. */
export const MAX_EXCLUSIONS = 50;
const MAX_EXCLUSION_NAME = 300;
const MAX_EXCLUSION_TEXT = 4000;

export type MarketFilters = {
  from: string; to: string; buyer: string; supplier: string; type: string;
  currency: string; includePlaceholders: boolean; includeFuture: boolean; minValue: string;
  /**
   * A UNSPSC code (eight digits): only awards classified under it, a segment,
   * family or class including everything below it (shared/unspsc.ts). Absent
   * rather than empty, as `exclude` is.
   */
  commodity?: string;
  /** Absent rather than empty, so a request without exclusions keeps the identity (and cached results) it always had. */
  exclude?: Exclusion[];
};
/** CAD only, placeholder suppliers and future-dated awards left out: Zoer's defaults. */
export const defaultFilters: MarketFilters = { from: "", to: "", buyer: "", supplier: "", type: "", currency: "CAD", includePlaceholders: false, includeFuture: false, minValue: "" };

export type QualityFlag = "future" | "undated" | "currency" | "placeholder" | "value" | "negative" | "zero" | "contract" | "justification" | "mapping";
/** Why the filters leave an award out of the figures (`leftOut`), as a drill-down over every published award. */
export type LeftOutReason = "currency" | "url" | "placeholder" | "future" | "excluded";
/**
 * The awards behind one figure: a party, a type, a month or date range, a
 * size band (`min` inclusive, `max` exclusive, `atMost` inclusive), an exact
 * value, a quality flag, or a reason the filters leave awards out.
 */
export type Slice = {
  buyer?: string; supplier?: string; type?: string; month?: string; from?: string; to?: string;
  min?: number; max?: number; atMost?: number; exact?: number; quality?: QualityFlag; left?: LeftOutReason;
};

export type Award = {
  id: string; title: string; buyer: string; supplier: string; type: string; currencyCode: string;
  date: string | null; value: number | null; placeholder: boolean;
  contractNumber?: string | null; justification?: string | null; buyerId?: string; hierarchy?: string[]; mappingStatus?: string; urlExcluded?: boolean;
  /** Every name the buyer goes by (source label, office, organisation, group, type, aliases), for exclusions. */
  buyerLabels?: string[];
  /** The UNSPSC codes the award is classified under; none when the source gave none. */
  commodities?: string[];
};
export function analyticalFields(row: ListRow): Record<string, any> {
  if (!row.analyticsJson) return {};
  try { const value = JSON.parse(row.analyticsJson); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
  catch { throw new Error(`Invalid analytical inputs for ${row.recordKey}.`); }
}

const PLACEHOLDER_SUPPLIERS = new Set(["migrated supplier"]);
/** Collapses whitespace (including non-breaking spaces); "" reads as missing. */
export function normalizeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/ /g, " ").replace(/\s+/g, " ").trim();
  return normalized || null;
}
/** A missing supplier or a migration stand-in ("Migrated supplier") isn't a real winner. */
export function isPlaceholderSupplier(value: string | null | undefined): boolean {
  const normalized = normalizeLabel(value);
  return !normalized || PLACEHOLDER_SUPPLIERS.has(normalized.toLowerCase());
}
const label = (value: string, fallback: string) => normalizeLabel(value) ?? fallback;

export function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

/** The list's sortable date may carry a time ("2026-10-30T14:00"); an award is dated by its day. */
export function normalizeAwards(rows: ListRow[]): Award[] {
  return rows.map((row) => { const extra = analyticalFields(row); return ({
    id: row.recordKey,
    title: row.title,
    buyer: label(row.organization, "Unknown buyer"),
    supplier: label(row.supplier, "Unknown supplier"),
    type: label(row.procurementType, "Unspecified type"),
    currencyCode: label(row.currency, "Unspecified").toUpperCase(),
    date: isoDate(row.date.slice(0, 10)),
    value: typeof row.value === "number" && Number.isFinite(row.value) ? row.value : null,
    placeholder: isPlaceholderSupplier(row.supplier),
    contractNumber: Object.hasOwn(extra, "contractNumber") ? String(extra.contractNumber ?? "").trim() : null,
    justification: Object.hasOwn(extra, "justification") ? String(extra.justification ?? "").trim() : null,
    buyerId: typeof extra.buyerId === "string" ? extra.buyerId : undefined,
    hierarchy: Array.isArray(extra.buyerHierarchy) ? extra.buyerHierarchy.filter((v: unknown) => typeof v === "string") : [],
    mappingStatus: String(extra.buyerMappingStatus ?? extra.mappingProvenance?.status ?? "Not supplied"),
    urlExcluded: extra.urlExcluded === true,
    buyerLabels: [extra.buyerOriginal, extra.buyerDisplayName, extra.buyerOrganization, extra.buyerGroup, extra.buyerType, ...(Array.isArray(extra.buyerAliases) ? extra.buyerAliases : [])]
      .filter((v: unknown): v is string => typeof v === "string" && v.trim() !== ""),
    commodities: unspscCodesOf(extra),
  }); });
}

/** A name as parties compare: entities decoded, Unicode forms unified, case and punctuation ignored. */
export const partyKey = (value: string) => decodeHtmlEntities(value).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const EXCLUSION_FIELDS: ExclusionField[] = ["buyer", "supplier", "type"];
/**
 * Exclusions checked, each party once, in a stable order (by kind, then
 * name), so two requests that leave out the same parties share one result.
 * Throws on anything malformed or over the limits; `[]` when there are none.
 */
export function normalizeExclusions(value: unknown): Exclusion[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("Invalid analysis exclusions.");
  if (value.length > MAX_EXCLUSIONS) throw new Error(`Leave out at most ${MAX_EXCLUSIONS} buyers, suppliers or types.`);
  const seen = new Map<string, Exclusion>();
  let text = 0;
  for (const item of value) {
    if (!item || typeof item !== "object") throw new Error("Invalid analysis exclusion.");
    const { field, name } = item as Record<string, unknown>;
    if (!EXCLUSION_FIELDS.includes(field as ExclusionField) || typeof name !== "string") throw new Error("Invalid analysis exclusion.");
    const trimmed = name.replace(/\s+/g, " ").trim();
    if (!trimmed || trimmed.length > MAX_EXCLUSION_NAME || !partyKey(trimmed)) throw new Error("Invalid analysis exclusion.");
    text += trimmed.length;
    const key = `${field}\u0000${partyKey(trimmed)}`;
    if (!seen.has(key)) seen.set(key, { field: field as ExclusionField, name: trimmed });
  }
  if (text > MAX_EXCLUSION_TEXT) throw new Error("The exclusions are too long; leave out fewer names.");
  return [...seen.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, item]) => item);
}

// Each award's names as keys, worked out once per award however often the exclusions change.
const awardKeys = new WeakMap<Award, Record<ExclusionField, string[]>>();
function keysOf(award: Award) {
  let keys = awardKeys.get(award);
  if (!keys) {
    keys = { buyer: [award.buyer, ...(award.buyerLabels ?? [])].map(partyKey), supplier: [partyKey(award.supplier)], type: [partyKey(award.type)] };
    awardKeys.set(award, keys);
  }
  return keys;
}
/** A test for "left out by the person", or null when nothing is, so the common case costs nothing. */
export function exclusionTest(exclusions: Exclusion[] | undefined): ((award: Award) => boolean) | null {
  if (!exclusions?.length) return null;
  const wanted: Record<ExclusionField, Set<string>> = { buyer: new Set(), supplier: new Set(), type: new Set() };
  for (const item of exclusions) wanted[item.field].add(partyKey(item.name));
  const fields = EXCLUSION_FIELDS.filter((field) => wanted[field].size);
  return (award) => {
    const keys = keysOf(award);
    return fields.some((field) => keys[field].some((key) => wanted[field].has(key)));
  };
}

export function validateFilters(input: Partial<MarketFilters>): MarketFilters {
  const f = { ...defaultFilters, ...input };
  if ((f.from && !isoDate(f.from)) || (f.to && !isoDate(f.to))) throw new Error("Choose valid start and end dates.");
  if (f.from && f.to && f.from > f.to) throw new Error("Start date must be on or before end date.");
  if (f.minValue && (!Number.isFinite(Number(f.minValue)) || Number(f.minValue) < 0)) throw new Error("Minimum award value must be zero or a positive number.");
  if (f.commodity !== undefined && f.commodity !== "" && !isUnspscCode(f.commodity)) throw new Error("Use an eight-digit UNSPSC commodity code.");
  return f;
}

export function filterAwards(rows: Award[], input: Partial<MarketFilters>, today: string): Award[] {
  const f = validateFilters(input), excluded = exclusionTest(f.exclude);
  return rows.filter((r) => !r.urlExcluded && !excluded?.(r) && (!f.buyer || r.buyer === f.buyer) && (!f.supplier || r.supplier === f.supplier) && (!f.type || r.type === f.type)
    && r.currencyCode === f.currency && (f.includePlaceholders || !r.placeholder) && (f.includeFuture || !r.date || r.date <= today)
    && (!f.from || (!!r.date && r.date >= f.from)) && (!f.to || (!!r.date && r.date <= f.to))
    && (!f.minValue || (r.value !== null && r.value >= Number(f.minValue)))
    && (!f.commodity || underUnspsc(r.commodities ?? [], f.commodity)));
}

export function qualityMatch(r: Award, flag: QualityFlag, today: string): boolean {
  switch (flag) {
    case "future": return !!r.date && r.date > today;
    case "undated": return !r.date;
    case "currency": return r.currencyCode === "UNSPECIFIED";
    case "placeholder": return r.placeholder;
    case "value": return r.value === null;
    case "negative": return r.value !== null && r.value < 0;
    case "zero": return r.value === 0;
    case "contract": return r.contractNumber === "";
    case "justification": return r.justification === "";
    case "mapping": return !r.buyerId || /not supplied|not mapped|review required/i.test(r.mappingStatus ?? "");
  }
}

/** `filters` only matters to a `left` slice: which currency and exclusions the figures use. */
export function sliceAwards(rows: Award[], slice: Slice = {}, today: string, filters: Partial<MarketFilters> = {}): Award[] {
  const left = slice.left ? leftOutTest(slice.left, { ...defaultFilters, ...filters }, today) : null;
  return rows.filter((r) => (!slice.buyer || r.buyer === slice.buyer) && (!slice.supplier || r.supplier === slice.supplier)
    && (!slice.type || r.type === slice.type) && (!slice.month || r.date?.slice(0, 7) === slice.month)
    && (!slice.from || (!!r.date && r.date >= slice.from)) && (!slice.to || (!!r.date && r.date <= slice.to))
    && (slice.min === undefined || (r.value !== null && r.value >= slice.min))
    && (slice.max === undefined || (r.value !== null && r.value < slice.max))
    && (slice.atMost === undefined || (r.value !== null && r.value <= slice.atMost))
    && (slice.exact === undefined || r.value === slice.exact) && (!slice.quality || qualityMatch(r, slice.quality, today))
    && (!left || left(r)));
}

function leftOutTest(reason: LeftOutReason, f: MarketFilters, today: string): (r: Award) => boolean {
  switch (reason) {
    case "currency": return (r) => r.currencyCode !== f.currency;
    case "url": return (r) => r.urlExcluded === true;
    case "placeholder": return (r) => !f.includePlaceholders && r.placeholder;
    case "future": return (r) => !f.includeFuture && !!r.date && r.date > today;
    case "excluded": { const test = exclusionTest(f.exclude); return (r) => !!test?.(r); }
  }
}
const LEFT_OUT: { reason: LeftOutReason; label: (f: MarketFilters) => string; note: string }[] = [
  { reason: "currency", label: (f) => `Not in ${f.currency === "UNSPECIFIED" ? "a stated currency" : f.currency}`, note: "Currencies are never converted or combined." },
  { reason: "url", label: () => "Excluded source URLs", note: "The publication’s versioned URL exclusion policy." },
  { reason: "placeholder", label: () => "Placeholder supplier", note: "Missing or “Migrated supplier” names." },
  { reason: "future", label: () => "Dated after today", note: "Future award dates usually need checking at the source." },
  { reason: "excluded", label: () => "Left out by you", note: "Buyers, suppliers or types chosen in Filters." },
];
/**
 * Why the filters leave awards out, each counted over every published award
 * (an award can be left out for more than one reason). The row for the
 * person's own exclusions shows only while there are some.
 */
export function leftOut(all: Award[], input: Partial<MarketFilters>, today: string) {
  const filters = { ...defaultFilters, ...input };
  return LEFT_OUT.filter((item) => item.reason !== "excluded" || !!filters.exclude?.length).map((item) => {
    const test = leftOutTest(item.reason, filters, today);
    return { reason: item.reason, label: item.label(filters), count: all.filter(test).length, note: item.note };
  });
}

const sum = (rows: Award[]) => rows.reduce((n, r) => n + (r.value ?? 0), 0);
const positive = (rows: Award[]) => rows.reduce((n, r) => n + Math.max(0, r.value ?? 0), 0);

export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), p = (sorted.length - 1) * q, base = Math.floor(p);
  return sorted[base] + (sorted[Math.ceil(p)] - sorted[base]) * (p - base);
}

type Dimension = "buyer" | "supplier" | "type";
function groups(rows: Award[], dimension: Dimension) {
  const result = new Map<string, Award[]>();
  for (const r of rows) { const key = r[dimension]; const bucket = result.get(key); if (bucket) bucket.push(r); else result.set(key, [r]); }
  return result;
}

/** One row per buyer, supplier or type, largest recorded value first. Shares and dependence use positive values only. */
export function rank(rows: Award[], dimension: Dimension) {
  const total = positive(rows);
  return [...groups(rows, dimension)].map(([name, records]) => {
    const counterparties = groups(records, dimension === "supplier" ? "buyer" : "supplier");
    const leading = [...counterparties].map(([party, items]) => ({ name: party, value: positive(items) })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))[0];
    const value = sum(records), positiveValue = positive(records);
    return {
      name, count: records.length, value, positiveValue, share: total > 0 ? positiveValue / total : 0,
      median: quantile(records.flatMap((r) => (r.value === null ? [] : [r.value])), 0.5), counterparties: counterparties.size,
      dependence: positiveValue > 0 ? (leading?.value ?? 0) / positiveValue : null, leading: leading?.name ?? "",
    };
  }).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}
export type Ranked = ReturnType<typeof rank>[number];

export function overview(rows: Award[]) {
  const suppliers = rank(rows, "supplier"), buyers = rank(rows, "buyer"), types = rank(rows, "type");
  const values = rows.flatMap((r) => (r.value === null ? [] : [r.value]));
  const positiveTotal = positive(rows);
  const sortedSuppliers = [...suppliers].sort((a, b) => b.positiveValue - a.positiveValue || a.name.localeCompare(b.name));
  let cumulative = 0, suppliersFor80: number | null = null;
  const pareto = sortedSuppliers.map((r, i) => {
    cumulative += r.positiveValue;
    const share = positiveTotal ? cumulative / positiveTotal : 0;
    if (positiveTotal > 0 && suppliersFor80 === null && share >= 0.8) suppliersFor80 = i + 1;
    return { rank: i + 1, share: Math.min(100, share * 100), name: r.name };
  });
  // Preserve the endpoints and key early ranks while bounding rendered marks.
  const step = Math.max(1, Math.ceil(pareto.length / 80));
  return {
    count: rows.length, value: sum(rows), valuedCount: values.length, positiveTotal, median: quantile(values, 0.5), q1: quantile(values, 0.25), q3: quantile(values, 0.75),
    buyerCount: buyers.length, supplierCount: suppliers.length, top10Share: sortedSuppliers.slice(0, 10).reduce((n, r) => n + r.share, 0), suppliersFor80,
    suppliers, buyers, types, pareto: pareto.filter((_, i) => i < 10 || i % step === 0 || i === pareto.length - 1 || i + 1 === suppliersFor80),
  };
}

/**
 * The commodity codes the awards are classified under, for the analysis's
 * commodity filter: how many awards carry any (`classified`; none means the
 * filter has nothing to narrow) and how many fall under each code and its
 * ancestors, as [code, awards] pairs in code order.
 */
export function commodityChoices(rows: Award[]) {
  const classified = rows.flatMap((row) => (row.commodities?.length ? [row.commodities] : []));
  return { classified: classified.length, codes: [...unspscCounts(classified)].sort(([a], [b]) => (a < b ? -1 : 1)) };
}

const QUALITY_FLAGS: QualityFlag[] = ["currency", "future", "undated", "placeholder", "value", "negative", "zero", "contract", "justification", "mapping"];
/** The choices for the filters and the data-quality counts, over every award regardless of filters. */
export function metadata(rows: Award[], today: string) {
  const distinct = (key: "buyer" | "supplier" | "type" | "currencyCode") => [...new Set(rows.map((r) => r[key]))].sort((a, b) => a.localeCompare(b));
  const dates = rows.flatMap((r) => (r.date ? [r.date] : [])).sort();
  return {
    count: rows.length, buyers: distinct("buyer"), suppliers: distinct("supplier"), types: distinct("type"), currencies: distinct("currencyCode"),
    firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null, years: [...new Set(dates.map((d) => d.slice(0, 4)))].reverse(),
    quality: QUALITY_FLAGS.map((flag) => ({ flag, count: rows.filter((r) => qualityMatch(r, flag, today)).length })),
    unavailable: { contractNumber: rows.filter(row => row.contractNumber === null).length, justification: rows.filter(row => row.justification === null).length },
    commodities: commodityChoices(rows),
  };
}

export function trends(rows: Award[], year: string, today: string) {
  const yearNumber = Number(year || today.slice(0, 4));
  if (!Number.isInteger(yearNumber) || yearNumber < 1900 || yearNumber > 2200) throw new Error("Choose a valid heatmap year.");
  const buckets = new Map<string, Award[]>();
  for (const r of rows) if (r.date) { const month = r.date.slice(0, 7); const bucket = buckets.get(month); if (bucket) bucket.push(r); else buckets.set(month, [r]); }
  const dates = [...buckets.keys()].sort();
  const series: { month: string; value: number; count: number }[] = [];
  if (dates.length) {
    const cursor = new Date(`${dates[0]}-01T00:00:00Z`);
    const end = dates.at(-1)!;
    // At most 301 years; source dates outside this range remain in the records list.
    while (cursor.toISOString().slice(0, 7) <= end && series.length < 3612) {
      const month = cursor.toISOString().slice(0, 7), bucket = buckets.get(month) ?? [];
      series.push({ month, value: sum(bucket), count: bucket.length }); cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  const yearRows = rows.filter((r) => r.date?.startsWith(`${yearNumber}-`));
  const buyers = rank(yearRows, "buyer").slice(0, 10);
  const months = Array.from({ length: 12 }, (_, i) => `${yearNumber}-${String(i + 1).padStart(2, "0")}`);
  const cells = buyers.flatMap((buyer) => months.map((month) => {
    const bucket = yearRows.filter((r) => r.buyer === buyer.name && r.date?.startsWith(month));
    return { row: buyer.name, column: month, count: bucket.length, value: sum(bucket), slice: { buyer: buyer.name, month } as Slice };
  }));
  return { series, months, buyers, cells, undated: rows.filter((r) => !r.date).length, year: String(yearNumber), shownCount: cells.reduce((n, c) => n + c.count, 0), yearCount: yearRows.length };
}

/** Calendar years, oldest first, from the monthly series (Zoer's chart has no yearly view; this is the same sums). */
export function yearly(series: ReturnType<typeof trends>["series"]) {
  const years = new Map<string, { year: string; value: number; count: number }>();
  for (const row of series) {
    const year = row.month.slice(0, 4);
    const bucket = years.get(year) ?? { year, value: 0, count: 0 };
    bucket.value += row.value; bucket.count += row.count;
    years.set(year, bucket);
  }
  return [...years.values()];
}

type MonthRow = { month: string; value: number; count: number };
/**
 * The monthly series as a table reads best: recent months one by one, and a
 * long, mostly empty stretch at the start (a source's first scattered
 * records, years of zeros) folded into one "earlier" row that still counts
 * and sums every award in it. At least `keep` months always show; nothing
 * folds unless a year or more of it is at least half empty and holds at
 * most a fifth of the awards; and the fold stops where the busy months
 * begin rather than taking the first of them.
 */
export function foldEarlyMonths<T extends MonthRow>(series: T[], keep = 24): { shown: T[]; earlier: { from: string; to: string; months: number; count: number; value: number } | null } {
  const total = series.reduce((n, row) => n + row.count, 0);
  let fold = 0;
  for (let k = series.length - keep, prefix = series.slice(0, Math.max(0, k)), empty = prefix.filter((row) => !row.count).length, awards = prefix.reduce((n, row) => n + row.count, 0); k >= 12; k--) {
    if (empty / k >= 0.5 && awards <= total / 5) { fold = k; break; }
    if (!series[k - 1].count) empty--;
    awards -= series[k - 1].count;
  }
  // Back out of a busy stretch (five of six months with awards), then off any months with awards at its edge.
  while (fold >= 12 && series.slice(fold - 6, fold).filter((row) => row.count).length >= 5) fold--;
  while (fold >= 12 && series[fold - 1].count) fold--;
  if (fold < 12) return { shown: series, earlier: null };
  const folded = series.slice(0, fold);
  return {
    shown: series.slice(fold),
    earlier: { from: folded[0].month, to: folded[fold - 1].month, months: fold, count: folded.reduce((n, row) => n + row.count, 0), value: folded.reduce((n, row) => n + row.value, 0) },
  };
}

export function distribution(rows: Award[]) {
  const edges = [0, 10000, 50000, 100000, 250000, 500000, 1000000, 5000000, 10000000, Infinity];
  const names = ["Under 10k", "10k–50k", "50k–100k", "100k–250k", "250k–500k", "500k–1m", "1m–5m", "5m–10m", "10m and above"];
  const bins = [
    { label: "Negative values", slice: { max: 0 } as Slice }, { label: "Zero", slice: { exact: 0 } as Slice },
    ...names.map((name, i) => ({ label: name, slice: { min: i === 0 ? Number.MIN_VALUE : edges[i], ...(Number.isFinite(edges[i + 1]) ? { max: edges[i + 1] } : {}) } as Slice })),
  ].map((bin) => { const bucket = sliceAwards(rows, bin.slice, "9999-12-31"); return { ...bin, count: bucket.length, value: sum(bucket) }; });
  const values = rows.flatMap((r) => (r.value === null ? [] : [r.value]));
  return {
    bins, count: rows.length, known: values.length, missing: rows.length - values.length, median: quantile(values, 0.5), q1: quantile(values, 0.25), q3: quantile(values, 0.75),
    max: values.length ? values.reduce((max, value) => Math.max(max, value), -Infinity) : null,
  };
}

export function matrix(rows: Award[], dimension: "supplier" | "type") {
  const buyers = rank(rows, "buyer").slice(0, 10), columns = rank(rows, dimension).slice(0, 10);
  // One pass instead of Zoer's filter per cell: the same sums, without 100 scans of 20,000 awards.
  const index = new Map<string, Award[]>();
  for (const r of rows) { const key = JSON.stringify([r.buyer, r[dimension]]); const bucket = index.get(key); if (bucket) bucket.push(r); else index.set(key, [r]); }
  const cells = buyers.flatMap((buyer) => columns.map((column) => {
    const bucket = index.get(JSON.stringify([buyer.name, column.name])) ?? [];
    return { row: buyer.name, column: column.name, count: bucket.length, value: sum(bucket), slice: { buyer: buyer.name, [dimension]: column.name } as Slice };
  }));
  return {
    rows: buyers.map((r) => r.name), columns: columns.map((r) => r.name), cells,
    shownCount: cells.reduce((n, c) => n + c.count, 0), totalCount: rows.length, buyerCount: new Set(rows.map((r) => r.buyer)).size, columnCount: new Set(rows.map((r) => r[dimension])).size,
  };
}

export type Overview = ReturnType<typeof overview>;
export type Metadata = ReturnType<typeof metadata>;
export type Trends = ReturnType<typeof trends>;
export type Distribution = ReturnType<typeof distribution>;
export type Matrix = ReturnType<typeof matrix>;

/** How each quality flag affects the figures (Zoer's wording). */
export const QUALITY_LABELS: Record<QualityFlag, string> = {
  currency: "Currency not stated", future: "Future-dated awards", undated: "Missing or invalid dates", placeholder: "Placeholder suppliers",
  value: "Missing or invalid values", negative: "Negative values", zero: "Zero values",
  contract: "Missing contract numbers", justification: "Missing justifications", mapping: "Buyer mapping needs review",
};
export const QUALITY_DETAILS: Record<QualityFlag, string> = {
  currency: "Excluded from CAD totals; choose “Not stated” under Currency to see their values separately.",
  future: "Excluded by default. Dates may need source verification.",
  undated: "Included in all-time totals but absent from dated trends.",
  placeholder: "Unknown or migrated supplier names; excluded by default.",
  value: "Counted as records; omitted from value statistics.",
  negative: "Included in net totals; excluded from positive-value concentration.",
  zero: "Included in counts and size statistics.",
  contract: "Counted only where the publication supplied the contract-number field.",
  justification: "Counted only where the publication supplied the justification field.",
  mapping: "No canonical buyer mapping, or the source marks it for review.",
};

// ---------------------------------------------------------------------------
// Formatting (Zoer's `dashboard/market/charts.tsx`): award values are whole
// currency units, not cents, and currencies are never converted.

export const count = (n: number) => n.toLocaleString("en-CA");
/** "1 award", "2 awards": a count with its noun in the right number. */
export const counted = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;
export const percent = (n: number | null) => (n === null ? "—" : new Intl.NumberFormat("en-CA", { style: "percent", maximumFractionDigits: 1 }).format(n));
export function money(n: number | null, currency: string, compact = false): string {
  if (n === null) return "—";
  try {
    if (currency !== "UNSPECIFIED") return new Intl.NumberFormat("en-CA", { style: "currency", currency, notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : 0 }).format(n);
  } catch { /* Preserve an unfamiliar source currency label. */ }
  return `${new Intl.NumberFormat("en-CA", { notation: compact ? "compact" : "standard", maximumFractionDigits: 1 }).format(n)} ${currency === "UNSPECIFIED" ? "units" : currency}`;
}
export const compact = (n: number) => new Intl.NumberFormat("en-CA", { notation: "compact", maximumFractionDigits: 1 }).format(n);
