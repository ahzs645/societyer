/**
 * The BC Bid facts an opportunity list can be narrowed by (its type, industry,
 * region and commodity code). They are source facts kept in the URL, not
 * table columns, but a reviewer filters by them in the same place as
 * everything else: a section of the table's filter editor (drafted there and
 * applied with its Apply), a pill each in the active-filter row, and a share
 * of the Filter button's count.
 *
 * BC Bid renamed its types in 2023. One "Opportunity type" field covers both
 * eras: each current type also matches the pre-2023 types crosswalked to it
 * (shared/bcBidTypeCrosswalk.ts), and says which, so the mapping is in plain
 * sight rather than a hidden rule. Pre-2023 types with no current equivalent
 * follow, marked as such. The commodity code is picked from the UNSPSC
 * hierarchy in a dialog (filters/CommodityField.tsx).
 */
import { useMemo } from "react";
import { Select } from "../../../components/Select";
import { Field } from "../../../components/ui";
import current from "../data/bc-bid-current-types.json";
import reference from "../data/bc-bid-filter-reference.json";
import historical from "../data/bc-bid-historical-types.json";
import { BC_FILTER_KEYS, type BcBidFilterKey, type BcBidSourceFilters } from "../../../../shared/bcBidSourceFilters";
import { HISTORICAL_TYPE_PREFIX, currentTypeOf, historicalTypeCode, historicalTypesOf } from "../../../../shared/bcBidTypeCrosswalk";
import type { RecordTableExtraChip } from "../../../platform/record-engine/record-table/components/RecordTableFilterChips";
import type { ListRow } from "./source";
import { useReaderNavigation } from "./routes";
import { CommodityField } from "./filters/CommodityField";
import { useCommodityTitle } from "./commodity/titles";

type Option = { value: string; label: string; hint?: string; keywords?: string };

/** "April 2015 – December 2022", from the reference file's own range. */
const HISTORICAL_SPAN = [historical.from, historical.to]
  .map((day) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" }))
  .join(" – ");

const CURRENT_TITLES = new Map(current.types.map((type) => [type.code, type.title]));
const HISTORICAL_TITLES = new Map(historical.types.map((type) => [type.code, type.title]));

/** What else a current type matches: "Also pre-2023: this type, Request for Proposal (Short), …". */
function crosswalkHint(code: string): string {
  const matches = historicalTypesOf(code);
  if (!matches.length) return "No pre-2023 match";
  const others = matches.filter((match) => match.match === "close").map((match) => HISTORICAL_TITLES.get(match.code) ?? match.code);
  const exact = matches.length > others.length;
  if (!others.length) return "Also pre-2023 notices of this type";
  return `Also pre-2023: ${[...(exact ? ["this type"] : []), ...others].join(", ")}`;
}

/**
 * What the type search also finds a current type by: the pre-2023 names
 * crosswalked to it and the codes BC Bid uses, so "Quotation" finds
 * Invitation to Quote and "SRFP" finds Request for Proposal.
 */
function crosswalkKeywords(code: string): string {
  const matches = historicalTypesOf(code);
  return [code, ...matches.flatMap((match) => [match.code, HISTORICAL_TITLES.get(match.code) ?? ""])].filter(Boolean).join(" ");
}

/** Pre-2023 types without a current equivalent are picked by their reference id (`historicalType`). */
const PRE_2023 = "pre-2023:";
const TYPE_OPTIONS: Option[] = [
  ...current.types.map((type) => ({ value: type.code, label: type.title, hint: crosswalkHint(type.code), keywords: crosswalkKeywords(type.code) })),
  ...historical.types
    .filter((type) => !currentTypeOf(type.code))
    .map((type) => ({ value: PRE_2023 + type.code, label: type.title, hint: `Pre-2023 only (${HISTORICAL_SPAN})`, keywords: type.code })),
];
const INDUSTRY_OPTIONS: Option[] = reference.industryCategories.map((category) => ({ value: category.title, label: category.title }));
/** Two places share a name (Cariboo is an economic region and a regional district), so each says which it is. */
const REGION_LEVELS: Record<string, string> = { "economic-region": "economic region", "regional-district": "regional district" };
const REGION_OPTIONS: Option[] = reference.regions.map((region) => ({
  value: region.code,
  label: REGION_LEVELS[region.level] ? `${region.title} (${REGION_LEVELS[region.level]})` : region.title,
}));

const labelOf = (options: Option[], value: string) => options.find((option) => option.value === value)?.label ?? value;

export const isCommodityCode = (value: string) => /^\d{8}$/.test(value);

type Chip = {
  key: BcBidFilterKey;
  label: string;
  /** The URL change that removes it. */
  patch: Record<string, null>;
  /** The commodity filter's code, whose chip also opens the commodity's page. */
  commodity?: string;
};

/** The filters in force, worded like the table's own pills ("Status is Open"). */
export function bcBidFilterChips(filters: BcBidSourceFilters): Chip[] {
  const chips: Chip[] = [];
  if (filters.currentType) {
    const code = filters.currentType, included = historicalTypesOf(code);
    const era = !included.length ? "" : included.length === 1 && included[0].match === "exact"
      ? " (also pre-2023)"
      : ` (includes ${included.length} pre-2023 type${included.length === 1 ? "" : "s"})`;
    // An older link's crosswalked `historicalType` reads as this type; removing it clears that too.
    chips.push({ key: "currentType", label: `Type is ${CURRENT_TITLES.get(code) ?? code}${era}`, patch: filters.historicalType ? { currentType: null } : { currentType: null, historicalType: null } });
  }
  if (filters.industryCategory) chips.push({ key: "industryCategory", label: `Industry is ${filters.industryCategory}`, patch: { industryCategory: null } });
  if (filters.officialRegion) chips.push({ key: "officialRegion", label: `Region is ${labelOf(REGION_OPTIONS, filters.officialRegion)}`, patch: { officialRegion: null } });
  if (filters.commodityCode) chips.push({ key: "commodityCode", label: `Commodity is ${filters.commodityCode}`, patch: { commodityCode: null }, commodity: filters.commodityCode });
  if (filters.historicalType) {
    const code = historicalTypeCode(filters.historicalType) ?? filters.historicalType;
    chips.push({ key: "historicalType", label: `Type is ${HISTORICAL_TITLES.get(code) ?? code} (pre-2023)`, patch: { historicalType: null } });
  }
  return chips;
}

/**
 * The pills for the filters in force, for the table's chip row: each removes
 * its filter; the commodity's names the code's title (where the loaded rows,
 * the visit or the source's code list give it) and opens the commodity's page.
 */
export function useBcBidFilterChips(filters: BcBidSourceFilters, rows: readonly ListRow[]): RecordTableExtraChip[] {
  const { update, openCommodity, commodityHref } = useReaderNavigation();
  const code = filters.commodityCode ?? "";
  const title = useCommodityTitle(code, rows);
  const page = code ? commodityHref(code) : "";
  return useMemo(
    () =>
      bcBidFilterChips(filters).map(({ key, label, patch, commodity }) => ({
        key,
        label: commodity && title ? `${label} ${title}` : label,
        onRemove: () => update(patch),
        ...(commodity ? { link: { href: page, label: `Open the commodity page for ${commodity}`, onOpen: () => openCommodity(commodity) } } : {}),
      })),
    [filters, title, page, update, openCommodity],
  );
}

/** The URL change that puts a draft in force; `null` clears a filter. Give no draft to clear them all. */
export function bcBidFilterPatch(draft: BcBidSourceFilters = {}): Record<BcBidFilterKey, string | null> {
  const patch = {} as Record<BcBidFilterKey, string | null>;
  for (const key of BC_FILTER_KEYS) patch[key] = draft[key] || null;
  return patch;
}

/**
 * The filter editor's BC Bid section. `value` is a draft: nothing applies
 * until the editor's Apply. `rows` are the list's loaded notices, which the
 * commodity picker counts. `codeInvalid` marks a commodity code that isn't
 * eight digits (checked on Apply).
 */
export function BcBidFilterFields({
  value,
  onChange,
  codeInvalid,
  rows,
}: {
  value: BcBidSourceFilters;
  onChange: (next: BcBidSourceFilters) => void;
  codeInvalid: boolean;
  rows: readonly ListRow[];
}) {
  const set = (patch: BcBidSourceFilters) => {
    const draft = { ...value, ...patch };
    for (const key of BC_FILTER_KEYS) if (!draft[key]) delete draft[key];
    onChange(draft);
  };
  const select = (key: BcBidFilterKey, label: string, options: Option[]) => (
    <Field label={label}>
      <Select
        value={value[key] ?? ""}
        onChange={(next) => set({ [key]: next })}
        options={options}
        placeholder="Any"
        clearable
        clearLabel="Any"
        searchable={options.length > 8}
      />
    </Field>
  );
  const counting = useMemo(() => ({ of: "notices" as const, filters: value }), [value]);
  const historicalCode = historicalTypeCode(value.historicalType);
  const type = value.currentType ?? (historicalCode ? PRE_2023 + historicalCode : "");
  return (
    <section className="procurement-source-filters" aria-labelledby="procurement-source-filters-title">
      <div className="procurement-source-filters__head">
        <strong id="procurement-source-filters-title">BC Bid details</strong>
        <span>Shows only BC Bid notices that state the detail you pick.</span>
      </div>
      <div className="procurement-source-filters__grid">
        <Field
          label="Opportunity type"
          hint="Includes BC Bid's pre-2023 types. Those notices are all closed, so they show only in views with closed notices."
        >
          <Select
            value={type}
            onChange={(next) => set(next.startsWith(PRE_2023)
              ? { currentType: "", historicalType: HISTORICAL_TYPE_PREFIX + next.slice(PRE_2023.length) }
              : { currentType: next, historicalType: "" })}
            options={TYPE_OPTIONS}
            placeholder="Any"
            clearable
            clearLabel="Any"
            searchable
          />
        </Field>
        {select("industryCategory", "Industry", INDUSTRY_OPTIONS)}
        {select("officialRegion", "Region", REGION_OPTIONS)}
        <CommodityField
          value={value.commodityCode ?? ""}
          onChange={(code) => set({ commodityCode: code })}
          invalid={codeInvalid}
          rows={rows}
          counting={counting}
        />
      </div>
    </section>
  );
}
