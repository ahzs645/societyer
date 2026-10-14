import { useId, useState, type ReactNode } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { Skeleton } from "../ui";
import type { ChartTable } from "./types";

export const NOT_ENOUGH_DATA = "Not enough data yet — import transactions to see trends.";

/**
 * Shell for every chart: title, subtitle, an actions slot, a loading skeleton,
 * an empty state, and the "View as table" twin that keeps every value
 * reachable without hovering (and for screen readers).
 */
export function ChartCard({
  title,
  subtitle,
  actions,
  loading,
  empty,
  emptyMessage = NOT_ENOUGH_DATA,
  table,
  height = 240,
  className,
  headingLevel = 2,
  children,
  footer,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  loading?: boolean;
  empty?: boolean;
  emptyMessage?: ReactNode;
  table?: ChartTable;
  /** Skeleton / empty-state height so the card does not jump when data lands. */
  height?: number;
  className?: string;
  headingLevel?: 2 | 3;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  const titleId = useId();
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const showTableToggle = Boolean(table) && !loading && !empty;
  return (
    <section className={`card chart-card${className ? ` ${className}` : ""}`} aria-labelledby={titleId}>
      <div className="card__head chart-card__head">
        <div className="chart-card__titles">
          <Heading className="card__title" id={titleId}>{title}</Heading>
          {subtitle && <span className="card__subtitle">{subtitle}</span>}
        </div>
        {(actions || showTableToggle) && (
          <div className="chart-card__actions">
            {actions}
            {showTableToggle && (
              <button
                type="button"
                className="btn btn--ghost btn--sm chart-card__table-toggle"
                aria-pressed={asTable}
                onClick={() => setAsTable((value) => !value)}
              >
                {asTable ? <BarChart3 size={14} aria-hidden="true" /> : <Table2 size={14} aria-hidden="true" />}
                {asTable ? "View as chart" : "View as table"}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="chart-card__body">
        {loading ? (
          <div className="chart-card__skeleton" aria-busy="true" aria-label="Loading chart">
            <Skeleton height={height} width="100%" radius={8} />
          </div>
        ) : empty ? (
          <div className="chart-card__empty" style={{ minHeight: Math.min(height, 160) }}>
            <BarChart3 size={18} aria-hidden="true" />
            <span>{emptyMessage}</span>
          </div>
        ) : asTable && table ? (
          <ChartDataTable table={table} />
        ) : (
          children
        )}
      </div>
      {footer && !loading && !empty && <div className="chart-card__footer">{footer}</div>}
    </section>
  );
}

export function ChartDataTable({ table }: { table: ChartTable }) {
  return (
    <div className="chart-table-scroll" tabIndex={0} role="region" aria-label={table.caption}>
      <table className="table chart-table">
        <caption className="sr-only">{table.caption}</caption>
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th key={column.key} scope="col" className={column.numeric ? "num" : undefined}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr key={index}>
              {table.columns.map((column, columnIndex) =>
                columnIndex === 0 ? (
                  <th key={column.key} scope="row">{row[column.key]}</th>
                ) : (
                  <td key={column.key} className={column.numeric ? "num" : undefined}>{row[column.key]}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
