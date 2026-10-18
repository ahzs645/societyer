import { DocumentPreviewButton } from "./DocumentFilePreview";
import { useState, type DragEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Id } from "../../convex/_generated/dataModel";
import { Drawer, Field, Badge } from "./ui";
import { FileDropZone, useFileDrop } from "./FileDropZone";
import { useToast } from "./Toast";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { usePermissions } from "../hooks/usePermissions";
import { History, Upload, RotateCcw, Download } from "lucide-react";
import { formatDate } from "../lib/format";
import { openDocumentDownloadTarget } from "../lib/documentStorage";
import { getRestoredFile } from "../lib/workspaceArchiveFiles";
import { triggerBlobDownload } from "../lib/zip";
import { uploadDocumentVersion } from "../lib/documentVersionUpload";
import { isDocumentVersionStorageEnabled } from "../lib/runtimeMode";

export function DocumentVersionsDrawer({
  open,
  onClose,
  documentId,
  societyId,
  title,
}: {
  open: boolean;
  onClose: () => void;
  documentId: Id<"documents"> | null;
  societyId: Id<"societies">;
  title: string;
}) {
  const versions = useQuery(
    api.documentVersions.listForDocument,
    documentId ? { documentId } : "skip",
  );
  const createDemoVersion = useMutation(api.documentVersions.createDemoVersion);
  const beginUpload = useAction(api.documentVersions.beginUpload);
  const completeUpload = useAction(api.documentVersions.completeUpload);
  const recordUpload = useMutation(api.documentVersions.recordUploadedVersion);
  const rollback = useMutation(api.documentVersions.rollback);
  const getDownloadTarget = useAction(api.documentVersions.getDownloadTarget);
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const permissions = usePermissions();
  const canEdit = permissions.loaded && permissions.can("documents:write");
  const [changeNote, setChangeNote] = useState("");
  const [busy, setBusy] = useState(false);
  const nativeStorage = isDocumentVersionStorageEnabled();

  const handleFile = async (file: File) => {
    if (!documentId || !canEdit || busy) return;
    setBusy(true);
    try {
      const result = await uploadDocumentVersion({
        societyId,
        documentId,
        file,
        changeNote,
        createDemoVersion,
        beginUpload,
        recordUploadedVersion: recordUpload,
        completeUpload,
      });
      if (result.provider === "demo") {
        toast.success(`Uploaded as v${result.version} (demo)`);
      } else {
        toast.success(`Uploaded as v${result.version}`);
      }
      setChangeNote("");
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  // Any file type, no size cap here (the storage provider enforces its own).
  // The footer button opens the picker; dropping a file anywhere on the drawer
  // body uploads it too. No paste: an image pasted into the change note would
  // silently become a new version.
  const drop = useFileDrop({
    disabled: !nativeStorage || busy || !canEdit,
    onFiles: (files) => handleFile(files[0]),
  });
  // The empty state has its own full zone inside the body; leave its drags to it.
  const outsideZone = (event: DragEvent<HTMLElement>) => !(event.target instanceof Element && event.target.closest(".file-drop"));
  const { onDragEnter, onDragOver, onDragLeave, onDrop } = drop.rootProps;
  const bodyDropHandlers = {
    onDragEnter: (event: DragEvent<HTMLElement>) => { if (outsideZone(event)) onDragEnter(event); },
    onDragOver: (event: DragEvent<HTMLElement>) => { if (outsideZone(event)) onDragOver(event); },
    onDragLeave: (event: DragEvent<HTMLElement>) => { if (outsideZone(event)) onDragLeave(event); },
    onDrop: (event: DragEvent<HTMLElement>) => { if (outsideZone(event)) onDrop(event); },
  };

  if (!documentId) return null;

  const download = async (versionId: Id<"documentVersions">) => {
    const restored = await getRestoredFile({ versionId });
    if (restored) { triggerBlobDownload(restored, versions?.find((version: any) => version._id === versionId)?.fileName ?? title); return; }
    const target = await getDownloadTarget({ versionId });
    if (!target) return;
    if (target.kind === "url" && target.url?.startsWith("demo://")) {
      toast.info("Demo mode — no real file is stored, so the download URL is simulated.");
      return;
    }
    await openDocumentDownloadTarget(target);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Versions · ${title}`}
      footer={
        <>
          {nativeStorage && (
            <input {...drop.inputProps} />
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
          {nativeStorage && (
            <button
              className="btn btn--accent"
              disabled={busy || !canEdit}
              onClick={drop.open}
            >
              <Upload size={12} /> Upload new version
            </button>
          )}
        </>
      }
    >
      <div className={`file-drop-target file-drop-target--fill is-${drop.dragState}`} {...(nativeStorage ? bodyDropHandlers : {})}>
        {permissions.loaded && !canEdit && <p className="muted">Document editing permission is required to upload or restore versions.</p>}
        {nativeStorage ? (
          <Field
            label="Change note (optional)"
            hint="Shown alongside this version in history — e.g. 'Board approved v4'."
          >
            <input
              className="input"
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              placeholder="What changed?"
            />
          </Field>
        ) : (
          <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            Native file storage is disabled — new versions can't be uploaded here. Manage the file through a document connector (e.g. Paperless).
          </div>
        )}

        <div className="field__label" style={{ marginTop: 16 }}>
          <History size={14} /> History
        </div>

        {versions === undefined && <div className="muted">Loading…</div>}
        {versions && versions.length === 0 && (nativeStorage ? (
          <FileDropZone
            ariaLabel="Upload the first version"
            title="No versions yet. Drop a file here to create v1."
            touchTitle="No versions yet. Upload a file to create v1."
            busy={busy}
            disabled={!canEdit}
            onFiles={(files) => handleFile(files[0])}
          />
        ) : (
          <div className="empty-state empty-state--sm empty-state--start">
            No versions. File storage is disabled on this deployment.
          </div>
        ))}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          {(versions ?? []).map((v) => (
            <div
              key={v._id}
              className="panel"
              style={{
                padding: 10,
                border: v.isCurrent
                  ? "1px solid var(--accent)"
                  : "1px solid var(--border)",
                borderRadius: "var(--r-sm)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <strong>v{v.version}</strong>
                {v.isCurrent && <Badge tone="success">Current</Badge>}
                <Badge tone="info">{v.storageProvider}</Badge>
                <div style={{ flex: 1 }} />
                <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                  {formatDate(v.uploadedAtISO)}
                </span>
              </div>
              <div style={{ fontSize: "var(--fs-sm)", marginTop: 4 }}>
                <span className="mono">{v.fileName}</span>
                {v.fileSizeBytes != null && (
                  <span className="muted"> · {formatBytes(v.fileSizeBytes)}</span>
                )}
              </div>
              {v.uploadedByName && (
                <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                  by {v.uploadedByName}
                </div>
              )}
              {v.changeNote && (
                <div style={{ fontSize: "var(--fs-sm)", marginTop: 4 }}>{v.changeNote}</div>
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <DocumentPreviewButton document={{ ...v, _id: String(documentId), latestVersionId: v._id, versionOnly: true }} />
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => download(v._id).catch((error: any) => toast.error("Could not download version", error?.message ?? String(error)))}
                >
                  <Download size={12} /> Download
                </button>
                {!v.isCurrent && (
                  <button
                    className="btn btn--ghost btn--sm"
                    disabled={!canEdit}
                    onClick={async () => {
                      try {
                        await rollback({ versionId: v._id });
                        toast.success(`Rolled back to v${v.version}`);
                      } catch (error: any) {
                        toast.error("Could not restore version", error?.message ?? String(error));
                      }
                    }}
                  >
                    <RotateCcw size={12} /> Restore
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Drawer>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
