import { useCallback, useEffect, useMemo, useState } from "react";
import { useAction, useConvex, useQuery } from "convex/react";
import { Eye } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../convex/_generated/dataModel";
import { readDocumentPreview, type PreviewDocument } from "../lib/documentPreview";
import { openDocumentFile, documentHasFile } from "../lib/documentOpen";
import { Modal } from "./Modal";
import { FilePreviewDialog } from "./FilePreviewDialog";
import { useToast } from "./Toast";

/** Mount only for the selected file: no storage requests per row. */
export function DocumentFilePreview({ document, onClose }: { document: PreviewDocument; onClose: () => void }) {
  const latest = useQuery(api.documentVersions.latest, document.latestVersionId ? "skip" : { documentId: document._id });
  const resolved = useMemo(() => latest ? { ...document, latestVersionId: latest._id, fileName: latest.fileName, mimeType: latest.mimeType, sha256: latest.sha256, fileSizeBytes: latest.fileSizeBytes } : document, [document, latest]);
  if (!document.latestVersionId && latest === undefined) return <Modal open title={document.fileName ?? document.title ?? "Document"} className="modal--one-line-title" onClose={onClose}><p role="status">Loading file information…</p></Modal>;
  return <ResolvedDocumentFilePreview document={resolved} onClose={onClose} />;
}

function ResolvedDocumentFilePreview({ document, onClose }: { document: PreviewDocument; onClose: () => void }) {
  const getDownloadTarget = useAction(api.documentVersions.getDownloadTarget);
  const convex = useConvex();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const loadBytes = useCallback((signal: AbortSignal) => readDocumentPreview(document, {
    getDownloadTarget: args => getDownloadTarget({ versionId: args.versionId as Id<"documentVersions"> }),
    getLegacyUrl: storageId => convex.query(api.files.getUrl, { storageId }),
  }, signal), [document, getDownloadTarget, convex]);
  const download = async () => {
    setDownloading(true);
    try {
      const result = await openDocumentFile(document, {
        getDownloadTarget: args => getDownloadTarget({ versionId: args.versionId as Id<"documentVersions"> }),
        getLegacyUrl: storageId => convex.query(api.files.getUrl, { storageId }),
      });
      if (result === "none" || result === "simulated") toast.info("No stored original is available for this document.");
    } catch (error) { toast.error("Could not open the original", error instanceof Error ? error.message : String(error)); }
    finally { setDownloading(false); }
  };
  return <FilePreviewDialog file={{ id: document._id, name: document.fileName ?? document.title ?? "Document", mimeType: document.mimeType, sha256: document.sha256, bytes: document.fileSizeBytes }} loadBytes={loadBytes} onClose={onClose} onDownload={() => void download()} downloading={downloading} />;
}

/** Reusable action for meeting packages, linked sources and file history. */
export function DocumentPreviewButton({ document, label = "Preview", className = "btn btn--ghost btn--sm" }: { document: PreviewDocument; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  if (("inCameraWithheld" in document && document.inCameraWithheld) || !documentHasFile(document)) return null;
  return <><button type="button" className={className} onClick={() => setOpen(true)}><Eye size={14} />{label}</button>{open && <DocumentFilePreview document={document} onClose={() => setOpen(false)} />}</>;
}

/** For record links carrying only an ID: resolve metadata after the click. */
export function DocumentPreviewByIdButton({ documentId, label = "Preview" }: { documentId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(true)}><Eye size={14} />{label}</button>{open && <DocumentPreviewById documentId={documentId} onClose={() => setOpen(false)} />}</>;
}
function DocumentPreviewById({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const convex = useConvex();
  const [document, setDocument] = useState<PreviewDocument | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void convex.query(api.documents.get, { id: documentId }).then(row => {
      if (!active) return;
      if (!row || row.inCameraWithheld) setError("This file is unavailable or you do not have access to it.");
      else setDocument(row);
    }).catch(() => { if (active) setError("This file is unavailable or you do not have access to it."); });
    return () => { active = false; };
  }, [convex, documentId]);
  if (document) return <DocumentFilePreview document={document} onClose={onClose} />;
  return <Modal open title="Document preview" onClose={onClose}><p role={error ? "alert" : "status"}>{error || "Loading file information…"}</p></Modal>;
}
