import { useEffect, useId, useState } from "react";
import { Download } from "lucide-react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import {
  TABLE_EXPORT_FORMATS,
  downloadDelimitedText,
  exportFileName,
  readLastExportFormat,
  rememberExportFormat,
  toDelimitedText,
  type TableExportFormat,
} from "@/lib/tableExport";
import type { RecordField } from "../../types";
import { useRecordTableStoreHandle } from "../state/recordTableStore";
import { useRecordTableRowModel } from "../hooks/useRecordTableRowModel";
import { recordCellText } from "../utils/recordCellText";
import { sortRecords } from "../utils/sortRecords";
import { lowerLabel } from "../utils/lowerLabel";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";

type Scope = "view" | "all";

export function buildExportRows(records: any[], columns: RecordField[]): string[][] {
  return [
    columns.map((column) => column.field.label),
    ...records.map((record) => columns.map((column) => recordCellText(column.field, record[column.field.name], record))),
  ];
}

/**
 * "Export…" for any table: file name, CSV or TSV (last choice remembered in
 * this browser), and either exactly what the view shows (its filters, sort
 * and visible columns) or every record with every field.
 */
export function RecordTableExportDialog({
  open,
  onClose,
  viewName,
}: {
  open: boolean;
  onClose: () => void;
  viewName: string;
}) {
  const handle = useRecordTableStoreHandle();
  const { objectMetadata } = useRecordTableContextOrThrow();
  const { ordered } = useRecordTableRowModel();
  const toast = useToast();
  const formId = useId();
  const [fileName, setFileName] = useState("");
  const [format, setFormat] = useState<TableExportFormat>("csv");
  const [scope, setScope] = useState<Scope>("view");

  useEffect(() => {
    if (!open) return;
    const today = handle.get().dateContext.today;
    setFileName(`${viewName} ${today}`);
    setFormat(readLastExportFormat());
    setScope("view");
  }, [open, viewName, handle]);

  const state = handle.get();
  const viewColumns = state.columns.filter((column) => column.isVisible);
  const allColumns = state.columns;
  const allCount = state.records.length;

  const runExport = () => {
    const current = handle.get();
    const columns = scope === "view" ? viewColumns : allColumns;
    const records = scope === "view" ? ordered : sortRecords({ records: current.records, columns: current.columns, sorts: current.sorts });
    const text = toDelimitedText(buildExportRows(records, columns), format);
    const name = exportFileName(fileName || viewName, format);
    downloadDelimitedText(name, text, format);
    rememberExportFormat(format);
    toast.success(`Exported ${records.length} ${lowerLabel(records.length === 1 ? objectMetadata.labelSingular : objectMetadata.labelPlural)}`, name);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Export ${lowerLabel(objectMetadata.labelPlural)}`}
      size="sm"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" form={formId} className="btn btn--accent" disabled={scope === "view" ? ordered.length === 0 : allCount === 0}>
            <Download size={14} aria-hidden="true" /> Export
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="record-table__export"
        onSubmit={(event) => {
          event.preventDefault();
          runExport();
        }}
      >
        <label className="field">
          <span className="field__label">File name</span>
          <input className="input" value={fileName} onChange={(event) => setFileName(event.target.value)} autoComplete="off" />
        </label>
        <fieldset className="record-table__export-group">
          <legend className="field__label">Format</legend>
          {TABLE_EXPORT_FORMATS.map((entry) => (
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
          <label className={`record-table__export-choice${scope === "view" ? " is-selected" : ""}`}>
            <input type="radio" name={`${formId}-scope`} value="view" checked={scope === "view"} onChange={() => setScope("view")} />
            <span>
              <strong>This view</strong>
              <small>
                {ordered.length} {ordered.length === 1 ? "row" : "rows"} · {viewColumns.length} visible {viewColumns.length === 1 ? "column" : "columns"}, with current filters and sort
              </small>
            </span>
          </label>
          <label className={`record-table__export-choice${scope === "all" ? " is-selected" : ""}`}>
            <input type="radio" name={`${formId}-scope`} value="all" checked={scope === "all"} onChange={() => setScope("all")} />
            <span>
              <strong>All {lowerLabel(objectMetadata.labelPlural)}</strong>
              <small>
                {allCount} {allCount === 1 ? "row" : "rows"} · all {allColumns.length} fields, ignoring filters
              </small>
            </span>
          </label>
        </fieldset>
        <p className="field__hint">Amounts export as plain numbers, dates as YYYY-MM-DD and choices as their labels.</p>
      </form>
    </Modal>
  );
}
