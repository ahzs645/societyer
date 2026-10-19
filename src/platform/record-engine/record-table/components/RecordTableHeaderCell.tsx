import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Select } from "../../../../components/Select";
import { columnWidthStyle } from "../utils/columnWidth";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  EyeOff,
  Filter,
  Rows3,
} from "lucide-react";
import { FIELD_TYPES, type RecordField, type SelectOption, type ViewFilterOperator } from "../../types";
import { resolveFieldIcon } from "../../record-field/fieldIcons";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { useIsMobile } from "../../../../lib/useIsMobile";
import { floatingLayerProps, isOutsidePointerEvent } from "../../../../lib/floatingLayer";
import { ViewportPopover } from "../../../../components/ViewportPopover";
import { isNumericFieldType, parseNumericFilterInput } from "../utils/filterValues";
import { defaultGroupBy, getViewGroupBy, isGroupableField, withViewGroupBy } from "../utils/groupRecords";

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
  const filters = useRecordTableState((s) => s.filters);
  const filterGroups = useRecordTableState((s) => s.filterGroups);
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
  const [filterValue, setFilterValue] = useState("");
  const [numericOperator, setNumericOperator] = useState<ViewFilterOperator>("eq");
  const numeric = isNumericFieldType(recordField.field.fieldType);
  const boolean = recordField.field.fieldType === FIELD_TYPES.BOOLEAN;
  const sortable = recordField.field.config?.sortable !== false;
  const noValue = boolean || ["isEmpty", "isNotEmpty"].includes(numericOperator);
  const canApply = noValue || canApplyHeaderFilter(recordField, filterValue);

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
    setMenuOpen(false);
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

  const applyHeaderFilter = () => {
    const condition = headerFilterCondition(recordField, filterValue);
    const operator = numeric || boolean ? numericOperator === "eq" && boolean ? "isTrue" : numericOperator : condition.operator;
    const value = noValue ? null : condition.value;
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
        (collapsed ? " record-table__header-cell--collapsed" : "")
      }
      style={columnWidthStyle(collapsed ? 0 : recordField.size)}
      aria-hidden={collapsed || undefined}
      aria-sort={sort ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        className="record-table__header-cell-button"
        onClick={cycleSort}
        type="button"
        title={sortable ? recordField.field.label : `${recordField.field.label} is available for filtering and grouping`}
        aria-disabled={!sortable || undefined}
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
            {sortable && <><button type="button" onClick={() => setSort("asc")}>
              <ArrowUp size={13} />
              <span>Sort ascending</span>
            </button>
            <button type="button" onClick={() => setSort("desc")}>
              <ArrowDown size={13} />
              <span>Sort descending</span>
            </button></>}
            <div className="record-table__header-menu-section">
              <div className="record-table__header-filter">
                <span>
                  <Filter size={13} />
                  Filter
                </span>
                {(numeric || boolean) && <Select
                  size="sm"
                  aria-label={`${recordField.field.label} filter condition`}
                  value={boolean && numericOperator === "eq" ? "isTrue" : numericOperator}
                  onChange={setNumericOperator}
                  options={boolean ? [{ value: "isTrue", label: "Yes" }, { value: "isFalse", label: "No" }] : [
                    { value: "eq", label: "Equals" }, { value: "neq", label: "Does not equal" },
                    { value: "gt", label: "Greater than" }, { value: "gte", label: "At least" },
                    { value: "lt", label: "Less than" }, { value: "lte", label: "At most" },
                    { value: "isEmpty", label: "Has no value" }, { value: "isNotEmpty", label: "Has a value" },
                  ]}
                />}
                {!noValue && <input
                  aria-label={`${recordField.field.label} filter value`}
                  value={filterValue}
                  onChange={(event) => setFilterValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && canApply) {
                      event.preventDefault();
                      applyHeaderFilter();
                    }
                  }}
                  placeholder={headerFilterPlaceholder(recordField)}
                  type={headerFilterInputType(recordField)}
                  inputMode={isNumericFieldType(recordField.field.fieldType) ? "decimal" : undefined}
                />}
              </div>
              <button
                type="button"
                disabled={!canApply}
                onClick={applyHeaderFilter}
              >
                Apply filter
              </button>
            </div>
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

/**
 * What the column menu's one text box filters by. Options: an exact label or
 * key is "is <option>", anything else "contains" (labels as well as keys).
 * Relations match their display names.
 */
function headerFilterCondition(recordField: RecordField, raw: string): { operator: ViewFilterOperator; value: unknown } {
  const options = Array.isArray(recordField.field.config?.options) ? (recordField.field.config.options as SelectOption[]) : [];
  if (options.length > 0) {
    const typed = raw.trim().toLowerCase();
    const option = options.find((entry) => String(entry.label ?? entry.value).toLowerCase() === typed || String(entry.value).toLowerCase() === typed);
    if (option && recordField.field.fieldType !== FIELD_TYPES.MULTI_SELECT) return { operator: "eq", value: String(option.value) };
    return { operator: "contains", value: raw.trim() };
  }
  if (recordField.field.fieldType === FIELD_TYPES.RELATION) return { operator: "contains", value: raw.trim() };
  const operator = defaultHeaderOperator(recordField);
  return { operator, value: normalizedHeaderFilterValue(recordField, raw, operator) };
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
  if (isNumericFieldType(recordField.field.fieldType)) {
    return parseNumericFilterInput(recordField.field, value) !== undefined;
  }
  return value.trim().length > 0;
}

function normalizedHeaderFilterValue(
  recordField: RecordField,
  value: string,
  operator: ViewFilterOperator,
) {
  if (operator === "isTrue" || operator === "isFalse") return null;
  if (isNumericFieldType(recordField.field.fieldType)) {
    // "1.5k", "$2,000", "(300)" — in the field's stored unit.
    return parseNumericFilterInput(recordField.field, value) ?? null;
  }
  return value.trim();
}

function headerFilterInputType(recordField: RecordField) {
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
  if (recordField.field.fieldType === FIELD_TYPES.CURRENCY) return "e.g. 1.5k or $2,000";
  if (isNumericFieldType(recordField.field.fieldType)) return "Enter a number";
  return "Contains…";
}
