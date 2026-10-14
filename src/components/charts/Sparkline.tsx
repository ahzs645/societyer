import { useElementWidth } from "./hooks";
import { linePath } from "./paths";
import { linearScale } from "./scales";

/**
 * Tiny trend line for stat tiles: no axes, the trend in the recessive
 * de-emphasis ink and the latest value as an accent dot. Decorative by
 * default — the tile's own number carries the value; pass `ariaLabel` to
 * describe the trend when it adds information.
 */
export function Sparkline({
  values,
  height = 32,
  curve = "linear",
  ariaLabel,
  color = "var(--dv-spark)",
  accent = "var(--dv-cat-1)",
}: {
  values: Array<number | null>;
  height?: number;
  curve?: "linear" | "step";
  ariaLabel?: string;
  color?: string;
  accent?: string;
}) {
  const [ref, width] = useElementWidth<HTMLSpanElement>();
  const numbers = values.filter((v): v is number => v != null && Number.isFinite(v));
  const pad = 5;
  const min = numbers.length ? Math.min(...numbers) : 0;
  const max = numbers.length ? Math.max(...numbers) : 1;
  const x = linearScale([0, Math.max(1, values.length - 1)], [pad, Math.max(pad + 1, width - pad)]);
  const y = linearScale(min === max ? [min - 1, max + 1] : [min, max], [height - pad, pad]);
  const points = values.map((v, i) => ({ x: x(i), y: v == null ? null : y(v) }));
  let lastIndex = -1;
  for (let i = values.length - 1; i >= 0; i -= 1) if (values[i] != null) { lastIndex = i; break; }
  return (
    <span className="sparkline" ref={ref} style={{ height }} role={ariaLabel ? "img" : undefined} aria-label={ariaLabel} aria-hidden={ariaLabel ? undefined : true}>
      {width > 0 && numbers.length > 1 && (
        <svg width={width} height={height} aria-hidden="true">
          <path d={linePath(points, curve)} className="sparkline__line chart-draw" pathLength={1} style={{ stroke: color }} />
          {lastIndex >= 0 && <circle cx={x(lastIndex)} cy={y(values[lastIndex]!)} r={3.5} className="chart-dot" style={{ fill: accent }} />}
        </svg>
      )}
    </span>
  );
}
