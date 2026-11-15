/** Pieces the analytics views share: ranked bars that act, a heatmap, and the "still loading" line. */
import { useState, type ComponentProps, type ReactNode } from "react";
import { BarChart3, ChevronRight, MoreHorizontal, Table2 } from "lucide-react";
import { ChartCard, ChartDataTable, type ChartTable } from "../../../../components/charts";
import { Menu, type MenuSection } from "../../../../components/Menu";
import { Progress } from "../../../../components/primitives";
import { compact, count, counted, money, percent, type Slice } from "../../lib/market";
import { plainClick } from "../ReaderHeader";
import type { RecordList } from "../source";

export type RankedRow = {
  key: string;
  label: string;
  value: number;
  share?: number;
  detail?: ReactNode;
  /** The row's own page (a buyer or supplier), so a middle-click opens it in a new tab. */
  href?: string;
  /** Beside the name, such as "Us" on the workspace's own organisation. */
  badge?: ReactNode;
};

const width = (value: number, max: number) => (max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100)));
const shareText = (share: number) => (share > 0 && share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`);

/**
 * An amount as every figure in the analytics shows one: compact ("$59.9M"),
 * with the exact amount ("$59,944,140") as its tooltip, so prose, tiles and
 * bars never mix the two styles.
 */
export function Amount({ value, currency }: { value: number | null; currency: string }) {
  return <span title={value === null ? undefined : money(value, currency)}>{money(value, currency, true)}</span>;
}

/** Rows below this share of the whole fold into one "+N more" row: their bars would be slivers. */
const FOLD_SHARE = 0.02;
/** The leaders always show, however small, so a fragmented market still lists someone. */
const FOLD_KEEP = 3;
export type FoldedRest = { count: number; value: number };

/**
 * The leading rows of a ranking, up to `limit`, without the ones too small to
 * draw; whatever is left is counted and summed for the "+N more" row, so the
 * list still accounts for the whole.
 */
export function foldRanked(rows: RankedRow[], limit: number): { rows: RankedRow[]; rest: FoldedRest | null } {
  const shown = rows.slice(0, limit).filter((row, index) => index < FOLD_KEEP || row.share == null || row.share >= FOLD_SHARE);
  const kept = new Set(shown.map((row) => row.key));
  const left = rows.filter((row) => !kept.has(row.key));
  return { rows: shown, rest: left.length ? { count: left.length, value: left.reduce((n, row) => n + row.value, 0) } : null };
}

/**
 * The chart kit's ranked bars (`RankedBars`, same classes and layout), with a
 * row that runs an action instead of following a link: open a buyer or a
 * supplier, focus the analysis on a type, or list a slice's awards. A row
 * with an `href` is a real link the reader handles itself on a plain click.
 * `rest` adds the "+N more" row that `foldRanked` leaves, which opens `onMore`
 * (the card's table, where every row is listed). `menu` puts a "⋯" beside a
 * row for what else it can do (its awards, its page, leaving it out of the
 * analysis); it sits beside the row's own button, never inside it.
 */
export function RankedList({ rows, ariaLabel, formatValue, exactValue, onSelect, selectLabel, rest, onMore, menu }: {
  rows: RankedRow[];
  ariaLabel: string;
  formatValue: (value: number) => string;
  /** The exact figure, as the value's tooltip, when `formatValue` is compact. */
  exactValue?: (value: number) => string;
  onSelect?: (row: RankedRow) => void;
  selectLabel?: (row: RankedRow) => string;
  rest?: FoldedRest | null;
  onMore?: () => void;
  menu?: (row: RankedRow) => MenuSection[];
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ol className="ranked-bars ranked-bars--neutral" aria-label={ariaLabel}>
      {rows.map((row) => {
        const content = (
          <>
            <span className="ranked-bars__head">
              <span className="ranked-bars__label">
                <span className="ranked-bars__name">{row.label}{row.badge && <> {row.badge}</>}</span>
                {row.detail && <span className="ranked-bars__detail">{row.detail}</span>}
              </span>
              <span className="ranked-bars__values">
                <strong title={exactValue?.(row.value)}>{formatValue(row.value)}</strong>
                {row.share != null && <span className="ranked-bars__share">{shareText(row.share)}</span>}
              </span>
              {onSelect && <ChevronRight size={14} className="ranked-bars__chevron" aria-hidden="true" />}
            </span>
            <span className="ranked-bars__track" aria-hidden="true">
              <span className="ranked-bars__fill chart-grow-x" style={{ width: `${width(row.value, max)}%`, minWidth: row.value > 0 ? 3 : 0 }} />
            </span>
          </>
        );
        const className = "ranked-bars__row ranked-bars__row--link procurement-analytics__bar-button";
        const sections = menu?.(row).filter((section) => section.items.length) ?? [];
        return (
          <li key={row.key} className={`ranked-bars__item${sections.length ? " procurement-analytics__ranked-item" : ""}`}>
            {onSelect && row.href ? (
              <a
                className={className}
                href={row.href}
                aria-label={selectLabel?.(row)}
                onClick={(event) => {
                  if (!plainClick(event)) return;
                  event.preventDefault();
                  onSelect(row);
                }}
              >
                {content}
              </a>
            ) : onSelect ? (
              <button type="button" className={className} aria-label={selectLabel?.(row)} onClick={() => onSelect(row)}>
                {content}
              </button>
            ) : (
              <div className="ranked-bars__row">{content}</div>
            )}
            {sections.length > 0 && (
              <Menu
                align="right"
                label={row.label}
                sheetTitle={row.label}
                sections={sections}
                trigger={
                  <button type="button" className="btn btn--ghost btn--sm btn--icon procurement-analytics__row-menu" aria-label={`More for ${row.label}`}>
                    <MoreHorizontal size={14} aria-hidden="true" />
                  </button>
                }
              />
            )}
          </li>
        );
      })}
      {rest && (
        <li className="ranked-bars__item procurement-analytics__more-row">
          {onMore ? (
            <button type="button" className="ranked-bars__row ranked-bars__row--link procurement-analytics__bar-button" onClick={onMore} aria-label={`${count(rest.count)} more, ${formatValue(rest.value)}: view every row as a table`}>
              <span className="ranked-bars__head">
                <span className="ranked-bars__label"><span className="ranked-bars__name">+{count(rest.count)} more</span></span>
                <span className="ranked-bars__values"><strong title={exactValue?.(rest.value)}>{formatValue(rest.value)}</strong></span>
                <ChevronRight size={14} className="ranked-bars__chevron" aria-hidden="true" />
              </span>
            </button>
          ) : (
            <div className="ranked-bars__row">
              <span className="ranked-bars__head">
                <span className="ranked-bars__label"><span className="ranked-bars__name">+{count(rest.count)} more</span></span>
                <span className="ranked-bars__values"><strong title={exactValue?.(rest.value)}>{formatValue(rest.value)}</strong></span>
              </span>
            </div>
          )}
        </li>
      )}
    </ol>
  );
}

/**
 * A chart card whose "View as table" the content can open too: the folded
 * "+N more" row of a ranking leads to the table, where every row is listed.
 * The same toggle and table as `ChartCard`'s own.
 */
export function RankedCard({ table, actions, children, ...card }: Omit<ComponentProps<typeof ChartCard>, "table" | "children"> & {
  table: ChartTable;
  children: (showTable: () => void) => ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  const toggle = !card.empty && !card.loading && (
    <button type="button" className="btn btn--ghost btn--sm chart-card__table-toggle" aria-pressed={asTable} onClick={() => setAsTable((value) => !value)}>
      {asTable ? <BarChart3 size={14} aria-hidden="true" /> : <Table2 size={14} aria-hidden="true" />}
      {asTable ? "View as chart" : "View as table"}
    </button>
  );
  return (
    <ChartCard {...card} actions={actions || toggle ? <>{actions}{toggle}</> : undefined}>
      {asTable ? <ChartDataTable table={table} /> : children(() => setAsTable(true))}
    </ChartCard>
  );
}

type Cell = { row: string; column: string; count: number; value: number; slice: Slice };

/**
 * Zoer's heatmap: buyers down the side, months or types across, each cell's
 * shade its share of the largest cell (or of its row). Every value is printed;
 * a cell lists its awards and a buyer heading opens the buyer.
 */
export function Heatmap({ rows, columns, cells, metric, currency, normalized, columnLabel, onCell, onRow, caption }: {
  rows: string[]; columns: string[]; cells: Cell[]; metric: "value" | "count"; currency: string; normalized: boolean;
  columnLabel: (column: string) => string; onCell: (cell: Cell) => void; onRow: (row: string) => void; caption: string;
}) {
  if (!rows.length || !columns.length) return <p className="muted procurement-analytics__empty">No recorded awards match this view.</p>;
  const index = new Map(cells.map((cell) => [JSON.stringify([cell.row, cell.column]), cell]));
  const maximum = Math.max(1, ...cells.map((cell) => Math.max(0, cell[metric])));
  const totals = new Map(rows.map((row) => [row, cells.filter((cell) => cell.row === row).reduce((n, cell) => n + Math.max(0, cell[metric]), 0)]));
  return (
    <div className="procurement-analytics__heat-scroll" tabIndex={0} role="region" aria-label={caption}>
      <table className="procurement-analytics__heatmap">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Buyer</th>
            {columns.map((column) => <th scope="col" key={column}>{columnLabel(column)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <th scope="row">
                <button type="button" className="procurement-analytics__heat-row" onClick={() => onRow(row)} aria-label={`Open buyer ${row}`}>
                  <span>{row}</span>
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </th>
              {columns.map((column) => {
                const cell = index.get(JSON.stringify([row, column]));
                if (!cell) return <td key={column} />;
                const ratio = Math.max(0, cell[metric]) / (normalized ? totals.get(row) || 1 : maximum);
                const shown = normalized ? percent(ratio) : metric === "value" ? compact(cell.value) : count(cell.count);
                const full = metric === "value" ? money(cell.value, currency) : counted(cell.count, "award");
                return (
                  <td key={column}>
                    <button
                      type="button"
                      className="procurement-analytics__heat-cell"
                      style={{ backgroundColor: `color-mix(in srgb, var(--dv-cat-1) ${cell.count ? 10 + ratio * 60 : 0}%, transparent)` }}
                      disabled={!cell.count}
                      aria-label={`${row}, ${columnLabel(column)}: ${full}; ${counted(cell.count, "award")}`}
                      onClick={() => onCell(cell)}
                    >
                      {cell.count ? shown : "·"}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Loading 4,000 of 21,877 awards…" with a bar, until the whole list is in; the figures are partial until then. */
export function LoadingLine({ list, noun }: { list: RecordList | undefined; noun: string }) {
  if (list?.done) return null;
  const loaded = list?.rows.length ?? 0;
  const total = list?.total ?? 0;
  return (
    <div className="procurement-analytics__loading" role="status">
      <span>
        {total ? `Loading ${count(loaded)} of ${count(total)} ${noun}…` : `Loading ${noun}…`}
        {loaded > 0 && <span className="muted"> Figures below are partial until every one has loaded.</span>}
      </span>
      {total > 0 && <Progress value={(loaded / total) * 100} />}
    </div>
  );
}
