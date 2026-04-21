import { type ReactNode, useMemo } from "react";
import { RecordTableRowContext } from "../contexts/RecordTableRowContext";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { RecordTableCell } from "./RecordTableCell";

export function RecordTableRow({
  record,
  rowIndex,
  selectable,
  renderRowActions,
}: {
  record: any;
  rowIndex: number;
  selectable: boolean;
  renderRowActions?: (record: any) => ReactNode;
}) {
  const { objectMetadata } = useRecordTableContextOrThrow();
  const columns = useRecordTableState((s) => s.columns);
  const isSelected = useRecordTableState((s) =>
    s.selectedRecordIds.has(String(record._id)),
  );
  const handle = useRecordTableStoreHandle();

  const visibleColumns = useMemo(() => columns.filter((c) => c.isVisible), [columns]);
  const recordId = String(record._id);

  const toggleRow = () => {
    const next = new Set(handle.get().selectedRecordIds);
    if (next.has(recordId)) next.delete(recordId);
    else next.add(recordId);
    handle.get().setSelectedRecordIds(next);
  };

  const rowValue = useMemo(
    () => ({ record, recordId, rowIndex }),
    [record, recordId, rowIndex],
  );

  return (
    <RecordTableRowContext.Provider value={rowValue}>
      {selectable && (
        <td className="record-table__checkbox-cell" style={{ width: 36 }}>
          <input
            type="checkbox"
            aria-label={isSelected ? "Deselect row" : "Select row"}
            checked={isSelected}
            onChange={toggleRow}
            onClick={(e) => e.stopPropagation()}
          />
        </td>
      )}
      {visibleColumns.map((column, idx) => (
        <RecordTableCell
          key={column.viewFieldId}
          recordField={column}
          columnIndex={idx}
          isLabelIdentifier={
            column.field.name === objectMetadata.labelIdentifierFieldName
          }
        />
      ))}
      {renderRowActions && (
        <td
          className="record-table__row-actions-cell"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="record-table__row-actions">
            {renderRowActions(record)}
          </div>
        </td>
      )}
    </RecordTableRowContext.Provider>
  );
}
