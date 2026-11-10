/**
 * The BC Bid facts an opportunity list can be narrowed by (its type, industry,
 * region, commodity code and pre-2023 type). They are source facts kept in the
 * URL, not table columns, but a reviewer filters by them in the same place as
 * everything else: a section of the table's filter editor (drafted there and
 * applied with its Apply), a pill each in the active-filter row, and a share
 * of the Filter button's count.
 */
import { Select } from "../../../components/Select";
import { Field } from "../../../components/ui";
import current from "../data/bc-bid-current-types.json";
import reference from "../data/bc-bid-filter-reference.json";
import historical from "../data/bc-bid-historical-types.json";
import { BC_FILTER_KEYS, type BcBidSourceFilters } from "../../../../shared/bcBidSourceFilters";

type FilterKey = (typeof BC_FILTER_KEYS)[number];
type Option = { value: string; label: string };

const HISTORICAL_PREFIX = "reference-term:BCBID:historical-type:";
/** "April 2015 – December 2022", from the reference file's own range. */
const HISTORICAL_SPAN = [historical.from, historical.to]
  .map((day) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" }))
  .join(" – ");

const TYPE_OPTIONS: Option[] = current.types.map((type) => ({ value: type.code, label: type.title }));
const INDUSTRY_OPTIONS: Option[] = reference.industryCategories.map((category) => ({ value: category.title, label: category.title }));
/** Two places share a name (Cariboo is an economic region and a regional district), so each says which it is. */
const REGION_LEVELS: Record<string, string> = { "economic-region": "economic region", "regional-district": "regional district" };
const REGION_OPTIONS: Option[] = reference.regions.map((region) => ({
  value: region.code,
  label: REGION_LEVELS[region.level] ? `${region.title} (${REGION_LEVELS[region.level]})` : region.title,
}));
const HISTORICAL_OPTIONS: Option[] = historical.types.map((type) => ({ value: `${HISTORICAL_PREFIX}${type.code}`, label: type.title }));

const labelOf = (options: Option[], value: string) => options.find((option) => option.value === value)?.label ?? value;

export const isCommodityCode = (value: string) => /^\d{8}$/.test(value);

/** The filters in force, worded like the table's own pills ("Status is Open"). */
export function bcBidFilterChips(filters: BcBidSourceFilters): { key: FilterKey; label: string }[] {
  const chips: { key: FilterKey; label: string }[] = [];
  if (filters.currentType) chips.push({ key: "currentType", label: `Type is ${labelOf(TYPE_OPTIONS, filters.currentType)}` });
  if (filters.industryCategory) chips.push({ key: "industryCategory", label: `Industry is ${filters.industryCategory}` });
  if (filters.officialRegion) chips.push({ key: "officialRegion", label: `Region is ${labelOf(REGION_OPTIONS, filters.officialRegion)}` });
  if (filters.commodityCode) chips.push({ key: "commodityCode", label: `Commodity is ${filters.commodityCode}` });
  if (filters.historicalType) chips.push({ key: "historicalType", label: `Pre-2023 type is ${labelOf(HISTORICAL_OPTIONS, filters.historicalType)}` });
  return chips;
}

/** The URL change that puts a draft in force; `null` clears a filter. Give no draft to clear them all. */
export function bcBidFilterPatch(draft: BcBidSourceFilters = {}): Record<FilterKey, string | null> {
  const patch = {} as Record<FilterKey, string | null>;
  for (const key of BC_FILTER_KEYS) patch[key] = draft[key] || null;
  return patch;
}

/**
 * The filter editor's BC Bid section. `value` is a draft: nothing applies
 * until the editor's Apply. `codeInvalid` marks a commodity code that isn't
 * eight digits (checked on Apply).
 */
export function BcBidFilterFields({
  value,
  onChange,
  codeInvalid,
}: {
  value: BcBidSourceFilters;
  onChange: (next: BcBidSourceFilters) => void;
  codeInvalid: boolean;
}) {
  const set = (key: FilterKey, next: string) => {
    const draft = { ...value };
    if (next) draft[key] = next;
    else delete draft[key];
    onChange(draft);
  };
  const select = (key: FilterKey, label: string, options: Option[], hint?: string) => (
    <Field label={label} hint={hint}>
      <Select
        value={value[key] ?? ""}
        onChange={(next) => set(key, next)}
        options={options}
        placeholder="Any"
        clearable
        clearLabel="Any"
        searchable={options.length > 8}
      />
    </Field>
  );
  return (
    <section className="procurement-source-filters" aria-labelledby="procurement-source-filters-title">
      <div className="procurement-source-filters__head">
        <strong id="procurement-source-filters-title">BC Bid details</strong>
        <span>Shows only BC Bid notices that state the detail you pick.</span>
      </div>
      <div className="procurement-source-filters__grid">
        {select("currentType", "Opportunity type", TYPE_OPTIONS)}
        {select("industryCategory", "Industry", INDUSTRY_OPTIONS)}
        {select("officialRegion", "Region", REGION_OPTIONS)}
        <Field
          label="Commodity code (UNSPSC)"
          hint={codeInvalid ? undefined : "A segment, family or class code includes everything under it."}
          error={codeInvalid ? "Enter all eight digits, such as 72000000." : undefined}
        >
          <input
            className="input"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            placeholder="Such as 72000000"
            value={value.commodityCode ?? ""}
            onChange={(event) => set("commodityCode", event.target.value.replace(/\D/g, ""))}
          />
        </Field>
        {select("historicalType", "Pre-2023 opportunity type", HISTORICAL_OPTIONS, `For notices from ${HISTORICAL_SPAN}. Picking one shows all statuses.`)}
      </div>
    </section>
  );
}
