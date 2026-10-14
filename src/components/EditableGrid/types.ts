import type { ReactNode } from "react";

/** Every grid row carries a stable client key; other fields are column values. */
export type GridRow = { key: string } & Record<string, unknown>;

export type GridColumnType = "text" | "number" | "money" | "date" | "select" | "computed";

export type GridOption = {
  value: string;
  label: string;
  /** Secondary text in the picker (e.g. account type). */
  hint?: string;
  /** Extra terms that match when searching or pasting (e.g. an account code). */
  keywords?: string[];
};

export type GridColumn<R extends GridRow = GridRow> = {
  /** Field on the row this column reads and writes. */
  key: string;
  header: string;
  type: GridColumnType;
  /** Column width in px (the grid lays out with fixed widths). */
  width?: number;
  placeholder?: string;
  /** Required once a row has any value; blank rows are never flagged. */
  required?: boolean;
  readOnly?: boolean | ((row: R) => boolean);
  /** Sum this numeric/money column in the totals footer. */
  total?: boolean;
  /** ISO currency for money columns (defaults to the workspace default). */
  currency?: string;
  /** Options for select columns (may depend on the row). */
  options?: GridOption[] | ((row: R) => GridOption[]);
  /** Computed columns: derive a value from the row. */
  compute?: (row: R) => unknown;
  /** How a computed value is displayed and totalled. */
  valueType?: "text" | "number" | "money";
  /** Extra validation on a parsed (valid) value. Return an error message or null. */
  validate?: (value: unknown, row: R, rows: R[]) => string | null | undefined;
  /** Accessible description shown in the header tooltip. */
  description?: string;
};

export type CellRef = { r: number; c: number };

export type CellRange = { r0: number; r1: number; c0: number; c1: number };

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

export type GridHistory = {
  undo: () => string | null;
  redo: () => string | null;
  canUndo: boolean;
  canRedo: boolean;
};

export type GridSelectionInfo = {
  range: CellRange | null;
  /** Column keys covered by the selection. */
  columnKeys: string[];
  /** Row keys covered by the selection. */
  rowKeys: string[];
};

export type EditableGridProps<R extends GridRow> = {
  /** Accessible name for the grid. */
  label: string;
  columns: GridColumn<R>[];
  rows: R[];
  /** Commit a new row array (one undoable step). */
  onRowsChange: (next: R[], label: string) => void;
  /** Fresh blank row for "Add row", Enter on the last row and paste overflow. */
  createRow: () => R;
  history?: GridHistory;
  /** Keep the first data column visible while scrolling sideways. */
  frozenFirstColumn?: boolean;
  allowAddRows?: boolean;
  allowDeleteRows?: boolean;
  /** Never delete below this many rows. */
  minRows?: number;
  /** Server-side errors keyed by row key. */
  rowErrors?: Record<string, string>;
  /** Host actions rendered in the toolbar. */
  toolbar?: ReactNode;
  /** Content under the totals (e.g. an out-of-balance warning). */
  summary?: ReactNode;
  /** Short label for a row used in the phone list and announcements. */
  rowLabel?: (row: R, index: number) => string;
  /** Row count above which rows are virtualized. */
  virtualizeAbove?: number;
  onSelectionChange?: (selection: GridSelectionInfo) => void;
  /** ⌘S / Ctrl+S inside the grid. */
  onSaveShortcut?: () => void;
  readOnly?: boolean;
  /** Singular noun used in buttons ("Add line"). */
  rowNoun?: string;
  className?: string;
};
