import { forwardRef, type ReactNode, useMemo } from "react";
// NOTE: if you're adding another hook to this file, it MUST go above all the
// early returns (`if (loading) ...`, etc). React's rules of hooks require a
// stable call order on every render. An earlier iteration had a useMemo
// after the virtualization branch and it crashed the page once the record
// count grew past the threshold on a re-render.
import { TableVirtuoso } from "react-virtuoso";
import { useRecordTableState } from "../state/recordTableStore";
import { useFilteredRecords } from "../hooks/useFilteredRecords";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { RecordTableHeader } from "./RecordTableHeader";
import { RecordTableRow } from "./RecordTableRow";
import { RecordTableEmpty } from "./RecordTableEmpty";
import type { FieldMetadata } from "../../types";

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
}) {
  const columns = useRecordTableState((s) => s.columns);
  const density = useRecordTableState((s) => s.density);
  const filtered = useFilteredRecords();
  const { objectMetadata } = useRecordTableContextOrThrow();

  const visibleColumns = useMemo(() => columns.filter((c) => c.isVisible), [columns]);

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

  const hasRowActions = !!renderRowActions;

  // Small result sets render without virtuoso — simpler, faster for
  // common <100-row tables. Once we cross the threshold we switch on
  // react-virtuoso.
  if (filtered.length <= virtualizeAbove) {
    return (
      <div className={`record-table__scroll ${densityClass}`}>
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
        </table>
      </div>
    );
  }

  // TableVirtuoso applies `height: 100%` inline by default, which overrides
  // the 600px from `.record-table__virtuoso` in CSS (inline > class). If the
  // parent card has no explicit height, 100% collapses to 0 and virtuoso
  // renders an empty tbody. Pass height inline so our value wins.
  return (
    <TableVirtuoso
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
  );
}
