import { useMemo, useState, type KeyboardEvent } from "react";
import { formatMoney, formatMoneyCompact } from "../../lib/money";
import { ChartLegend } from "./ChartLegend";
import { ChartTooltip } from "./ChartTooltip";
import { useElementWidth, useSeriesVisibility } from "./hooks";
import { linePath } from "./paths";
import { barPath, estimateTextWidth, linearScale, niceDomain, thinIndexes } from "./scales";
import type { TooltipRow, ValueFormatter } from "./types";

export type FlowRow = {
  key: string;
  /** Axis label (short, e.g. "Apr"). */
  label: string;
  /** Tooltip heading (e.g. "April 2026"); defaults to `label`. */
  tooltipLabel?: string;
  /** Money (or count) coming in. */
  inflow: number;
  /** Money (or count) going out, as a positive magnitude. */
  outflow: number;
  /** Fade rows outside an active filter. */
  dimmed?: boolean;
};

const MARGIN = { top: 12, right: 12, bottom: 28 };
const MAX_BAR = 24;
const GAP = 2;
const KEYS = ["inflow", "outflow", "net"];

export type FlowBarChartProps = {
  rows: FlowRow[];
  ariaLabel: string;
  /** Diverging puts money out below the axis; grouped sets the bars side by side. */
  mode?: "diverging" | "grouped";
  showNet?: boolean;
  labels?: { inflow?: string; outflow?: string; net?: string };
  formatValue?: ValueFormatter;
  formatAxis?: ValueFormatter;
  height?: number;
  /** Whole-number axis (counts): ticks never fall between integers. */
  integerAxis?: boolean;
};

function useFlowGeometry(rows: FlowRow[], width: number, height: number, mode: "diverging" | "grouped", show: { inflow: boolean; outflow: boolean; net: boolean }, formatAxis: ValueFormatter, integerAxis: boolean) {
  return useMemo(() => {
    const net = rows.map((r) => r.inflow - r.outflow);
    const ins = show.inflow ? rows.map((r) => r.inflow) : [0];
    const outs = show.outflow ? rows.map((r) => (mode === "diverging" ? -r.outflow : r.outflow)) : [0];
    const nets = show.net ? net : [0];
    const all = [0, ...ins, ...outs, ...nets];
    const plotH = Math.max(40, height - MARGIN.top - MARGIN.bottom);
    const nice = niceDomain(Math.min(...all), Math.max(...all), Math.max(2, Math.round(plotH / 44)), integerAxis ? 1 : 0);
    const left = Math.max(32, ...nice.ticks.map((t) => estimateTextWidth(formatAxis(t)) + 12));
    const plotW = Math.max(20, width - left - MARGIN.right);
    const band = plotW / Math.max(1, rows.length);
    const y = linearScale(nice.domain, [MARGIN.top + plotH, MARGIN.top]);
    const centres = rows.map((_, i) => left + band * i + band / 2);
    const barW = mode === "diverging" ? Math.max(2, Math.min(MAX_BAR, band * 0.56)) : Math.max(2, Math.min(MAX_BAR, (band * 0.72 - GAP) / 2));
    return { y, left, plotW, plotH, band, centres, barW, ticks: nice.ticks, net, labelIdx: new Set(thinIndexes(rows.length, plotW, Math.max(40, ...rows.map((r) => estimateTextWidth(r.label, 6) + 14)))) };
  }, [formatAxis, height, integerAxis, mode, rows, show.inflow, show.net, show.outflow, width]);
}

export function FlowBarChart({ rows, ariaLabel, mode = "diverging", showNet = false, labels, formatValue = (v) => formatMoney(v), formatAxis = (v) => formatMoneyCompact(v), height = 240, integerAxis = false }: FlowBarChartProps) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const { hidden, toggle } = useSeriesVisibility(KEYS);
  const [active, setActive] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const names = { inflow: labels?.inflow ?? "Money in", outflow: labels?.outflow ?? "Money out", net: labels?.net ?? "Net change" };
  const show = { inflow: !hidden.has("inflow"), outflow: !hidden.has("outflow"), net: showNet && !hidden.has("net") };
  const geo = useFlowGeometry(rows, width, height, mode, show, formatAxis, integerAxis);
  const zeroY = geo.y(0);
  const plotBottom = MARGIN.top + geo.plotH;
  const legendItems = [
    { key: "inflow", label: names.inflow, color: "var(--dv-in)", shape: "bar" as const },
    { key: "outflow", label: names.outflow, color: "var(--dv-out)", shape: "bar" as const },
    ...(showNet ? [{ key: "net", label: names.net, color: "var(--dv-net)", shape: "line" as const }] : []),
  ];

  const describe = (i: number) => `${rows[i].tooltipLabel ?? rows[i].label}: ${names.inflow} ${formatValue(rows[i].inflow)}, ${names.outflow} ${formatValue(rows[i].outflow)}, ${names.net} ${formatValue(geo.net[i])}`;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!rows.length) return;
    const current = active ?? rows.length - 1;
    const next = event.key === "ArrowRight" ? Math.min(rows.length - 1, current + 1) : event.key === "ArrowLeft" ? Math.max(0, current - 1) : event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : null;
    if (event.key === "Escape") setActive(null);
    if (next == null) return;
    event.preventDefault();
    setActive(next);
    setAnnouncement(describe(next));
  };

  const activeRow = active != null ? rows[active] : null;
  const tooltipRows: TooltipRow[] = activeRow
    ? [
        ...(show.inflow ? [{ key: "inflow", label: names.inflow, value: formatValue(activeRow.inflow), color: "var(--dv-in)", swatch: "bar" as const }] : []),
        ...(show.outflow ? [{ key: "outflow", label: names.outflow, value: formatValue(activeRow.outflow), color: "var(--dv-out)", swatch: "bar" as const }] : []),
      ]
    : [];

  return (
    <div className="chart chart--flow">
      <ChartLegend items={legendItems} hidden={hidden} onToggle={toggle} />
      <div className="chart__plot" ref={containerRef} style={{ height }} tabIndex={0} role="group" aria-label={`${ariaLabel}. Use arrow keys to read each period.`} onKeyDown={onKeyDown} onBlur={() => setActive(null)}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel} onPointerLeave={() => setActive(null)}>
            <g className="chart-grid" aria-hidden="true">
              {geo.ticks.map((tick) => (
                <g key={tick}>
                  <line x1={geo.left} x2={geo.left + geo.plotW} y1={geo.y(tick)} y2={geo.y(tick)} className={tick === 0 ? "chart-zero" : undefined} />
                  <text x={geo.left - 8} y={geo.y(tick)} dy="0.32em" textAnchor="end" className="chart-axis-label">{formatAxis(tick)}</text>
                </g>
              ))}
              {rows.map((row, i) => geo.labelIdx.has(i) && (
                <text key={row.key} x={geo.centres[i]} y={plotBottom + 18} textAnchor="middle" className="chart-axis-label">{row.label}</text>
              ))}
            </g>
            {active != null && <rect x={geo.left + geo.band * active} y={MARGIN.top} width={geo.band} height={geo.plotH} className="chart-hover-band" aria-hidden="true" />}
            <g className="chart-bars" aria-hidden="true">
              {rows.map((row, i) => {
                const c = geo.centres[i];
                const inX = mode === "diverging" ? c - geo.barW / 2 : c - geo.barW - GAP / 2;
                const outX = mode === "diverging" ? c - geo.barW / 2 : c + GAP / 2;
                const outTip = mode === "diverging" ? geo.y(-row.outflow) : geo.y(row.outflow);
                return (
                  <g key={row.key} className={row.dimmed ? "is-dimmed" : undefined}>
                    {show.inflow && <path d={barPath(inX, geo.barW, zeroY, geo.y(row.inflow))} className="chart-bar chart-bar--up" style={{ fill: "var(--dv-in)" }} />}
                    {show.outflow && <path d={barPath(outX, geo.barW, zeroY, outTip)} className={`chart-bar ${mode === "diverging" ? "chart-bar--down" : "chart-bar--up"}`} style={{ fill: "var(--dv-out)" }} />}
                  </g>
                );
              })}
            </g>
            {show.net && rows.length > 0 && (
              <g className="chart-net" aria-hidden="true">
                <path d={linePath(geo.net.map((v, i) => ({ x: geo.centres[i], y: geo.y(v) })))} className="chart-line chart-draw" pathLength={1} style={{ stroke: "var(--dv-net)" }} />
                {geo.net.map((v, i) => <circle key={rows[i].key} cx={geo.centres[i]} cy={geo.y(v)} r={active === i ? 5 : 3.5} className="chart-dot" style={{ fill: "var(--dv-net)" }} />)}
              </g>
            )}
            <g className="chart-hit">
              {rows.map((row, i) => (
                <rect key={row.key} x={geo.left + geo.band * i} y={MARGIN.top} width={geo.band} height={geo.plotH} fill="transparent" onPointerEnter={() => setActive(i)} onPointerMove={() => active !== i && setActive(i)} />
              ))}
            </g>
          </svg>
        )}
        {activeRow && active != null && (
          <ChartTooltip x={geo.centres[active]} y={MARGIN.top} containerWidth={width} title={activeRow.tooltipLabel ?? activeRow.label} rows={tooltipRows} total={{ label: names.net, value: formatValue(geo.net[active]) }} />
        )}
        <span className="sr-only" aria-live="polite">{announcement}</span>
      </div>
    </div>
  );
}
