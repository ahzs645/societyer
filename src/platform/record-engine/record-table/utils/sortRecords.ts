import { FIELD_TYPES } from "../../types/FieldType";
import type { FieldMetadata } from "../../types/FieldMetadata";
import type { RecordField, ViewSort } from "../../types/View";
import { isEmptyValue } from "./filterRecords";
import { recordCellText } from "./recordCellText";
import { isDateFieldType, isNumericFieldType } from "./filterValues";

/** A record's comparable value for one sort: a number, folded text, or nothing. */
type SortKey = number | string | null;

/**
 * Text order: case-insensitive and natural ("Item 2" before "Item 10").
 * One collator for every comparison; building it per call is the slow part
 * of `localeCompare`.
 */
export const naturalTextCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Sorts by the view's sort rules, by field type: numbers and amounts
 * numerically, dates chronologically, yes/no as no → yes, and everything
 * else by the text the cell shows (option labels, relation names) in natural
 * order. Empty values go last in both directions. Ties keep the incoming
 * order, so a second rule only breaks ties of the first.
 *
 * Each record's keys are read once (not once per comparison), which keeps
 * a 25,000-row sort well inside a frame budget.
 */
export function sortRecords<T extends object>({
  records,
  columns,
  sorts,
}: {
  records: T[];
  columns: RecordField[];
  sorts: ViewSort[];
}): T[] {
  if (sorts.length === 0 || records.length < 2) return records;

  const fieldById = new Map(columns.map((column) => [column.fieldMetadataId, column.field]));
  const rules = sorts.flatMap((sort) => {
    const field = fieldById.get(sort.fieldMetadataId);
    return field ? [{ field, sign: sort.direction === "desc" ? -1 : 1 }] : [];
  });
  if (rules.length === 0) return records;

  const entries = records.map((record, index) => ({
    record,
    index,
    keys: rules.map((rule) => sortKey(rule.field, record)),
  }));
  // A text column that is plain ASCII throughout (most are) compares folded
  // keys directly, several times faster than the collator and the same order
  // for letters and numbers. One non-ASCII value and the whole column uses
  // the collator, so every comparison in a sort agrees.
  const folded = rules.map((_, i) => entries.every((entry) => {
    const key = entry.keys[i];
    return typeof key !== "string" || ASCII.test(key);
  }));
  for (let i = 0; i < rules.length; i += 1) {
    if (!folded[i]) continue;
    for (const entry of entries) {
      const key = entry.keys[i];
      if (typeof key === "string") entry.keys[i] = foldAscii(key);
    }
  }
  entries.sort((a, b) => {
    for (let i = 0; i < rules.length; i += 1) {
      const comparison = compareSortKeys(a.keys[i], b.keys[i], rules[i].sign, folded[i]);
      if (comparison !== 0) return comparison;
    }
    return a.index - b.index;
  });
  return entries.map((entry) => entry.record);
}

const ASCII = /^[\x00-\x7f]*$/;

/** Lower-cased, with each run of digits zero-padded, so "item 9" sorts before "item 10" by plain comparison. */
function foldAscii(text: string): string {
  return text.toLowerCase().replace(/\d+/g, (digits) => {
    const trimmed = digits.replace(/^0+(?=\d)/, "");
    return trimmed.length > 20 ? trimmed : trimmed.padStart(20, "0");
  });
}

/** Empty keys last whatever the direction; otherwise `sign` flips the order. */
function compareSortKeys(a: SortKey, b: SortKey, sign: number, folded: boolean): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * sign;
  if (folded) return (a < b ? -1 : a > b ? 1 : 0) * sign;
  return naturalTextCollator.compare(String(a), String(b)) * sign;
}

export function sortKey(field: FieldMetadata, record: object): SortKey {
  const value = (record as Record<string, unknown>)[field.name];
  if (isEmptyValue(value)) return null;
  if (isNumericFieldType(field.fieldType)) return numericKey(value);
  if (isDateFieldType(field.fieldType)) return dateKey(value);
  if (field.fieldType === FIELD_TYPES.BOOLEAN) {
    if (value === true || value === "true" || value === 1 || value === "1") return 1;
    if (value === false || value === "false" || value === 0 || value === "0") return 0;
    return null;
  }
  const text = recordCellText(field, value, record).trim();
  return text === "" ? null : text;
}

function numericKey(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).replace(/[\s,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateKey(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  const time = Date.parse(String(value));
  return Number.isFinite(time) ? time : null;
}
