import { X } from "lucide-react";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import type { ViewFilter, ViewFilterOperator } from "../../types";

const OPERATOR_LABELS: Record<ViewFilterOperator, string> = {
  eq: "is",
  neq: "is not",
  contains: "contains",
  notContains: "doesn't contain",
  startsWith: "starts with",
  endsWith: "ends with",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  in: "in",
  notIn: "not in",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
  isTrue: "is true",
  isFalse: "is false",
};

/**
 * Shows each active filter as a pill the user can dismiss. Lives just above
 * the table body.
 */
export function RecordTableFilterChips() {
  const filters = useRecordTableState((s) => s.filters);
  const columns = useRecordTableState((s) => s.columns);
  const handle = useRecordTableStoreHandle();

  if (filters.length === 0) return null;

  const labelFor = (f: ViewFilter) => {
    const col = columns.find((c) => c.fieldMetadataId === f.fieldMetadataId);
    const field = col?.field.label ?? "Unknown";
    const op = OPERATOR_LABELS[f.operator];
    const value =
      f.operator === "isEmpty" ||
      f.operator === "isNotEmpty" ||
      f.operator === "isTrue" ||
      f.operator === "isFalse"
        ? ""
        : ` ${Array.isArray(f.value) ? f.value.join(", ") : String(f.value ?? "")}`;
    return `${field} ${op}${value}`;
  };

  const remove = (f: ViewFilter) => {
    handle.set({
      filters: handle.get().filters.filter((x) => x !== f),
    });
  };

  return (
    <div className="record-table__chips">
      {filters.map((f, i) => (
        <span key={`${f.fieldMetadataId}-${i}`} className="record-table__chip">
          {labelFor(f)}
          <button
            type="button"
            className="record-table__chip-remove"
            onClick={() => remove(f)}
            aria-label="Remove filter"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <button
        type="button"
        className="record-table__chip-clear"
        onClick={() => handle.set({ filters: [] })}
      >
        Clear all
      </button>
    </div>
  );
}
