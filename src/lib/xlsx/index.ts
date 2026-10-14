/**
 * Excel (.xlsx) export without a spreadsheet library.
 *
 * This entry point is tiny: the SpreadsheetML builder and JSZip load only
 * when a workbook is actually written, so screens that offer "Excel" don't
 * grow the main bundle.
 */

import type { XlsxWorkbook } from "./types";

export type * from "./types";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Build the workbook (lazy-loading the writer) and return the file bytes. */
export async function buildXlsxFile(workbook: XlsxWorkbook): Promise<Uint8Array> {
  const { writeXlsx } = await import("./writer");
  return writeXlsx(workbook);
}

/** "Members — Active" → "Members - Active.xlsx". */
export function xlsxFileName(name: string): string {
  const base =
    name
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\.(xlsx|csv|tsv|txt)$/i, "") || "export";
  return `${base}.xlsx`;
}

/** Write the workbook and trigger a browser download. Resolves once the download has started. */
export async function downloadXlsx(fileName: string, workbook: XlsxWorkbook): Promise<void> {
  const bytes = await buildXlsxFile(workbook);
  const blob = new Blob([bytes as BlobPart], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = xlsxFileName(fileName);
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
