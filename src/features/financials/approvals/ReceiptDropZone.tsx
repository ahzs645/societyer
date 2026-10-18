import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../convex/_generated/dataModel";
import { FileDropZone, type FileRejection } from "../../../components/FileDropZone";
import { usePermissions } from "../../../hooks/usePermissions";
import { uploadDocumentVersion } from "../../../lib/documentVersionUpload";
import { isDocumentVersionStorageEnabled } from "../../../lib/runtimeMode";

const ACCEPT = "image/*,application/pdf,.heic,.heif";
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Drop, paste or choose a receipt file: creates a Receipt document (the same
 * upload path as Documents), then hands its id to the caller to link to the claim.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canUpload = permissions.loaded && permissions.can("documents:write") && isDocumentVersionStorageEnabled();
  const off = disabled || busy || !canUpload;

  const upload = async (file: File | undefined) => {
    if (!file || off) return;
    setError(null);
    setBusy(true);
    try {
      const title = claimTitle?.trim() ? `Receipt: ${claimTitle.trim()}` : file.name;
      const documentId: string = await createDocument({
        societyId: societyId as Id<"societies">,
        title,
        category: "Receipt",
        fileName: file.name,
        mimeType: file.type || undefined,
        tags: ["receipt", "expense-claim"],
        retentionYears: 7,
      });
      await uploadDocumentVersion({ societyId, documentId, file, createDemoVersion, beginUpload, recordUploadedVersion, completeUpload });
      await onUploaded(documentId, title);
    } catch (err: unknown) {
      setError(err instanceof Error && err.message ? err.message : "The receipt could not be uploaded.");
    } finally {
      setBusy(false);
    }
  };

  const onReject = ([first]: FileRejection[]) => {
    if (!first) return;
    setError(
      first.reason === "size"
        ? "That file is over 25 MB. Upload a smaller scan or photo."
        : "That file type isn't supported. Upload a PDF or a photo of the receipt.",
    );
  };

  const hint = !permissions.loaded
    ? ""
    : !isDocumentVersionStorageEnabled()
      ? "File upload is turned off on this deployment. Link a receipt from Documents instead."
      : !permissions.can("documents:write")
        ? "Uploading receipts needs document edit access."
        : "PDF or photo, up to 25 MB. You can also paste a screenshot. It's saved to Documents as a receipt.";

  return (
    <FileDropZone
      className="receipt-drop"
      ariaLabel="Receipt upload"
      title="Drop a receipt here"
      touchTitle="Add a receipt photo or PDF"
      chooseLabel="Choose file"
      busyLabel="Uploading receipt…"
      hint={hint}
      accept={ACCEPT}
      maxBytes={MAX_BYTES}
      disabled={disabled || !canUpload}
      busy={busy}
      error={error}
      onFiles={(files) => upload(files[0])}
      onReject={onReject}
    />
  );
}
