import { useState } from "react";
import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { Check, ReceiptText, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { EmptyState } from "../../components/ui";
import { Money } from "../../components/Money";
import { usePrompt } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { formatDate, pluralize } from "../../lib/format";
import { errorMessage, type BillRow, type BillsWorkspace } from "./types";

/** Bills waiting for approval, inside the Approvals queue (same rules as expense claims). */
export function useBillsAwaitingApproval(societyId: string | undefined) {
  const workspace = useQuery(api.bills.workspace, societyId ? { societyId: societyId as Id<"societies"> } : "skip") as BillsWorkspace | undefined;
  return { workspace, rows: (workspace?.bills ?? []).filter((bill) => bill.status === "awaiting_approval") };
}

/**
 * The Approvals page's Bills tab: every bill waiting for approval with its
 * progress, approve in place, or decline with a reason. Opening a bill goes
 * to its panel on the Bills page.
 */
export function BillApprovalsPanel({ rows, loading }: { rows: BillRow[]; loading: boolean }) {
  const decide = usePermissionedMutation(api.bills.decide, true);
  const prompt = usePrompt();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = async (bill: BillRow, decision: "approve" | "decline") => {
    let reason: string | undefined;
    if (decision === "decline") {
      const answer = await prompt({ title: `Decline ${bill.vendorName ?? "this bill"}?`, message: <p>It goes back to draft with your reason.</p>, placeholder: "What needs to change", confirmLabel: "Decline", multiline: true, required: true });
      if (!answer) return;
      reason = answer;
    }
    setBusyId(bill._id);
    try {
      await decide({ id: bill._id as Id<"bills">, decision, reason });
      if (decision === "decline") toast.success("Bill declined", "It's back in drafts with your reason.");
      else toast.success(bill.approvalsRemaining <= 1 ? "Bill approved" : "Approval recorded", bill.approvalsRemaining <= 1 ? "It's posted to Accounts payable and ready to pay." : `${bill.approvalsRemaining - 1} more approval needed.`);
    } catch (error) {
      toast.error(decision === "approve" ? "Couldn't approve" : "Couldn't decline", errorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <div className="card__body"><div className="record-table__loading">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="record-table__loading-row" />)}</div></div>;
  }
  if (!rows.length) {
    return (
      <div className="card__body">
        <EmptyState icon={<ReceiptText size={20} />} title="No bills waiting for approval" description="Bills sent for approval from the Bills page appear here until they have the approvals your rules require." />
      </div>
    );
  }
  const mine = rows.filter((bill) => bill.canApprove).length;
  return (
    <>
      <div className="approvals-policy">
        <span>{mine ? <><strong>{pluralize(mine, "bill")}</strong> {mine === 1 ? "needs" : "need"} your approval.</> : "Nothing needs your approval right now."}</span>
        <span className="muted approvals-policy__rules"><Link to="/app/bills?tab=approval">Open in Bills</Link></span>
      </div>
      <table className="table table--comfortable approvals-table">
        <thead>
          <tr>
            <th>Bill</th>
            <th>Due</th>
            <th className="num">Amount</th>
            <th>Approvals</th>
            <th className="approvals-table__actions"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((bill) => (
            <tr key={bill._id}>
              <td data-label="Bill" className="approvals-table__claim">
                <Link className="approvals-table__title" to={`/app/bills?bill=${bill._id}`}>{bill.vendorName ?? "Bill"}</Link>
                <span className="muted approvals-table__category">{bill.billNumber ? `Bill ${bill.billNumber} · ` : ""}{formatDate(bill.billDate)}</span>
              </td>
              <td data-label="Due">{formatDate(bill.dueDate)}</td>
              <td data-label="Amount" className="num"><Money cents={bill.totalCents} currency={bill.currency} /></td>
              <td data-label="Approvals">
                {bill.approvals.length} of {bill.requiredApprovals}
                {!bill.canApprove && bill.cannotApproveReason && <div className="muted approvals-table__category">{bill.cannotApproveReason}</div>}
              </td>
              <td className="approvals-table__actions">
                <span className="approvals-table__action-group">
                  {bill.canApprove && (
                    <>
                      <button type="button" className="btn btn--ghost btn--sm" disabled={busyId === bill._id} onClick={() => void run(bill, "decline")}>
                        <X size={12} aria-hidden="true" /> Decline
                      </button>
                      <button type="button" className="btn btn--sm" disabled={busyId === bill._id} onClick={() => void run(bill, "approve")}>
                        <Check size={12} aria-hidden="true" /> Approve
                      </button>
                    </>
                  )}
                  {!bill.canApprove && <Link className="btn btn--ghost btn--sm" to={`/app/bills?bill=${bill._id}`}>Open</Link>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
