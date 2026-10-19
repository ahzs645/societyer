import { assertPreviewSize, readPreviewResponse } from "../lib/filePreviewBytes";
import { useCallback, useEffect, useState } from "react";
import { PdfPreview } from "./PdfPreview";
import { DocxPreview } from "./DocxPreview";
import { ScrollArea } from "./ScrollArea";
import { Download, FileWarning, Loader2, ShieldCheck } from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";
import { restoredDocumentFile } from "../lib/documentOpen";
import { fetchDocumentDownload } from "../lib/documentDownload";
import { xlsxToSheets, type SheetPreview } from "../lib/xlsxPreview";
import { hasPdfSignature, hasZipSignature, hasOleSignature, imageMimeType, mediaMimeType, extensionOf, LEGACY_LABELS } from "../lib/filePreviewSignatures";

/* ------------------------------- preview pane -------------------------------- */

type PreviewStatus = "loading" | "pdf" | "docx" | "xlsx" | "image" | "audio" | "video" | "text" | "legacy" | "unsupported" | "not-a-file" | "unavailable" | "error";

const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Renders the real file inline where possible: a saved original from a
 * restored backup first, then the latest uploaded version, then a fetched
 * link (finding D-02). PDFs use the shared PDF.js viewer only after the
 * bytes prove to be a PDF (finding D-01); DOCX via docx-preview, fitted to the
 * width with zoom controls (`DocxPreview`); XLSX as plain
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
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [docxBlob, setDocxBlob] = useState<Blob | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetPreview[]>([]);
  const [text, setText] = useState<string>("");
  const [origin, setOrigin] = useState<"saved" | "version" | "link" | null>(null);
  const fileName = document?.fileName;
  const ext = extensionOf(fileName);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let createdBlobUrl: string | null = null;
    setStatus("loading");
    setBlobUrl(null);
    setPdfBlob(null);
    setDocxBlob(null);
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
          assertPreviewSize(restored.size);
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
          const previewable = mimeType?.includes("pdf") || mimeType?.includes("wordprocessingml") || mimeType?.includes("spreadsheetml") || /\.(pdf|docx|xlsx|png|jpe?g|gif|txt|csv|md|json|vtt|srt|mp3|m4a|mp4|wav|webm|ogg|oga|flac|aac|mov|mkv)$/.test(lower);
          if (!previewable) {
            setStatus(LEGACY_LABELS[ext] ? "legacy" : "unsupported");
            return;
          }
          // Fetch and re-host as a same-origin blob: URL rather than framing the
          // storage URL directly — keeps the CSP's frame-src scoped to
          // 'self' data: blob: instead of needing to allowlist every storage host.
          const response = await fetchDocumentDownload(url, { signal: controller.signal });
          if (!response.ok) throw new Error("Couldn't load the file");
          bytes = await readPreviewResponse(response, controller.signal);
          setOrigin(document.latestVersionId ? "version" : "link");
        }
        if (cancelled || !bytes) return;
        assertPreviewSize(bytes.byteLength);
        // Never trust the filename or a response's content type: a sharing
        // link (e.g. a Drive viewer URL) can return an HTML page, and a blob:
        // URL inherits this origin, so framing it would run that page's
        // scripts with the app's privileges. Classify by the bytes and re-type
        // every blob explicitly.
        if (hasPdfSignature(bytes)) {
          setPdfBlob(new Blob([bytes], { type: "application/pdf" }));
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
            setDocxBlob(new Blob([bytes], { type: DOCX_MIME_TYPE }));
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
        const media = mediaMimeType(bytes, fileName);
        if (media) {
          createdBlobUrl = URL.createObjectURL(new Blob([bytes], { type: media }));
          setBlobUrl(createdBlobUrl);
          setStatus(media.startsWith("audio/") ? "audio" : "video");
          return;
        }
        if (/^(txt|csv|md|json|vtt|srt)$/.test(ext)) {
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
  }, [loadBytes, getDownloadTarget, document?._id, document?.latestVersionId, document?.sha256, document?.mimeType, fallbackUrl, fileName, hasAnyFile]);

  const docxFailed = useCallback((error: unknown) => {
    console.error("Failed to render document preview", error);
    setStatus("error");
  }, []);
  const extracted = extractedText?.trim();
  return (
    <ScrollArea className="document-preview-pane" viewportClassName="document-preview-pane__viewport" tabIndex={0} role="region" aria-label="Document preview">
      {origin === "saved" && status !== "loading" && (
        <div className="document-preview-pane__origin"><ShieldCheck size={12} /> Showing the saved original</div>
      )}
      {status === "loading" && (
        <div className="minutes-docx-preview__status">
          <Loader2 size={18} className="minutes-docx-preview__spinner" aria-hidden />
          <span>Loading preview…</span>
        </div>
      )}
      {status === "pdf" && pdfBlob && <PdfPreview blob={pdfBlob} />}
      {status === "docx" && docxBlob && <DocxPreview blob={docxBlob} onError={docxFailed} />}
      {status === "image" && blobUrl && (
        <img src={blobUrl} alt={fileName ?? "Document image"} className="document-preview-pane__image" />
      )}
      {status === "audio" && blobUrl && <audio className="file-preview-media" src={blobUrl} controls preload="metadata" aria-label={fileName ?? "Audio preview"} />}
      {status === "video" && blobUrl && <video className="file-preview-media" src={blobUrl} controls playsInline preload="metadata" aria-label={fileName ?? "Video preview"} />}
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
          {status === "unsupported" && <p>Preview is not available for this file type. Download the original to open it in its own application.</p>}
          {status === "not-a-file" && <p>This link didn't return the document file itself (it may be a sharing or viewer page), so it isn't previewed here. Use “Open file” to view it at its source.</p>}
          {status === "unavailable" && <p>{hasAnyFile ? "No previewable file could be loaded." : "No file is attached to this document — it's a metadata record. Its details are below."}</p>}
          {status === "error" && <p><FileWarning size={16} aria-hidden /> Couldn't render a preview. You can still download the original.</p>}
          {onOpenFile && hasAnyFile && status !== "unavailable" && <button className="btn btn--sm" onClick={onOpenFile}><Download size={12} /> Open file</button>}
          {extracted && (
            <details className="document-preview-pane__extracted" open>
              <summary>Text extracted at import ({extracted.length.toLocaleString()} characters)</summary>
              <pre>{extracted.slice(0, 20_000)}{extracted.length > 20_000 ? "\n…" : ""}</pre>
            </details>
          )}
        </div>
      )}
    </ScrollArea>
  );
}
