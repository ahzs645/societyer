/**
 * The notice's files in one list: those Zoer downloaded first (previewed or
 * downloaded from the workspace's SharePoint folder, checked against their
 * SHA-256), then those it didn't download, which open on the source instead.
 * The heading says how many there are; a notice with none gets one line
 * rather than an empty card, pointing to the source, where they may be.
 */
import { useCallback, useState } from "react";
import { Download, ExternalLink, Eye, FileText, Paperclip } from "lucide-react";
import { FilePreviewDialog, MAX_FILE_PREVIEW_BYTES } from "../../../components/FilePreviewDialog";
import type { StoredProcurementDocument } from "../lib/documents";
import { noticeDocumentRows, onDocumentSource, onSource, type NoticeModel } from "../lib/notice";
import { useReaderSource } from "./source";

function size(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
function kindOf(name: string, mediaType = "") {
  const extension = /\.([a-z0-9]{2,5})$/i.exec(name)?.[1];
  return extension ? extension.toUpperCase() : mediaType.split("/").pop()?.toUpperCase() ?? "";
}

/** `id` is the section's anchor (`?tab=documents` scrolls to it). */
export function NoticeDocuments({ recordKey, model, id }: { recordKey: string; model: NoticeModel; id: string }) {
  const source = useReaderSource();
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const documents = source.useDocuments(recordKey, cursors[cursors.length - 1]);
  const [preview, setPreview] = useState<StoredProcurementDocument | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadPreview = useCallback((signal: AbortSignal) => {
    if (!preview) throw new Error("No document selected.");
    return source.readDocument(preview, signal);
  }, [source, preview]);

  const download = async (document: StoredProcurementDocument) => {
    if (busy) return;
    setBusy(document.documentKey); setError(null);
    try {
      const bytes = await source.readDocument(document);
      const url = URL.createObjectURL(new Blob([bytes], { type: document.mediaType }));
      const anchor = window.document.createElement("a");
      anchor.href = url; anchor.download = document.name; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The file couldn't be downloaded.");
    } finally {
      setBusy(null);
    }
  };

  const complete = Boolean(documents?.isDone && cursors.length === 1);
  const rows = noticeDocumentRows(documents?.page ?? [], model.attachments, complete);
  const count = documents ? (complete ? String(rows.length) : `${rows.length}+`) : "";
  const nothing = documents && rows.length === 0 && cursors.length === 1;
  const where = onSource(model.source);

  if (nothing)
    return (
      <section className="procurement-notice__nodocs" id={id} aria-labelledby={`${id}-title`}>
        <Paperclip size={14} aria-hidden="true" />
        <h2 className="procurement-notice__nodocs-title" id={`${id}-title`}>No documents attached</h2>
        {model.sourceUrl && (
          <>
            <span aria-hidden="true">·</span>
            <a href={model.sourceUrl} target="_blank" rel="noopener noreferrer">
              check {where.replace(/^on /, "")} <ExternalLink size={12} aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </>
        )}
      </section>
    );

  return (
    <section className="card" id={id} aria-labelledby={`${id}-title`}>
      <div className="card__head">
        <h2 className="card__title" id={`${id}-title`}>
          Documents{count && count !== "0" && <> <span className="procurement-notice__count">{count}</span></>}
        </h2>
      </div>
      <div className="card__body">
        {error && <p className="notice notice--danger" role="alert">{error}</p>}
        {!documents ? <p className="muted" role="status">Loading documents…</p>
          : (
            <ul className="procurement-notice__docs">
              {rows.map((row) => {
                if (row.state === "elsewhere") {
                  const destination = row.url ? onDocumentSource(row.url, model.source) : where;
                  return (
                    <li key={row.key} className="procurement-notice__doc" data-state="elsewhere">
                      <FileText size={16} aria-hidden="true" className="procurement-notice__doc-icon" />
                      <span className="procurement-notice__doc-name">
                        <span>{row.name}</span>
                        <small className="muted">{[kindOf(row.name, row.document?.mediaType), "Not downloaded"].filter(Boolean).join(" · ")}</small>
                      </span>
                      {row.url && (
                        <span className="procurement-notice__doc-actions">
                          <a className="btn btn--ghost btn--sm" href={row.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${row.name} ${destination} (opens in a new tab)`}>
                            <ExternalLink size={14} aria-hidden="true" /> Open {destination}
                          </a>
                        </span>
                      )}
                    </li>
                  );
                }
                const { document } = row;
                const tooBig = document.bytes > MAX_FILE_PREVIEW_BYTES;
                return (
                  <li key={row.key} className="procurement-notice__doc">
                    <FileText size={16} aria-hidden="true" className="procurement-notice__doc-icon" />
                    <span className="procurement-notice__doc-name">
                      <span>{document.name}</span>
                      <small className="muted">{[kindOf(document.name, document.mediaType), size(document.bytes)].filter(Boolean).join(" · ")}</small>
                    </span>
                    <span className="procurement-notice__doc-actions">
                      <button type="button" className="btn btn--ghost btn--sm" disabled={tooBig} title={tooBig ? "Preview supports files up to 25 MB" : undefined} aria-label={`Preview ${document.name}`} onClick={() => setPreview(document)}><Eye size={14} aria-hidden="true" /> Preview</button>
                      <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Download ${document.name}`} title="Download" disabled={busy !== null} onClick={() => void download(document)}>
                        <Download size={14} aria-hidden="true" />
                      </button>
                    </span>
                    {busy === document.documentKey && <small className="muted procurement-notice__doc-busy" role="status">Downloading…</small>}
                  </li>
                );
              })}
            </ul>
          )}
        {(cursors.length > 1 || (documents && !documents.isDone)) && (
          <div className="procurement-reader__pager">
            <button type="button" className="btn btn--sm" disabled={cursors.length === 1} onClick={() => setCursors((values) => values.slice(0, -1))}>Previous</button>
            <button type="button" className="btn btn--sm" disabled={!documents || documents.isDone} onClick={() => documents && setCursors((values) => [...values, documents.continueCursor])}>More documents</button>
          </div>
        )}
      </div>
      {preview && (
        <FilePreviewDialog
          file={{ id: source.previewId(preview), name: preview.name, mimeType: preview.mediaType, sha256: preview.sha256, bytes: preview.bytes }}
          loadBytes={loadPreview}
          onClose={() => setPreview(null)}
          onDownload={() => void download(preview)}
          downloading={busy !== null}
        />
      )}
    </section>
  );
}
