import { type ReactNode, useMemo } from "react";
import { GripVertical, MoreHorizontal, PanelRightOpen } from "lucide-react";
import { Menu, type MenuSection } from "../../../../components/Menu";
import { RecordTableRowContext } from "../contexts/RecordTableRowContext";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { RecordTableCell } from "./RecordTableCell";
import type { RecordTableCellRenderer } from "./RecordTable";
import { useFilteredRecords } from "../hooks/useFilteredRecords";

export function RecordTableRow({
  record,
  rowIndex,
  selectable,
  showDragHandle = false,
  renderRowActions,
  rowMenuSections,
  showOpenRecordAction = false,
  renderCell,
}: {
  record: any;
  rowIndex: number;
  selectable: boolean;
  showDragHandle?: boolean;
  renderRowActions?: (record: any) => ReactNode;
  /** Menu sections rendered behind a trailing "…" kebab (and, via
   * RecordTable, on row right-click). */
  rowMenuSections?: (record: any) => MenuSection[];
  showOpenRecordAction?: boolean;
  renderCell?: RecordTableCellRenderer;
}) {
  const { objectMetadata, onRecordClick, onReorder } = useRecordTableContextOrThrow();
  const columns = useRecordTableState((s) => s.columns);
  const isSelected = useRecordTableState((s) =>
    s.selectedRecordIds.has(String(record._id)),
  );
  const handle = useRecordTableStoreHandle();
  const filteredRecords = useFilteredRecords();

  const visibleColumns = useMemo(() => columns.filter((c) => c.isVisible), [columns]);
  const recordId = String(record._id);

  const toggleRow = (extendRange = false) => {
    const next = new Set(handle.get().selectedRecordIds);
    if (extendRange) {
      const anchor = handle.get().selectionAnchorRowIndex ?? rowIndex;
      const start = Math.min(anchor, rowIndex);
      const end = Math.max(anchor, rowIndex);
      for (let index = start; index <= end; index += 1) {
        const rangeRecord = filteredRecords[index];
        if (rangeRecord?._id) next.add(String(rangeRecord._id));
      }
      handle.get().setSelectedRecordIds(next);
      return;
    }
    if (next.has(recordId)) next.delete(recordId);
    else next.add(recordId);
    handle.get().setSelectedRecordIds(next);
    handle.get().setSelectionAnchorRowIndex(rowIndex);
  };

  const rowValue = useMemo(
    () => ({ record, recordId, rowIndex }),
    [record, recordId, rowIndex],
  );

  return (
    <RecordTableRowContext.Provider value={rowValue}>
      {showDragHandle && (
        <td
          className="record-table__drag-cell"
          onDragOver={(event) => {
            if (!onReorder) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            if (!onReorder) return;
            event.preventDefault();
            const draggedRecordId = event.dataTransfer.getData("text/plain");
            if (!draggedRecordId || draggedRecordId === recordId) return;
            const orderedIds = filteredRecords.map((item) => String(item._id));
            const fromIndex = orderedIds.indexOf(draggedRecordId);
            if (fromIndex < 0) return;
            orderedIds.splice(fromIndex, 1);
            orderedIds.splice(rowIndex, 0, draggedRecordId);
            void onReorder(orderedIds);
          }}
        >
          <button
            type="button"
            className="record-table__drag-grip"
            title="Reorder row"
            aria-label={`Reorder ${objectMetadata.labelSingular.toLowerCase()}`}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", recordId);
            }}
          >
            <GripVertical size={13} />
          </button>
        </td>
      )}
      {selectable && (
        <td className="record-table__checkbox-cell">
          <input
            type="checkbox"
            aria-label={isSelected ? "Deselect row" : "Select row"}
            checked={isSelected}
            onChange={(event) =>
              toggleRow((event.nativeEvent as MouseEvent).shiftKey)
            }
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
          renderCell={renderCell}
        />
      ))}
      <td className="record-table__fill-cell" aria-hidden="true" />
      {(showOpenRecordAction || renderRowActions || rowMenuSections) && (
        <td
          className="record-table__row-actions-cell"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="record-table__row-actions">
            {showOpenRecordAction && onRecordClick && (
              <button
                type="button"
                className="btn btn--ghost btn--sm btn--icon record-table__open-record"
                aria-label={`Preview ${objectMetadata.labelSingular ?? "record"} in sidebar`}
                title="Preview in sidebar"
                onClick={() => onRecordClick(recordId, record, { openRecordIn: "drawer" })}
              >
                <PanelRightOpen size={12} />
              </button>
            )}
            {renderRowActions?.(record)}
            {rowMenuSections && (
              <Menu
                align="right"
                minWidth={180}
                sections={rowMenuSections(record)}
                trigger={
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm btn--icon"
                    aria-label={`Actions for this ${objectMetadata.labelSingular?.toLowerCase() ?? "record"}`}
                    // Focusing this button can nudge the table's scroll
                    // container (focus scroll-into-view), and the menu
                    // dismisses itself on scroll — so the first click would
                    // open-then-instantly-close the menu.
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                }
              />
            )}
          </div>
        </td>
      )}
    </RecordTableRowContext.Provider>
  );
}
