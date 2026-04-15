import { useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { Drawer, Field, Badge } from "./ui";
import { useToast } from "./Toast";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { isDemoMode } from "../lib/demoMode";
import { History, Upload, RotateCcw, Download } from "lucide-react";
import { formatDate } from "../lib/format";

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
  const recordUpload = useMutation(api.documentVersions.recordUploadedVersion);
  const rollback = useMutation(api.documentVersions.rollback);
  const getDownloadUrl = useAction(api.documentVersions.getDownloadUrl);
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [changeNote, setChangeNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (!documentId) return null;

  const handleFile = async (file: File) => {
    if (!documentId) return;
    setBusy(true);
    try {
      if (isDemoMode()) {
        await createDemoVersion({
          societyId,
          documentId,
          fileName: file.name,
          mimeType: file.type,
          fileSizeBytes: file.size,
          changeNote: changeNote || undefined,
          actingUserId,
        });
        toast.success(`Uploaded as v${(versions?.[0]?.version ?? 0) + 1} (demo)`);
      } else {
        const { version, presigned } = await beginUpload({
          societyId,
          documentId,
          fileName: file.name,
          mimeType: file.type,
          fileSizeBytes: file.size,
          actingUserId,
        });
        if (presigned.provider === "rustfs") {
          const res = await fetch(presigned.url, {
            method: "PUT",
            headers: presigned.headers ?? (file.type ? { "Content-Type": file.type } : {}),
            body: file,
          });
          if (!res.ok) throw new Error(`RustFS upload failed (${res.status})`);
        }
        await recordUpload({
          societyId,
          documentId,
          version,
          storageProvider: presigned.provider,
          storageKey: presigned.key,
          fileName: file.name,
          mimeType: file.type,
          fileSizeBytes: file.size,
          changeNote: changeNote || undefined,
          actingUserId,
        });
        toast.success(`Uploaded as v${version}`);
      }
      setChangeNote("");
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const download = async (versionId: Id<"documentVersions">) => {
    const url = await getDownloadUrl({ versionId });
    if (!url) return;
    if (url.startsWith("demo://")) {
      toast.info("Demo mode — no real file is stored, so the download URL is simulated.");
      return;
    }
    window.open(url, "_blank");
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Versions · ${title}`}
      footer={
        <>
          <input
            ref={fileRef}
            type="file"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button
            className="btn btn--accent"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={12} /> Upload new version
          </button>
        </>
      }
    >
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

      <div className="field__label" style={{ marginTop: 16 }}>
        <History size={14} /> History
      </div>

      {versions === undefined && <div className="muted">Loading…</div>}
      {versions && versions.length === 0 && (
        <div className="muted" style={{ padding: 12 }}>
          No versions yet. Upload a file to create v1.
        </div>
      )}

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
              <span className="muted mono" style={{ fontSize: "var(--fs-sm)" }}>
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
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => download(v._id)}
              >
                <Download size={12} /> Download
              </button>
              {!v.isCurrent && (
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={async () => {
                    await rollback({ versionId: v._id, actingUserId });
                    toast.success(`Rolled back to v${v.version}`);
                  }}
                >
                  <RotateCcw size={12} /> Restore
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Drawer>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
