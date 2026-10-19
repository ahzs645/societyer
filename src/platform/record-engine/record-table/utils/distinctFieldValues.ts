import { FIELD_TYPES, type FieldType } from "../../types/FieldType";
import type { FieldMetadata } from "../../types/FieldMetadata";
import { getSearchableValue, isEmptyValue } from "./filterRecords";
import { naturalTextCollator } from "./sortRecords";

/** One value found in a column, with how many records carry it. */
export type DistinctFieldValue = {
  /** What a filter stores: the text itself (relations: the display name). */
  value: string;
  label: string;
  count: number;
  /** Lower-cased label, for searching the list. */
  search: string;
};

/** Free-text fields whose filters offer the values found in the records. */
const VALUE_PICKER_TYPES = new Set<FieldType>([
  FIELD_TYPES.TEXT,
  FIELD_TYPES.EMAIL,
  FIELD_TYPES.PHONE,
  FIELD_TYPES.LINK,
  FIELD_TYPES.UUID,
  FIELD_TYPES.ARRAY,
  FIELD_TYPES.RELATION,
]);

/**
 * Whether a field's filter offers a list of the values in the records. Fields
 * with an option list (selects) offer their options instead.
 */
export function supportsValuePicker(field: FieldMetadata | undefined): boolean {
  if (!field) return false;
  if (Array.isArray(field.config?.options) && field.config.options.length > 0) return false;
  return VALUE_PICKER_TYPES.has(field.fieldType)
    || field.fieldType === FIELD_TYPES.SELECT
    || field.fieldType === FIELD_TYPES.MULTI_SELECT;
}

/**
 * The distinct values of one field across `records`, most common first (then
 * A→Z). Values that differ only in case count as one, under the first
 * spelling met; the filters compare them the same way. List fields count each
 * entry. One pass, so 25,000 records with thousands of values stay quick.
 */
export function distinctFieldValues(records: readonly object[], field: FieldMetadata): DistinctFieldValue[] {
  const byKey = new Map<string, DistinctFieldValue>();
  const add = (raw: unknown) => {
    const label = getSearchableValue(raw, field.fieldType).trim();
    if (!label) return;
    const key = label.toLowerCase();
    const existing = byKey.get(key);
    if (existing) existing.count += 1;
    else byKey.set(key, { value: label, label, count: 1, search: key });
  };
  for (const record of records) {
    const row = record as Record<string, unknown>;
    const value = row[field.name];
    if (field.fieldType === FIELD_TYPES.RELATION) {
      // A relation stores ids; people pick (and filters match) its display name.
      const label = row[`${field.name}Label`];
      add(label !== undefined && label !== null && label !== "" ? label : value);
      continue;
    }
    if (isEmptyValue(value)) continue;
    if (Array.isArray(value)) {
      // An entry listed twice on one record still counts that record once.
      new Set(value.map((entry) => getSearchableValue(entry, field.fieldType).trim())).forEach(add);
      continue;
    }
    add(value);
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || naturalTextCollator.compare(a.label, b.label));
}

/**
 * The values matching a search (anywhere in the label), capped at `limit`
 * so a list of thousands renders a screenful. `matched` counts them all.
 */
export function searchDistinctValues(
  values: readonly DistinctFieldValue[],
  query: string,
  limit: number,
): { shown: DistinctFieldValue[]; matched: number } {
  const needle = query.trim().toLowerCase();
  if (!needle) return { shown: values.slice(0, limit), matched: values.length };
  const shown: DistinctFieldValue[] = [];
  let matched = 0;
  for (const value of values) {
    if (!value.search.includes(needle)) continue;
    matched += 1;
    if (shown.length < limit) shown.push(value);
  }
  return { shown, matched };
}
