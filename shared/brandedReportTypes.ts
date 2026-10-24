/** A report export consumes the already-filtered data shown on its source page. */
export type BrandedReportColumn = { key: string; label: string; width?: number; align?: "left" | "right" };
export type BrandedReportRow = { key: string; cells: string[]; kind?: "section" | "subtotal" | "total" | "data" | "note"; depth?: number };
export type BrandedReportSection = { title: string; columns: BrandedReportColumn[]; rows: BrandedReportRow[]; description?: string };
export type BrandedReportChart = {
  title: string;
  description?: string;
  kind: "bars" | "lines" | "svg";
  labels?: string[];
  curve?: "linear" | "step";
  /** Amounts are cents unless valueUnit is number. */
  valueUnit?: "cents" | "number";
  series?: Array<{ label: string; color: string; values: Array<number | null>; plotSign?: 1 | -1 }>;
  /** Internal vector artwork generated from report data, never uploaded HTML. */
  svg?: { content: string; width: number; height: number; annotations?: Array<{ text: string; x: number; y: number; width: number; align?: "left" | "center" | "right" }> };
};
export type BrandedReportBlock = { kind: "chart"; chart: BrandedReportChart } | { kind: "table"; section: BrandedReportSection };
export type BrandedReportData = {
  title: string;
  subtitle?: string;
  filterSummary: string[];
  currency: string;
  columns?: BrandedReportColumn[];
  rows?: BrandedReportRow[];
  sections?: BrandedReportSection[];
  charts?: BrandedReportChart[];
  warnings?: string[];
  blocks?: BrandedReportBlock[];
};
