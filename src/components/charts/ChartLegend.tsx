import type { MouseEvent } from "react";

export type LegendItem = {
  key: string;
  label: string;
  color: string;
  /** Swatch mirrors the mark: a line key for lines, a block for bars/areas. */
  shape?: "line" | "dashed" | "bar";
};

/**
 * Interactive legend. Click toggles a series; Alt/Option-click shows only that
 * series (Alt-click it again to show everything). Colours follow the series,
 * never their position, so hiding one never repaints the others.
 */
export function ChartLegend({
  items,
  hidden,
  onToggle,
  label = "Chart series",
}: {
  items: LegendItem[];
  hidden?: Set<string>;
  onToggle?: (key: string, isolate: boolean) => void;
  label?: string;
}) {
  if (items.length === 0) return null;
  const interactive = Boolean(onToggle) && items.length > 1;
  return (
    <ul className="chart-legend" aria-label={label}>
      {items.map((item) => {
        const off = hidden?.has(item.key) ?? false;
        const swatch = <span className={`chart-swatch chart-swatch--${item.shape ?? "bar"}`} style={{ "--swatch": item.color } as React.CSSProperties} aria-hidden="true" />;
        return (
          <li key={item.key}>
            {interactive ? (
              <button
                type="button"
                className={`chart-legend__item${off ? " is-off" : ""}`}
                aria-pressed={!off}
                title="Click to show or hide. Alt-click to show only this series."
                onClick={(event: MouseEvent) => onToggle?.(item.key, event.altKey)}
              >
                {swatch}
                <span>{item.label}</span>
              </button>
            ) : (
              <span className="chart-legend__item chart-legend__item--static">
                {swatch}
                <span>{item.label}</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
