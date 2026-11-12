import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { columnWidthStyle } from "../utils/columnWidth";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  EyeOff,
  Filter,
  Rows3,
} from "lucide-react";
import { FIELD_TYPES, type RecordField } from "../../types";
import { resolveFieldIcon } from "../../record-field/fieldIcons";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { useIsMobile } from "../../../../lib/useIsMobile";
import { floatingLayerProps, isOutsidePointerEvent } from "../../../../lib/floatingLayer";
import { ViewportPopover } from "../../../../components/ViewportPopover";
import { sortDirectionLabels } from "../utils/sortLabels";
import { defaultGroupBy, getViewGroupBy, isGroupableField, withViewGroupBy } from "../utils/groupRecords";
import { RecordTableHeaderFilter } from "./RecordTableHeaderFilter";

/**
 * One header cell. Click = cycle sort (asc → desc → off). Drag the right
 * edge to resize. Uses the per-instance store so multiple tables don't
 * share sort state.
 */
export function RecordTableHeaderCell({
  recordField,
  isLabelIdentifier = false,
  lockIdentifier = isLabelIdentifier,
  collapsed = false,
}: {
  recordField: RecordField;
  /** The column that opens the record (styled and pinned as the identifier). */
  isLabelIdentifier?: boolean;
  /** The object's own identifier field: it cannot be moved or hidden. */
  lockIdentifier?: boolean;
  /** Folded to zero width while the preview panel condenses the table. */
  collapsed?: boolean;
}) {
  const columns = useRecordTableState((s) => s.columns);
  const isFiltered = useRecordTableState((s) =>
    s.filters.some((filter) => filter.fieldMetadataId === recordField.fieldMetadataId),
  );
  const sorts = useRecordTableState((s) => s.sorts);
  const viewType = useRecordTableState((s) => s.type);
  const isGroupedByThis = useRecordTableState(
    (s) => getViewGroupBy(s.viewGroups)?.fieldMetadataId === recordField.fieldMetadataId,
  );
  const handle = useRecordTableStoreHandle();
  const isMobile = useIsMobile();
  const resizing = useRef<{ startX: number; startSize: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const sortable = recordField.field.config?.sortable !== false;
  const directionLabels = sortDirectionLabels(recordField.field);

  const sort = sorts.find((s) => s.fieldMetadataId === recordField.fieldMetadataId);
  const FieldIcon = resolveFieldIcon(recordField.field);
  const visibleColumns = columns.filter((column) => column.isVisible);
  const visibleIndex = visibleColumns.findIndex(
    (column) => column.viewFieldId === recordField.viewFieldId,
  );
  const canMoveLeft = !lockIdentifier && visibleIndex > 1;
  const canMoveRight =
    !lockIdentifier &&
    visibleIndex >= 1 &&
    visibleIndex < visibleColumns.length - 1;

  // Tell the table a column menu is open: filtering from it must not switch
  // the table between its plain and windowed layouts, which would remount
  // this header and close the menu mid-typing.
  useEffect(() => {
    if (!menuOpen) return;
    const id = recordField.viewFieldId;
    handle.get().setOpenColumnMenu(id);
    return () => {
      if (handle.get().openColumnMenu === id) handle.get().setOpenColumnMenu(null);
    };
  }, [menuOpen, handle, recordField.viewFieldId]);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!isOutsidePointerEvent(event, menuRef)) return;
      setMenuOpen(false);
    };

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  const cycleSort = () => {
    if (!sortable) return;
    const next = handle.get().sorts.filter(
      (s) => s.fieldMetadataId !== recordField.fieldMetadataId,
    );
    if (!sort) {
      next.unshift({ fieldMetadataId: recordField.fieldMetadataId, direction: "asc" });
    } else if (sort.direction === "asc") {
      next.unshift({ fieldMetadataId: recordField.fieldMetadataId, direction: "desc" });
    }
    handle.set({ sorts: next });
  };

  const setSort = (direction: "asc" | "desc") => {
    handle.get().setSorts([
      { fieldMetadataId: recordField.fieldMetadataId, direction },
      ...handle.get().sorts.filter((s) => s.fieldMetadataId !== recordField.fieldMetadataId),
    ]);
  };

  const clearSort = () => {
    handle.get().setSorts(handle.get().sorts.filter((s) => s.fieldMetadataId !== recordField.fieldMetadataId));
  };

  const moveColumn = (direction: -1 | 1) => {
    const currentVisible = handle.get().columns.filter((column) => column.isVisible);
    const currentIndex = currentVisible.findIndex(
      (column) => column.viewFieldId === recordField.viewFieldId,
    );
    const nextIndex = currentIndex + direction;
    if (
      lockIdentifier ||
      currentIndex < 0 ||
      nextIndex < 1 ||
      nextIndex >= currentVisible.length
    ) return;

    const nextVisible = [...currentVisible];
    const [moved] = nextVisible.splice(currentIndex, 1);
    nextVisible.splice(nextIndex, 0, moved);

    const visibleIds = nextVisible.map((column) => column.viewFieldId);
    const hiddenIds = handle
      .get()
      .columns.filter((column) => !column.isVisible)
      .map((column) => column.viewFieldId);

    handle.get().reorderColumns([...visibleIds, ...hiddenIds]);
    setMenuOpen(false);
  };

  // Pointer events, so a finger or pen resizes a column as a mouse does.
  // Capturing the pointer keeps the drag on the handle even when the finger
  // runs ahead of it, and stops the table scroller from panning meanwhile.
  const onResizePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // Capture is a nicety: window listeners below still follow the drag.
    }
    resizing.current = { startX: e.clientX, startSize: recordField.size };
    const onMove = (ev: PointerEvent) => {
      if (!resizing.current || ev.pointerId !== pointerId) return;
      const delta = ev.clientX - resizing.current.startX;
      const next = Math.max(80, resizing.current.startSize + delta);
      handle.get().resizeColumn(recordField.viewFieldId, next);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      resizing.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // Alt+↓ on a focused header opens its menu, as in spreadsheets and data grids.
  const openMenuWithKeyboard = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" || !event.altKey) return;
    event.preventDefault();
    setMenuOpen(true);
  };

  const resizeWithKeyboard = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 10 : -10;
    handle.get().resizeColumn(recordField.viewFieldId, Math.max(80, recordField.size + delta));
  };

  return (
    <th
      className={
        "record-table__header-cell" +
        (isLabelIdentifier ? " record-table__header-cell--identifier" : "") +
        (recordField.field.fieldType === FIELD_TYPES.CURRENCY || recordField.field.fieldType === FIELD_TYPES.NUMBER
          ? " record-table__header-cell--numeric"
          : "") +
        (collapsed ? " record-table__header-cell--collapsed" : "") +
        (isFiltered ? " record-table__header-cell--filtered" : "")
      }
      style={columnWidthStyle(collapsed ? 0 : recordField.size)}
      aria-hidden={collapsed || undefined}
      aria-sort={sort ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        className="record-table__header-cell-button"
        onClick={cycleSort}
        onKeyDown={openMenuWithKeyboard}
        type="button"
        title={sortable ? recordField.field.label : `${recordField.field.label} is available for filtering and grouping`}
        aria-disabled={!sortable || undefined}
      >
        <FieldIcon size={13} className="record-table__header-cell-icon" aria-hidden="true" />
        <span className="record-table__header-cell-label">{recordField.field.label}</span>
        {sort?.direction === "asc" && <ArrowUp size={11} aria-label="Sorted ascending" />}
        {sort?.direction === "desc" && <ArrowDown size={11} aria-label="Sorted descending" />}
        {isFiltered && <Filter size={11} className="record-table__header-cell-filtered" aria-label="Filtered" />}
      </button>
      <div className="record-table__header-menu-wrap" ref={menuRef}>
        <button
          type="button"
          className="record-table__header-menu-trigger"
          aria-label={`Column menu for ${recordField.field.label}`}
          aria-expanded={menuOpen}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((open) => !open);
          }}
        >
          <ChevronDown size={12} />
        </button>
        {/* A vertical menu in a viewport-fixed layer (portaled out of the
            table's scroller, which clipped it on phones and on short tables),
            right-aligned to the trigger and kept on screen. */}
        {menuOpen && createPortal(
          <div {...floatingLayerProps} className="record-table__header-menu-layer">
          <ViewportPopover
            open
            onClose={closeMenu}
            anchorRef={menuRef}
            label={`${recordField.field.label} column`}
            className="record-table__header-menu"
          >
            {/* Sort is a switch: pick a direction, pick it again to stop sorting. */}
            {sortable && (
              <div className="record-table__header-menu-line" role="group" aria-label={`Sort by ${recordField.field.label}`}>
                <span className="record-table__header-menu-line-label">
                  <ArrowUpDown size={13} aria-hidden="true" />
                  Sort
                </span>
                <div className="record-table__menu-segmented">
                  {(["asc", "desc"] as const).map((direction) => (
                    <button
                      key={direction}
                      type="button"
                      aria-pressed={sort?.direction === direction}
                      title={sort?.direction === direction ? "Select again to stop sorting" : undefined}
                      onClick={() => (sort?.direction === direction ? clearSort() : setSort(direction))}
                    >
                      {direction === "asc" ? <ArrowUp size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />}
                      {directionLabels[direction]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <RecordTableHeaderFilter recordField={recordField} onDone={closeMenu} />
            {viewType === "table" && isGroupableField(recordField) && (
              <button
                type="button"
                onClick={() => {
                  handle.get().setViewGroups(
                    withViewGroupBy(handle.get().viewGroups, isGroupedByThis ? null : defaultGroupBy(recordField)),
                  );
                  setMenuOpen(false);
                }}
              >
                <Rows3 size={13} />
                <span>{isGroupedByThis ? "Remove grouping" : "Group by this field"}</span>
              </button>
            )}
            <div className="record-table__header-menu-row">
              <button type="button" disabled={!canMoveLeft} onClick={() => moveColumn(-1)}>
                <ArrowLeft size={13} />
                <span>Move left</span>
              </button>
              <button type="button" disabled={!canMoveRight} onClick={() => moveColumn(1)}>
                <ArrowRight size={13} />
                <span>Move right</span>
              </button>
            </div>
            <button
              type="button"
              disabled={lockIdentifier}
              onClick={() => {
                handle.get().toggleColumnVisibility(recordField.viewFieldId);
                setMenuOpen(false);
              }}
            >
              <EyeOff size={13} />
              <span>{lockIdentifier ? "Identifier field" : "Hide field"}</span>
            </button>
          </ViewportPopover>
          </div>,
          document.body,
        )}
      </div>
      {!isMobile && (
        <span
          className="record-table__resize-handle"
          onPointerDown={onResizePointerDown}
          // The browser must not pan or zoom the table while a finger drags it.
          style={{ touchAction: "none" }}
          aria-label="Resize column"
          aria-orientation="vertical"
          aria-valuemin={80}
          aria-valuenow={recordField.size}
          role="separator"
          tabIndex={0}
          onKeyDown={resizeWithKeyboard}
        />
      )}
    </th>
  );
}
