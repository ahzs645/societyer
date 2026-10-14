import type { XlsxCellInput, XlsxColumn, XlsxSheet } from "./types";

function isObject(input: XlsxCellInput): input is Exclude<XlsxCellInput, string | number | boolean | Date | null | undefined> {
  return typeof input === "object" && input !== null && !(input instanceof Date);
}

function cellText(input: XlsxCellInput, column: XlsxColumn | undefined): string {
  const object = isObject(input) ? input : null;
  const value = object ? object.value : (input as string | number | boolean | Date | null | undefined);
  if (value === null || value === undefined) return "";
  const type = object?.type ?? column?.type;
  const indent = "  ".repeat(Math.max(0, object?.indent ?? 0));
  if (typeof value === "number") {
    if (type === "currency" || type === "accounting") return (column?.cents ? value / 100 : value).toFixed(2);
    if (type === "percent") return `${(value * 100).toFixed(1)}%`;
    return String(value);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  return `${indent}${value}`;
}

/**
 * The same sheet as plain text rows for CSV / TSV: optional title lines and a
 * blank line, the header, then decimal amounts, ratios as percentages and
 * labels indented with spaces by level.
 */
export function sheetTextRows(sheet: XlsxSheet): string[][] {
  const title = (sheet.title ?? []).filter((line) => line && line.trim());
  return [
    ...title.map((line) => [line]),
    ...(title.length ? [[]] : []),
    sheet.columns.map((column) => column.header),
    ...sheet.rows.map((row) => {
      const cells = Array.isArray(row) ? row : row.cells;
      return cells.map((cell, index) => cellText(cell, sheet.columns[index]));
    }),
  ];
}
