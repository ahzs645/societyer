import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useFilteredRecords } from "../hooks/useFilteredRecords";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
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
  const columns = useRecordTableState((state) => state.columns);
  const visibleColumns = useMemo(() => columns.filter((column) => column.isVisible), [columns]);
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
          />
        ))}
        <td className="record-table__footer-cell record-table__fill-cell" />
        {hasRowActions && <td className="record-table__footer-cell record-table__row-actions-cell" />}
    </tr>
  );
}

function RecordTableAggregateFooterCell({
  column,
  records,
  recordCount,
  isFirst,
}: {
  column: RecordField;
  records: any[];
  recordCount: number;
  isFirst: boolean;
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
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
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
      className="record-table__footer-cell"
      style={{ width: column.size, minWidth: column.size }}
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
          <span>{value || (isFirst ? `${recordCount} records` : "Calculate")}</span>
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
