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
/** "previous-minutes" / "NeedsReview" / "needs_review" → "Previous minutes" / "Needs review". Free text is left alone. */
function humanizeToken(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || /^\d+$/.test(value)) return value;
  const words = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function RecordTableFilterChips() {
  const filters = useRecordTableState((s) => s.filters);
  const columns = useRecordTableState((s) => s.columns);
  const handle = useRecordTableStoreHandle();

  if (filters.length === 0) return null;

  const labelFor = (f: ViewFilter) => {
    const col = columns.find((c) => c.fieldMetadataId === f.fieldMetadataId);
    const field = col?.field.label ?? "Unknown";
    // Show option labels ("Needs review"), not stored values ("NeedsReview").
    const options = (col?.field.config as { options?: { value: string; label: string }[] } | undefined)?.options ?? [];
    const display = (value: unknown) => options.find((option) => option.value === value)?.label ?? humanizeToken(String(value ?? ""));
    if (f.operator === "isTrue") return field;
    if (f.operator === "isFalse") return `Not ${field.charAt(0).toLowerCase()}${field.slice(1)}`;
    if (f.operator === "isEmpty" || f.operator === "isNotEmpty") return `${field} ${OPERATOR_LABELS[f.operator]}`;
    if (f.operator === "in" || f.operator === "notIn") {
      const values = (Array.isArray(f.value) ? f.value : [f.value]).map(display);
      return `${field} ${f.operator === "in" ? "is" : "is not"} ${values.join(" or ")}`;
    }
    return `${field} ${OPERATOR_LABELS[f.operator]} ${Array.isArray(f.value) ? f.value.map(display).join(", ") : display(f.value)}`;
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
