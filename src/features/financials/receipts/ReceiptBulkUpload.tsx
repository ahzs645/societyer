import { useState } from "react";
import { useMutation } from "convex/react";
import { Inbox } from "lucide-react";
import { api } from "@/lib/convexApi";
import { FileDropZone, type FileRejection } from "../../../components/FileDropZone";
import { useToast } from "../../../components/Toast";
import { usePermissions } from "../../../hooks/usePermissions";
import { useCreateReceiptDocument } from "./useCreateReceiptDocument";
import { isDocumentVersionStorageEnabled } from "../../../lib/runtimeMode";
import { pluralize } from "../../../lib/format";
import { parseReceiptFilename, type ReceiptPrefill } from "../../../../shared/receiptMatching";
import { errorMessage } from "../banking/types";

const ACCEPT = "image/*,application/pdf,.heic,.heif,.eml,message/rfc822";
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 50;

/**
 * Drop several receipt files at once. Each becomes a Receipt document (the
 * same upload path as Documents) and an inbox item, with the merchant, amount
 * and date prefilled from its file name where it carries them.
 */
export function ReceiptBulkUpload({ societyId, canWrite }: { societyId: string; canWrite: boolean }) {
  const permissions = usePermissions();
  const createReceipt = useCreateReceiptDocument(societyId);
  const addToInbox = useMutation(api.receiptInbox.add);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const storage = isDocumentVersionStorageEnabled();
  const canUpload = canWrite && storage && permissions.loaded && permissions.can("documents:write");

  const upload = async (files: File[]) => {
    if (!canUpload || busy || !files.length) return;
    const batch = files.slice(0, MAX_FILES);
    setError(null);
    const items: Array<{ documentId: string; fileName: string } & ReceiptPrefill> = [];
    const failed: string[] = [];
    for (const [index, original] of batch.entries()) {
      setBusy(`Uploading ${index + 1} of ${batch.length}…`);
      try {
        const prefill = /\.eml$/i.test(original.name) || original.type === "message/rfc822" ? {} : parseReceiptFilename(original.name);
        const title = prefill.merchant ? `Receipt: ${prefill.merchant}${prefill.date ? ` (${prefill.date})` : ""}` : `Receipt: ${original.name}`;
        const documentId = await createReceipt(original, title, ["receipt", "inbox"], 7);
        items.push({ documentId, fileName: original.name, ...prefill });
      } catch (err: unknown) {
        failed.push(`${original.name}: ${errorMessage(err) ?? "upload failed"}`);
      }
    }
    try {
      if (items.length) {
        const result = await addToInbox({ societyId, items });
        toast.success(`${pluralize(result.added, "receipt")} added to the inbox`, files.length > MAX_FILES ? `Only the first ${MAX_FILES} files were uploaded.` : undefined);
      }
      if (failed.length) setError(failed.join(" "));
    } catch (err: unknown) {
      setError(errorMessage(err) ?? "The receipts could not be added to the inbox.");
    } finally {
      setBusy(null);
    }
  };

  const onReject = (rejections: FileRejection[]) => {
    setError(rejections.map((rejection) => `${rejection.file.name}: ${rejection.reason === "size" ? "over 25 MB" : "choose a PDF, image or .eml email"}`).join(" "));
  };

  const hint = !storage
    ? "File upload is turned off on this deployment."
    : !canUpload
      ? "Uploading receipts needs finance and document edit access."
      : "PDFs, photos or .eml email receipts, up to 25 MB each and 50 at a time. Preview email receipts and enter their expense details.";

  return (
    <FileDropZone
      className="receipt-inbox__drop"
      ariaLabel="Upload receipts"
      icon={<Inbox size={16} />}
      title="Drop receipts here"
      touchTitle="Add receipts"
      chooseLabel="Choose files"
      busyLabel={busy ?? "Uploading…"}
      hint={hint}
      touchHint={canUpload ? "Photos, PDFs or .eml emails, 25 MB each, up to 50 at a time." : undefined}
      accept={ACCEPT}
      maxBytes={MAX_BYTES}
      multiple
      disabled={!canUpload}
      busy={Boolean(busy)}
      error={error}
      onFiles={(files) => upload(files)}
      onReject={onReject}
    />
  );
}
