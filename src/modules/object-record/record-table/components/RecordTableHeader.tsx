import { useMemo } from "react";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { RecordTableHeaderCell } from "./RecordTableHeaderCell";
import { useFilteredRecords } from "../hooks/useFilteredRecords";

/**
 * Header row. The selection checkbox reflects whether *all filtered rows*
 * are selected, and toggles them as a group.
 */
export function RecordTableHeader({
  selectable,
  hasRowActions = false,
}: {
  selectable: boolean;
  hasRowActions?: boolean;
}) {
  const columns = useRecordTableState((s) => s.columns);
  const selected = useRecordTableState((s) => s.selectedRecordIds);
  const handle = useRecordTableStoreHandle();
  const filtered = useFilteredRecords();

  const allSelected = useMemo(() => {
    if (filtered.length === 0) return false;
    return filtered.every((r: any) => selected.has(String(r._id)));
  }, [filtered, selected]);
  const someSelected = useMemo(() => {
    if (allSelected) return false;
    return filtered.some((r: any) => selected.has(String(r._id)));
  }, [filtered, selected, allSelected]);

  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) {
      filtered.forEach((r: any) => next.delete(String(r._id)));
    } else {
      filtered.forEach((r: any) => next.add(String(r._id)));
    }
    handle.get().setSelectedRecordIds(next);
  };

  const visibleColumns = columns.filter((c) => c.isVisible);

  return (
    <tr className="record-table__header-row">
      {selectable && (
        <th className="record-table__checkbox-cell" style={{ width: 36 }}>
          <input
            type="checkbox"
            aria-label={allSelected ? "Deselect all rows" : "Select all rows"}
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={toggleAll}
          />
        </th>
      )}
      {visibleColumns.map((column) => (
        <RecordTableHeaderCell key={column.viewFieldId} recordField={column} />
      ))}
      {hasRowActions && (
        <th className="record-table__row-actions-head" aria-hidden="true" />
      )}
    </tr>
  );
}
