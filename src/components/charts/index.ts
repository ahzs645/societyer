/**
 * Societyer chart kit: dependency-free, responsive SVG charts that read their
 * colours from the `--dv-*` tokens (light and dark), expose a "View as table"
 * twin, keyboard reading and reduced-motion-aware draw-in.
 *
 * Import from a lazily loaded module where the chart is not above the fold of
 * the initial route.
 */
export { ChartCard, ChartDataTable, NOT_ENOUGH_DATA } from "./ChartCard";
export { ChartLegend, type LegendItem } from "./ChartLegend";
export { ChartTooltip } from "./ChartTooltip";
export { TimeSeriesChart, type TimeSeriesChartProps } from "./TimeSeriesChart";
export { FlowBarChart, type FlowRow, type FlowBarChartProps } from "./FlowBarChart";
export { BudgetBars, type BudgetBarRow, type BudgetBarLabels } from "./BudgetBars";
export { Sparkline } from "./Sparkline";
export * from "./dates";
export type { ChartSeries, ChartTable, DateRange, TimeRow, TooltipRow, ValueFormatter } from "./types";
