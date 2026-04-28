import { useMemo } from "react";
import { useFilteredRecords } from "../hooks/useFilteredRecords";
import { useRecordTableState } from "../state/recordTableStore";
import { aggregateRecordValues } from "../utils/aggregateOperations";

export function RecordTableAggregateFooter({
  selectable,
  hasRowActions,
}: {
  selectable: boolean;
  hasRowActions: boolean;
}) {
  const columns = useRecordTableState((state) => state.columns);
  const visibleColumns = useMemo(() => columns.filter((column) => column.isVisible), [columns]);
  const filteredRecords = useFilteredRecords();

  if (filteredRecords.length === 0 || visibleColumns.length === 0) return null;

  return (
    <tfoot className="record-table__tfoot">
      <tr className="record-table__footer-row">
        {selectable && <td className="record-table__footer-cell record-table__checkbox-cell" />}
        {visibleColumns.map((column, index) => (
          <td
            key={column.viewFieldId}
            className="record-table__footer-cell"
            style={{ width: column.size, minWidth: column.size }}
          >
            {index === 0 ? `${filteredRecords.length} records` : aggregateRecordValues({ column, records: filteredRecords })}
          </td>
        ))}
        {hasRowActions && <td className="record-table__footer-cell record-table__row-actions-cell" />}
      </tr>
    </tfoot>
  );
}
