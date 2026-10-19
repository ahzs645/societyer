import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { FileDropZone, type FileRejection } from "../../components/FileDropZone";
import { usePermissions } from "../../hooks/usePermissions";
import { uploadDocumentVersion } from "../../lib/documentVersionUpload";
import { isDocumentVersionStorageEnabled } from "../../lib/runtimeMode";

const ACCEPT = "image/*,application/pdf,.heic,.heif";
const MAX_BYTES = 25 * 1024 * 1024;

/** Whether this person can upload a bill file on this deployment. */
export function useCanUploadBill() {
  const permissions = usePermissions();
  return permissions.loaded && permissions.can("documents:write") && isDocumentVersionStorageEnabled();
}

/**
 * Creates a Bill document from a file (the same upload path as Documents) and
 * returns its id. Shared by the drop zone and the "Upload bill" quick action.
 */
export function useUploadBillDocument(societyId: string) {
  const createDocument = useMutation(api.documents.create);
  const createDemoVersion = useMutation(api.documentVersions.createDemoVersion);
  const beginUpload = useAction(api.documentVersions.beginUpload);
  const completeUpload = useAction(api.documentVersions.completeUpload);
  const recordUploadedVersion = useMutation(api.documentVersions.recordUploadedVersion);
  return async (file: File, label?: string) => {
    const title = label?.trim() ? `Bill: ${label.trim()}` : file.name;
    const documentId: string = await createDocument({
      societyId: societyId as Id<"societies">,
      title,
      category: "Bill",
      fileName: file.name,
      mimeType: file.type || undefined,
      tags: ["bill", "accounts-payable"],
      retentionYears: 7,
    });
    await uploadDocumentVersion({ societyId, documentId, file, createDemoVersion, beginUpload, recordUploadedVersion, completeUpload });
    return { documentId, title };
  };
}

export function rejectionMessage([first]: FileRejection[]) {
  if (!first) return null;
  return first.reason === "size"
    ? "That file is over 25 MB. Upload a smaller scan or PDF."
    : "That file type isn't supported. Upload a PDF or a photo of the bill.";
}

/** Drop, paste or choose the bill file; hands the new document id to the caller to link. */
export function BillDocumentDropZone({
  societyId,
  label,
  onUploaded,
  disabled,
}: {
  societyId: string;
  /** Names the document ("Bill: {vendor} {number}"). */
  label?: string;
  onUploaded: (documentId: string, title: string) => void | Promise<void>;
  disabled?: boolean;
}) {
  const permissions = usePermissions();
  const canUpload = useCanUploadBill();
  const upload = useUploadBillDocument(societyId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file || disabled || busy || !canUpload) return;
    setError(null);
    setBusy(true);
    try {
      const { documentId, title } = await upload(file, label);
      await onUploaded(documentId, title);
    } catch (err: unknown) {
      setError(err instanceof Error && err.message ? err.message : "The bill could not be uploaded.");
    } finally {
      setBusy(false);
    }
  };

  const hint = !permissions.loaded
    ? ""
    : !isDocumentVersionStorageEnabled()
      ? "File upload is turned off on this deployment."
      : !permissions.can("documents:write")
        ? "Uploading bills needs document edit access."
        : "PDF or photo, up to 25 MB. It's saved to Documents as a bill.";

  return (
    <FileDropZone
      className="receipt-drop"
      ariaLabel="Bill upload"
      title="Drop the bill here"
      touchTitle="Add a bill photo or PDF"
      chooseLabel="Choose file"
      busyLabel="Uploading bill…"
      hint={hint}
      accept={ACCEPT}
      maxBytes={MAX_BYTES}
      disabled={disabled || !canUpload}
      busy={busy}
      error={error}
      onFiles={(files) => onFile(files[0])}
      onReject={(rejections) => setError(rejectionMessage(rejections))}
    />
  );
}
