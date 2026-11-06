import { useState } from "react";
import { FileDropZone, type FileRejection } from "../../../components/FileDropZone";
import { usePermissions } from "../../../hooks/usePermissions";
import { useCreateReceiptDocument } from "../receipts/useCreateReceiptDocument";
import { isDocumentVersionStorageEnabled } from "../../../lib/runtimeMode";

const ACCEPT = "image/*,application/pdf,.heic,.heif,.eml,message/rfc822";
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
  const createReceipt = useCreateReceiptDocument(societyId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canUpload = permissions.loaded && permissions.can("documents:write") && isDocumentVersionStorageEnabled();
  const off = disabled || busy || !canUpload;

  const upload = async (original: File | undefined) => {
    if (!original || off) return;
    setError(null);
    setBusy(true);
    try {
      const title = claimTitle?.trim() ? `Receipt: ${claimTitle.trim()}` : original.name;
      const documentId = await createReceipt(original, title, ["receipt", "expense-claim"], 7);
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
        : "Upload a PDF, photo or .eml email receipt.",
    );
  };

  const hint = !permissions.loaded
    ? ""
    : !isDocumentVersionStorageEnabled()
      ? "File upload is turned off on this deployment. Link a receipt from Documents instead."
      : !permissions.can("documents:write")
        ? "Uploading receipts needs document edit access."
        : "PDF, photo or .eml email, up to 25 MB. You can also paste a screenshot. It's saved to Documents as a receipt.";

  return (
    <FileDropZone
      className="receipt-drop"
      ariaLabel="Receipt upload"
      title="Drop a receipt here"
      touchTitle="Add a receipt file or email"
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
