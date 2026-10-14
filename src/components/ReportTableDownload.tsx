import { useState, type ReactNode } from "react";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { Menu } from "./Menu";
import { useToast } from "./Toast";
import type { ReportColumn, ReportComparison, ReportRow } from "./ReportTable";
import { downloadTableExport, rememberExportFormat, type TableExportFormat } from "../lib/tableExport";
import { nodeText, reportTableSheet } from "../lib/xlsx/reportSheet";
import { sheetTextRows } from "../lib/xlsx/textRows";

export type ReportDownload = {
  /** File name without extension, e.g. "Balance sheet 2026-10-14". */
  fileName: string;
  /** Sheet name in the workbook (defaults to the table's aria label). */
  sheetName?: string;
  /** Lines written above the table in the file: organisation, statement, period. */
  title?: string[];
};

/**
 * "Download" for a statement: Excel (signed numbers in the accounting format,
 * bold sections, subtotals and totals) or CSV, always the full hierarchy.
 */
export function ReportTableDownload<M>({
  download,
  ariaLabel,
  columns,
  rows,
  comparison,
  currency,
  labelHeader,
  disabled,
}: {
  download: ReportDownload;
  ariaLabel: string;
  columns: ReportColumn[];
  rows: ReportRow<M>[];
  comparison?: ReportComparison | null;
  currency?: string;
  labelHeader?: ReactNode;
  disabled?: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const run = async (format: TableExportFormat) => {
    if (busy) return;
    setBusy(true);
    try {
      const sheet = reportTableSheet({
        name: download.sheetName ?? ariaLabel,
        columns,
        rows: rows as ReportRow<unknown>[],
        comparison,
        currency,
        labelHeader: nodeText(labelHeader) || "Account",
        title: download.title,
      });
      const fileName = await downloadTableExport(download.fileName, format, {
        title: download.title?.[0] ?? download.fileName,
        textRows: () => sheetTextRows(sheet),
        sheet: () => sheet,
      });
      rememberExportFormat(format);
      toast.success("Downloaded", fileName);
    } catch (error) {
      toast.error("Download failed", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Menu
      align="right"
      trigger={
        <button type="button" className="btn btn--ghost btn--sm" disabled={disabled || busy} aria-label={`Download ${ariaLabel}`} aria-busy={busy || undefined}>
          <Download size={14} aria-hidden="true" /> Download
        </button>
      }
      sections={[
        {
          id: "download",
          items: [
            { id: "xlsx", label: "Excel (.xlsx)", icon: <FileSpreadsheet size={14} />, onSelect: () => void run("xlsx") },
            { id: "csv", label: "CSV", icon: <FileText size={14} />, onSelect: () => void run("csv") },
          ],
        },
      ]}
    />
  );
}
