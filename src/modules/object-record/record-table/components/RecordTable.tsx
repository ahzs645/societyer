import { forwardRef, type ReactNode, useEffect, useMemo, useRef } from "react";
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
import { RecordTableAggregateFooter } from "./RecordTableAggregateFooter";
import { useRecordTableKeyboardNavigation } from "../hooks/useRecordTableKeyboardNavigation";
import { FieldDisplay } from "../../record-field/components/FieldDisplay";
import { CalendarView } from "../../../../components/CalendarView";
import { RecordBoard, type RecordBoardColumn } from "../../../../components/RecordBoard";
import { FIELD_TYPES, type FieldMetadata, type RecordField } from "../../types";

// react-virtuoso attaches refs to the four table subcomponents so it can
// measure them for virtualization. Plain function components can't accept
// refs, so each override has to be a `forwardRef`. They're defined outside
// the main component so React doesn't re-create them every render (which
// would thrash virtuoso's internal keys).
const VirtuosoTable = forwardRef<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>(
  function VirtuosoTable(props, ref) {
    return <table ref={ref} {...props} className="record-table" />;
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

const VirtuosoTableRow = forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement> & { item?: unknown }>(
  function VirtuosoTableRow({ item: _item, ...props }, ref) {
    return <tr ref={ref} {...props} className="record-table__row" />;
  },
);

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
  const focusedCell = useRecordTableState((s) => s.focusedCell);
  const viewType = useRecordTableState((s) => s.type);
  const kanbanFieldMetadataId = useRecordTableState((s) => s.kanbanFieldMetadataId);
  const calendarFieldMetadataId = useRecordTableState((s) => s.calendarFieldMetadataId);
  const filtered = useFilteredRecords();
  const { objectMetadata, onRecordClick, onUpdate } = useRecordTableContextOrThrow();
  const handle = useRecordTableStoreHandle();
  const tableRootRef = useRef<HTMLDivElement>(null);
  const virtuosoRef = useRef<TableVirtuosoHandle>(null);

  const visibleColumns = useMemo(() => columns.filter((c) => c.isVisible), [columns]);
  const hasRowActions = !!renderRowActions;
  useRecordTableKeyboardNavigation({ enabled: keyboardNavigation });

  useEffect(() => {
    if (!focusedCell) return;
    virtuosoRef.current?.scrollToIndex({
      index: focusedCell.rowIndex,
      align: "center",
      behavior: "smooth",
    });
    window.requestAnimationFrame(() => {
      tableRootRef.current
        ?.querySelector<HTMLElement>(
          `[data-row-index="${focusedCell.rowIndex}"] [data-column-index="${focusedCell.columnIndex}"]`,
        )
        ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    });
  }, [focusedCell]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const root = tableRootRef.current;
      if (!root || root.contains(event.target as Node)) return;
      handle.get().setFocusedCell(null);
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
              onClick={() => onRecordClick?.(String(record._id), record)}
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
          onSelect={(record) => onRecordClick?.(String(record._id), record)}
        />
      </div>
    );
  }

  // Small result sets render without virtuoso — simpler, faster for
  // common <100-row tables. Once we cross the threshold we switch on
  // react-virtuoso.
  if (filtered.length <= virtualizeAbove) {
    return (
      <div ref={tableRootRef} className={`record-table__scroll ${densityClass}`}>
        <table className="record-table">
          <thead className="record-table__thead">
            <RecordTableHeader selectable={selectable} hasRowActions={hasRowActions} />
          </thead>
          <tbody className="record-table__tbody">
            {filtered.map((record: any, i: number) => (
              <tr
                key={String(record._id)}
                className="record-table__row"
                data-row-index={i}
              >
                <RecordTableRow
                  record={record}
                  rowIndex={i}
                  selectable={selectable}
                  renderRowActions={renderRowActions}
                  renderCell={renderCell}
                />
              </tr>
            ))}
          </tbody>
          {showAggregateFooter && (
            <RecordTableAggregateFooter selectable={selectable} hasRowActions={hasRowActions} />
          )}
        </table>
      </div>
    );
  }

  // TableVirtuoso applies `height: 100%` inline by default, which overrides
  // the 600px from `.record-table__virtuoso` in CSS (inline > class). If the
  // parent card has no explicit height, 100% collapses to 0 and virtuoso
  // renders an empty tbody. Pass height inline so our value wins.
  return (
    <div ref={tableRootRef}>
      <TableVirtuoso
        ref={virtuosoRef}
        data={filtered}
        className={`record-table__virtuoso ${densityClass}`}
        style={{ height: 600 }}
        components={{
          Table: VirtuosoTable,
          TableHead: VirtuosoTableHead,
          TableBody: VirtuosoTableBody,
          TableRow: VirtuosoTableRow,
        }}
        fixedHeaderContent={() => (
          <RecordTableHeader selectable={selectable} hasRowActions={hasRowActions} />
        )}
        itemContent={(index, record) => (
          <RecordTableRow
            record={record}
            rowIndex={index}
            selectable={selectable}
            renderRowActions={renderRowActions}
            renderCell={renderCell}
          />
        )}
      />
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
