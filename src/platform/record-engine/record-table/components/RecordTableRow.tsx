import { type HTMLAttributes, type MouseEvent as ReactMouseEvent, type ReactNode, useMemo, useRef, useState } from "react";
import { GripVertical, MoreHorizontal, PanelRightOpen } from "lucide-react";
import { Menu, type MenuItem, type MenuSection } from "../../../../components/Menu";
import { RecordTableRowContext } from "../contexts/RecordTableRowContext";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { RecordTableCell } from "./RecordTableCell";
import type { RecordTableCellRenderer } from "./RecordTable";
import { useRecordTableRowModel } from "../hooks/useRecordTableRowModel";
import { useRecordTableColumns } from "../hooks/useRecordTableColumns";
import { Tooltip } from "../../../../components/Tooltip";
import { useLongPress } from "../hooks/useLongPress";

/**
 * Class list for a record's `<tr>`: the base row class plus the new-row flash,
 * the "open in the preview panel" highlight and the selected state (whether
 * the checkbox sits in its own column or, on phones, in the identifier cell).
 * Shared by the plain and the virtualized body so both mark rows the same way.
 */
export function useRecordRowClassName(recordId: string | null) {
  const isFlashing = useRecordTableState((state) => recordId !== null && state.flashRecordIds.has(recordId));
  const isActive = useRecordTableState((state) => recordId !== null && state.panelRecordId === recordId);
  const isSelected = useRecordTableState((state) => recordId !== null && state.selectedRecordIds.has(recordId));
  return (
    "record-table__row" +
    (isFlashing ? " row-flash" : "") +
    (isActive ? " record-table__row--active" : "") +
    (isSelected ? " record-table__row--selected" : "")
  );
}

export function RecordTableRow({
  record,
  rowIndex,
  selectable,
  mobileSelectionMode = false,
  showDragHandle = false,
  renderRowActions,
  rowMenuSections,
  showOpenRecordAction = false,
  renderCell,
  longPressSelect = false,
}: {
  record: any;
  rowIndex: number;
  selectable: boolean;
  mobileSelectionMode?: boolean;
  showDragHandle?: boolean;
  renderRowActions?: (record: any) => ReactNode;
  /** Menu sections rendered behind a trailing "…" kebab (and, via
   * RecordTable, on row right-click). */
  rowMenuSections?: (record: any) => MenuSection[];
  showOpenRecordAction?: boolean;
  renderCell?: RecordTableCellRenderer;
  /** Touch: holding a finger on the row starts selection with this row. */
  longPressSelect?: boolean;
}) {
  const { objectMetadata, onRecordClick, onReorder } = useRecordTableContextOrThrow();
  const isSelected = useRecordTableState((s) =>
    s.selectedRecordIds.has(String(record._id)),
  );
  const handle = useRecordTableStoreHandle();
  const { records: rowRecords } = useRecordTableRowModel();
  const { columns: visibleColumns, collapsed } = useRecordTableColumns(objectMetadata.labelIdentifierFieldName);
  const recordId = String(record._id);

  const toggleRow = (extendRange = false) => {
    const next = new Set(handle.get().selectedRecordIds);
    if (extendRange) {
      const anchor = handle.get().selectionAnchorRowIndex ?? rowIndex;
      const start = Math.min(anchor, rowIndex);
      const end = Math.max(anchor, rowIndex);
      for (let index = start; index <= end; index += 1) {
        const rangeRecord = rowRecords[index];
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

  const longPress = useLongPress(longPressSelect ? () => {
    // Phones keep selection behind "Select records"; a long-press is the
    // shortcut into it, starting with the pressed row.
    if (handle.get().mobileSelectable) handle.get().setMobileSelectionMode(true);
    const next = new Set(handle.get().selectedRecordIds);
    next.add(recordId);
    handle.get().setSelectedRecordIds(next);
    handle.get().setSelectionAnchorRowIndex(rowIndex);
  } : undefined);
  const pressHandlers: Partial<HTMLAttributes<HTMLTableCellElement>> | undefined = longPressSelect || mobileSelectionMode
    ? {
        ...longPress,
        onClickCapture: (event: ReactMouseEvent<HTMLTableCellElement>) => {
          longPress.onClickCapture?.(event);
          if (event.isPropagationStopped() || !mobileSelectionMode) return;
          // While selecting on a phone a tap anywhere on a row ticks it,
          // rather than opening or editing it.
          if ((event.target as Element).closest(".record-table__mobile-selection-checkbox")) return;
          event.preventDefault();
          event.stopPropagation();
          toggleRow();
        },
      }
    : undefined;

  const actionsSourceRef = useRef<HTMLDivElement>(null);
  const recordName = recordDisplayName(record, objectMetadata.labelIdentifierFieldName)
    ?? `this ${objectMetadata.labelSingular?.toLowerCase() ?? "record"}`;

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
            const orderedIds = rowRecords.map((item) => String(item._id));
            const fromIndex = orderedIds.indexOf(draggedRecordId);
            if (fromIndex < 0) return;
            orderedIds.splice(fromIndex, 1);
            orderedIds.splice(rowIndex, 0, draggedRecordId);
            void onReorder(orderedIds);
          }}
        >
          <Tooltip content="Reorder row">
            <button
              type="button"
              className="record-table__drag-grip"
              aria-label={`Reorder ${objectMetadata.labelSingular.toLowerCase()}`}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", recordId);
              }}
            >
              <GripVertical size={13} />
            </button>
          </Tooltip>
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
          collapsed={collapsed.has(column.viewFieldId)}
          isLabelIdentifier={
            column.field.name === objectMetadata.labelIdentifierFieldName
          }
          selectionControl={mobileSelectionMode && idx === 0 ? (
            <label className="record-table__mobile-selection-checkbox"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}>
              <input type="checkbox" aria-label={isSelected ? "Deselect row" : "Select row"}
                checked={isSelected} onChange={() => toggleRow()} />
            </label>
          ) : undefined}
          renderCell={renderCell}
          pressHandlers={pressHandlers}
        />
      ))}
      {/* Actions come BEFORE the fill cell so they anchor to where the data
        * ends — on a wide monitor they sit next to the last column instead of
        * a screen-width away. While the table fits its frame the buttons show
        * inline; once it scrolls sideways RecordTable pins a narrow cell to
        * the right edge (`data-row-actions="pinned"` on the frame) where the
        * same actions open from one "Row actions" button instead. */}
      {(showOpenRecordAction || renderRowActions || rowMenuSections) && (
        <td
          className="record-table__row-actions-cell"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="record-table__row-actions" ref={actionsSourceRef}>
            {showOpenRecordAction && onRecordClick && (
              <Tooltip content="Preview in sidebar">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm btn--icon record-table__open-record"
                  aria-label={`Preview ${objectMetadata.labelSingular ?? "record"} in sidebar`}
                  data-row-action-label="Preview in sidebar"
                  onClick={() =>
                    onRecordClick(recordId, record, {
                      source: "action",
                      openRecordIn: "drawer",
                    })
                  }
                >
                  <PanelRightOpen size={12} />
                </button>
              </Tooltip>
            )}
            {renderRowActions?.(record)}
            {rowMenuSections && (
              <Menu
                align="right"
                minWidth={180}
                label={`Actions for ${recordName}`}
                sheetTitle={`Actions for ${recordName}`}
                sections={rowMenuSections(record)}
                trigger={
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm btn--icon"
                    data-row-actions-kebab=""
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
          <PinnedRowActionsMenu
            recordName={recordName}
            getSections={() => [
              { id: "row-actions", items: collectRowActionItems(actionsSourceRef.current, recordName) },
              ...(rowMenuSections?.(record) ?? []),
            ].filter((section) => section.items.length > 0)}
          />
        </td>
      )}
      <td className="record-table__fill-cell" aria-hidden="true" />
    </RecordTableRowContext.Provider>
  );
}

/** The record's name (its label identifier field), for labelling its actions. */
function recordDisplayName(record: any, fieldName: string | undefined): string | null {
  const value = fieldName ? record?.[fieldName] : undefined;
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") return String(value).trim() || null;
  if (typeof value === "object") {
    const parts = [value.firstName, value.lastName].filter(Boolean).join(" ");
    const name = value.label ?? value.name ?? value.title ?? (parts || undefined);
    return name ? String(name) : null;
  }
  return null;
}

/**
 * The row's inline actions (whatever `renderRowActions` drew, plus the
 * preview button) as menu items. They stay rendered, hidden, in the pinned
 * cell, so each item runs the real control's own click handler: pages keep
 * one definition of their actions and both layouts stay in step.
 */
function collectRowActionItems(source: HTMLElement | null, recordName: string): MenuItem[] {
  if (!source) return [];
  return Array.from(source.querySelectorAll<HTMLElement>("button, a[href]"))
    .filter((control) => !control.hasAttribute("data-row-actions-kebab"))
    .map((control, index) => {
      const text = control.textContent?.replace(/\s+/g, " ").trim();
      // Icon buttons are named for their record ("Edit Board template"); the
      // menu is already labelled with it, so the row reads "Edit".
      const ariaLabel = control.getAttribute("aria-label")?.trim();
      const shortAriaLabel = ariaLabel?.endsWith(` ${recordName}`)
        ? ariaLabel.slice(0, -recordName.length - 1).trim()
        : ariaLabel;
      const label = control.getAttribute("data-row-action-label") || text || shortAriaLabel || control.getAttribute("title") || "Action";
      const icon = control.querySelector("svg");
      return {
        id: `inline-${index}`,
        label,
        icon: icon ? <ClonedIcon icon={icon} /> : undefined,
        disabled: (control as HTMLButtonElement).disabled || control.getAttribute("aria-disabled") === "true",
        destructive: /^(delete|remove)\b/i.test(label),
        onSelect: () => control.click(),
      };
    });
}

/** A copy of an action button's icon for its menu row. */
function ClonedIcon({ icon }: { icon: SVGElement }) {
  return (
    <span
      className="record-table__row-action-icon"
      aria-hidden="true"
      ref={(node) => {
        if (node && !node.firstChild) node.appendChild(icon.cloneNode(true));
      }}
    />
  );
}

/**
 * The pinned cell's single "Row actions" button. Hidden by CSS until the
 * table is wider than its frame; then it is the way to every action of the
 * row, read from the hidden inline buttons each time it opens.
 */
function PinnedRowActionsMenu({
  recordName,
  getSections,
}: {
  recordName: string;
  getSections: () => MenuSection[];
}) {
  const [sections, setSections] = useState<MenuSection[]>([]);
  return (
    <Menu
      align="right"
      minWidth={200}
      label={`Actions for ${recordName}`}
      sheetTitle={`Actions for ${recordName}`}
      sections={sections}
      trigger={
        <button
          type="button"
          className="btn btn--ghost btn--sm btn--icon record-table__row-actions-more"
          aria-label={`Row actions for ${recordName}`}
          // Same as the kebab above: no focus scroll on press, which would
          // dismiss the menu that this click opens.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setSections(getSections())}
        >
          <MoreHorizontal size={14} />
        </button>
      }
    />
  );
}
