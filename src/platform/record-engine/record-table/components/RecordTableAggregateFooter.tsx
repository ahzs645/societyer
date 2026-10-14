import { useEffect, useRef, useState } from "react";
import { columnWidthStyle } from "../utils/columnWidth";
import { ChevronDown } from "lucide-react";
import { isOutsidePointerEvent } from "../../../../lib/floatingLayer";
import { pluralize } from "../../../../lib/format";
import { useFilteredRecords } from "../hooks/useFilteredRecords";
import { useRecordTableColumns } from "../hooks/useRecordTableColumns";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { useRecordTableStoreHandle } from "../state/recordTableStore";
import { FIELD_TYPES } from "../../types";
import {
  aggregateRecordValues,
  getAvailableAggregateOperationsForFieldType,
} from "../utils/aggregateOperations";
import type { AggregateOperation, RecordField } from "../../types";

const AGGREGATE_LABELS: Record<AggregateOperation, string> = {
  count: "Count all",
  countEmpty: "Count empty",
  countNotEmpty: "Count not empty",
  countUniqueValues: "Count unique",
  percentageEmpty: "Percent empty",
  percentageNotEmpty: "Percent not empty",
  sum: "Sum",
  avg: "Average",
  min: "Minimum",
  max: "Maximum",
};

export function RecordTableAggregateFooter({
  selectable,
  hasRowActions,
  showDragHandle = false,
}: {
  selectable: boolean;
  hasRowActions: boolean;
  showDragHandle?: boolean;
}) {
  return (
    <tfoot className="record-table__tfoot">
      <RecordTableAggregateFooterRow
        selectable={selectable}
        hasRowActions={hasRowActions}
        showDragHandle={showDragHandle}
      />
    </tfoot>
  );
}

export function RecordTableAggregateFooterRow({
  selectable,
  hasRowActions,
  showDragHandle = false,
}: {
  selectable: boolean;
  hasRowActions: boolean;
  showDragHandle?: boolean;
}) {
  const { objectMetadata } = useRecordTableContextOrThrow();
  const { columns: visibleColumns, collapsed } = useRecordTableColumns(objectMetadata.labelIdentifierFieldName);
  const filteredRecords = useFilteredRecords();

  if (filteredRecords.length === 0 || visibleColumns.length === 0) return null;

  return (
    <tr className="record-table__footer-row">
        {showDragHandle && <td className="record-table__footer-cell record-table__drag-cell" />}
        {selectable && <td className="record-table__footer-cell record-table__checkbox-cell" />}
        {visibleColumns.map((column, index) => (
          <RecordTableAggregateFooterCell
            key={column.viewFieldId}
            column={column}
            recordCount={filteredRecords.length}
            records={filteredRecords}
            isFirst={index === 0}
            collapsed={collapsed.has(column.viewFieldId)}
          />
        ))}
        {hasRowActions && <td className="record-table__footer-cell record-table__row-actions-cell" />}
        <td className="record-table__footer-cell record-table__fill-cell" />
    </tr>
  );
}

function RecordTableAggregateFooterCell({
  column,
  records,
  recordCount,
  isFirst,
  collapsed,
}: {
  column: RecordField;
  records: any[];
  recordCount: number;
  isFirst: boolean;
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const handle = useRecordTableStoreHandle();
  const operations = getAvailableAggregateOperationsForFieldType(column.field.fieldType);
  const value = column.aggregateOperation
    ? aggregateRecordValues({ column, records, operation: column.aggregateOperation })
    : "";

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
        return;
      }
      if (isOutsidePointerEvent(event, menuRef)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <td
      className={
        "record-table__footer-cell" +
        (column.field.fieldType === FIELD_TYPES.CURRENCY || column.field.fieldType === FIELD_TYPES.NUMBER
          ? " record-table__footer-cell--numeric"
          : "") +
        (collapsed ? " record-table__footer-cell--collapsed" : "")
      }
      style={columnWidthStyle(collapsed ? 0 : column.size)}
      aria-hidden={collapsed || undefined}
    >
      <div ref={menuRef} className="record-table__aggregate">
        <button
          type="button"
          className={
            "record-table__aggregate-trigger" +
            (!value && !isFirst ? " record-table__aggregate-trigger--empty" : "")
          }
          aria-label={`Calculate ${column.field.label}`}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span>{value || (isFirst ? pluralize(recordCount, "record") : "Calculate")}</span>
          <ChevronDown size={11} />
        </button>
        {open && (
          <div className="record-table__aggregate-menu">
            <button
              type="button"
              className={!column.aggregateOperation ? "is-active" : ""}
              onClick={() => {
                handle.get().setColumnAggregateOperation(column.viewFieldId, null);
                setOpen(false);
              }}
            >
              None
            </button>
            {operations.map((operation) => (
              <button
                key={operation}
                type="button"
                className={column.aggregateOperation === operation ? "is-active" : ""}
                onClick={() => {
                  handle.get().setColumnAggregateOperation(column.viewFieldId, operation);
                  setOpen(false);
                }}
              >
                {AGGREGATE_LABELS[operation]}
              </button>
            ))}
          </div>
        )}
      </div>
    </td>
  );
}
