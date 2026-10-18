import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { FileText, Paperclip, UploadCloud, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "@/hooks/usePermissions";
import { FileDropZone } from "../../../components/FileDropZone";
import { Select } from "../../../components/Select";
import { useToast } from "../../../components/Toast";
import { uploadDocumentVersion } from "../../../lib/documentVersionUpload";
import { isDocumentVersionStorageEnabled } from "../../../lib/runtimeMode";
import { RECEIPT_ATTENTION_THRESHOLD_CENTS } from "../../../../shared/transactionAttention";
import { formatMoney } from "../../../lib/money";

/** Receipts kept as documents follow the usual seven-year finance retention. */
const RECEIPT_RETENTION_YEARS = 7;

type ReceiptTransaction = {
  _id: string;
  date: string;
  amountCents: number;
  receiptStatus?: string | null;
  receiptDocumentId?: string | null;
};

/**
 * The receipt block of the transaction panel: the attached document (open or
 * remove), or a drop zone that uploads a file as a new Receipt document and
 * attaches it, plus a picker for documents already in the library.
 */
export function TransactionReceipt({
  societyId,
  txn,
  payee,
  canWrite,
  onAttach,
}: {
  societyId: string;
  txn: ReceiptTransaction;
  payee: string;
  canWrite: boolean;
  /** Sets (document id) or clears (null) the receipt on the transaction. */
  onAttach: (documentId: string | null) => Promise<void>;
}) {
  const { loaded, can } = usePermissions();
  const canUpload = canWrite && loaded && can("documents:write");
  const toast = useToast();
  const createDocument = useMutation(api.documents.create);
  const createDemoVersion = useMutation(api.documentVersions.createDemoVersion);
  const recordUploadedVersion = useMutation(api.documentVersions.recordUploadedVersion);
  const beginUpload = useAction(api.documentVersions.beginUpload);
  const completeUpload = useAction(api.documentVersions.completeUpload);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const attached = useQuery(api.documents.get, txn.receiptDocumentId ? { id: txn.receiptDocumentId as any } : "skip") as { _id: string; title?: string; fileName?: string } | null | undefined;
  const library = useQuery(api.documents.listSummaries, picking ? { societyId: societyId as any } : "skip") as Array<{ _id: string; title?: string; category?: string; createdAtISO?: string }> | undefined;
  const storage = isDocumentVersionStorageEnabled();

  const upload = async (file: File) => {
    if (!canUpload || busy) return;
    setBusy(true);
    try {
      const title = `Receipt: ${payee} (${txn.date})`;
      const documentId = await createDocument({
        societyId: societyId as any,
        title,
        category: "Receipt",
        fileName: file.name,
        mimeType: file.type || undefined,
        tags: ["receipt"],
        retentionYears: RECEIPT_RETENTION_YEARS,
      });
      await uploadDocumentVersion({
        societyId,
        documentId,
        file,
        createDemoVersion,
        beginUpload,
        recordUploadedVersion,
        completeUpload,
      });
      await onAttach(String(documentId));
      toast.success("Receipt attached", file.name);
    } catch (error: any) {
      toast.error("Could not attach the receipt", error?.message);
    } finally {
      setBusy(false);
    }
  };

  if (txn.receiptDocumentId) {
    const name = attached?.title || attached?.fileName || (attached === null ? "Document not found" : "Loading…");
    return (
      <div className="txn-receipt txn-receipt--attached">
        <span className="txn-receipt__file-icon" aria-hidden="true"><FileText size={16} /></span>
        <div className="txn-receipt__file">
          {attached ? (
            <Link to={`/app/documents/${attached._id}`} className="txn-receipt__name">{name}</Link>
          ) : (
            <span className="txn-receipt__name">{name}</span>
          )}
          <span className="txn-receipt__meta">Receipt attached</span>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          aria-label="Remove the receipt"
          disabled={!canWrite}
          onClick={() => void onAttach(null)}
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  const needed = txn.amountCents <= -RECEIPT_ATTENTION_THRESHOLD_CENTS;
  return (
    <div className="txn-receipt">
      {canUpload && storage ? (
        // Paste works while the zone has focus (tap or Tab to it, then paste a
        // screenshot); the hidden input keeps the same accept list as before.
        <FileDropZone
          ariaLabel="Receipt upload"
          icon={<UploadCloud size={16} />}
          title="Drop a receipt here"
          touchTitle="Add a receipt photo or PDF"
          chooseLabel="Choose a file"
          busy={busy}
          busyLabel="Attaching…"
          accept="image/*,application/pdf"
          hint={
            txn.receiptStatus === "attached"
              ? "Marked as received in the bank feed. Add the file to keep it with this transaction."
              : needed
                ? `Payments over ${formatMoney(RECEIPT_ATTENTION_THRESHOLD_CENTS, { trimWholeCents: true })} need a receipt.`
                : "Saved to Documents as a receipt."
          }
          onFiles={(files) => upload(files[0])}
        />
      ) : (
        <p className="txn-receipt__meta">
          {canWrite ? "Uploading is off on this deployment. Link a document that is already in Documents." : "No receipt attached."}
        </p>
      )}
      {canWrite && (
        picking ? (
          <Select
            className="txn-receipt__picker"
            value=""
            searchable
            defaultOpen
            placeholder={library ? "Choose a document" : "Loading documents…"}
            onClose={() => setPicking(false)}
            onChange={(documentId) => {
              setPicking(false);
              void onAttach(documentId);
            }}
            options={(library ?? []).map((doc) => ({ value: String(doc._id), label: doc.title || "Untitled document", hint: doc.category }))}
          />
        ) : (
          <button type="button" className="btn btn--ghost btn--sm txn-receipt__link" onClick={() => setPicking(true)}>
            <Paperclip size={12} aria-hidden="true" /> Link a document from Documents
          </button>
        )
      )}
    </div>
  );
}
