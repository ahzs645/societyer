import { useMemo } from "react";
import { useRecordTableState } from "../state/recordTableStore";
import type { RecordField, ViewFilter, ViewSort } from "../../types";

/**
 * Takes the records from the store plus the active view's filter/sort/search
 * state and returns a derived list. All in-memory — good enough for a few
 * thousand rows, which is where RecordTable's virtualization kicks in anyway.
 */
export function useFilteredRecords() {
  const records = useRecordTableState((s) => s.records);
  const columns = useRecordTableState((s) => s.columns);
  const filters = useRecordTableState((s) => s.filters);
  const sorts = useRecordTableState((s) => s.sorts);
  const searchTerm = useRecordTableState((s) => s.searchTerm);

  return useMemo(() => {
    const fieldById = new Map(columns.map((c) => [c.fieldMetadataId, c]));
    let out = records;

    if (filters.length > 0) {
      out = out.filter((record) =>
        filters.every((f) => applyFilter(record, fieldById.get(f.fieldMetadataId), f)),
      );
    }

    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      out = out.filter((record) =>
        columns.some((col) => {
          const v = record[col.field.name];
          if (v == null) return false;
          return String(v).toLowerCase().includes(q);
        }),
      );
    }

    if (sorts.length > 0) {
      const sortables = sorts
        .map((s) => {
          const col = fieldById.get(s.fieldMetadataId);
          return col ? { col, dir: s.direction } : null;
        })
        .filter((x): x is { col: RecordField; dir: ViewSort["direction"] } => x !== null);
      out = [...out].sort((a, b) => {
        for (const { col, dir } of sortables) {
          const av = a[col.field.name];
          const bv = b[col.field.name];
          const cmp = compareValues(av, bv);
          if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
        }
        return 0;
      });
    }

    return out;
  }, [records, columns, filters, sorts, searchTerm]);
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") {
    return a === b ? 0 : a ? 1 : -1;
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function applyFilter(
  record: any,
  column: RecordField | undefined,
  filter: ViewFilter,
): boolean {
  if (!column) return true;
  const value = record[column.field.name];
  const target = filter.value;
  switch (filter.operator) {
    case "eq":
      return value === target;
    case "neq":
      return value !== target;
    case "contains":
      return value != null && String(value).toLowerCase().includes(String(target).toLowerCase());
    case "notContains":
      return value == null || !String(value).toLowerCase().includes(String(target).toLowerCase());
    case "startsWith":
      return value != null && String(value).toLowerCase().startsWith(String(target).toLowerCase());
    case "endsWith":
      return value != null && String(value).toLowerCase().endsWith(String(target).toLowerCase());
    case "gt":
      return value != null && Number(value) > Number(target);
    case "gte":
      return value != null && Number(value) >= Number(target);
    case "lt":
      return value != null && Number(value) < Number(target);
    case "lte":
      return value != null && Number(value) <= Number(target);
    case "in":
      return Array.isArray(target) && target.includes(value);
    case "notIn":
      return Array.isArray(target) && !target.includes(value);
    case "isEmpty":
      return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
    case "isNotEmpty":
      return !(value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0));
    case "isTrue":
      return value === true || value === "true" || value === 1 || value === "1";
    case "isFalse":
      return !(value === true || value === "true" || value === 1 || value === "1");
    default:
      return true;
  }
}
