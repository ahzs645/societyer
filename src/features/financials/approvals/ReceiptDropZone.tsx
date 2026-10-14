import { useId, useRef, useState, type DragEvent } from "react";
import { useAction, useMutation } from "convex/react";
import { FileUp, Loader2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../../../hooks/usePermissions";
import { uploadDocumentVersion } from "../../../lib/documentVersionUpload";
import { isNativeFileStorageEnabled } from "../../../lib/runtimeMode";

const ACCEPT = "image/*,application/pdf,.heic,.heif";
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Drop or choose a receipt file: creates a Receipt document (the same upload
 * path as Documents), then hands its id to the caller to link to the claim.
 */
export function ReceiptDropZone({
  societyId,
  claimTitle,
  onUploaded,
  disabled,
}: {
  societyId: string;
  /** Names the receipt document ("Receipt: {claim}"). */
  claimTitle?: string;
  onUploaded: (documentId: string, title: string) => void | Promise<void>;
  disabled?: boolean;
}) {
  const permissions = usePermissions();
  const createDocument = useMutation(api.documents.create);
  const createDemoVersion = useMutation(api.documentVersions.createDemoVersion);
  const beginUpload = useAction(api.documentVersions.beginUpload);
  const completeUpload = useAction(api.documentVersions.completeUpload);
  const recordUploadedVersion = useMutation(api.documentVersions.recordUploadedVersion);
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canUpload = permissions.loaded && permissions.can("documents:write") && isNativeFileStorageEnabled();
  const off = disabled || busy || !canUpload;

  const upload = async (file: File | undefined) => {
    if (!file || off) return;
    setError(null);
    if (file.size > MAX_BYTES) {
      setError("That file is over 25 MB. Upload a smaller scan or photo.");
      return;
    }
    setBusy(true);
    try {
      const title = claimTitle?.trim() ? `Receipt: ${claimTitle.trim()}` : file.name;
      const documentId: string = await createDocument({
        societyId: societyId as any,
        title,
        category: "Receipt",
        fileName: file.name,
        mimeType: file.type || undefined,
        tags: ["receipt", "expense-claim"],
        retentionYears: 7,
      });
      await uploadDocumentVersion({ societyId, documentId, file, createDemoVersion, beginUpload, recordUploadedVersion, completeUpload });
      await onUploaded(documentId, title);
    } catch (err: any) {
      setError(err?.message ?? "The receipt could not be uploaded.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void upload(event.dataTransfer.files?.[0]);
  };

  const hint = !permissions.loaded
    ? ""
    : !isNativeFileStorageEnabled()
      ? "File upload is turned off on this deployment. Link a receipt from Documents instead."
      : !permissions.can("documents:write")
        ? "Uploading receipts needs document edit access."
        : "PDF or photo, up to 25 MB. It's saved to Documents as a receipt.";

  return (
    <div
      className={`receipt-drop${dragging ? " is-dragging" : ""}${off ? " is-disabled" : ""}`}
      onDragOver={(event) => {
        if (off) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <span className="receipt-drop__icon" aria-hidden="true">
        {busy ? <Loader2 size={16} className="spin" /> : <FileUp size={16} />}
      </span>
      <div className="receipt-drop__text">
        <span className="receipt-drop__title">{busy ? "Uploading receipt…" : "Drop a receipt here or"}</span>
        {!busy && (
          <button type="button" className="link-button receipt-drop__choose" disabled={off} aria-describedby={hintId} onClick={() => inputRef.current?.click()}>
            choose a file
          </button>
        )}
        <span id={hintId} className="receipt-drop__hint muted">{hint}</span>
        {error && <span className="receipt-drop__error" role="alert">{error}</span>}
      </div>
      <input ref={inputRef} type="file" accept={ACCEPT} hidden tabIndex={-1} onChange={(event) => void upload(event.target.files?.[0])} />
    </div>
  );
}
