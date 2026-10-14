import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { X } from "lucide-react";
import { formatMoney, formatMoneyCompact } from "../../lib/money";
import { ChartLegend } from "./ChartLegend";
import { ChartTooltip } from "./ChartTooltip";
import { formatDay } from "./dates";
import { useCoarsePointer, useElementWidth, useSeriesVisibility } from "./hooks";
import { areaPath, linePath } from "./paths";
import { estimateTextWidth, linearScale, nearestIndex, niceDomain } from "./scales";
import { timeTicks } from "./timeAxis";
import type { ChartSeries, DateRange, TimeRow, TooltipRow, ValueFormatter } from "./types";
import { useRangeSelection } from "./useRangeSelection";

const MARGIN = { top: 14, right: 16, bottom: 28 };
const defaultValue: ValueFormatter = (value) => formatMoney(value);
const defaultAxis: ValueFormatter = (value) => formatMoneyCompact(value);

export type TimeSeriesChartProps = {
  /** Evenly spaced rows (daily, weekly or monthly), ascending by date. */
  data: TimeRow[];
  series: ChartSeries[];
  /** One-sentence summary of what the chart shows, read by screen readers. */
  ariaLabel: string;
  /** Total height including the x-axis band. */
  height?: number;
  curve?: "linear" | "step";
  formatValue?: ValueFormatter;
  formatAxis?: ValueFormatter;
  formatDate?: (date: string) => string;
  includeZero?: boolean;
  /** Draw the mean of one series as a recessive reference line. */
  average?: { key: string; label?: string };
  /** Legend shows by default whenever two or more series are listed. */
  legend?: boolean;
  /** Controlled selected range (drag-to-select). */
  selection?: DateRange | null;
  onRangeChange?: (range: DateRange | null) => void;
  minSelectionDays?: number;
  /** Drag-to-select is off on touch-first devices unless this is set. */
  allowSelectOnCoarsePointer?: boolean;
  tooltipTotal?: (row: TimeRow) => { label: string; value: string } | null;
  /** Whole-number axis (counts): ticks never fall between integers. */
  integerAxis?: boolean;
};

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function useGeometry(data: TimeRow[], visible: ChartSeries[], width: number, height: number, includeZero: boolean, formatAxis: ValueFormatter, averageKey?: string, integerAxis = false) {
  return useMemo(() => {
    const dates = data.map((row) => row.date);
    const values: number[] = [];
    for (const row of data) for (const s of visible) {
      const v = numeric(row[s.key]);
      if (v != null) values.push(v);
    }
    const zero = includeZero || visible.some((s) => s.variant === "area");
    let min = values.length ? Math.min(...values) : 0;
    let max = values.length ? Math.max(...values) : 1;
    if (zero) {
      min = Math.min(0, min);
      max = Math.max(0, max);
    }
    const plotH = Math.max(40, height - MARGIN.top - MARGIN.bottom);
    const nice = niceDomain(min, max, Math.max(2, Math.round(plotH / 48)), integerAxis ? 1 : 0);
    const left = Math.max(32, ...nice.ticks.map((t) => estimateTextWidth(formatAxis(t)) + 12));
    const plotW = Math.max(20, width - left - MARGIN.right);
    const n = dates.length;
    const xs = dates.map((_, i) => (n === 1 ? left + plotW / 2 : left + (i * plotW) / (n - 1)));
    const y = linearScale(nice.domain, [MARGIN.top + plotH, MARGIN.top]);
    const [d0, d1] = nice.domain;
    const baseline = y(Math.min(Math.max(0, d0), d1));
    const avgValues = averageKey ? data.map((row) => numeric(row[averageKey])).filter((v): v is number => v != null) : [];
    const average = avgValues.length ? avgValues.reduce((a, b) => a + b, 0) / avgValues.length : null;
    return { dates, xs, y, left, plotW, plotH, ticks: nice.ticks, zeroInDomain: d0 <= 0 && d1 >= 0, baseline, xTicks: timeTicks(dates, plotW), average };
  }, [averageKey, data, formatAxis, height, includeZero, integerAxis, visible, width]);
}

export function TimeSeriesChart(props: TimeSeriesChartProps) {
  const { data, series, ariaLabel, height = 240, curve = "linear", formatValue = defaultValue, formatAxis = defaultAxis, formatDate = formatDay, includeZero = false, average, legend, selection, onRangeChange, minSelectionDays = 7, allowSelectOnCoarsePointer = false, tooltipTotal, integerAxis = false } = props;
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const keys = useMemo(() => series.map((s) => s.key), [series]);
  const { hidden, toggle } = useSeriesVisibility(keys);
  const visible = useMemo(() => series.filter((s) => !hidden.has(s.key)), [hidden, series]);
  const coarse = useCoarsePointer();
  const selectable = Boolean(onRangeChange) && (!coarse || allowSelectOnCoarsePointer);
  const [active, setActive] = useState<number | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [announcement, setAnnouncement] = useState("");
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const geo = useGeometry(data, visible, width, height, includeZero, formatAxis, average && !hidden.has(average.key) ? average.key : undefined, integerAxis);
  const sel = useRangeSelection({ dates: geo.dates, xs: geo.xs, selection, onRangeChange, minDays: minSelectionDays, enabled: selectable });
  const legendItems = series.filter((s) => !s.hideFromLegend).map((s) => ({ key: s.key, label: s.label, color: s.color, shape: s.comparison ? ("dashed" as const) : s.variant === "area" ? ("bar" as const) : ("line" as const) }));
  const showLegend = legend ?? legendItems.length > 1;
  const primary = visible.find((s) => !s.comparison);

  const describe = (index: number) => {
    const row = data[index];
    const parts = visible.map((s) => `${s.label} ${numeric(row[s.key]) == null ? "no data" : formatValue(numeric(row[s.key])!)}`);
    return `${formatDate(row.date)}: ${parts.join(", ")}`;
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    sel.handlers.onPointerMove(event);
    const px = event.clientX - event.currentTarget.getBoundingClientRect().left;
    setActive(nearestIndex(geo.xs, px));
    setCursor(sel.dragging ? "grabbing" : sel.cursorAt(px));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const n = data.length;
    if (n === 0) return;
    const current = active ?? n - 1;
    let next = current;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const direction = event.key === "ArrowRight" ? 1 : -1;
      if (event.shiftKey && selectable) sel.grow(direction, current);
      else next = Math.min(n - 1, Math.max(0, current + direction));
    } else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = n - 1;
    else if (event.key === "Escape") {
      if (selection) sel.clear();
      else setActive(null);
      event.preventDefault();
      return;
    } else return;
    event.preventDefault();
    setActive(next);
    setAnnouncement(describe(next));
  };

  const activeRow = active != null ? data[active] : null;
  const tooltipRows: TooltipRow[] = activeRow
    ? visible.map((s) => ({ key: s.key, label: s.label, color: s.color, swatch: s.comparison ? "dashed" : "line", value: numeric(activeRow[s.key]) == null ? "—" : formatValue(numeric(activeRow[s.key])!) }))
    : [];
  const hint = selectable ? " Use arrow keys to read values. Shift with arrow keys selects a date range; Escape clears it." : " Use arrow keys to read values.";
  const plotBottom = MARGIN.top + geo.plotH;

  return (
    <div className="chart chart--time">
      {showLegend && <ChartLegend items={legendItems} hidden={hidden} onToggle={toggle} />}
      <div
        className={`chart__plot${selectable ? " is-selectable" : ""}`}
        ref={containerRef}
        style={{ height }}
        tabIndex={0}
        role="group"
        aria-label={`${ariaLabel}.${hint}`}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={ariaLabel}
            style={{ cursor }}
            onPointerDown={sel.handlers.onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={sel.handlers.onPointerUp}
            onPointerCancel={sel.handlers.onPointerCancel}
            onPointerLeave={() => !sel.dragging && setActive(null)}
          >
            <defs>
              {visible.filter((s) => s.variant === "area").map((s) => (
                <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" style={{ stopColor: s.color, stopOpacity: 0.22 }} />
                  <stop offset="100%" style={{ stopColor: s.color, stopOpacity: 0 }} />
                </linearGradient>
              ))}
            </defs>
            <g className="chart-grid" aria-hidden="true">
              {geo.ticks.map((tick) => (
                <g key={tick}>
                  <line x1={geo.left} x2={geo.left + geo.plotW} y1={geo.y(tick)} y2={geo.y(tick)} className={tick === 0 ? "chart-zero" : undefined} />
                  <text x={geo.left - 8} y={geo.y(tick)} dy="0.32em" textAnchor="end" className="chart-axis-label">{formatAxis(tick)}</text>
                </g>
              ))}
              {geo.xTicks.map((tick) => (
                <text key={tick.index} x={geo.xs[tick.index]} y={plotBottom + 18} textAnchor={tick.index === 0 ? "start" : geo.xs[tick.index] > geo.left + geo.plotW - 28 ? "end" : "middle"} className="chart-axis-label">{tick.label}</text>
              ))}
            </g>
            {sel.range && <SelectionOverlay x0={geo.xs[sel.range.start]} x1={geo.xs[sel.range.end]} top={MARGIN.top} bottom={plotBottom} left={geo.left} right={geo.left + geo.plotW} />}
            <g className="chart-series">
              {visible.map((s) => {
                const points = data.map((row, i) => ({ x: geo.xs[i], y: numeric(row[s.key]) == null ? null : geo.y(numeric(row[s.key])!) }));
                return (
                  <g key={s.key}>
                    {s.variant === "area" && <path d={areaPath(points, geo.baseline, curve)} fill={`url(#${uid}-${s.key})`} className="chart-area" />}
                    <path d={linePath(points, curve)} style={{ stroke: s.color }} pathLength={s.comparison ? undefined : 1} className={s.comparison ? "chart-line chart-line--comparison" : "chart-line chart-draw"} />
                  </g>
                );
              })}
            </g>
            {geo.average != null && <AverageLine y={geo.y(geo.average)} left={geo.left} right={geo.left + geo.plotW} label={`${average?.label ?? "Avg"} ${formatAxis(geo.average)}`} />}
            {primary && active == null && <EndDot data={data} xs={geo.xs} y={geo.y} seriesKey={primary.key} color={primary.color} />}
            {activeRow && active != null && (
              <g className="chart-crosshair" aria-hidden="true">
                <line x1={geo.xs[active]} x2={geo.xs[active]} y1={MARGIN.top} y2={plotBottom} />
                {visible.map((s) => numeric(activeRow[s.key]) == null ? null : (
                  <circle key={s.key} cx={geo.xs[active]} cy={geo.y(numeric(activeRow[s.key])!)} r={4} className="chart-dot" style={{ fill: s.color }} />
                ))}
              </g>
            )}
          </svg>
        )}
        {activeRow && active != null && !sel.dragging && (
          <ChartTooltip x={geo.xs[active]} y={MARGIN.top} containerWidth={width} title={formatDate(activeRow.date)} rows={tooltipRows} total={tooltipTotal?.(activeRow) ?? undefined} />
        )}
        {selectable && selection && (
          <button type="button" className="chart-clear" onClick={sel.clear} aria-label="Clear selected date range">
            <X size={12} aria-hidden="true" /> Clear
          </button>
        )}
        <span className="sr-only" aria-live="polite">{announcement}</span>
      </div>
    </div>
  );
}

function SelectionOverlay({ x0, x1, top, bottom, left, right }: { x0: number; x1: number; top: number; bottom: number; left: number; right: number }) {
  const h = bottom - top;
  return (
    <g className="chart-selection" aria-hidden="true">
      <rect x={left} y={top} width={Math.max(0, x0 - left)} height={h} className="chart-selection__dim" />
      <rect x={x1} y={top} width={Math.max(0, right - x1)} height={h} className="chart-selection__dim" />
      <rect x={x0} y={top} width={Math.max(1, x1 - x0)} height={h} className="chart-selection__fill" />
      <line x1={x0} x2={x0} y1={top} y2={bottom} className="chart-selection__edge" />
      <line x1={x1} x2={x1} y1={top} y2={bottom} className="chart-selection__edge" />
      <rect x={x0 - 3} y={top + h / 2 - 10} width={6} height={20} rx={3} className="chart-selection__handle" />
      <rect x={x1 - 3} y={top + h / 2 - 10} width={6} height={20} rx={3} className="chart-selection__handle" />
    </g>
  );
}

function AverageLine({ y, left, right, label }: { y: number; left: number; right: number; label: string }) {
  return (
    <g className="chart-average" aria-hidden="true">
      <line x1={left} x2={right} y1={y} y2={y} />
      <text x={left + 6} y={y - 6} className="chart-ref-label">{label}</text>
    </g>
  );
}

function EndDot({ data, xs, y, seriesKey, color }: { data: TimeRow[]; xs: number[]; y: (v: number) => number; seriesKey: string; color: string }) {
  for (let i = data.length - 1; i >= 0; i -= 1) {
    const value = numeric(data[i][seriesKey]);
    if (value != null) return <circle cx={xs[i]} cy={y(value)} r={4} className="chart-dot chart-fade" style={{ fill: color }} aria-hidden="true" />;
  }
  return null;
}
