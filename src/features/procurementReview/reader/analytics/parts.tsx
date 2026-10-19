/** Pieces the analytics views share: ranked bars that act, a heatmap, and the "still loading" line. */
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Progress } from "../../../../components/primitives";
import { compact, count, counted, money, percent, type Slice } from "../../lib/market";
import type { RecordList } from "../source";

export type RankedRow = { key: string; label: string; value: number; share?: number; detail?: ReactNode };

const width = (value: number, max: number) => (max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100)));
const shareText = (share: number) => (share > 0 && share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`);

/**
 * The chart kit's ranked bars (`RankedBars`, same classes and layout), with a
 * row that runs an action instead of following a link: open a buyer, focus
 * the analysis on a supplier, or list a slice's awards.
 */
export function RankedList({ rows, ariaLabel, formatValue, onSelect, selectLabel }: {
  rows: RankedRow[];
  ariaLabel: string;
  formatValue: (value: number) => string;
  onSelect?: (row: RankedRow) => void;
  selectLabel?: (row: RankedRow) => string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ol className="ranked-bars ranked-bars--neutral" aria-label={ariaLabel}>
      {rows.map((row) => {
        const content = (
          <>
            <span className="ranked-bars__head">
              <span className="ranked-bars__label">
                <span className="ranked-bars__name">{row.label}</span>
                {row.detail && <span className="ranked-bars__detail">{row.detail}</span>}
              </span>
              <span className="ranked-bars__values">
                <strong>{formatValue(row.value)}</strong>
                {row.share != null && <span className="ranked-bars__share">{shareText(row.share)}</span>}
              </span>
              {onSelect && <ChevronRight size={14} className="ranked-bars__chevron" aria-hidden="true" />}
            </span>
            <span className="ranked-bars__track" aria-hidden="true">
              <span className="ranked-bars__fill chart-grow-x" style={{ width: `${width(row.value, max)}%` }} />
            </span>
          </>
        );
        return (
          <li key={row.key} className="ranked-bars__item">
            {onSelect ? (
              <button type="button" className="ranked-bars__row ranked-bars__row--link procurement-analytics__bar-button" aria-label={selectLabel?.(row)} onClick={() => onSelect(row)}>
                {content}
              </button>
            ) : (
              <div className="ranked-bars__row">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
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
