import { useRef, useState, type DragEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { FileText, Paperclip, UploadCloud, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "@/hooks/usePermissions";
import { Select } from "../../../components/Select";
import { useToast } from "../../../components/Toast";
import { uploadDocumentVersion } from "../../../lib/documentVersionUpload";
import { isNativeFileStorageEnabled } from "../../../lib/runtimeMode";
import { RECEIPT_ATTENTION_THRESHOLD_CENTS } from "./transactionAttention";
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
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const attached = useQuery(api.documents.get, txn.receiptDocumentId ? { id: txn.receiptDocumentId as any } : "skip") as { _id: string; title?: string; fileName?: string } | null | undefined;
  const library = useQuery(api.documents.listSummaries, picking ? { societyId: societyId as any } : "skip") as Array<{ _id: string; title?: string; category?: string; createdAtISO?: string }> | undefined;
  const storage = isNativeFileStorageEnabled();

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

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void upload(file);
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
        <label
          className={`txn-receipt__drop${dragging ? " is-dragging" : ""}${busy ? " is-busy" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <UploadCloud size={18} aria-hidden="true" />
          <span className="txn-receipt__drop-title">{busy ? "Attaching…" : "Drop a receipt here, or choose a file"}</span>
          <span className="txn-receipt__drop-hint">
            {txn.receiptStatus === "attached"
              ? "Marked as received in the bank feed. Add the file to keep it with this transaction."
              : needed
                ? `Payments over ${formatMoney(RECEIPT_ATTENTION_THRESHOLD_CENTS, { trimWholeCents: true })} need a receipt.`
                : "Saved to Documents as a receipt."}
          </span>
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            accept="image/*,application/pdf"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
        </label>
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
