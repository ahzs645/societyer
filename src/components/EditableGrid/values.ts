import { formatMoney, parseMoneyInput } from "../../lib/money";
import { formatDate } from "../../lib/format";
import { parseTypedDate } from "../../lib/typedDate";
import type { CellRange, GridColumn, GridOption, GridRow, ParseResult } from "./types";

// ---------------------------------------------------------------- invalid --

const INVALID = "__editableGridInvalid";

/** A cell holding text that did not parse: kept (and marked) instead of lost. */
export type GridInvalid = { [INVALID]: true; raw: string; error: string };

export function invalidCell(raw: string, error: string): GridInvalid {
  return { [INVALID]: true, raw, error };
}

export function isInvalidCell(value: unknown): value is GridInvalid {
  return typeof value === "object" && value !== null && (value as any)[INVALID] === true;
}

// ----------------------------------------------------------------- basics --

export function isNumericColumn(col: GridColumn<any>) {
  return col.type === "number" || col.type === "money" || (col.type === "computed" && (col.valueType === "number" || col.valueType === "money"));
}

export function isMoneyColumn(col: GridColumn<any>) {
  return col.type === "money" || (col.type === "computed" && col.valueType === "money");
}

export function isReadOnlyColumn<R extends GridRow>(col: GridColumn<R>, row?: R) {
  if (col.type === "computed") return true;
  if (typeof col.readOnly === "function") return row ? col.readOnly(row) : false;
  return Boolean(col.readOnly);
}

export function emptyValue(col: GridColumn<any>): unknown {
  return col.type === "number" || col.type === "money" ? null : "";
}

export function isEmptyValue(value: unknown) {
  return value == null || value === "" || (isInvalidCell(value) && value.raw.trim() === "");
}

export function columnOptions<R extends GridRow>(col: GridColumn<R>, row: R): GridOption[] {
  if (!col.options) return [];
  return typeof col.options === "function" ? col.options(row) : col.options;
}

/** The value a cell shows: computed columns derive it, others read the row. */
export function cellValue<R extends GridRow>(row: R, col: GridColumn<R>): unknown {
  if (col.type === "computed") return col.compute ? col.compute(row) : undefined;
  return row[col.key];
}

/** True when every editable cell in the row is empty (such rows are ignored). */
export function isBlankRow<R extends GridRow>(row: R, columns: GridColumn<R>[]) {
  return columns.every((col) => col.type === "computed" || isEmptyValue(row[col.key]));
}

export function valuesEqual(a: unknown, b: unknown) {
  if (a === b) return true;
  if (isEmptyValue(a) && isEmptyValue(b)) return true;
  if (isInvalidCell(a) && isInvalidCell(b)) return a.raw === b.raw;
  return false;
}

// ------------------------------------------------------------ parse/format --

function normalise(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function matchOption(text: string, options: GridOption[]): GridOption | undefined {
  const needle = normalise(text);
  if (!needle) return undefined;
  return (
    options.find((o) => o.value === text.trim()) ??
    options.find((o) => normalise(o.label) === needle) ??
    options.find((o) => (o.keywords ?? []).some((k) => normalise(k) === needle)) ??
    // "1000 · Cash" style labels pasted as just "Cash"
    options.find((o) => normalise(o.label).endsWith(` ${needle}`) || normalise(o.label).split(" · ").includes(needle))
  );
}

export function searchOptions(query: string, options: GridOption[]): GridOption[] {
  const terms = normalise(query).split(" ").filter(Boolean);
  if (terms.length === 0) return options;
  return options.filter((o) => {
    const hay = normalise([o.label, o.hint ?? "", ...(o.keywords ?? [])].join(" "));
    return terms.every((t) => hay.includes(t));
  });
}

/** Parse typed or pasted text into a cell value for the column. */
export function parseCellText<R extends GridRow>(text: string, col: GridColumn<R>, row: R): ParseResult {
  const raw = text.replace(/ /g, " ");
  const trimmed = raw.trim();
  if (isReadOnlyColumn(col, row)) return { ok: false, error: `${col.header} is read-only.` };
  if (trimmed === "") return { ok: true, value: emptyValue(col) };
  switch (col.type) {
    case "text":
      return { ok: true, value: trimmed };
    case "number": {
      const n = Number(trimmed.replace(/,/g, ""));
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: `"${trimmed}" isn't a number.` };
    }
    case "money": {
      const cents = parseMoneyInput(trimmed);
      return cents === undefined || !Number.isSafeInteger(cents)
        ? { ok: false, error: `"${trimmed}" isn't an amount.` }
        : { ok: true, value: cents };
    }
    case "date": {
      const parsed = parseTypedDate(trimmed);
      return parsed.ok ? { ok: true, value: parsed.value } : { ok: false, error: parsed.error };
    }
    case "select": {
      const option = matchOption(trimmed, columnOptions(col, row));
      return option ? { ok: true, value: option.value } : { ok: false, error: `No ${col.header.toLowerCase()} matches "${trimmed}".` };
    }
    default:
      return { ok: false, error: `${col.header} is read-only.` };
  }
}

/** Plain text for the clipboard and for starting an edit. */
export function cellText<R extends GridRow>(value: unknown, col: GridColumn<R>, row: R): string {
  if (isInvalidCell(value)) return value.raw;
  if (value == null || value === "") return "";
  const kind = col.type === "computed" ? col.valueType ?? "text" : col.type;
  switch (kind) {
    case "money":
      return typeof value === "number" ? (value / 100).toFixed(2) : String(value);
    case "number":
      return String(value);
    case "select":
      return columnOptions(col, row).find((o) => o.value === value)?.label ?? String(value);
    default:
      return String(value);
  }
}

/** Formatted text shown in the cell. */
export function cellDisplay<R extends GridRow>(value: unknown, col: GridColumn<R>, row: R): string {
  if (isInvalidCell(value)) return value.raw;
  if (value == null || value === "") return "";
  const kind = col.type === "computed" ? col.valueType ?? "text" : col.type;
  switch (kind) {
    case "money":
      return typeof value === "number" ? formatMoney(value, { currency: col.currency }) : String(value);
    case "number":
      return typeof value === "number" ? value.toLocaleString() : String(value);
    case "date":
      return formatDate(String(value));
    case "select":
      return columnOptions(col, row).find((o) => o.value === value)?.label ?? String(value);
    default:
      return String(value);
  }
}

/** The error a cell shows, or null. Blank rows are never flagged. */
export function cellError<R extends GridRow>(row: R, col: GridColumn<R>, rows: R[], columns: GridColumn<R>[]): string | null {
  if (col.type === "computed") return null;
  const value = row[col.key];
  if (isInvalidCell(value)) return value.error;
  if (isBlankRow(row, columns)) return null;
  if (col.required && isEmptyValue(value)) return `${col.header} is required.`;
  return col.validate?.(value, row, rows) ?? null;
}

export function rowHasErrors<R extends GridRow>(row: R, rows: R[], columns: GridColumn<R>[]) {
  return columns.some((col) => cellError(row, col, rows, columns) !== null);
}

export function columnTotal<R extends GridRow>(rows: R[], col: GridColumn<R>) {
  let sum = 0;
  for (const row of rows) {
    const value = cellValue(row, col);
    if (typeof value === "number" && Number.isFinite(value)) sum += value;
  }
  return sum;
}

// -------------------------------------------------------------------- TSV --

/** Parse clipboard text from Excel / Google Sheets (TSV with quoted cells). */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === "\t") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  // Spreadsheets end the copied block with a newline.
  while (rows.length > 1 && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  return rows;
}

export function toTsv(matrix: string[][]): string {
  return matrix
    .map((r) => r.map((c) => (/[\t\n"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join("\t"))
    .join("\n");
}

// ------------------------------------------------------------------ ranges --

export function normaliseRange(a: { r: number; c: number }, b: { r: number; c: number }): CellRange {
  return { r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) };
}

export function inRange(range: CellRange | null, r: number, c: number) {
  return Boolean(range && r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1);
}

export function columnLetter(index: number) {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ------------------------------------------------------------------ series --

function addDays(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

function dayDiff(a: string, b: string) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * Values for `count` cells continuing `source` down a column: numbers, money
 * and dates continue the step between the last two cells; anything else (or a
 * single source cell) repeats the source pattern.
 */
export function continueSeries<R extends GridRow>(source: unknown[], col: GridColumn<R>, count: number): unknown[] {
  const n = source.length;
  if (n === 0) return [];
  const clean = source.every((v) => !isInvalidCell(v) && !isEmptyValue(v));
  if (n >= 2 && clean && (col.type === "number" || col.type === "money")) {
    const nums = source as number[];
    const step = nums[n - 1] - nums[n - 2];
    return Array.from({ length: count }, (_, k) => {
      const next = nums[n - 1] + step * (k + 1);
      return col.type === "money" ? Math.round(next) : Number(next.toFixed(10));
    });
  }
  if (n >= 2 && clean && col.type === "date") {
    const dates = source as string[];
    const step = dayDiff(dates[n - 2], dates[n - 1]);
    return Array.from({ length: count }, (_, k) => addDays(dates[n - 1], step * (k + 1)));
  }
  return Array.from({ length: count }, (_, k) => source[k % n]);
}
