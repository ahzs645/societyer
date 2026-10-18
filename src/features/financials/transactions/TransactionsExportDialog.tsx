import { useEffect, useId, useState } from "react";
import { Download } from "lucide-react";
import { Modal } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { pluralize } from "../../../lib/format";
import { TABLE_EXPORT_FORMATS, downloadTableExport, readLastExportFormat, rememberExportFormat } from "../../../lib/tableExport";
import { useRecordTableRowModel } from "../../../platform/record-engine/record-table/hooks/useRecordTableRowModel";
import { useRecordTableStoreHandle } from "../../../platform/record-engine/record-table/state/recordTableStore";
import { transactionExportSheet, transactionExportTextRows, type ExportLayout, type ExportLookups, type ExportTransaction } from "./transactionExport";

type Format = "xlsx" | "csv";

const FORMATS = TABLE_EXPORT_FORMATS.filter((entry): entry is (typeof TABLE_EXPORT_FORMATS)[number] & { id: Format } => entry.id === "xlsx" || entry.id === "csv");

/**
 * Export every transaction the table shows (queue, filters, search and sort
 * applied, not only the selection) to Excel or CSV, one row per transaction
 * or one row per line item. Mount inside the table scope.
 */
export function TransactionsExportDialog({
  open,
  onClose,
  viewName,
  lookups,
}: {
  open: boolean;
  onClose: () => void;
  viewName: string;
  lookups: ExportLookups;
}) {
  const { ordered } = useRecordTableRowModel();
  const handle = useRecordTableStoreHandle();
  const toast = useToast();
  const formId = useId();
  const [fileName, setFileName] = useState("");
  const [format, setFormat] = useState<Format>("xlsx");
  const [layout, setLayout] = useState<ExportLayout>("transactions");
  const [busy, setBusy] = useState(false);
  const rows = ordered as ExportTransaction[];
  const lineCount = rows.reduce((sum, row) => sum + Math.max(1, row.lines?.length ?? 0), 0);

  useEffect(() => {
    if (!open) return;
    setFileName(`${viewName} ${handle.get().dateContext.today}`);
    setFormat(readLastExportFormat("xlsx") === "csv" ? "csv" : "xlsx");
    setLayout("transactions");
  }, [open, viewName, handle]);

  const runExport = async () => {
    if (busy || rows.length === 0) return;
    setBusy(true);
    try {
      const name = await downloadTableExport(fileName || viewName, format, {
        title: fileName || viewName,
        textRows: () => transactionExportTextRows(rows, layout, lookups),
        sheet: () => transactionExportSheet(rows, layout, lookups),
      });
      rememberExportFormat(format);
      toast.success(`Exported ${pluralize(rows.length, "transaction")}`, name);
      onClose();
    } catch (error) {
      toast.error("Export failed", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Export transactions"
      size="sm"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" form={formId} className="btn btn--accent" disabled={busy || rows.length === 0} aria-busy={busy || undefined}>
            <Download size={14} aria-hidden="true" /> {busy ? "Exporting…" : "Export"}
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="record-table__export"
        onSubmit={(event) => {
          event.preventDefault();
          void runExport();
        }}
      >
        <label className="field">
          <span className="field__label">File name</span>
          <input className="input" value={fileName} onChange={(event) => setFileName(event.target.value)} autoComplete="off" />
        </label>
        <fieldset className="record-table__export-group">
          <legend className="field__label">Format</legend>
          {FORMATS.map((entry) => (
            <label key={entry.id} className={`record-table__export-choice${format === entry.id ? " is-selected" : ""}`}>
              <input type="radio" name={`${formId}-format`} value={entry.id} checked={format === entry.id} onChange={() => setFormat(entry.id)} />
              <span>
                <strong>{entry.label}</strong>
                <small>{entry.hint}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset className="record-table__export-group">
          <legend className="field__label">Rows</legend>
          <label className={`record-table__export-choice${layout === "transactions" ? " is-selected" : ""}`}>
            <input type="radio" name={`${formId}-layout`} value="transactions" checked={layout === "transactions"} onChange={() => setLayout("transactions")} />
            <span>
              <strong>One row per transaction</strong>
              <small>{pluralize(rows.length, "row")}; a split lists its categories together</small>
            </span>
          </label>
          <label className={`record-table__export-choice${layout === "lines" ? " is-selected" : ""}`}>
            <input type="radio" name={`${formId}-layout`} value="lines" checked={layout === "lines"} onChange={() => setLayout("lines")} />
            <span>
              <strong>One row per line item</strong>
              <small>{pluralize(lineCount, "row")} with each line's amount, category, ledger account, fund and tags</small>
            </span>
          </label>
        </fieldset>
        <p className="field__hint">Exports the {pluralize(rows.length, "transaction")} the table shows now, with the queue, filters, search and sort applied.</p>
      </form>
    </Modal>
  );
}
