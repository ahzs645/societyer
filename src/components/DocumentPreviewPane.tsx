import { useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import { Download, FileWarning, Loader2, ShieldCheck } from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";
import { restoredDocumentFile } from "../lib/documentOpen";
import { fetchDocumentDownload } from "../lib/documentDownload";
import { xlsxToSheets, type SheetPreview } from "../lib/xlsxPreview";
import { hasPdfSignature, hasZipSignature, hasOleSignature, imageMimeType, extensionOf, LEGACY_LABELS } from "../lib/filePreviewSignatures";

/* ------------------------------- preview pane -------------------------------- */

/**
 * The browser's PDF viewer titles its toolbar with the PDF's Title metadata,
 * falling back to the blob: URL's random id. Give it the file name instead.
 * Best effort: large, encrypted or unreadable PDFs keep their original bytes.
 */
async function withPdfTitle(bytes: ArrayBuffer, title?: string | null): Promise<ArrayBuffer | Uint8Array> {
  if (!title || bytes.byteLength > 20 * 1024 * 1024) return bytes;
  try {
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    if (pdf.getTitle()) return bytes;
    pdf.setTitle(title, { showInWindowTitleBar: true });
    return await pdf.save({ useObjectStreams: false });
  } catch {
    return bytes;
  }
}

type PreviewStatus = "loading" | "pdf" | "docx" | "xlsx" | "image" | "text" | "legacy" | "unsupported" | "not-a-file" | "unavailable" | "error";

const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Renders the real file inline where possible: a saved original from a
 * restored backup first, then the latest uploaded version, then a fetched
 * link (finding D-02). PDFs go into a same-origin blob iframe only after the
 * bytes prove to be a PDF (finding D-01); DOCX via docx-preview; XLSX as plain
 * tables; images as <img>; legacy Office files explain why they cannot render
 * and show the text extracted at import instead.
 */
export function DocumentPreviewPane({
  document,
  getDownloadTarget,
  fallbackUrl,
  hasAnyFile,
  extractedText,
  onOpenFile,
  loadBytes,
}: {
  document: { _id: string; fileName?: string; mimeType?: string; sha256?: string; latestVersionId?: string } | null;
  getDownloadTarget?: (args: { versionId: Id<"documentVersions"> }) => Promise<any>;
  fallbackUrl: string | null;
  hasAnyFile: boolean;
  extractedText?: string;
  onOpenFile?: () => void;
  /** Private-storage adapters supply verified bytes without exposing a remote URL. */
  loadBytes?: (signal: AbortSignal) => Promise<ArrayBuffer>;
}) {
  const [status, setStatus] = useState<PreviewStatus>("loading");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetPreview[]>([]);
  const [text, setText] = useState<string>("");
  const [origin, setOrigin] = useState<"saved" | "version" | "link" | null>(null);
  const renderRef = useRef<HTMLDivElement>(null);
  const fileName = document?.fileName;
  const ext = extensionOf(fileName);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let createdBlobUrl: string | null = null;
    setStatus("loading");
    setBlobUrl(null);
    setSheets([]);
    setText("");
    setOrigin(null);
    if (!document || !hasAnyFile) {
      setStatus(LEGACY_LABELS[ext] ? "legacy" : "unavailable");
      return;
    }
    (async () => {
      try {
        let bytes: ArrayBuffer | null = null;
        let mimeType = document.mimeType;
        const restored = loadBytes ? undefined : await restoredDocumentFile(document);
        if (loadBytes) {
          bytes = await loadBytes(controller.signal);
          if (cancelled) return;
          setOrigin("version");
        }
        if (cancelled) return;
        if (restored) {
          bytes = await restored.arrayBuffer();
          setOrigin("saved");
        }
        let url = fallbackUrl;
        if (!bytes && document.latestVersionId && getDownloadTarget) {
          const target = await getDownloadTarget({ versionId: document.latestVersionId as Id<"documentVersions"> });
          if (target?.kind === "url" && target.url) {
            url = target.url;
            mimeType = target.mimeType ?? mimeType;
          }
        }
        if (cancelled) return;
        if (!bytes) {
          if (!url || url.startsWith("demo://")) {
            setStatus(LEGACY_LABELS[ext] ? "legacy" : "unavailable");
            return;
          }
          const lower = (fileName ?? "").toLowerCase();
          const previewable = mimeType?.includes("pdf") || mimeType?.includes("wordprocessingml") || mimeType?.includes("spreadsheetml") || /\.(pdf|docx|xlsx|png|jpe?g|gif|txt|csv|md)$/.test(lower);
          if (!previewable) {
            setStatus(LEGACY_LABELS[ext] ? "legacy" : "unsupported");
            return;
          }
          // Fetch and re-host as a same-origin blob: URL rather than framing the
          // storage URL directly — keeps the CSP's frame-src scoped to
          // 'self' data: blob: instead of needing to allowlist every storage host.
          const response = await fetchDocumentDownload(url);
          if (!response.ok) throw new Error("Couldn't load the file");
          bytes = await response.arrayBuffer();
          setOrigin(document.latestVersionId ? "version" : "link");
        }
        if (cancelled || !bytes) return;
        // Never trust the filename or a response's content type: a sharing
        // link (e.g. a Drive viewer URL) can return an HTML page, and a blob:
        // URL inherits this origin, so framing it would run that page's
        // scripts with the app's privileges. Classify by the bytes and re-type
        // every blob explicitly.
        if (hasPdfSignature(bytes)) {
          const titled = await withPdfTitle(bytes, fileName);
          if (cancelled) return;
          createdBlobUrl = URL.createObjectURL(new Blob([titled], { type: "application/pdf" }));
          setBlobUrl(createdBlobUrl);
          setStatus("pdf");
          return;
        }
        if (hasZipSignature(bytes)) {
          if (ext === "xlsx" || mimeType?.includes("spreadsheetml")) {
            const parsed = await xlsxToSheets(bytes);
            if (cancelled) return;
            setSheets(parsed);
            setStatus("xlsx");
            return;
          }
          if (ext === "docx" || mimeType?.includes("wordprocessingml") || !ext) {
            const container = renderRef.current;
            if (!container) throw new Error("Preview container missing");
            container.replaceChildren();
            await renderAsync(new Blob([bytes], { type: DOCX_MIME_TYPE }), container);
            if (cancelled) return;
            setStatus("docx");
            return;
          }
          setStatus("unsupported");
          return;
        }
        if (hasOleSignature(bytes) || LEGACY_LABELS[ext]) {
          setStatus("legacy");
          return;
        }
        const image = imageMimeType(bytes);
        if (image) {
          createdBlobUrl = URL.createObjectURL(new Blob([bytes], { type: image }));
          setBlobUrl(createdBlobUrl);
          setStatus("image");
          return;
        }
        if (/^(txt|csv|md|json)$/.test(ext)) {
          setText(new TextDecoder().decode(bytes.slice(0, 200_000)));
          setStatus("text");
          return;
        }
        if (/^(pdf|docx|xlsx)$/.test(ext)) {
          setStatus("not-a-file");
          return;
        }
        setStatus("unsupported");
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        console.error("Failed to render document preview", error);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      if (createdBlobUrl) URL.revokeObjectURL(createdBlobUrl);
    };
  }, [loadBytes, getDownloadTarget, document?._id, document?.latestVersionId, document?.sha256, fallbackUrl, fileName, hasAnyFile]);

  const extracted = extractedText?.trim();
  return (
    <div className="document-preview-pane">
      {origin === "saved" && status !== "loading" && (
        <div className="document-preview-pane__origin"><ShieldCheck size={12} /> Showing the saved original</div>
      )}
      {status === "loading" && (
        <div className="minutes-docx-preview__status">
          <Loader2 size={18} className="minutes-docx-preview__spinner" aria-hidden />
          <span>Loading preview…</span>
        </div>
      )}
      {status === "pdf" && blobUrl && (
        <iframe src={blobUrl} title="Document preview" className="document-preview-pane__pdf" />
      )}
      {status === "image" && blobUrl && (
        <img src={blobUrl} alt={fileName ?? "Document image"} className="document-preview-pane__image" />
      )}
      {status === "xlsx" && (
        <div className="document-preview-pane__sheets">
          {sheets.map((sheet) => (
            <section key={sheet.name}>
              <h4>{sheet.name}</h4>
              {sheet.rows.length > 0 && (
                <div className="table-wrap">
                  <table className="table">
                    <tbody>
                      {sheet.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}
                    </tbody>
                  </table>
                </div>
              )}
              {sheet.truncated && <p className="muted">Only the first rows and columns are shown. Open the file for the rest.</p>}
            </section>
          ))}
          {!sheets.length && <p className="muted">This workbook has no readable cells.</p>}
        </div>
      )}
      {status === "text" && <pre className="document-preview-pane__text">{text}</pre>}
      {(status === "legacy" || status === "unsupported" || status === "not-a-file" || status === "unavailable" || status === "error") && (
        <div className="document-preview-pane__message">
          {status === "legacy" && <p><FileWarning size={16} aria-hidden /> {LEGACY_LABELS[ext] ?? "This older Office format"} can't be shown in a browser.{hasAnyFile ? " Use Open file to read the original in its own application." : ""}</p>}
          {status === "unsupported" && <p>Preview isn't available for this file type — use “Open file” to view or download it.</p>}
          {status === "not-a-file" && <p>This link didn't return the document file itself (it may be a sharing or viewer page), so it isn't previewed here. Use “Open file” to view it at its source.</p>}
          {status === "unavailable" && <p>{hasAnyFile ? "No previewable file could be loaded." : "No file is attached to this document — it's a metadata record. Its details are below."}</p>}
          {status === "error" && <p><FileWarning size={16} aria-hidden /> Couldn't render a preview — “Open file” still works.</p>}
          {onOpenFile && hasAnyFile && status !== "unavailable" && <button className="btn btn--sm" onClick={onOpenFile}><Download size={12} /> Open file</button>}
          {extracted && (
            <details className="document-preview-pane__extracted" open>
              <summary>Text extracted at import ({extracted.length.toLocaleString()} characters)</summary>
              <pre>{extracted.slice(0, 20_000)}{extracted.length > 20_000 ? "\n…" : ""}</pre>
            </details>
          )}
        </div>
      )}
      <div
        ref={renderRef}
        className="minutes-docx-preview__render"
        style={{ display: status === "docx" ? "block" : "none" }}
      />
    </div>
  );
}

