import { ReactNode } from "react";
import { TableVirtuoso } from "react-virtuoso";
import type { Column } from "./DataTable";

/** Thin virtualized list for very large record sets (thousands of rows).
 * Intentionally lean: no filters, saved views, bulk select, or keyboard nav.
 * Use DataTable for feature-rich tables and this when row count would grind
 * the browser. Returns an empty block when data is empty. */
export function VirtualDataTable<T extends { _id?: string } & Record<string, any>>({
  data,
  columns,
  rowKey,
  onRowClick,
  height = 520,
  label,
  emptyMessage = "No rows.",
}: {
  data: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  height?: number | string;
  label: string;
  emptyMessage?: ReactNode;
}) {
  if (data.length === 0) {
    return <div className="table__empty">{emptyMessage}</div>;
  }
  return (
    <div className="table-scroll" style={{ height }}>
      <TableVirtuoso
        style={{ height: "100%" }}
        data={data}
        fixedHeaderContent={() => (
          <tr>
            {columns.map((col) => (
              <th
                key={col.id}
                style={{
                  width: col.width,
                  textAlign: col.align,
                  background: "var(--bg-panel)",
                }}
              >
                {typeof col.header === "string" ? col.header : col.id}
              </th>
            ))}
          </tr>
        )}
        itemContent={(_index, row) => (
          <>
            {columns.map((col) => (
              <td
                key={col.id}
                style={{ textAlign: col.align }}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {col.render ? col.render(row) : String(col.accessor?.(row) ?? "")}
              </td>
            ))}
          </>
        )}
        components={{
          Table: (props) => (
            <table {...props} className="table" aria-label={label} style={{ ...props.style, tableLayout: "fixed" }} />
          ),
          TableRow: (props: any) => (
            <tr
              {...props}
              style={{ cursor: onRowClick ? "pointer" : undefined, ...(props.style ?? {}) }}
            />
          ),
        }}
        computeItemKey={(_index, row) => rowKey(row)}
      />
    </div>
  );
}
