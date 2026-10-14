/**
 * Table export formats: Excel (.xlsx, typed cells — see src/lib/xlsx) and
 * plain-text CSV / TSV with spreadsheet-safe escaping.
 *
 * For CSV / TSV, values are expected to be "raw but readable" already
 * (decimal amounts, ISO dates, option labels); this module only handles
 * delimiting, quoting and the download itself.
 */

import { XLSX_MIME, downloadXlsx, type XlsxSheet } from "./xlsx";

export type DelimitedExportFormat = "csv" | "tsv";
export type TableExportFormat = DelimitedExportFormat | "xlsx";

export const TABLE_EXPORT_FORMATS: readonly { id: TableExportFormat; label: string; extension: string; mime: string; hint: string }[] = [
  { id: "xlsx", label: "Excel (.xlsx)", extension: "xlsx", mime: XLSX_MIME, hint: "Amounts, dates and yes/no stay typed; opens in Excel, Numbers, Google Sheets" },
  { id: "csv", label: "CSV", extension: "csv", mime: "text/csv;charset=utf-8", hint: "Plain text for any spreadsheet or import" },
  { id: "tsv", label: "TSV", extension: "tsv", mime: "text/tab-separated-values;charset=utf-8", hint: "Tab-separated, pastes cleanly into sheets" },
];

const LAST_FORMAT_KEY = "societyer:table-export-format";

export function isTableExportFormat(value: unknown): value is TableExportFormat {
  return value === "csv" || value === "tsv" || value === "xlsx";
}

/** The format chosen last time in this browser (`fallback`, CSV by default, until something is picked). */
export function readLastExportFormat(fallback: TableExportFormat = "csv"): TableExportFormat {
  try {
    const stored = window.localStorage.getItem(LAST_FORMAT_KEY);
    return isTableExportFormat(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function rememberExportFormat(format: TableExportFormat) {
  try {
    window.localStorage.setItem(LAST_FORMAT_KEY, format);
  } catch {
    // Storage blocked (private mode): the choice is simply not remembered.
  }
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * Text that a spreadsheet would run as a formula (=, +, -, @, tab, CR) is
 * prefixed with an apostrophe. Plain numbers, including negatives, are left
 * alone so amounts stay numeric.
 */
function neutraliseFormula(value: string): string {
  if (!value || NUMERIC.test(value)) return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function escapeCsv(value: string): string {
  const safe = neutraliseFormula(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function escapeTsv(value: string): string {
  return neutraliseFormula(value).replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

export function toDelimitedText(rows: string[][], format: DelimitedExportFormat): string {
  const escape = format === "tsv" ? escapeTsv : escapeCsv;
  const separator = format === "tsv" ? "\t" : ",";
  return rows.map((row) => row.map((cell) => escape(cell ?? "")).join(separator)).join("\r\n");
}

/** "Members — Active 2026-10-14" → "Members - Active 2026-10-14.csv" (no path or reserved characters). */
export function exportFileName(name: string, format: TableExportFormat): string {
  const extension = TABLE_EXPORT_FORMATS.find((entry) => entry.id === format)?.extension ?? format;
  const base = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.(csv|tsv|txt|xlsx)$/i, "") || "export";
  return `${base}.${extension}`;
}

/** Trigger a browser download of `text`. A UTF-8 BOM keeps accents intact in Excel. */
export function downloadDelimitedText(fileName: string, text: string, format: DelimitedExportFormat) {
  const mime = TABLE_EXPORT_FORMATS.find((entry) => entry.id === format)?.mime ?? "text/plain;charset=utf-8";
  const blob = new Blob(["﻿", text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Download a table in the chosen format: CSV / TSV from text rows, Excel from
 * a typed sheet (the XLSX writer loads on demand). Returns the file name used.
 */
export async function downloadTableExport(
  name: string,
  format: TableExportFormat,
  build: { textRows: () => string[][]; sheet: () => XlsxSheet; title?: string },
): Promise<string> {
  const fileName = exportFileName(name, format);
  if (format === "xlsx") {
    await downloadXlsx(fileName, { title: build.title ?? fileName.replace(/\.xlsx$/, ""), sheets: [build.sheet()] });
  } else {
    downloadDelimitedText(fileName, toDelimitedText(build.textRows(), format), format);
  }
  return fileName;
}
