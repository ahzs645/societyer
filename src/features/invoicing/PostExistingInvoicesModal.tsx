import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { Modal } from "../../components/Modal";
import { Money } from "../../components/Money";
import { useToast } from "../../components/Toast";
import { pluralize } from "../../lib/format";
import type { InvoicePostingPreview } from "./types";

type Props = { open: boolean; onClose: () => void; societyId: string; canPost: boolean; onOpenInvoice: (id: string) => void; onEditMapping: () => void };

/**
 * "Post existing invoices to the ledger": a preview of what would be posted
 * (sent invoices not yet in the books and their payments) and of what blocks
 * the rest, then the run. Running it twice posts nothing new.
 */
export function PostExistingInvoicesModal({ open, onClose, societyId, canPost, onOpenInvoice, onEditMapping }: Props) {
  const preview = useQuery(api.invoices.postingPreview, open ? { societyId: societyId as Id<"societies"> } : "skip") as InvoicePostingPreview | undefined;
  const postExisting = useMutation(api.invoices.postExisting);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const nothing = preview && preview.invoiceCount === 0 && preview.paymentCount === 0;

  const run = async () => {
    setBusy(true);
    try {
      const result = await postExisting({ societyId: societyId as Id<"societies"> });
      const posted = [result.postedInvoices ? pluralize(result.postedInvoices, "invoice") : "", result.postedPayments ? pluralize(result.postedPayments, "payment") : ""].filter(Boolean).join(" and ");
      if (result.failed.length) toast.warn(posted ? `Posted ${posted}` : "Nothing posted", `${pluralize(result.failed.length, "invoice")} couldn't be posted: ${result.failed[0].number}: ${result.failed[0].error}`);
      else toast.success(posted ? `Posted ${posted}` : "Nothing new to post", result.blocked ? `${pluralize(result.blocked, "invoice")} still need action.` : undefined);
      onClose();
    } catch (err) {
      toast.error("Could not post the invoices", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Post existing invoices to the ledger"
      size="lg"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--accent" disabled={!canPost || busy || !preview || nothing} title={canPost ? undefined : "Only admins can post existing invoices"} onClick={() => void run()}>
            {preview && !nothing ? `Post ${pluralize(preview.invoiceCount + preview.paymentCount, "entry", "entries")}` : "Post"}
          </button>
        </>
      }
    >
      {!preview ? (
        <div className="record-table__loading"><div className="record-table__loading-row" /><div className="record-table__loading-row" /></div>
      ) : (
        <div className="invoice-backfill">
          <p className="muted">
            Sent invoices that aren't in the books yet post their receivable and revenue on the issue date, and their payments on the payment
            date. Anything already posted is left alone, so this can be run again safely.
            {preview.booksStart ? ` Activity on or before ${preview.booksStart.replace(/^the /, "")} belongs to the opening balances and is not posted.` : ""}
          </p>
          <dl className="invoice-backfill__figures">
            <div><dt>Invoices to post</dt><dd>{preview.invoiceCount} · <Money cents={preview.invoiceCents} /></dd></div>
            <div><dt>Payments to post</dt><dd>{preview.paymentCount} · <Money cents={preview.paymentCents} /></dd></div>
            <div><dt>Already in the books</dt><dd>{preview.postedCount}</dd></div>
          </dl>
          {preview.blocked.length > 0 && (
            <section aria-labelledby="backfill-blocked">
              <h3 id="backfill-blocked" className="invoice-drawer__heading">Not posted ({preview.blocked.length})</h3>
              <ul className="invoice-backfill__blocked">
                {preview.blocked.slice(0, 50).map((row) => (
                  <li key={row.invoiceId}>
                    <button type="button" className="invoice-table__link" onClick={() => { onClose(); onOpenInvoice(row.invoiceId); }}>{row.number}</button>
                    <span className="muted"> · {row.billToName} · <Money cents={row.totalCents} /></span>
                    <span className="invoice-backfill__reason">{row.reasons.join(" ")}</span>
                  </li>
                ))}
              </ul>
              {preview.blocked.some((row) => row.reasons.some((reason) => reason.startsWith("No revenue account"))) && (
                <button type="button" className="btn btn--sm" onClick={() => { onClose(); onEditMapping(); }}>Edit GL account mapping</button>
              )}
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
