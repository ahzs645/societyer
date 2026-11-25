import { useCallback, useState } from "react";
import { useAction, useConvex, useQuery } from "convex/react";
import { api } from "../../lib/convexApi";
import { readDocumentPreview } from "../../lib/documentPreview";
import { FilePreviewDialog } from "../../components/FilePreviewDialog";

/** A reviewer opens the pinned document version, including after a later upload. */
export function PolicyEvidencePreview({
  versionId,
  label,
  onRead,
}: {
  versionId: string;
  label: string;
  onRead?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn--sm" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && <VersionPreview versionId={versionId} onRead={onRead} close={() => setOpen(false)} />}
    </>
  );
}

function VersionPreview({
  versionId,
  onRead,
  close,
}: {
  versionId: string;
  onRead?: (id: string) => void;
  close: () => void;
}) {
  const version = useQuery(api.documentVersions.get, { id: versionId });
  const convex = useConvex();
  const download = useAction(api.documentVersions.getDownloadTarget);
  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!version) throw new Error("The reviewed version is unavailable.");
      const bytes = await readDocumentPreview(
        {
          _id: version.documentId,
          latestVersionId: version._id,
          versionOnly: true,
          sha256: version.sha256,
          fileSizeBytes: version.fileSizeBytes,
        },
        {
          getDownloadTarget: (args) => download(args),
          getLegacyUrl: (storageId) => convex.query(api.files.getUrl, { storageId }),
        },
        signal,
      );
      if (!signal.aborted) onRead?.(version._id);
      return bytes;
    },
    [version, download, convex, onRead],
  );
  if (!version)
    return (
      <p role="status">
        {version === undefined ? "Loading original…" : "Original unavailable"}{" "}
        <button type="button" onClick={close}>
          Close
        </button>
      </p>
    );
  return (
    <FilePreviewDialog
      file={{
        id: version._id,
        name: version.fileName || "Policy original",
        mimeType: version.mimeType,
        sha256: version.sha256,
        bytes: version.fileSizeBytes,
      }}
      loadBytes={load}
      onClose={close}
    />
  );
}
