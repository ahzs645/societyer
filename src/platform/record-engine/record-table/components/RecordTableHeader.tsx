import { useMemo } from "react";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { RecordTableHeaderCell } from "./RecordTableHeaderCell";
import { useFilteredRecords } from "../hooks/useFilteredRecords";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";

/**
 * Header row. The selection checkbox reflects whether *all filtered rows*
 * are selected, and toggles them as a group.
 */
export function RecordTableHeader({
  selectable,
  hasRowActions = false,
  showDragHandle = false,
}: {
  selectable: boolean;
  hasRowActions?: boolean;
  showDragHandle?: boolean;
}) {
  const columns = useRecordTableState((s) => s.columns);
  const selected = useRecordTableState((s) => s.selectedRecordIds);
  const handle = useRecordTableStoreHandle();
  const filtered = useFilteredRecords();
  const { objectMetadata } = useRecordTableContextOrThrow();

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
    handle.get().setSelectionAnchorRowIndex(null);
  };

  const visibleColumns = columns.filter((c) => c.isVisible);

  return (
    <tr className="record-table__header-row">
      {showDragHandle && <th className="record-table__drag-head" aria-hidden="true" />}
      {selectable && (
        <th className="record-table__checkbox-cell">
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
        <RecordTableHeaderCell
          key={column.viewFieldId}
          recordField={column}
          isLabelIdentifier={
            column.field.name === objectMetadata.labelIdentifierFieldName
          }
        />
      ))}
      <th className="record-table__fill-head" aria-hidden="true" />
      {hasRowActions && (
        <th className="record-table__row-actions-head" aria-hidden="true" />
      )}
    </tr>
  );
}
