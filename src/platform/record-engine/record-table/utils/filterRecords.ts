import { FIELD_TYPES, type FieldType, type SelectOption } from "../../types/FieldType";
import type { FieldMetadata } from "../../types/FieldMetadata";
import type { RecordField, ViewFilter, ViewFilterGroup, ViewFilterOperator } from "../../types/View";
import { compileViewFilters } from "./viewFilterGroups";
import { isDateInRange, isDateRangeValue, resolveDateRange, type DateRangeContext } from "../../../../lib/dateRanges";
import { todayDateOnly } from "../../../../../shared/dateOnly";
import { recordCellText } from "./recordCellText";

const TEXT_OPERATORS = new Set<ViewFilterOperator>([
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
]);

/** A record as the filters read it: field values by name. */
type FilterableRecord = Record<string, unknown>;
export type RecordPredicate = (record: FilterableRecord) => boolean;

/**
 * Field types whose "is" / "is any of" compare the text a person sees,
 * case-insensitively. Values picked from the distinct-value list (see
 * distinctFieldValues) match these exactly.
 */
const TEXT_EQUALITY_TYPES = new Set<FieldType>([
  FIELD_TYPES.TEXT,
  FIELD_TYPES.EMAIL,
  FIELD_TYPES.PHONE,
  FIELD_TYPES.LINK,
  FIELD_TYPES.UUID,
  FIELD_TYPES.ARRAY,
  FIELD_TYPES.RICH_TEXT,
]);

export function filterRecords<T extends object>({
  records,
  columns,
  filters,
  filterGroups,
  searchTerm,
  dateContext,
}: {
  records: T[];
  columns: RecordField[];
  filters: ViewFilter[];
  filterGroups?: ViewFilterGroup[];
  searchTerm?: string;
  /** Organisation calendar for relative date-range filters. */
  dateContext?: DateRangeContext;
}): T[] {
  const query = searchTerm?.trim().toLowerCase() ?? "";
  if (filters.length === 0 && !query) return records;
  // Filters are compiled once (field lookups, date ranges, option labels),
  // not re-derived for every record.
  const matches = filters.length > 0 ? compileViewFilters({ columns, filters, filterGroups, dateContext }) : null;
  const searchFields = query ? columns.map((column) => column.field) : [];

  return records.filter((record) => {
    const row = record as FilterableRecord;
    if (matches && !matches(row)) return false;
    if (!query) return true;
    return recordSearchText(row, searchFields).includes(query);
  });
}

/* ------------------------------ search text ------------------------------ */

/**
 * Field objects get a small id so a search corpus can be cached per set of
 * fields: resizing or reordering columns keeps the field objects (and the
 * cache); new metadata (renamed options) brings new ones.
 */
const fieldIds = new WeakMap<FieldMetadata, number>();
let nextFieldId = 0;
const searchTextCaches = new Map<string, WeakMap<object, string>>();
const SEARCH_CACHE_LIMIT = 16;

function fieldsSignature(fields: FieldMetadata[]) {
  return fields
    .map((field) => {
      let id = fieldIds.get(field);
      if (id === undefined) {
        id = nextFieldId += 1;
        fieldIds.set(field, id);
      }
      return id;
    })
    .join(",");
}

/**
 * What the quick search looks in, lower-cased: every field as its cell reads
 * (option labels and relation names, not stored keys or ids), stored option
 * keys as well, and an adapter's `_searchText`. Built once per record object;
 * an edited record is a new object and gets a fresh entry.
 */
export function recordSearchText(record: FilterableRecord, fields: FieldMetadata[]): string {
  const signature = fieldsSignature(fields);
  let cache = searchTextCaches.get(signature);
  if (!cache) {
    if (searchTextCaches.size >= SEARCH_CACHE_LIMIT) {
      const oldest = searchTextCaches.keys().next().value;
      if (oldest !== undefined) searchTextCaches.delete(oldest);
    }
    cache = new WeakMap();
    searchTextCaches.set(signature, cache);
  }
  const cached = cache.get(record);
  if (cached !== undefined) return cached;
  const parts: string[] = [];
  // Adapters can opt into a richer search corpus for display-only joins or
  // fields that are not columns in the active view.
  const extra = getSearchableValue(record._searchText, FIELD_TYPES.TEXT);
  if (extra) parts.push(extra);
  for (const field of fields) {
    const value = record[field.name];
    if (isEmptyValue(value)) continue;
    parts.push(recordCellText(field, value, record));
    if (field.fieldType === FIELD_TYPES.SELECT || field.fieldType === FIELD_TYPES.MULTI_SELECT) {
      parts.push(getSearchableValue(value, field.fieldType));
    }
  }
  const text = parts.join("\n").toLowerCase();
  cache.set(record, text);
  return text;
}

/* -------------------------------- filters -------------------------------- */

export function applyRecordFilter(
  record: FilterableRecord,
  column: RecordField | undefined,
  filter: ViewFilter,
  dateContext?: DateRangeContext,
): boolean {
  return compileRecordFilter(column, filter, dateContext)(record);
}

const matchAll: RecordPredicate = () => true;

/**
 * One condition as a predicate. Everything that does not depend on the
 * record (the date range, lower-cased text, option keys a typed label stands
 * for) is worked out here, once.
 */
export function compileRecordFilter(
  column: RecordField | undefined,
  filter: ViewFilter,
  dateContext?: DateRangeContext,
): RecordPredicate {
  if (!column) return matchAll;
  const field = column.field;
  const name = field.name;
  const fieldType = field.fieldType;
  const target = filter.value;

  switch (filter.operator) {
    case "isEmpty":
      return (record) => isEmptyValue(record[name]);
    case "isNotEmpty":
      return (record) => !isEmptyValue(record[name]);
    case "isTrue":
      return (record) => coerceBoolean(record[name]) === true;
    case "isFalse":
      return (record) => coerceBoolean(record[name]) === false;
    case "between": {
      if (!isDateRangeValue(target)) return matchAll;
      const range = resolveDateRange(target, dateContext ?? { today: todayDateOnly() });
      // A range that cannot resolve (e.g. a fiscal preset with no fiscal year
      // end recorded) does not hide records.
      if (!range || (!range.start && !range.end)) return matchAll;
      return (record) => isDateInRange(record[name], range);
    }
    default:
      break;
  }

  if (TEXT_OPERATORS.has(filter.operator)) {
    const expected = String(target ?? "").toLowerCase();
    const texts = (record: FilterableRecord) => matchTexts(field, record);
    switch (filter.operator) {
      case "contains":
        return (record) => texts(record).some((text) => text.includes(expected));
      case "notContains":
        return (record) => !texts(record).some((text) => text.includes(expected));
      case "startsWith":
        return (record) => texts(record).some((text) => text.startsWith(expected));
      default:
        return (record) => texts(record).some((text) => text.endsWith(expected));
    }
  }

  if (filter.operator === "in" || filter.operator === "notIn" || filter.operator === "eq" || filter.operator === "neq") {
    const candidates = Array.isArray(target) ? target : [target];
    const matches = compileEquality(field, candidates);
    return filter.operator === "in" || filter.operator === "eq" ? matches : (record) => !matches(record);
  }

  const compare = (record: FilterableRecord) => {
    const value = record[name];
    // An empty value is neither above nor below anything.
    return isEmptyValue(value) ? null : compareFieldValues(value, target, fieldType);
  };
  switch (filter.operator) {
    case "gt":
      return (record) => (compare(record) ?? 0) > 0;
    case "gte":
      return (record) => { const c = compare(record); return c !== null && c >= 0; };
    case "lt":
      return (record) => (compare(record) ?? 0) < 0;
    case "lte":
      return (record) => { const c = compare(record); return c !== null && c <= 0; };
    default:
      return matchAll;
  }
}

/** Lower-cased texts a text condition looks in: what the cell shows, and stored keys for options. */
function matchTexts(field: FieldMetadata, record: FilterableRecord): string[] {
  const value = record[field.name];
  if (field.fieldType === FIELD_TYPES.RELATION) {
    // A relation stores ids; text conditions match its display label.
    const label = record[`${field.name}Label`];
    return [getSearchableValue(label ?? value, field.fieldType).toLowerCase()];
  }
  if (field.fieldType === FIELD_TYPES.SELECT || field.fieldType === FIELD_TYPES.MULTI_SELECT) {
    if (isEmptyValue(value)) return [""];
    return [recordCellText(field, value, record).toLowerCase(), getSearchableValue(value, field.fieldType).toLowerCase()];
  }
  return [getSearchableValue(value, field.fieldType).toLowerCase()];
}

/**
 * "is" / "is any of". Options match by key or by label (a header filter
 * types the label), relations by id or display name, text-like fields by
 * their text regardless of case; numbers, dates and the rest compare by
 * type.
 */
function compileEquality(field: FieldMetadata, candidates: unknown[]): RecordPredicate {
  const name = field.name;
  const fieldType = field.fieldType;
  const options = Array.isArray(field.config?.options) ? (field.config.options as SelectOption[]) : [];

  if (options.length > 0) {
    const byLabel = new Map(options.map((option) => [String(option.label ?? option.value).toLowerCase(), String(option.value)]));
    const keys = new Set(
      candidates.map((candidate) => {
        const text = String(candidate ?? "");
        return options.some((option) => String(option.value) === text) ? text : byLabel.get(text.toLowerCase()) ?? text;
      }),
    );
    return (record) => {
      const value = record[name];
      return Array.isArray(value) ? value.some((entry) => keys.has(String(entry))) : keys.has(String(value ?? ""));
    };
  }

  if (fieldType === FIELD_TYPES.RELATION) {
    const labels = new Set(candidates.map((candidate) => getSearchableValue(candidate, fieldType).toLowerCase()));
    return (record) => {
      const value = record[name];
      if (candidates.some((candidate) => valuesEqual(value, candidate, fieldType))) return true;
      const label = record[`${name}Label`];
      return label != null && labels.has(String(label).toLowerCase());
    };
  }

  if (TEXT_EQUALITY_TYPES.has(fieldType)) {
    const wanted = new Set(candidates.map((candidate) => getSearchableValue(candidate, fieldType).trim().toLowerCase()));
    return (record) => {
      const value = record[name];
      if (Array.isArray(value)) return value.some((entry) => wanted.has(getSearchableValue(entry, fieldType).trim().toLowerCase()));
      return wanted.has(getSearchableValue(value, fieldType).trim().toLowerCase());
    };
  }

  return (record) => candidates.some((candidate) => valuesEqual(record[name], candidate, fieldType));
}

export function isEmptyValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function getSearchableValue(value: unknown, fieldType: FieldType): string {
  if (isEmptyValue(value)) return "";
  if (Array.isArray(value)) {
    return value.map((item) => getSearchableValue(item, fieldType)).join(" ");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return String(record.label ?? record.name ?? record.title ?? record._id ?? record.id ?? "");
  }
  return String(value);
}

export function compareFieldValues(a: unknown, b: unknown, fieldType: FieldType): number {
  if (isEmptyValue(a) && isEmptyValue(b)) return 0;
  if (isEmptyValue(a)) return -1;
  if (isEmptyValue(b)) return 1;

  if (
    fieldType === FIELD_TYPES.NUMBER ||
    fieldType === FIELD_TYPES.CURRENCY ||
    fieldType === FIELD_TYPES.RATING
  ) {
    return Number(a) - Number(b);
  }

  if (fieldType === FIELD_TYPES.DATE || fieldType === FIELD_TYPES.DATE_TIME) {
    const aTime = Date.parse(String(a));
    const bTime = Date.parse(String(b));
    if (Number.isFinite(aTime) && Number.isFinite(bTime)) return aTime - bTime;
  }

  const aBool = coerceBoolean(a);
  const bBool = coerceBoolean(b);
  if (typeof aBool === "boolean" && typeof bBool === "boolean") {
    return aBool === bBool ? 0 : aBool ? 1 : -1;
  }

  return textCollator.compare(getSearchableValue(a, fieldType), getSearchableValue(b, fieldType));
}

const textCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function valuesEqual(a: unknown, b: unknown, fieldType: FieldType): boolean {
  if (Array.isArray(a)) return a.some((item) => valuesEqual(item, b, fieldType));
  if (Array.isArray(b)) return b.some((item) => valuesEqual(a, item, fieldType));
  return compareFieldValues(a, b, fieldType) === 0;
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return undefined;
}
