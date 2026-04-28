import { useState } from "react";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { FIELD_TYPES, type ViewFilterOperator } from "../../types";
import { Select } from "@/components/Select";

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
  const filters = useRecordTableState((s) => s.filters);
  const filterGroups = useRecordTableState((s) => s.filterGroups);
  const handle = useRecordTableStoreHandle();

  const [fieldId, setFieldId] = useState<string>("");
  const [operator, setOperator] = useState<ViewFilterOperator>("contains");
  const [value, setValue] = useState<string>("");
  const rootLogicalOperator = filterGroups.find((group) => !group.parentViewFilterGroupId)?.logicalOperator ?? "and";

  if (!open) return null;
  const selectedColumn = columns.find((c) => c.fieldMetadataId === fieldId);
  const availableOps =
    (selectedColumn && DEFAULT_OPERATORS[selectedColumn.field.fieldType]) ?? ["contains"];

  const add = () => {
    if (!selectedColumn) return;
    const existingRoot = filterGroups.find((group) => !group.parentViewFilterGroupId);
    const rootGroup = existingRoot ?? {
      id: `fg_${Date.now()}`,
      logicalOperator: rootLogicalOperator,
      parentViewFilterGroupId: null,
      positionInViewFilterGroup: 0,
    };
    const normalizedGroups = existingRoot
      ? filterGroups
      : [rootGroup, ...filterGroups];
    const filter = {
      id: `f_${Date.now()}`,
      fieldMetadataId: selectedColumn.fieldMetadataId,
      operator,
      value: VALUELESS.includes(operator)
        ? null
        : selectedColumn.field.fieldType === FIELD_TYPES.NUMBER ||
            selectedColumn.field.fieldType === FIELD_TYPES.CURRENCY ||
            selectedColumn.field.fieldType === FIELD_TYPES.RATING
          ? Number(value)
          : value,
      viewFilterGroupId: rootGroup.id,
      positionInViewFilterGroup: filters.length,
    };
    handle.set({
      filterGroups: normalizedGroups,
      filters: [
        ...filters.map((entry, index) =>
          entry.viewFilterGroupId
            ? entry
            : {
                ...entry,
                viewFilterGroupId: rootGroup.id,
                positionInViewFilterGroup: index,
              },
        ),
        filter,
      ],
    });
    setFieldId("");
    setOperator("contains");
    setValue("");
    onClose();
  };

  return (
    <div className="record-table__filter-popover">
      <div className="record-table__popover-head">
        <strong>Advanced filters</strong>
        <select
          className="record-table__menu-select"
          style={{ width: 140 }}
          value={rootLogicalOperator}
          onChange={(event) => {
            const logicalOperator = event.target.value as "and" | "or";
            const root = filterGroups.find((group) => !group.parentViewFilterGroupId);
            if (root) {
              handle.get().setFilterGroups(
                filterGroups.map((group) =>
                  group.id === root.id ? { ...group, logicalOperator } : group,
                ),
              );
              return;
            }
            if (filters.length > 0) {
              const rootId = `fg_${Date.now()}`;
              handle.set({
                filterGroups: [{ id: rootId, logicalOperator, parentViewFilterGroupId: null }],
                filters: filters.map((entry, index) => ({
                  ...entry,
                  viewFilterGroupId: rootId,
                  positionInViewFilterGroup: index,
                })),
              });
            }
          }}
        >
          <option value="and">Match all</option>
          <option value="or">Match any</option>
        </select>
      </div>
      <div className="record-table__filter-popover-row">
        <Select
          size="sm"
          placeholder="Choose field…"
          value={fieldId}
          onChange={(v) => {
            setFieldId(v);
            const c = columns.find((x) => x.fieldMetadataId === v);
            if (c) {
              const ops = DEFAULT_OPERATORS[c.field.fieldType] ?? [];
              setOperator(ops[0] ?? "contains");
            }
          }}
          options={columns.map((c) => ({ value: c.fieldMetadataId, label: c.field.label }))}
          searchable={columns.length > 6}
        />
        <Select
          size="sm"
          value={operator}
          onChange={(v) => setOperator(v as ViewFilterOperator)}
          options={availableOps.map((op) => ({ value: op, label: OPERATOR_LABELS[op] }))}
          disabled={!selectedColumn}
        />
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
