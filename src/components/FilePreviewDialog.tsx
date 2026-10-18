import { lazy, Suspense, useCallback } from "react";
import { Download } from "lucide-react";
import { Modal } from "./Modal";

const PreviewPane = lazy(() => import("./DocumentPreviewPane").then(module => ({ default: module.DocumentPreviewPane })));
/** Bound in-memory previews on phones; downloading the original remains available. */
export const MAX_FILE_PREVIEW_BYTES = 25 * 1024 * 1024;
export type PreviewFile = { id: string; name: string; mimeType?: string; sha256?: string; bytes?: number };

/**
 * Storage-independent preview dialog for any platform feature. The caller's
 * loader must authorize access and verify stored-file integrity. No storage URL
 * or credentials are passed to a third-party document viewer.
 */
export function FilePreviewDialog({ file, loadBytes, onClose, onDownload, downloading = false }: {
  file: PreviewFile;
  loadBytes: (signal: AbortSignal) => Promise<ArrayBuffer>;
  onClose: () => void;
  onDownload?: () => void;
  downloading?: boolean;
}) {
  const boundedLoad = useCallback(async (signal: AbortSignal) => {
    const bytes = await loadBytes(signal);
    signal.throwIfAborted();
    if (bytes.byteLength > MAX_FILE_PREVIEW_BYTES) throw new Error("Inline preview supports files up to 25 MB.");
    return bytes;
  }, [loadBytes]);
  return <Modal open title={file.name} size="xl" onClose={onClose} footer={onDownload && <button className="btn" disabled={downloading} onClick={onDownload}><Download size={14} />{downloading ? "Downloading…" : "Download original"}</button>}>
    {file.bytes !== undefined && file.bytes > MAX_FILE_PREVIEW_BYTES
      ? <p>Inline preview supports files up to 25 MB. Download the original to open this file.</p>
      : <Suspense fallback={<p role="status">Loading document viewer…</p>}>
          <PreviewPane document={{ _id: file.id, fileName: file.name, mimeType: file.mimeType, sha256: file.sha256 }} fallbackUrl={null} hasAnyFile onOpenFile={onDownload} loadBytes={boundedLoad} />
        </Suspense>}
  </Modal>;
}
