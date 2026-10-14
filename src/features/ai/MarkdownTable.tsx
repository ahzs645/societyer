import { useRef, useState, type ComponentPropsWithoutRef } from "react";
import { Check, Copy, Download, FileSpreadsheet } from "lucide-react";
import { useToast } from "../../components/Toast";
import { downloadDelimitedText, exportFileName, toDelimitedText } from "../../lib/tableExport";
import type { XlsxCellInput, XlsxCellType, XlsxSheet } from "../../lib/xlsx/types";
import { todayDateOnly } from "../../../shared/dateOnly";

/** The rendered table's text, row by row (header first). */
export function tableTextRows(table: HTMLTableElement | null): string[][] {
  if (!table) return [];
  return Array.from(table.rows).map((row) => Array.from(row.cells).map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim()));
}

const PLAIN_NUMBER = /^[-−]?\d{1,3}(,\d{3})*(\.\d+)?$|^[-−]?\d+(\.\d+)?$/;
const MONEY = /^[-−(]?\s?(CA)?\$\s?\d[\d,]*(\.\d+)?\)?$|^\(?[-−]?\$\d[\d,]*(\.\d+)?\)?$/;
const PERCENT = /^[-−]?\d+(\.\d+)?\s?%$/;

function numberFrom(text: string): number {
  const negative = /^[-−(]/.test(text) || text.endsWith(")");
  const value = Number(text.replace(/[^\d.]/g, ""));
  return negative ? -value : value;
}

/**
 * A typed sheet from the table text: a column whose every filled cell is an
 * amount ("$1,250.00", "($300)") becomes currency, plain numbers become
 * numbers and percentages become ratios. Everything else stays text.
 */
export function sheetFromTextRows(name: string, rows: string[][]): XlsxSheet {
  const [header = [], ...body] = rows;
  const width = Math.max(header.length, ...body.map((row) => row.length));
  const types: XlsxCellType[] = Array.from({ length: width }, (_, index) => {
    const filled = body.map((row) => row[index] ?? "").filter(Boolean);
    if (!filled.length) return "text";
    if (filled.every((cell) => MONEY.test(cell))) return "currency";
    if (filled.every((cell) => PLAIN_NUMBER.test(cell))) return "number";
    if (filled.every((cell) => PERCENT.test(cell))) return "percent";
    return "text";
  });
  return {
    name,
    columns: Array.from({ length: width }, (_, index) => ({ header: header[index] || `Column ${index + 1}`, type: types[index] })),
    rows: body.map((row) =>
      Array.from({ length: width }, (_, index): XlsxCellInput => {
        const text = row[index] ?? "";
        if (!text) return null;
        if (types[index] === "currency" || types[index] === "number") return numberFrom(text);
        if (types[index] === "percent") return numberFrom(text) / 100;
        return text;
      }),
    ),
  };
}

/**
 * A Markdown table in an assistant answer, with Copy (tab-separated, pastes
 * into a spreadsheet as cells), Download CSV and Download Excel.
 */
export function MarkdownTable({ children, node: _node, ...tableProps }: ComponentPropsWithoutRef<"table"> & { node?: unknown }) {
  const tableRef = useRef<HTMLTableElement>(null);
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const baseName = () => `Assistant table ${todayDateOnly()}`;

  const copy = async () => {
    const rows = tableTextRows(tableRef.current);
    if (!rows.length) return;
    try {
      await navigator.clipboard.writeText(toDelimitedText(rows, "tsv"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy the table", "Your browser blocked clipboard access.");
    }
  };
  const downloadCsv = () => {
    const rows = tableTextRows(tableRef.current);
    if (!rows.length) return;
    downloadDelimitedText(exportFileName(baseName(), "csv"), toDelimitedText(rows, "csv"), "csv");
  };
  const downloadExcel = async () => {
    const rows = tableTextRows(tableRef.current);
    if (!rows.length || busy) return;
    setBusy(true);
    try {
      const { downloadXlsx } = await import("../../lib/xlsx");
      await downloadXlsx(baseName(), { title: baseName(), sheets: [sheetFromTextRows("Table", rows)] });
    } catch (error) {
      toast.error("Download failed", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="global-ai-table">
      <div className="global-ai-table__scroll" tabIndex={0} role="region" aria-label="Table from the assistant">
        <table ref={tableRef} {...tableProps}>{children}</table>
      </div>
      <div className="global-ai-table__actions" role="group" aria-label="Table actions">
        <button type="button" className="global-ai-table__action" onClick={() => void copy()} aria-label={copied ? "Table copied" : "Copy table"}>
          {copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="global-ai-table__action" onClick={downloadCsv} aria-label="Download table as CSV">
          <Download size={11} aria-hidden="true" /> CSV
        </button>
        <button type="button" className="global-ai-table__action" onClick={() => void downloadExcel()} disabled={busy} aria-label="Download table as Excel">
          <FileSpreadsheet size={11} aria-hidden="true" /> Excel
        </button>
      </div>
    </div>
  );
}
