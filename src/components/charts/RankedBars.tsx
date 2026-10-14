import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { formatMoney } from "../../lib/money";
import type { ValueFormatter } from "./types";

export type RankedBarRow = {
  key: string;
  label: string;
  value: number;
  /** Share of the whole, 0..1, printed beside the value. */
  share?: number;
  /** Small context under the label, e.g. "4 payments". */
  detail?: ReactNode;
  /** Makes the row a link (e.g. to a filtered table). */
  href?: string;
};

const percent = (value: number, max: number) => (max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100)));
const shareText = (share: number) => (share > 0 && share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`);

/**
 * A ranked list with one horizontal bar per row, longest first, scaled to the
 * largest row. Every value and share is printed beside its bar, so nothing
 * depends on hover or on colour; the bar is one hue (`tone`).
 */
export function RankedBars({
  rows,
  ariaLabel,
  tone = "neutral",
  formatValue = (v) => formatMoney(v, { trimWholeCents: true }),
  linkLabel,
}: {
  rows: RankedBarRow[];
  ariaLabel: string;
  tone?: "in" | "out" | "neutral";
  formatValue?: ValueFormatter;
  /** Accessible name for a row link, e.g. (row) => `Show transactions for ${row.label}`. */
  linkLabel?: (row: RankedBarRow) => string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ol className={`ranked-bars ranked-bars--${tone}`} aria-label={ariaLabel}>
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
              {row.href && <ChevronRight size={14} className="ranked-bars__chevron" aria-hidden="true" />}
            </span>
            <span className="ranked-bars__track" aria-hidden="true">
              <span className="ranked-bars__fill chart-grow-x" style={{ width: `${percent(row.value, max)}%` }} />
            </span>
          </>
        );
        return (
          <li key={row.key} className="ranked-bars__item">
            {row.href ? (
              <Link className="ranked-bars__row ranked-bars__row--link" to={row.href} aria-label={linkLabel?.(row)}>
                {content}
              </Link>
            ) : (
              <div className="ranked-bars__row">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
