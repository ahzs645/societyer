export type ValueFormatter = (value: number) => string;

/** One plotted series. `color` is a CSS colour, normally a `var(--dv-*)` token. */
export type ChartSeries = {
  key: string;
  label: string;
  color: string;
  /** Line (default) or line with a gradient area wash beneath it. */
  variant?: "line" | "area";
  /** Dashed and recessive, e.g. a "previous period" comparison. */
  comparison?: boolean;
  /** Leave out of the legend (still shown in the tooltip). */
  hideFromLegend?: boolean;
};

/** A row of a time series: an ISO date plus one numeric value per series key. */
export type TimeRow = { date: string } & Record<string, number | string | null | undefined>;

export type DateRange = { start: string; end: string };

export type TooltipRow = {
  key: string;
  label: string;
  value: string;
  color?: string;
  /** Line key style in the tooltip ("line" for lines, "bar" for bars). */
  swatch?: "line" | "dashed" | "bar";
};

export type TableColumn = { key: string; label: string; numeric?: boolean };

export type ChartTable = {
  caption: string;
  columns: TableColumn[];
  rows: Array<Record<string, string | number>>;
};
