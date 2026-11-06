import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { ArrowLeft, Inbox, Wand2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { EmptyState } from "../components/ui";
import { Tabs } from "../components/primitives";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { centsToDollarInput, pluralize } from "../lib/format";
import { ClaimEditorDrawer, type ClaimEditorDraft } from "../features/financials/approvals/ClaimEditorDrawer";
import { AddBankTransactionDrawer } from "../features/financials/reconciliation/AddBankTransactionDrawer";
import { ReceiptBulkUpload } from "../features/financials/receipts/ReceiptBulkUpload";
import { ReceiptInboxItem } from "../features/financials/receipts/ReceiptInboxItem";
import { errorMessage } from "../features/financials/banking/types";
import type { InboxItem, ReceiptInboxData } from "../features/financials/receipts/types";

type InboxTab = "unmatched" | "matched" | "discarded";

const EMPTY: Record<InboxTab, { title: string; description: string }> = {
  unmatched: { title: "No receipts waiting", description: "Drop a receipt above, then link it to a reimbursement claim or a company payment." },
  matched: { title: "Nothing linked yet", description: "Receipts linked to transactions or reimbursement claims appear here." },
  discarded: { title: "Nothing discarded", description: "Receipts you discard stay in Documents and can be restored." },
};

/**
 * Receipt inbox: upload receipts in bulk, correct each one's merchant, amount
 * and date, and attach it to the bank transaction it belongs to, one at a
 * time or every high-confidence match at once.
 */
export function ReceiptInboxPage() {
  const society = useSociety();
  const me = useCurrentUser();
  const { canWrite } = useFinancePermissions();
  const data = useQuery(api.receiptInbox.list, society ? { societyId: society._id } : "skip") as ReceiptInboxData | undefined;
  const matchAll = useMutation(api.receiptInbox.matchAllHighConfidence);
  const confirm = useConfirm();
  const toast = useToast();
  const [tab, setTab] = useState<InboxTab>("unmatched");
  const [busy, setBusy] = useState(false);
  const [claim, setClaim] = useState<ClaimEditorDraft | null>(null);
  const [cardReceipt, setCardReceipt] = useState<InboxItem | null>(null);
  const users = useQuery(api.users.list, claim && society ? { societyId: society._id } : "skip");
  const claims = useQuery(api.expenseReports.list, claim && society ? { societyId: society._id } : "skip");

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
        subtitle="Keep receipts with company payments or personal card reimbursements."
        info={
          <>
            <p>
              Receipts are saved to Documents. The inbox suggests transactions by amount (exact first, then close), how near
              the dates are, and how alike the merchant and payee names are. Preview .eml email receipts here and enter their details by hand.
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
          { id: "matched", label: "Linked", count: data?.counts.matched ?? null },
          { id: "discarded", label: "Discarded", count: data?.counts.discarded ?? null },
        ]}
      />

      {data === undefined ? (
        <div className="card"><div className="card__body"><div className="record-table__loading">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="record-table__loading-row" />)}</div></div></div>
      ) : rows.length === 0 ? (
        <div className="card"><div className="card__body"><EmptyState icon={<Inbox size={20} />} title={EMPTY[tab].title} description={EMPTY[tab].description} /></div></div>
      ) : (
        <ul className="receipt-inbox__list">
          {rows.map((item) => <ReceiptInboxItem key={item._id} item={item} canWrite={canWrite} onCard={() => setCardReceipt(item)} onClaim={() => setClaim({
            claimantName: me?.displayName ?? "", claimantUserId: me?._id ?? "", title: item.merchant ? `${item.merchant} expense` : "", category: "Other",
            amountDollars: centsToDollarInput(item.amountCents), currency: item.currency ?? "CAD", incurredAtISO: item.date ?? "",
            submittedAtISO: "", status: "Draft", receiptDocumentId: item.documentId, receiptInboxItemId: item._id, paymentReference: "", notes: "",
          })} />)}
        </ul>
      )}
      {claim && <ClaimEditorDrawer draft={claim} onChange={setClaim} onClose={() => setClaim(null)} onSaved={() => setTab("matched")} societyId={society._id}
        users={users} claims={claims} documents={undefined} categories={["Program", "Travel", "Meals", "Supplies", "Software", "Facility", "Professional services", "Other"]} statuses={["Draft", "Submitted"]} />}
      {cardReceipt && <AddBankTransactionDrawer open expense receipt={cardReceipt} canWrite={canWrite} societyId={society._id} onClose={() => setCardReceipt(null)} onSaved={() => setTab("matched")} />}
    </div>
  );
}
