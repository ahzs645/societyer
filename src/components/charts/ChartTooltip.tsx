import type { TooltipRow } from "./types";

const TOOLTIP_GAP = 12;
const TOOLTIP_WIDTH_GUESS = 200;

/**
 * Floating readout for a chart (elevation-2). Values lead, series labels
 * follow; rows are keyed with a short stroke of the series colour. Positioned
 * inside the chart container and flipped to the left near the right edge.
 */
export function ChartTooltip({
  x,
  y = 8,
  containerWidth,
  title,
  rows,
  total,
}: {
  x: number;
  y?: number;
  containerWidth: number;
  title: string;
  rows: TooltipRow[];
  total?: { label: string; value: string };
}) {
  const flip = x + TOOLTIP_GAP + TOOLTIP_WIDTH_GUESS > containerWidth && x - TOOLTIP_GAP - TOOLTIP_WIDTH_GUESS > 0;
  const fits = x + TOOLTIP_GAP + TOOLTIP_WIDTH_GUESS <= containerWidth;
  // On narrow charts with no room either side, centre the tooltip over the top.
  const style: React.CSSProperties = flip
    ? { right: Math.max(0, containerWidth - x + TOOLTIP_GAP), top: y }
    : fits
      ? { left: x + TOOLTIP_GAP, top: y }
      : { left: Math.max(0, Math.min(x - TOOLTIP_WIDTH_GUESS / 2, containerWidth - TOOLTIP_WIDTH_GUESS)), top: y };
  return (
    <div className="chart-tooltip" style={style} aria-hidden="true">
      <div className="chart-tooltip__title">{title}</div>
      <ul className="chart-tooltip__rows">
        {rows.map((row) => (
          <li key={row.key} className="chart-tooltip__row">
            <span
              className={`chart-swatch chart-swatch--${row.swatch ?? "line"}`}
              style={{ "--swatch": row.color ?? "currentColor" } as React.CSSProperties}
            />
            <strong className="chart-tooltip__value">{row.value}</strong>
            <span className="chart-tooltip__label">{row.label}</span>
          </li>
        ))}
      </ul>
      {total && (
        <div className="chart-tooltip__total">
          <strong className="chart-tooltip__value">{total.value}</strong>
          <span className="chart-tooltip__label">{total.label}</span>
        </div>
      )}
    </div>
  );
}
