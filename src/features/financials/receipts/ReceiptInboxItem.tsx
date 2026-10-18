import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { Download, FileText, Link2, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge } from "../../../components/ui";
import { DatePicker } from "../../../components/DatePicker";
import { Money } from "../../../components/Money";
import { useToast } from "../../../components/Toast";
import { formatDate } from "../../../lib/format";
import { centsToDollarInput } from "../../../lib/format";
import { parseMoneyInput } from "../../../lib/money";
import { useOpenDocumentFile } from "../banking/useOpenDocumentFile";
import { errorMessage } from "../banking/types";
import type { InboxCandidate, InboxItem, InboxTransaction } from "./types";

const CONFIDENCE = {
  high: { tone: "success", label: "High confidence" },
  medium: { tone: "info", label: "Possible match" },
  low: { tone: "neutral", label: "Weak match" },
} as const;

function TransactionLine({ txn }: { txn: InboxTransaction }) {
  return (
    <span className="receipt-inbox__txn">
      <span className="receipt-inbox__txn-name">{txn.counterparty || txn.description}</span>
      <span className="muted">{formatDate(txn.date)}{txn.accountName ? ` · ${txn.accountName}` : ""}</span>
      <Money cents={txn.amountCents} />
    </span>
  );
}

/**
 * One receipt in the inbox: its file, editable merchant, amount and date, and
 * the transactions it may belong to (confirm one to attach the receipt), or
 * the transaction it is attached to (unmatch).
 */
export function ReceiptInboxItem({ item, canWrite }: { item: InboxItem; canWrite: boolean }) {
  const update = useMutation(api.receiptInbox.update);
  const confirmMatch = useMutation(api.receiptInbox.confirmMatch);
  const unmatch = useMutation(api.receiptInbox.unmatch);
  const setDiscarded = useMutation(api.receiptInbox.setDiscarded);
  const openFile = useOpenDocumentFile();
  const toast = useToast();
  const [merchant, setMerchant] = useState(item.merchant ?? "");
  const [amount, setAmount] = useState(item.amountCents ? centsToDollarInput(item.amountCents) : "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setMerchant(item.merchant ?? ""), [item.merchant]);
  useEffect(() => setAmount(item.amountCents ? centsToDollarInput(item.amountCents) : ""), [item.amountCents]);
  const editable = canWrite && item.status === "unmatched";

  const run = async (label: string, action: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await action();
      if (success) toast.success(success);
    } catch (error: unknown) {
      toast.error(`Could not ${label}`, errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const saveMerchant = () => {
    if (merchant.trim() === (item.merchant ?? "")) return;
    void run("save the merchant", () => update({ id: item._id, merchant: merchant.trim() || null }));
  };
  const saveAmount = () => {
    const cents = amount.trim() ? parseMoneyInput(amount) : null;
    if (cents === undefined) {
      toast.error("Enter an amount, for example 161.38");
      return;
    }
    const value = cents === null ? null : Math.abs(cents);
    if (value === (item.amountCents ?? null)) return;
    void run("save the amount", () => update({ id: item._id, amountCents: value }));
  };
  const match = (candidate: InboxCandidate) =>
    void run("match the receipt", () => confirmMatch({ id: item._id, transactionId: candidate.transactionId }), "Receipt attached to the transaction");

  return (
    <li className={`receipt-inbox__item receipt-inbox__item--${item.status}`}>
      <div className="receipt-inbox__file">
        <FileText size={16} aria-hidden="true" />
        <div className="receipt-inbox__file-text">
          <span className="receipt-inbox__file-name" title={item.fileName}>{item.fileName}</span>
          <span className="muted receipt-inbox__file-meta">
            {item.uploadedByName ? `Uploaded by ${item.uploadedByName} · ` : ""}{formatDate(item.createdAtISO)}
          </span>
        </div>
        <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Download ${item.fileName}`} onClick={() => void openFile(item.documentId)}>
          <Download size={14} />
        </button>
      </div>

      <div className="receipt-inbox__fields">
        <label className="receipt-inbox__field">
          <span>Merchant</span>
          <input className="input input--sm" value={merchant} disabled={!editable || busy} placeholder="Who was paid" onChange={(event) => setMerchant(event.target.value)} onBlur={saveMerchant} />
        </label>
        <label className="receipt-inbox__field receipt-inbox__field--amount">
          <span>Amount</span>
          <input className="input input--sm" inputMode="decimal" value={amount} disabled={!editable || busy} placeholder="$0.00" onChange={(event) => setAmount(event.target.value)} onBlur={saveAmount} />
        </label>
        <div className="receipt-inbox__field receipt-inbox__field--date">
          <span>Date</span>
          <DatePicker value={item.date ?? ""} disabled={!editable || busy} onChange={(date) => void run("save the date", () => update({ id: item._id, date: date || null }))} />
        </div>
      </div>

      <div className="receipt-inbox__match">
        {item.status === "matched" && item.matchedTransaction ? (
          <>
            <span className="receipt-inbox__match-label"><Link2 size={12} aria-hidden="true" /> Attached to</span>
            <TransactionLine txn={item.matchedTransaction} />
            <button type="button" className="btn btn--sm" disabled={!canWrite || busy} onClick={() => void run("unmatch the receipt", () => unmatch({ id: item._id }), "Receipt removed from the transaction")}>
              <Undo2 size={12} aria-hidden="true" /> Unmatch
            </button>
          </>
        ) : item.status === "discarded" ? (
          <>
            <span className="muted">Discarded. The file stays in Documents.</span>
            <button type="button" className="btn btn--sm" disabled={!canWrite || busy} onClick={() => void run("restore the receipt", () => setDiscarded({ id: item._id, discarded: false }))}>
              <RotateCcw size={12} aria-hidden="true" /> Restore
            </button>
          </>
        ) : (
          <>
            {item.candidates.length === 0 ? (
              <span className="muted receipt-inbox__none">
                {item.amountCents || item.date || item.merchant ? "No matching transactions in the last 18 months." : "Enter the amount and date to find its transaction."}
              </span>
            ) : (
              <ul className="receipt-inbox__candidates" aria-label="Suggested transactions">
                {item.candidates.map((candidate) => (
                  <li key={candidate.transactionId} className="receipt-inbox__candidate">
                    <TransactionLine txn={candidate.transaction} />
                    <span className="receipt-inbox__why" title={candidate.reasons.join(" · ")}>
                      <Badge tone={CONFIDENCE[candidate.confidence].tone}>{CONFIDENCE[candidate.confidence].label}</Badge>
                      <span className="muted">{candidate.reasons.join(" · ")}</span>
                    </span>
                    <button type="button" className={`btn btn--sm${candidate.confidence === "high" ? " btn--accent" : ""}`} disabled={!canWrite || busy} onClick={() => match(candidate)}>
                      <Link2 size={12} aria-hidden="true" /> Match
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="btn btn--ghost btn--sm receipt-inbox__discard" disabled={!canWrite || busy} onClick={() => void run("discard the receipt", () => setDiscarded({ id: item._id, discarded: true }), "Receipt discarded")}>
              <Trash2 size={12} aria-hidden="true" /> Discard
            </button>
          </>
        )}
      </div>
    </li>
  );
}
