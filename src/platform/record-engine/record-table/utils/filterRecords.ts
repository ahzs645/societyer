import { FIELD_TYPES, type FieldType } from "../../types/FieldType";
import type { RecordField, ViewFilter, ViewFilterGroup, ViewFilterOperator } from "../../types/View";
import { recordMatchesViewFilters } from "./viewFilterGroups";

const TEXT_OPERATORS = new Set<ViewFilterOperator>([
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
]);

export function filterRecords({
  records,
  columns,
  filters,
  filterGroups,
  searchTerm,
}: {
  records: any[];
  columns: RecordField[];
  filters: ViewFilter[];
  filterGroups?: ViewFilterGroup[];
  searchTerm?: string;
}) {
  const query = searchTerm?.trim().toLowerCase() ?? "";

  return records.filter((record) => {
    if (
      filters.length > 0 &&
      !recordMatchesViewFilters({ record, columns, filters, filterGroups })
    ) {
      return false;
    }

    if (!query) return true;
    return columns.some((column) => {
      const value = getSearchableValue(record[column.field.name], column.field.fieldType);
      return value.toLowerCase().includes(query);
    });
  });
}

export function applyRecordFilter(
  record: any,
  column: RecordField | undefined,
  filter: ViewFilter,
): boolean {
  if (!column) return true;

  const value = record[column.field.name];
  const target = filter.value;
  const fieldType = column.field.fieldType;

  if (filter.operator === "isEmpty") return isEmptyValue(value);
  if (filter.operator === "isNotEmpty") return !isEmptyValue(value);
  if (filter.operator === "isTrue") return coerceBoolean(value) === true;
  if (filter.operator === "isFalse") return coerceBoolean(value) === false;

  if (TEXT_OPERATORS.has(filter.operator)) {
    const actual = getSearchableValue(value, fieldType).toLowerCase();
    const expected = String(target ?? "").toLowerCase();
    if (filter.operator === "contains") return actual.includes(expected);
    if (filter.operator === "notContains") return !actual.includes(expected);
    if (filter.operator === "startsWith") return actual.startsWith(expected);
    if (filter.operator === "endsWith") return actual.endsWith(expected);
  }

  if (filter.operator === "in" || filter.operator === "notIn") {
    const candidates = Array.isArray(target) ? target : [target];
    const matched = candidates.some((candidate) => valuesEqual(value, candidate, fieldType));
    return filter.operator === "in" ? matched : !matched;
  }

  const comparison = compareFieldValues(value, target, fieldType);
  switch (filter.operator) {
    case "eq":
      return valuesEqual(value, target, fieldType);
    case "neq":
      return !valuesEqual(value, target, fieldType);
    case "gt":
      return comparison > 0;
    case "gte":
      return comparison >= 0;
    case "lt":
      return comparison < 0;
    case "lte":
      return comparison <= 0;
    default:
      return true;
  }
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

  return getSearchableValue(a, fieldType).localeCompare(
    getSearchableValue(b, fieldType),
    undefined,
    { numeric: true, sensitivity: "base" },
  );
}

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
