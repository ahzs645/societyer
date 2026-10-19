import { FIELD_TYPES, type FieldType, type SelectOption } from "../../types/FieldType";
import type { RecordField, ViewGroup, ViewGroupBy, ViewGroupDateGranularity } from "../../types/View";
import { toCalendarDate } from "../../../../lib/dateRanges";
import { getSearchableValue, isEmptyValue } from "./filterRecords";
import { isNumericFieldType } from "./filterValues";

/** Key of the "No value" group; always ordered last. */
export const EMPTY_GROUP_KEY = "__empty__";
const GROUP_BY_ENTRY_ID = "group-by";

export type RecordGroup = {
  key: string;
  /** Plain-text label (also used for sorting and accessibility). */
  label: string;
  /** A raw value representative of the group, for the field's display renderer. */
  value: unknown;
  isEmpty: boolean;
  records: any[];
  /** Position in the field's option list, for "field order". */
  optionIndex: number;
};

const GROUPABLE_TYPES = new Set<FieldType>([
  FIELD_TYPES.SELECT,
  FIELD_TYPES.MULTI_SELECT,
  FIELD_TYPES.BOOLEAN,
  FIELD_TYPES.RELATION,
  FIELD_TYPES.DATE,
  FIELD_TYPES.DATE_TIME,
  FIELD_TYPES.TEXT,
  FIELD_TYPES.EMAIL,
  FIELD_TYPES.NUMBER,
  FIELD_TYPES.CURRENCY,
  FIELD_TYPES.RATING,
  FIELD_TYPES.UUID,
  FIELD_TYPES.ARRAY,
]);

export function isGroupableField(column: RecordField) {
  return column.field.config?.groupable !== false && GROUPABLE_TYPES.has(column.field.fieldType);
}

export function isDateGroupField(column: RecordField | undefined) {
  return column?.field.fieldType === FIELD_TYPES.DATE || column?.field.fieldType === FIELD_TYPES.DATE_TIME;
}

/** Whether a field has its own natural order (option list, yes/no). */
export function hasFieldOrder(column: RecordField | undefined) {
  if (!column) return false;
  return (
    column.field.fieldType === FIELD_TYPES.BOOLEAN ||
    (Array.isArray(column.field.config?.options) && column.field.config.options.length > 0)
  );
}

export function getViewGroupBy(viewGroups: ViewGroup[] | undefined): ViewGroupBy | null {
  const entry = viewGroups?.find((group) => group.groupBy?.fieldMetadataId);
  return entry?.groupBy ?? null;
}

/** Replace (or clear, with null) the group-by entry while keeping any per-value entries. */
export function withViewGroupBy(viewGroups: ViewGroup[] | undefined, groupBy: ViewGroupBy | null): ViewGroup[] {
  const rest = (viewGroups ?? []).filter((group) => !group.groupBy);
  if (!groupBy) return rest;
  return [
    { id: GROUP_BY_ENTRY_ID, fieldValue: "", position: -1, isVisible: true, groupBy },
    ...rest,
  ];
}

/** Default order when a field is first chosen: option order where it exists, dates newest first, else A→Z. */
export function defaultGroupBy(column: RecordField): ViewGroupBy {
  if (isDateGroupField(column)) {
    return { fieldMetadataId: column.fieldMetadataId, dateGranularity: "month", sort: "label", direction: "desc" };
  }
  return {
    fieldMetadataId: column.fieldMetadataId,
    sort: hasFieldOrder(column) ? "field" : "label",
    direction: "asc",
  };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function dateBucket(value: unknown, granularity: ViewGroupDateGranularity): { key: string; label: string } | null {
  const day = toCalendarDate(value);
  if (!day) return null;
  const [year, month, date] = day.split("-").map(Number);
  switch (granularity) {
    case "day":
      return { key: day, label: `${MONTHS[month - 1].slice(0, 3)} ${date}, ${year}` };
    case "quarter": {
      const quarter = Math.floor((month - 1) / 3) + 1;
      return { key: `${year}-Q${quarter}`, label: `Q${quarter} ${year}` };
    }
    case "year":
      return { key: String(year), label: String(year) };
    case "month":
    default:
      return { key: `${year}-${String(month).padStart(2, "0")}`, label: `${MONTHS[month - 1]} ${year}` };
  }
}

function firstValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value;
}

function bucketFor(record: any, column: RecordField, groupBy: ViewGroupBy): { key: string; label: string; value: unknown } {
  const field = column.field;
  const raw = record[field.name];
  if (isEmptyValue(raw)) return { key: EMPTY_GROUP_KEY, label: "No value", value: null };

  switch (field.fieldType) {
    case FIELD_TYPES.DATE:
    case FIELD_TYPES.DATE_TIME: {
      const bucket = dateBucket(raw, groupBy.dateGranularity ?? "month");
      return bucket ? { ...bucket, value: raw } : { key: EMPTY_GROUP_KEY, label: "No value", value: null };
    }
    case FIELD_TYPES.BOOLEAN: {
      const truthy = raw === true || raw === "true" || raw === 1 || raw === "1";
      return {
        key: truthy ? "true" : "false",
        label: truthy ? field.config?.trueLabel ?? "Yes" : field.config?.falseLabel ?? "No",
        value: truthy,
      };
    }
    case FIELD_TYPES.SELECT:
    case FIELD_TYPES.MULTI_SELECT: {
      // A multi-select record joins the group of its first value so every
      // record appears exactly once (selection and keyboard order stay simple).
      const value = firstValue(raw);
      if (isEmptyValue(value)) return { key: EMPTY_GROUP_KEY, label: "No value", value: null };
      const options = (field.config?.options ?? []) as SelectOption[];
      const option = options.find((entry) => String(entry.value) === String(value));
      return {
        key: String(value),
        label: option?.label ?? String(value),
        value: field.fieldType === FIELD_TYPES.MULTI_SELECT ? [value] : value,
      };
    }
    case FIELD_TYPES.RELATION: {
      const value = firstValue(raw);
      const id = value && typeof value === "object" ? String((value as any)._id ?? (value as any).id ?? getSearchableValue(value, field.fieldType)) : String(value);
      const label = record[`${field.name}Label`] ?? getSearchableValue(value, field.fieldType);
      return { key: id, label: String(label || id), value };
    }
    default: {
      const value = firstValue(raw);
      const label = getSearchableValue(value, field.fieldType).trim();
      if (!label) return { key: EMPTY_GROUP_KEY, label: "No value", value: null };
      return { key: field.fieldType === FIELD_TYPES.TEXT || field.fieldType === FIELD_TYPES.EMAIL ? label.toLowerCase() : label, label, value };
    }
  }
}

/** Sum of a numeric column across records (stored units). */
export function sumColumn(records: any[], column: RecordField | undefined): number {
  if (!column) return 0;
  let total = 0;
  for (const record of records) {
    const value = Number(record[column.field.name]);
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

/**
 * Split already filtered + sorted records into ordered groups. Records keep
 * their relative order inside each group, so the view's sort still applies.
 */
export function groupRecords({
  records,
  column,
  groupBy,
  columns,
}: {
  records: any[];
  column: RecordField;
  groupBy: ViewGroupBy;
  columns: RecordField[];
}): RecordGroup[] {
  const options = (column.field.config?.options ?? []) as SelectOption[];
  const byKey = new Map<string, RecordGroup>();
  for (const record of records) {
    const bucket = bucketFor(record, column, groupBy);
    let group = byKey.get(bucket.key);
    if (!group) {
      const optionIndex = column.field.fieldType === FIELD_TYPES.BOOLEAN
        ? (bucket.key === "true" ? 0 : 1)
        : options.findIndex((option) => String(option.value) === bucket.key);
      group = {
        key: bucket.key,
        label: bucket.label,
        value: bucket.value,
        isEmpty: bucket.key === EMPTY_GROUP_KEY,
        records: [],
        optionIndex: optionIndex < 0 ? Number.MAX_SAFE_INTEGER : optionIndex,
      };
      byKey.set(bucket.key, group);
    }
    group.records.push(record);
  }

  const groups = [...byKey.values()];
  const direction = groupBy.direction === "desc" ? -1 : 1;
  const sumColumnRef = groupBy.sort === "sum"
    ? columns.find((entry) => entry.fieldMetadataId === groupBy.sumFieldMetadataId)
    : undefined;
  const sums = sumColumnRef ? new Map(groups.map((group) => [group.key, sumColumn(group.records, sumColumnRef)])) : null;
  const numericKeys = isNumericFieldType(column.field.fieldType);
  const byLabel = (a: RecordGroup, b: RecordGroup) => {
    if (isDateGroupField(column)) return a.key.localeCompare(b.key);
    if (numericKeys) return Number(a.key) - Number(b.key);
    return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
  };
  const sort = groupBy.sort ?? (hasFieldOrder(column) ? "field" : "label");

  groups.sort((a, b) => {
    // "No value" always closes the list, whatever the order.
    if (a.isEmpty !== b.isEmpty) return a.isEmpty ? 1 : -1;
    let result = 0;
    if (sort === "count") result = a.records.length - b.records.length;
    else if (sort === "sum" && sums) result = (sums.get(a.key) ?? 0) - (sums.get(b.key) ?? 0);
    else if (sort === "field") result = a.optionIndex - b.optionIndex;
    if (result === 0 && sort !== "label") return byLabel(a, b);
    return (result || byLabel(a, b)) * direction;
  });
  return groups;
}
