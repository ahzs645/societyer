import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { ArrowLeft, Inbox, Wand2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { EmptyState } from "../components/ui";
import { Tabs } from "../components/primitives";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { pluralize } from "../lib/format";
import { ReceiptBulkUpload } from "../features/financials/receipts/ReceiptBulkUpload";
import { ReceiptInboxItem } from "../features/financials/receipts/ReceiptInboxItem";
import { errorMessage } from "../features/financials/banking/types";
import type { InboxItem, ReceiptInboxData } from "../features/financials/receipts/types";

type InboxTab = "unmatched" | "matched" | "discarded";

const EMPTY: Record<InboxTab, { title: string; description: string }> = {
  unmatched: { title: "No receipts waiting", description: "Drop receipt files above. Each one is matched to the bank transaction it paid for." },
  matched: { title: "Nothing matched yet", description: "Receipts you match are attached to their transactions and listed here." },
  discarded: { title: "Nothing discarded", description: "Receipts you discard stay in Documents and can be restored." },
};

/**
 * Receipt inbox: upload receipts in bulk, correct each one's merchant, amount
 * and date, and attach it to the bank transaction it belongs to, one at a
 * time or every high-confidence match at once.
 */
export function ReceiptInboxPage() {
  const society = useSociety();
  const { canWrite } = useFinancePermissions();
  const data = useQuery(api.receiptInbox.list, society ? { societyId: society._id } : "skip") as ReceiptInboxData | undefined;
  const matchAll = useMutation(api.receiptInbox.matchAllHighConfidence);
  const confirm = useConfirm();
  const toast = useToast();
  const [tab, setTab] = useState<InboxTab>("unmatched");
  const [busy, setBusy] = useState(false);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const rows: InboxItem[] = (data?.rows ?? []).filter((row) => row.status === tab);
  const highConfidence = data?.highConfidenceCount ?? 0;

  const runMatchAll = async () => {
    const ok = await confirm({
      title: `Match ${pluralize(highConfidence, "receipt")}?`,
      message: "Each receipt whose amount matches a transaction exactly, close to its date and well ahead of any other candidate is attached to it. You can unmatch any of them afterwards.",
      confirmLabel: "Match all",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await matchAll({ societyId: society._id });
      toast.success(`${pluralize(result.matched, "receipt")} attached`, result.remaining ? `${pluralize(result.remaining, "receipt")} still to match by hand.` : undefined);
    } catch (error: unknown) {
      toast.error("Could not match the receipts", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page receipt-inbox">
      <PageHeader
        title="Receipt inbox"
        icon={<Inbox size={16} />}
        iconColor="green"
        subtitle="Upload receipts in bulk and attach each one to its bank transaction."
        info={
          <>
            <p>
              Receipts are saved to Documents. The inbox suggests transactions by amount (exact first, then close), how near
              the dates are, and how alike the merchant and payee names are. Names like 2026-10-12_Coastal-Hydro_161.38.pdf
              fill in the details; the files themselves aren't read.
            </p>
            <p>Forwarding receipts by email and matching from Gmail aren't available yet.</p>
          </>
        }
        actions={
          <>
            <Link className="btn-action" to="/app/financials?tab=transactions"><ArrowLeft size={12} aria-hidden="true" /> Transactions</Link>
            <button type="button" className="btn-action btn-action--primary" disabled={!canWrite || busy || highConfidence === 0} onClick={() => void runMatchAll()}>
              <Wand2 size={12} aria-hidden="true" /> Match all high-confidence{highConfidence ? ` (${highConfidence})` : ""}
            </button>
          </>
        }
      />

      <ReceiptBulkUpload societyId={society._id} canWrite={canWrite} />

      <Tabs<InboxTab>
        value={tab}
        onChange={setTab}
        tabRoles
        ariaLabel="Receipt inbox"
        items={[
          { id: "unmatched", label: "To match", count: data?.counts.unmatched ?? null },
          { id: "matched", label: "Matched", count: data?.counts.matched ?? null },
          { id: "discarded", label: "Discarded", count: data?.counts.discarded ?? null },
        ]}
      />

      {data === undefined ? (
        <div className="card"><div className="card__body"><div className="record-table__loading">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="record-table__loading-row" />)}</div></div></div>
      ) : rows.length === 0 ? (
        <div className="card"><div className="card__body"><EmptyState icon={<Inbox size={20} />} title={EMPTY[tab].title} description={EMPTY[tab].description} /></div></div>
      ) : (
        <ul className="receipt-inbox__list">
          {rows.map((item) => <ReceiptInboxItem key={item._id} item={item} canWrite={canWrite} />)}
        </ul>
      )}
    </div>
  );
}
