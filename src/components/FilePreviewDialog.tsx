import { lazy, Suspense, useCallback, useState } from "react";
import { Download, Maximize2, Minimize2 } from "lucide-react";
import { Modal } from "./Modal";
import { splitFileName } from "./previewViewport";

const PreviewPane = lazy(() => import("./DocumentPreviewPane").then(module => ({ default: module.DocumentPreviewPane })));
/** Bound in-memory previews on phones; downloading the original remains available. */
export { MAX_FILE_PREVIEW_BYTES } from "../lib/filePreviewBytes";
import { MAX_FILE_PREVIEW_BYTES } from "../lib/filePreviewBytes";
export type PreviewFile = { id: string; name: string; mimeType?: string; sha256?: string; bytes?: number };

/**
 * Storage-independent preview dialog for any platform feature. The caller's
 * loader must authorize access and verify stored-file integrity. No storage URL
 * or credentials are passed to a third-party document viewer.
 *
 * The header shows the file name on one line with a middle ellipsis, so the
 * extension and the expand/close actions always stay visible; tapping the name
 * (or hovering it) shows it in full. The modal's own heading stays as the
 * dialog's accessible name, visually hidden.
 */
export function FilePreviewDialog({ file, loadBytes, onClose, onDownload, downloading = false }: {
  file: PreviewFile;
  loadBytes: (signal: AbortSignal) => Promise<ArrayBuffer>;
  onClose: () => void;
  onDownload?: () => void;
  downloading?: boolean;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const boundedLoad = useCallback(async (signal: AbortSignal) => {
    const bytes = await loadBytes(signal);
    signal.throwIfAborted();
    if (bytes.byteLength > MAX_FILE_PREVIEW_BYTES) throw new Error("Inline preview supports files up to 25 MB.");
    return bytes;
  }, [loadBytes]);
  return (
    <Modal
      open
      title={file.name}
      size="xl"
      className="file-preview-modal"
      resizable={false}
      fullscreen={fullscreen}
      headerActions={<>
        <FilePreviewTitle name={file.name} />
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          aria-pressed={fullscreen}
          onClick={() => setFullscreen(value => !value)}
        >
          {fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </>}
      onClose={onClose}
      footer={onDownload && (
        <button className="btn" disabled={downloading} onClick={onDownload}>
          <Download size={14} />{downloading ? "Downloading…" : "Download original"}
        </button>
      )}
    >
      {file.bytes !== undefined && file.bytes > MAX_FILE_PREVIEW_BYTES
        ? <p>Inline preview supports files up to 25 MB. Download the original to open this file.</p>
        : <Suspense fallback={<p role="status">Loading document viewer…</p>}>
            <PreviewPane document={{ _id: file.id, fileName: file.name, mimeType: file.mimeType, sha256: file.sha256 }} fallbackUrl={null} hasAnyFile onOpenFile={onDownload} loadBytes={boundedLoad} />
          </Suspense>}
    </Modal>
  );
}

/** One line, cut in the middle ("Forestry Digital…Design.docx"); a tap toggles the full name. */
function FilePreviewTitle({ name }: { name: string }) {
  const [expanded, setExpanded] = useState(false);
  const { head, tail } = splitFileName(name);
  return (
    <button type="button" className={`file-preview-title${expanded ? " is-expanded" : ""}`} title={name} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      {expanded || !tail ? <span className="file-preview-title__head">{name}</span> : <>
        <span className="file-preview-title__head">{head}</span>
        <span className="file-preview-title__tail">{tail}</span>
      </>}
    </button>
  );
}
