import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  EyeOff,
  Filter,
} from "lucide-react";
import { FIELD_TYPES, type RecordField, type ViewFilterOperator } from "../../types";
import { resolveFieldIcon } from "../../record-field/fieldIcons";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { useIsMobile } from "../../../../lib/useIsMobile";

/**
 * One header cell. Click = cycle sort (asc → desc → off). Drag the right
 * edge to resize. Uses the per-instance store so multiple tables don't
 * share sort state.
 */
export function RecordTableHeaderCell({
  recordField,
  isLabelIdentifier = false,
}: {
  recordField: RecordField;
  isLabelIdentifier?: boolean;
}) {
  const columns = useRecordTableState((s) => s.columns);
  const filters = useRecordTableState((s) => s.filters);
  const filterGroups = useRecordTableState((s) => s.filterGroups);
  const sorts = useRecordTableState((s) => s.sorts);
  const handle = useRecordTableStoreHandle();
  const isMobile = useIsMobile();
  const resizing = useRef<{ startX: number; startSize: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [filterValue, setFilterValue] = useState("");

  const sort = sorts.find((s) => s.fieldMetadataId === recordField.fieldMetadataId);
  const FieldIcon = resolveFieldIcon(recordField.field);
  const visibleColumns = columns.filter((column) => column.isVisible);
  const visibleIndex = visibleColumns.findIndex(
    (column) => column.viewFieldId === recordField.viewFieldId,
  );
  const canMoveLeft = !isLabelIdentifier && visibleIndex > 1;
  const canMoveRight =
    !isLabelIdentifier &&
    visibleIndex >= 1 &&
    visibleIndex < visibleColumns.length - 1;

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  const cycleSort = () => {
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
    setMenuOpen(false);
  };

  const moveColumn = (direction: -1 | 1) => {
    const currentVisible = handle.get().columns.filter((column) => column.isVisible);
    const currentIndex = currentVisible.findIndex(
      (column) => column.viewFieldId === recordField.viewFieldId,
    );
    const nextIndex = currentIndex + direction;
    if (
      isLabelIdentifier ||
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

  const applyHeaderFilter = () => {
    const operator = defaultHeaderOperator(recordField);
    const value = normalizedHeaderFilterValue(recordField, filterValue, operator);
    const existingRoot = filterGroups.find((group) => !group.parentViewFilterGroupId);
    const rootGroup = existingRoot ?? {
      id: `fg_${Date.now()}`,
      logicalOperator: "and" as const,
      parentViewFilterGroupId: null,
      positionInViewFilterGroup: 0,
    };

    handle.set({
      filterGroups: existingRoot ? filterGroups : [rootGroup, ...filterGroups],
      filters: [
        ...filters.map((entry, index) =>
          entry.viewFilterGroupId
            ? entry
            : {
                ...entry,
                viewFilterGroupId: rootGroup.id,
                positionInViewFilterGroup: index,
              },
        ),
        {
          id: `f_${Date.now()}`,
          fieldMetadataId: recordField.fieldMetadataId,
          operator,
          value,
          viewFilterGroupId: rootGroup.id,
          positionInViewFilterGroup: filters.length,
        },
      ],
    });
    setFilterValue("");
    setMenuOpen(false);
  };

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { startX: e.clientX, startSize: recordField.size };
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const delta = ev.clientX - resizing.current.startX;
      const next = Math.max(80, resizing.current.startSize + delta);
      handle.get().resizeColumn(recordField.viewFieldId, next);
    };
    const onUp = () => {
      resizing.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
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
        (isLabelIdentifier ? " record-table__header-cell--identifier" : "")
      }
      style={{ width: recordField.size, minWidth: recordField.size }}
      aria-sort={sort ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        className="record-table__header-cell-button"
        onClick={cycleSort}
        type="button"
      >
        <FieldIcon size={13} className="record-table__header-cell-icon" aria-hidden="true" />
        <span className="record-table__header-cell-label">{recordField.field.label}</span>
        {sort?.direction === "asc" && <ArrowUp size={11} />}
        {sort?.direction === "desc" && <ArrowDown size={11} />}
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
        {menuOpen && (
          <div className="record-table__header-menu">
            <button type="button" onClick={() => setSort("asc")}>
              <ArrowUp size={13} />
              <span>Sort ascending</span>
            </button>
            <button type="button" onClick={() => setSort("desc")}>
              <ArrowDown size={13} />
              <span>Sort descending</span>
            </button>
            <div className="record-table__header-menu-section">
              <label>
                <span>
                  <Filter size={13} />
                  Filter
                </span>
                <input
                  value={filterValue}
                  onChange={(event) => setFilterValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && canApplyHeaderFilter(recordField, filterValue)) {
                      event.preventDefault();
                      applyHeaderFilter();
                    }
                  }}
                  placeholder={headerFilterPlaceholder(recordField)}
                  type={headerFilterInputType(recordField)}
                />
              </label>
              <button
                type="button"
                disabled={!canApplyHeaderFilter(recordField, filterValue)}
                onClick={applyHeaderFilter}
              >
                Apply filter
              </button>
            </div>
            <button type="button" disabled={!canMoveLeft} onClick={() => moveColumn(-1)}>
              <ArrowLeft size={13} />
              <span>Move left</span>
            </button>
            <button type="button" disabled={!canMoveRight} onClick={() => moveColumn(1)}>
              <ArrowRight size={13} />
              <span>Move right</span>
            </button>
            <button
              type="button"
              disabled={isLabelIdentifier}
              onClick={() => {
                handle.get().toggleColumnVisibility(recordField.viewFieldId);
                setMenuOpen(false);
              }}
            >
              <EyeOff size={13} />
              <span>{isLabelIdentifier ? "Identifier field" : "Hide field"}</span>
            </button>
          </div>
        )}
      </div>
      {!isMobile && (
        <span
          className="record-table__resize-handle"
          onMouseDown={onResizeMouseDown}
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

function defaultHeaderOperator(recordField: RecordField): ViewFilterOperator {
  if (recordField.field.fieldType === FIELD_TYPES.BOOLEAN) return "isTrue";
  if (
    recordField.field.fieldType === FIELD_TYPES.TEXT ||
    recordField.field.fieldType === FIELD_TYPES.EMAIL ||
    recordField.field.fieldType === FIELD_TYPES.PHONE ||
    recordField.field.fieldType === FIELD_TYPES.LINK ||
    recordField.field.fieldType === FIELD_TYPES.ARRAY ||
    recordField.field.fieldType === FIELD_TYPES.MULTI_SELECT
  ) {
    return "contains";
  }
  return "eq";
}

function canApplyHeaderFilter(recordField: RecordField, value: string) {
  if (recordField.field.fieldType === FIELD_TYPES.BOOLEAN) return true;
  return value.trim().length > 0;
}

function normalizedHeaderFilterValue(
  recordField: RecordField,
  value: string,
  operator: ViewFilterOperator,
) {
  if (operator === "isTrue" || operator === "isFalse") return null;
  if (
    recordField.field.fieldType === FIELD_TYPES.NUMBER ||
    recordField.field.fieldType === FIELD_TYPES.CURRENCY ||
    recordField.field.fieldType === FIELD_TYPES.RATING
  ) {
    return Number(value);
  }
  return value.trim();
}

function headerFilterInputType(recordField: RecordField) {
  if (
    recordField.field.fieldType === FIELD_TYPES.NUMBER ||
    recordField.field.fieldType === FIELD_TYPES.CURRENCY ||
    recordField.field.fieldType === FIELD_TYPES.RATING
  ) {
    return "number";
  }
  if (
    recordField.field.fieldType === FIELD_TYPES.DATE ||
    recordField.field.fieldType === FIELD_TYPES.DATE_TIME
  ) {
    return "date";
  }
  return "text";
}

function headerFilterPlaceholder(recordField: RecordField) {
  if (recordField.field.fieldType === FIELD_TYPES.BOOLEAN) return "true";
  return "Value";
}
