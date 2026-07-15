import { forwardRef, type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
// NOTE: if you're adding another hook to this file, it MUST go above all the
// early returns (`if (loading) ...`, etc). React's rules of hooks require a
// stable call order on every render. An earlier iteration had a useMemo
// after the virtualization branch and it crashed the page once the record
// count grew past the threshold on a re-render.
import { TableVirtuoso, type TableVirtuosoHandle } from "react-virtuoso";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { useFilteredRecords } from "../hooks/useFilteredRecords";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { RecordTableHeader } from "./RecordTableHeader";
import { RecordTableRow } from "./RecordTableRow";
import { RecordTableEmpty } from "./RecordTableEmpty";
import { RecordTableAggregateFooter, RecordTableAggregateFooterRow } from "./RecordTableAggregateFooter";
import { RecordTableActionRow, RecordTableActionRowCells } from "./RecordTableActionRow";
import { useRecordTableKeyboardNavigation } from "../hooks/useRecordTableKeyboardNavigation";
import { useIsMobile } from "../../../../lib/useIsMobile";
import { getMobileTableLayout } from "../../../../lib/mobileTableLayout";
import { useScrollEdgeShadows } from "../../../../lib/useScrollEdgeShadows";
import { FieldDisplay } from "../../record-field/components/FieldDisplay";
import { CalendarView } from "../../../../components/CalendarView";
import { RecordBoard, type RecordBoardColumn } from "../../../../components/RecordBoard";
import { ContextMenu } from "../../../../components/ContextMenu";
import type { MenuSection } from "../../../../components/Menu";
import { FIELD_TYPES, type FieldMetadata, type RecordField } from "../../types";

// react-virtuoso attaches refs to the four table subcomponents so it can
// measure them for virtualization. Plain function components can't accept
// refs, so each override has to be a `forwardRef`. They're defined outside
// the main component so React doesn't re-create them every render (which
// would thrash virtuoso's internal keys).
const VirtuosoTable = forwardRef<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>(
  function VirtuosoTable(props, ref) {
    return <table ref={ref} {...props} className="record-table" role="grid" />;
  },
);

const VirtuosoTableHead = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  function VirtuosoTableHead(props, ref) {
    return <thead ref={ref} {...props} className="record-table__thead" />;
  },
);

const VirtuosoTableBody = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  function VirtuosoTableBody(props, ref) {
    return <tbody ref={ref} {...props} className="record-table__tbody" />;
  },
);

type RowContextMenuHandler = (event: React.MouseEvent, record: any) => void;

const VIRTUAL_ACTION_ROW = { __recordTableActionRow: true } as const;

function isVirtualActionRow(item: unknown): item is typeof VIRTUAL_ACTION_ROW {
  return !!item && typeof item === "object" && "__recordTableActionRow" in item;
}

const VirtuosoTableRow = forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement> & {
    item?: unknown;
    context?: { onRowContextMenu?: RowContextMenuHandler };
  }
>(function VirtuosoTableRow({ item, context, ...props }, ref) {
  const isActionRow = isVirtualActionRow(item);
  return (
    <tr
      ref={ref}
      {...props}
      className={isActionRow ? "record-table__action-row" : "record-table__row"}
      onContextMenu={
        context?.onRowContextMenu && item != null && !isActionRow
          ? (event) => context.onRowContextMenu!(event, item)
          : undefined
      }
    />
  );
});

/**
 * Opt-in escape hatch for pages that need a custom cell renderer on
 * specific fields (links, badges with domain-specific tones, composite
 * content). Return `undefined` to fall through to the default
 * metadata-driven `FieldDisplay`.
 */
export type RecordTableCellRenderer = (ctx: {
  record: any;
  field: FieldMetadata;
  value: unknown;
}) => ReactNode | undefined;

/**
 * The table itself — headers + virtualized body. Requires a surrounding
 * <RecordTableScope>. Any toolbar (search/filter/views) lives outside and
 * writes into the same store via the hooks.
 *
 * `selectable` turns on the checkbox column + enables bulk actions.
 */
export function RecordTable({
  selectable = false,
  emptyState,
  loading = false,
  virtualizeAbove = 40,
  renderRowActions,
  rowMenuSections,
  renderCell,
  keyboardNavigation = true,
  showAggregateFooter = true,
}: {
  selectable?: boolean;
  emptyState?: ReactNode;
  loading?: boolean;
  /** Use virtualization only once the filtered row count exceeds this. */
  virtualizeAbove?: number;
  /**
   * Optional per-row action slot — renders in a sticky right-hand column
   * (e.g. "Bot", "Mark filed" inline buttons). Keep it compact; bulk
   * actions belong in RecordTableBulkBar instead.
   */
  renderRowActions?: (record: any) => ReactNode;
  /**
   * Preferred way to expose per-row actions: menu sections rendered both
   * behind a trailing "…" kebab button and on row right-click (context
   * menu). Keeps rows clean instead of a strip of inline buttons.
   */
  rowMenuSections?: (record: any) => MenuSection[];
  /**
   * Optional per-cell renderer override. Return undefined to fall
   * through to the default metadata-driven display. Use sparingly —
   * prefer adding a proper field type + display component when a
   * pattern recurs.
   */
  renderCell?: RecordTableCellRenderer;
  keyboardNavigation?: boolean;
  showAggregateFooter?: boolean;
}) {
  const columns = useRecordTableState((s) => s.columns);
  const density = useRecordTableState((s) => s.density);
  const records = useRecordTableState((s) => s.records);
  const focusedCell = useRecordTableState((s) => s.focusedCell);
  const viewType = useRecordTableState((s) => s.type);
  const kanbanFieldMetadataId = useRecordTableState((s) => s.kanbanFieldMetadataId);
  const calendarFieldMetadataId = useRecordTableState((s) => s.calendarFieldMetadataId);
  const openRecordIn = useRecordTableState((s) => s.openRecordIn);
  const filtered = useFilteredRecords();
  const { objectMetadata, onRecordClick, onUpdate, onCreate, onReorder } = useRecordTableContextOrThrow();
  const handle = useRecordTableStoreHandle();
  const getTableState = handle.get;
  const tableRootRef = useRef<HTMLDivElement | null>(null);
  const virtuosoRef = useRef<TableVirtuosoHandle>(null);
  const [rowContextMenu, setRowContextMenu] = useState<{ x: number; y: number; record: any } | null>(null);

  const visibleColumns = useMemo(() => columns.filter((c) => c.isVisible), [columns]);
  const hasOpenRecordAction = !!onRecordClick;
  const hasRowActions = !!renderRowActions || !!rowMenuSections || hasOpenRecordAction;
  const onRowContextMenu: RowContextMenuHandler | undefined = rowMenuSections
    ? (event, record) => {
        event.preventDefault();
        setRowContextMenu({ x: event.clientX, y: event.clientY, record });
      }
    : undefined;
  const rowContextMenuElement = rowMenuSections ? (
    <ContextMenu
      position={rowContextMenu ? { x: rowContextMenu.x, y: rowContextMenu.y } : null}
      sections={rowContextMenu ? rowMenuSections(rowContextMenu.record) : []}
      onClose={() => setRowContextMenu(null)}
    />
  ) : null;
  // On phones we drop the selection column so the first data column (the
  // record name) sits flush left and can be frozen while the rest of the
  // table scrolls horizontally — the Twenty-style narrow-screen table.
  const isMobile = useIsMobile();
  const { showSelectionColumn: effectiveSelectable, showDragHandle } =
    getMobileTableLayout({ isMobile, selectable, hasDragHandle: !!onReorder });
  const tableColumnCount =
    visibleColumns.length +
    1 +
    (effectiveSelectable ? 1 : 0) +
    (showDragHandle ? 1 : 0) +
    (hasRowActions ? 1 : 0);
  const virtualizedRows = useMemo(
    () => (onCreate ? [...filtered, VIRTUAL_ACTION_ROW] : filtered),
    [filtered, onCreate],
  );
  // In the non-virtualized branch the scroll container is the horizontal
  // scroller, so these edge flags drive the "there's more →" fade shadows that
  // keep a frozen-first-column table from looking cut off on a phone. The
  // scroller node feeds both `tableRootRef` (used for focus/outside-click
  // queries) and the shadow hook's callback ref.
  const { edges: scrollEdges, ref: scrollShadowRef } = useScrollEdgeShadows();
  const setScrollNode = useCallback(
    (node: HTMLDivElement | null) => {
      tableRootRef.current = node;
      scrollShadowRef(node);
    },
    [scrollShadowRef],
  );
  const handleTableKeyDown = useRecordTableKeyboardNavigation({
    enabled: keyboardNavigation,
    selectable: effectiveSelectable,
  });

  useEffect(() => {
    if (!focusedCell) return;
    virtuosoRef.current?.scrollToIndex({
      index: focusedCell.rowIndex,
      align: "center",
      behavior: "smooth",
    });
    const frame = window.requestAnimationFrame(() => {
      // Opening an editor focuses its input. Do not let the delayed cell-focus
      // pass steal focus back from that input: doing so fires the editor's blur
      // commit and closes it immediately after it opens.
      if (getTableState().editingCell) return;
      const focusedElement = tableRootRef.current
        ?.querySelector<HTMLElement>(
          `[data-row-index="${focusedCell.rowIndex}"][data-column-index="${focusedCell.columnIndex}"]`,
        );
      focusedElement?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      focusedElement?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedCell, getTableState]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const root = tableRootRef.current;
      const target = event.target as HTMLElement | null;
      if (!root || root.contains(event.target as Node)) return;
      // Inline editors portal their popovers (select menus, calendars) to
      // <body>; interacting with them must not tear the editor down.
      if (target?.closest(".record-table__cell-editor-popover, .menu, .calendar")) return;
      handle.get().setFocusedCell(null);
      handle.get().setEditingInitialValue(undefined);
      handle.get().setEditingCell(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [handle]);

  if (loading) {
    return (
      <div className="record-table__loading">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="record-table__loading-row" />
        ))}
      </div>
    );
  }

  if (!visibleColumns.length) {
    return (
      <RecordTableEmpty
        title="No columns to display"
        description="Add a column from the field picker."
      />
    );
  }

  if (filtered.length === 0) {
    if (records.length > 0) {
      return (
        <RecordTableEmpty
          title="No matching records"
          description="Change or clear the current search and filters."
          action={
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                handle.get().setSearchTerm("");
                handle.get().setFilters([]);
                handle.get().setFilterGroups([]);
              }}
            >
              Clear search and filters
            </button>
          }
        />
      );
    }
    return (
      emptyState ?? (
        <RecordTableEmpty
          title={`No ${objectMetadata.labelPlural.toLowerCase()}`}
          description="Try clearing your filters or creating a new record."
        />
      )
    );
  }

  // Density lives on the wrapper (CSS selectors are descendant-based —
  // `.record-table--compact .record-table__cell`), so the <table> itself
  // can keep a static `record-table` class. That lets `VirtuosoTable` be a
  // module-level forwardRef with no closure over render-time state, which
  // keeps the hook order stable across both render branches.
  const densityClass =
    density === "comfortable" ? "record-table--comfortable" : "record-table--compact";

  if (viewType === "kanban" || viewType === "board") {
    const groupColumn =
      columns.find((column) => column.fieldMetadataId === kanbanFieldMetadataId) ??
      columns.find((column) =>
        [FIELD_TYPES.SELECT, FIELD_TYPES.MULTI_SELECT, FIELD_TYPES.BOOLEAN, FIELD_TYPES.RELATION].includes(
          column.field.fieldType as any,
        ),
      );
    const labelColumn = getLabelColumn(columns, objectMetadata.labelIdentifierFieldName);
    const boardColumns = buildBoardColumns(filtered, groupColumn);

    if (!groupColumn || boardColumns.length === 0) {
      return (
        <RecordTableEmpty
          title="Choose a kanban field"
          description="Use View options to select a select, boolean, relation or status field."
        />
      );
    }

    return (
      <div className="record-table__view-surface">
        <RecordBoard<any>
          columns={boardColumns}
          items={filtered}
          getItemId={(record) => String(record._id)}
          getColumnId={(record) => normalizeBoardValue(record[groupColumn.field.name])}
          onMove={(record, toColumnId) => {
            if (!onUpdate) return;
            const value =
              groupColumn.field.fieldType === FIELD_TYPES.MULTI_SELECT
                ? [toColumnId]
                : groupColumn.field.fieldType === FIELD_TYPES.BOOLEAN
                  ? toColumnId === "true"
                  : toColumnId;
            void onUpdate({
              recordId: String(record._id),
              fieldName: groupColumn.field.name,
              value,
            });
          }}
          renderCard={(record) => (
            <button
              type="button"
              className="record-table__board-card"
              onClick={() => onRecordClick?.(String(record._id), record, { openRecordIn })}
            >
              <strong>{String(record[labelColumn?.field.name ?? "_id"] ?? "Untitled")}</strong>
              <span>
                <FieldDisplay
                  record={record}
                  field={groupColumn.field}
                  value={record[groupColumn.field.name]}
                />
              </span>
            </button>
          )}
        />
      </div>
    );
  }

  if (viewType === "calendar") {
    const dateColumn =
      columns.find((column) => column.fieldMetadataId === calendarFieldMetadataId) ??
      columns.find((column) =>
        column.field.fieldType === FIELD_TYPES.DATE ||
        column.field.fieldType === FIELD_TYPES.DATE_TIME,
      );
    const labelColumn = getLabelColumn(columns, objectMetadata.labelIdentifierFieldName);

    if (!dateColumn) {
      return (
        <RecordTableEmpty
          title="Choose a calendar field"
          description="Use View options to select a date field for this view."
        />
      );
    }

    return (
      <div className="record-table__view-surface">
        <CalendarView<any>
          items={filtered}
          getId={(record) => String(record._id)}
          getDate={(record) => record[dateColumn.field.name]}
          getLabel={(record) => String(record[labelColumn?.field.name ?? "_id"] ?? "Untitled")}
          onSelect={(record) => onRecordClick?.(String(record._id), record, { openRecordIn })}
        />
      </div>
    );
  }

  // Small result sets render without virtuoso — simpler, faster for
  // common <100-row tables. Once we cross the threshold we switch on
  // react-virtuoso.
  if (filtered.length <= virtualizeAbove) {
    return (
      <div
        role="region"
        aria-label={`${objectMetadata.labelPlural} table`}
        tabIndex={0}
        onKeyDown={handleTableKeyDown}
        className={`record-table__scroll-frame${scrollEdges.left ? " is-scrolled-left" : ""}${scrollEdges.right ? " is-scrolled-right" : ""}`}
        style={{
          "--record-table-identifier-left": effectiveSelectable ? "28px" : "0px",
        } as CSSProperties}
      >
        <div ref={setScrollNode} className={`record-table__scroll ${densityClass}`}>
          <table className="record-table" role="grid">
            <thead className="record-table__thead">
              <RecordTableHeader selectable={effectiveSelectable} hasRowActions={hasRowActions} showDragHandle={showDragHandle} />
            </thead>
            <tbody className="record-table__tbody">
              {filtered.map((record: any, i: number) => (
                <tr
                  key={String(record._id)}
                  className="record-table__row"
                  data-row-index={i}
                  onContextMenu={onRowContextMenu ? (event) => onRowContextMenu(event, record) : undefined}
                >
                  <RecordTableRow
                    record={record}
                    rowIndex={i}
                    selectable={effectiveSelectable}
                    showDragHandle={showDragHandle}
                    renderRowActions={renderRowActions}
                    rowMenuSections={rowMenuSections}
                    showOpenRecordAction={hasOpenRecordAction}
                    renderCell={renderCell}
                  />
                </tr>
              ))}
              {onCreate && (
                <RecordTableActionRow colSpan={tableColumnCount} />
              )}
            </tbody>
            {showAggregateFooter && (
              <RecordTableAggregateFooter selectable={effectiveSelectable} hasRowActions={hasRowActions} showDragHandle={showDragHandle} />
            )}
          </table>
        </div>
        {rowContextMenuElement}
      </div>
    );
  }

  // TableVirtuoso applies `height: 100%` inline by default, which overrides
  // the 600px from `.record-table__virtuoso` in CSS (inline > class). If the
  // parent card has no explicit height, 100% collapses to 0 and virtuoso
  // renders an empty tbody. Pass height inline so our value wins.
  return (
    <div
      ref={tableRootRef}
      className="record-table__interaction-root"
      role="region"
      aria-label={`${objectMetadata.labelPlural} table`}
      tabIndex={0}
      onKeyDown={handleTableKeyDown}
      style={{
        "--record-table-identifier-left": effectiveSelectable ? "28px" : "0px",
      } as CSSProperties}
    >
      <TableVirtuoso
        ref={virtuosoRef}
        data={virtualizedRows}
        context={{ onRowContextMenu }}
        className={`record-table__virtuoso ${densityClass}`}
        style={{ height: 600 }}
        components={{
          Table: VirtuosoTable,
          TableHead: VirtuosoTableHead,
          TableBody: VirtuosoTableBody,
          TableRow: VirtuosoTableRow,
        }}
        fixedHeaderContent={() => (
          <RecordTableHeader selectable={effectiveSelectable} hasRowActions={hasRowActions} showDragHandle={showDragHandle} />
        )}
        fixedFooterContent={showAggregateFooter ? () => (
          <RecordTableAggregateFooterRow
            selectable={effectiveSelectable}
            hasRowActions={hasRowActions}
            showDragHandle={showDragHandle}
          />
        ) : undefined}
        itemContent={(index, record) =>
          isVirtualActionRow(record) ? (
            <RecordTableActionRowCells colSpan={tableColumnCount} />
          ) : (
            <RecordTableRow
              record={record}
              rowIndex={index}
              selectable={effectiveSelectable}
              showDragHandle={showDragHandle}
              renderRowActions={renderRowActions}
              rowMenuSections={rowMenuSections}
              showOpenRecordAction={hasOpenRecordAction}
              renderCell={renderCell}
            />
          )
        }
      />
      {rowContextMenuElement}
    </div>
  );
}

function getLabelColumn(columns: RecordField[], labelIdentifierFieldName?: string) {
  return (
    columns.find((column) => column.field.name === labelIdentifierFieldName) ??
    columns.find((column) => column.isVisible) ??
    columns[0]
  );
}

function buildBoardColumns(records: any[], column: RecordField | undefined): RecordBoardColumn[] {
  if (!column) return [];
  const options = Array.isArray(column.field.config?.options)
    ? column.field.config.options
    : [];
  if (options.length > 0) {
    return options.map((option: any) => ({
      id: String(option.value),
      label: String(option.label ?? option.value),
      tone: option.color,
    }));
  }
  if (column.field.fieldType === FIELD_TYPES.BOOLEAN) {
    return [
      { id: "true", label: column.field.config?.trueLabel ?? "True", tone: "green" },
      { id: "false", label: column.field.config?.falseLabel ?? "False", tone: "gray" },
    ];
  }
  const values = new Set<string>();
  for (const record of records) values.add(normalizeBoardValue(record[column.field.name]));
  return Array.from(values)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ id: value, label: value }));
}

function normalizeBoardValue(value: unknown): string {
  if (Array.isArray(value)) return normalizeBoardValue(value[0]);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return String(record.value ?? record.id ?? record._id ?? record.label ?? record.name ?? "");
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value ?? "");
}
