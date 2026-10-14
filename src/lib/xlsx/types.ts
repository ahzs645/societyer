/**
 * Public shape of a workbook handed to the XLSX writer.
 *
 * Every cell is a typed value: text is always written as a string cell and
 * never as a formula, so `=SUM(A1)` or `@cmd` in a memo stays inert text.
 */

export type XlsxCellType =
  /** Plain text (the default for strings). */
  | "text"
  /** A number with the General format. */
  | "number"
  /** A whole number shown with thousands separators. */
  | "integer"
  /** Major units (dollars) shown with the currency symbol, negatives in red with a minus sign. */
  | "currency"
  /** Major units in the accounting layout used by financial statements. */
  | "accounting"
  /** A ratio (0.123 → 12.3%). */
  | "percent"
  /** A calendar date: "YYYY-MM-DD" or a Date (its local calendar day). */
  | "date"
  /** A moment: a Date, epoch milliseconds or an ISO string, written as local wall-clock time. */
  | "datetime"
  | "boolean";

export type XlsxPrimitive = string | number | boolean | Date | null | undefined;

export type XlsxCellObject = {
  value: XlsxPrimitive;
  /** Overrides the column type for this cell. */
  type?: XlsxCellType;
  /** ISO 4217 code for currency/accounting cells (defaults to the column's, then CAD). */
  currency?: string;
  bold?: boolean;
  /** Left indent level for hierarchical labels (statements). */
  indent?: number;
};

export type XlsxCellInput = XlsxPrimitive | XlsxCellObject;

/** Row emphasis for statements: sections and subtotals are bold; totals also get a rule above. */
export type XlsxRowStyle = "section" | "subtotal" | "total";

export type XlsxRowObject = {
  cells: XlsxCellInput[];
  style?: XlsxRowStyle;
};

export type XlsxRowInput = XlsxCellInput[] | XlsxRowObject;

export type XlsxColumn = {
  header: string;
  type?: XlsxCellType;
  /** Default currency for currency/accounting cells in this column. */
  currency?: string;
  /** Values in this column are integer cents; they are divided by 100 when written. */
  cents?: boolean;
  /** Width in characters; estimated from the content when omitted. */
  width?: number;
};

export type XlsxSheet = {
  name: string;
  columns: XlsxColumn[];
  rows: XlsxRowInput[];
  /** Bold lines written above the header (a statement title, its period). */
  title?: string[];
  /** Freeze the header row (default true). */
  freezeHeader?: boolean;
  /** Add an autofilter over the header and data (default true). */
  autoFilter?: boolean;
};

export type XlsxWorkbook = {
  sheets: XlsxSheet[];
  /** Document title (core properties). */
  title?: string;
  subject?: string;
  creator?: string;
  /** Creation time (core properties); defaults to now. */
  created?: Date;
};
