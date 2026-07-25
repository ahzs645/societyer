import { type ReactNode, useMemo } from "react";
import { GripVertical, MoreHorizontal, PanelRightOpen } from "lucide-react";
import { Menu, type MenuSection } from "../../../../components/Menu";
import { RecordTableRowContext } from "../contexts/RecordTableRowContext";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { RecordTableCell } from "./RecordTableCell";
import type { RecordTableCellRenderer } from "./RecordTable";

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
  const { objectMetadata, onRecordClick } = useRecordTableContextOrThrow();
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
      {showDragHandle && (
        <td className="record-table__drag-cell" aria-hidden="true">
          <span className="record-table__drag-grip" title="Row handle">
            <GripVertical size={13} />
          </span>
        </td>
      )}
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
          renderCell={renderCell}
        />
      ))}
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
                aria-label={`Open ${objectMetadata.labelSingular ?? "record"} details`}
                title={`Open ${objectMetadata.labelSingular ?? "record"} details`}
                onClick={() => onRecordClick(recordId, record)}
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
