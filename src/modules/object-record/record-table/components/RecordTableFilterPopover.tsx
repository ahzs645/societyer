import { useState } from "react";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { FIELD_TYPES, type ViewFilterOperator } from "../../types";

const DEFAULT_OPERATORS: Record<string, ViewFilterOperator[]> = {
  [FIELD_TYPES.TEXT]: ["contains", "eq", "neq", "startsWith", "endsWith", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.EMAIL]: ["contains", "eq", "neq", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.PHONE]: ["contains", "eq", "neq", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.LINK]: ["contains", "eq", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.NUMBER]: ["eq", "neq", "gt", "gte", "lt", "lte", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.CURRENCY]: ["eq", "neq", "gt", "gte", "lt", "lte", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.RATING]: ["eq", "gt", "lt", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.BOOLEAN]: ["isTrue", "isFalse"],
  [FIELD_TYPES.DATE]: ["eq", "neq", "gt", "lt", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.DATE_TIME]: ["eq", "gt", "lt", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.SELECT]: ["eq", "neq", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.MULTI_SELECT]: ["contains", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.RELATION]: ["eq", "neq", "isEmpty", "isNotEmpty"],
  [FIELD_TYPES.UUID]: ["eq", "neq"],
  [FIELD_TYPES.ARRAY]: ["contains", "isEmpty", "isNotEmpty"],
};

const OPERATOR_LABELS: Record<ViewFilterOperator, string> = {
  eq: "is",
  neq: "is not",
  contains: "contains",
  notContains: "doesn't contain",
  startsWith: "starts with",
  endsWith: "ends with",
  gt: "greater than",
  gte: "≥",
  lt: "less than",
  lte: "≤",
  in: "in",
  notIn: "not in",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
  isTrue: "is true",
  isFalse: "is false",
};

const VALUELESS: ViewFilterOperator[] = ["isEmpty", "isNotEmpty", "isTrue", "isFalse"];

/**
 * Simple add-a-filter popover. Bind the `open` state from the parent
 * (RecordTableToolbar has a button that toggles it). Keep the render
 * conditional so the popover unmounts between opens and resets state.
 */
export function RecordTableFilterPopover({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const columns = useRecordTableState((s) => s.columns);
  const handle = useRecordTableStoreHandle();

  const [fieldId, setFieldId] = useState<string>("");
  const [operator, setOperator] = useState<ViewFilterOperator>("contains");
  const [value, setValue] = useState<string>("");

  if (!open) return null;
  const selectedColumn = columns.find((c) => c.fieldMetadataId === fieldId);
  const availableOps =
    (selectedColumn && DEFAULT_OPERATORS[selectedColumn.field.fieldType]) ?? ["contains"];

  const add = () => {
    if (!selectedColumn) return;
    const filter = {
      fieldMetadataId: selectedColumn.fieldMetadataId,
      operator,
      value: VALUELESS.includes(operator)
        ? null
        : selectedColumn.field.fieldType === FIELD_TYPES.NUMBER ||
            selectedColumn.field.fieldType === FIELD_TYPES.CURRENCY ||
            selectedColumn.field.fieldType === FIELD_TYPES.RATING
          ? Number(value)
          : value,
    };
    handle.set({ filters: [...handle.get().filters, filter] });
    setFieldId("");
    setOperator("contains");
    setValue("");
    onClose();
  };

  return (
    <div className="record-table__filter-popover">
      <div className="record-table__filter-popover-row">
        <select
          value={fieldId}
          onChange={(e) => {
            setFieldId(e.target.value);
            const c = columns.find((x) => x.fieldMetadataId === e.target.value);
            if (c) {
              const ops = DEFAULT_OPERATORS[c.field.fieldType] ?? [];
              setOperator(ops[0] ?? "contains");
            }
          }}
        >
          <option value="">Choose field…</option>
          {columns.map((c) => (
            <option key={c.fieldMetadataId} value={c.fieldMetadataId}>
              {c.field.label}
            </option>
          ))}
        </select>
        <select
          value={operator}
          onChange={(e) => setOperator(e.target.value as ViewFilterOperator)}
          disabled={!selectedColumn}
        >
          {availableOps.map((op) => (
            <option key={op} value={op}>
              {OPERATOR_LABELS[op]}
            </option>
          ))}
        </select>
        {!VALUELESS.includes(operator) && (
          <input
            type={
              selectedColumn?.field.fieldType === FIELD_TYPES.DATE
                ? "date"
                : selectedColumn?.field.fieldType === FIELD_TYPES.NUMBER ||
                    selectedColumn?.field.fieldType === FIELD_TYPES.CURRENCY ||
                    selectedColumn?.field.fieldType === FIELD_TYPES.RATING
                  ? "number"
                  : "text"
            }
            placeholder="Value…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
      </div>
      <div className="record-table__filter-popover-actions">
        <button type="button" className="record-table__secondary-btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="record-table__primary-btn"
          disabled={!selectedColumn}
          onClick={add}
        >
          Add filter
        </button>
      </div>
    </div>
  );
}
