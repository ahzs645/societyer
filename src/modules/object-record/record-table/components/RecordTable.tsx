import { type ReactNode, useMemo } from "react";
import { TableVirtuoso } from "react-virtuoso";
import { useRecordTableState } from "../state/recordTableStore";
import { useFilteredRecords } from "../hooks/useFilteredRecords";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { RecordTableHeader } from "./RecordTableHeader";
import { RecordTableRow } from "./RecordTableRow";
import { RecordTableEmpty } from "./RecordTableEmpty";
import type { FieldMetadata } from "../../types";

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

  const className =
    "record-table" +
    (density === "comfortable" ? " record-table--comfortable" : " record-table--compact");

  const hasRowActions = !!renderRowActions;

  // Small result sets render without virtuoso — simpler, faster for
  // common <100-row tables. Once we cross the threshold we switch on
  // react-virtuoso.
  if (filtered.length <= virtualizeAbove) {
    return (
      <div className="record-table__scroll">
        <table className={className}>
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

  return (
    <TableVirtuoso
      data={filtered}
      className="record-table__virtuoso"
      components={{
        Table: (props) => <table {...props} className={className} />,
        TableHead: (props) => <thead {...props} className="record-table__thead" />,
        TableBody: (props: any) => <tbody {...props} className="record-table__tbody" />,
        TableRow: ({ item: _item, ...props }: any) => (
          <tr {...props} className="record-table__row" />
        ),
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
