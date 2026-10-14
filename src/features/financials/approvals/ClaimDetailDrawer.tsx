import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { Check, CircleDollarSign, Send, Undo2, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge, Drawer, Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { Money } from "../../../components/Money";
import { usePrompt } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { formatDate, formatDateTime } from "../../../lib/format";
import { formatMoney } from "../../../lib/money";
import { ApprovalProgress, CLAIM_STATUS_LABEL, CLAIM_STATUS_TONE } from "./ApprovalProgress";
import type { QueueRow } from "./types";

const TRAIL_LABEL: Record<string, string> = {
  submitted: "Submitted",
  approved: "Approved",
  declined: "Declined",
  paid: "Marked paid",
  recalled: "Recalled",
  reset: "Approvals reset",
  draft: "Moved to draft",
};

export function ClaimDetailDrawer({
  row,
  societyId,
  canWrite,
  onClose,
}: {
  row: QueueRow | null;
  societyId: string;
  canWrite: boolean;
  onClose: () => void;
}) {
  const decide = useMutation(api.expenseReports.decide);
  const setStatus = useMutation(api.expenseReports.setStatus);
  const accounts = useQuery(api.financialHub.accounts, row ? { societyId: societyId as any } : "skip") as any[] | undefined;
  const prompt = usePrompt();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState({ reference: "", expenseAccountId: "", bankAccountId: "" });

  useEffect(() => {
    setPayment({ reference: row?.paymentReference ?? "", expenseAccountId: "", bankAccountId: "" });
  }, [row?._id, row?.paymentReference]);

  if (!row) return null;

  const run = async (label: string, action: () => Promise<unknown>, success: string, description?: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success, description);
    } catch (error: any) {
      toast.error(`Could not ${label}`, error?.message);
    } finally {
      setBusy(false);
    }
  };

  const approve = () =>
    run("approve", () => decide({ id: row._id as any, decision: "approve" }), row.approvalsRemaining <= 1 ? "Claim approved" : "Approval recorded",
      row.approvalsRemaining <= 1 ? "It's ready to pay." : `${row.approvalsRemaining - 1} more approval needed.`);

  const decline = async () => {
    const reason = await prompt({
      title: "Decline claim",
      message: `Tell ${row.claimantName} why “${row.title}” is declined.`,
      placeholder: "Reason",
      required: true,
      multiline: true,
      confirmLabel: "Decline claim",
    });
    if (!reason) return;
    await run("decline", () => decide({ id: row._id as any, decision: "decline", reason }), "Claim declined");
  };

  const markPaid = () =>
    run(
      "mark paid",
      () =>
        setStatus({
          id: row._id as any,
          status: "Paid",
          paymentReference: payment.reference.trim() || undefined,
          expenseAccountId: (payment.expenseAccountId || undefined) as any,
          bankAccountId: (payment.bankAccountId || undefined) as any,
        }),
      "Marked paid",
      payment.expenseAccountId && payment.bankAccountId ? "The reimbursement was posted to the ledger." : undefined,
    );

  const expenseAccounts = (accounts ?? []).filter((account) => account.accountType === "Expense");
  const bankAccounts = (accounts ?? []).filter((account) => account.accountType === "Bank" || account.accountType === "Credit");

  const footer = (
    <>
      <button className="btn" type="button" onClick={onClose}>Close</button>
      {row.status === "Draft" && (
        <button className="btn btn--accent" type="button" disabled={!canWrite || busy} onClick={() => void run("submit", () => setStatus({ id: row._id as any, status: "Submitted" }), "Claim submitted for approval")}>
          <Send size={12} aria-hidden="true" /> Submit for approval
        </button>
      )}
      {row.status === "Submitted" && row.isMine && (
        <button className="btn" type="button" disabled={!canWrite || busy} onClick={() => void run("recall", () => setStatus({ id: row._id as any, status: "Recalled" }), "Claim recalled")}>
          <Undo2 size={12} aria-hidden="true" /> Recall
        </button>
      )}
      {row.status === "Submitted" && !row.isMine && (
        <>
          <button className="btn btn--danger" type="button" disabled={busy || (!row.canApprove && row.cannotApproveReason !== "You've already approved this claim.")} onClick={() => void decline()}>
            <X size={12} aria-hidden="true" /> Decline
          </button>
          <button className="btn btn--accent" type="button" disabled={busy || !row.canApprove} title={row.cannotApproveReason} onClick={() => void approve()}>
            <Check size={12} aria-hidden="true" /> Approve
          </button>
        </>
      )}
      {row.status === "Approved" && (
        <button className="btn btn--accent" type="button" disabled={!canWrite || busy} onClick={() => void markPaid()}>
          <CircleDollarSign size={12} aria-hidden="true" /> Mark paid
        </button>
      )}
      {(row.status === "Rejected" || row.status === "Recalled") && (
        <button className="btn" type="button" disabled={!canWrite || busy} onClick={() => void run("resubmit", () => setStatus({ id: row._id as any, status: "Submitted" }), "Claim resubmitted")}>
          <Undo2 size={12} aria-hidden="true" /> Resubmit
        </button>
      )}
    </>
  );

  return (
    <Drawer open onClose={onClose} title={row.title} footer={footer} className="claim-drawer">
      <div className="claim-drawer__hero">
        <Money cents={row.amountCents} currency={row.currency} variant="hero" />
        <Badge tone={CLAIM_STATUS_TONE[row.status] ?? "neutral"}>{CLAIM_STATUS_LABEL[row.status] ?? row.status}</Badge>
      </div>
      <dl className="claim-drawer__facts">
        <div><dt>Requester</dt><dd>{row.claimantName}{row.isMine ? " (you)" : ""}</dd></div>
        <div><dt>Category</dt><dd>{row.category}</dd></div>
        <div><dt>Incurred</dt><dd>{formatDate(row.incurredAtISO)}</dd></div>
        {row.submittedAtISO && <div><dt>Submitted</dt><dd>{formatDate(row.submittedAtISO)}</dd></div>}
        <div>
          <dt>Receipt</dt>
          <dd>{row.receiptDocument ? <Link to={`/app/documents/${row.receiptDocument._id}`}>{row.receiptDocument.title}</Link> : <span className="muted">No receipt attached</span>}</dd>
        </div>
        {row.paymentReference && <div><dt>Payment reference</dt><dd>{row.paymentReference}</dd></div>}
      </dl>
      {row.notes && <p className="claim-drawer__notes">{row.notes}</p>}

      {row.status !== "Draft" && (
        <section className="claim-drawer__section" aria-labelledby="claim-approvals">
          <h3 id="claim-approvals" className="claim-drawer__section-title">Approvals</h3>
          <ApprovalProgress row={row} />
          <p className="claim-drawer__rule muted">
            Claims of {formatMoney(row.ruleThresholdCents)} or more need {row.requiredApprovals} approval{row.requiredApprovals === 1 ? "" : "s"}
            {row.ruleBlocksSelfApproval ? "; the requester can't approve their own claim." : "."}
          </p>
          {row.approvals.length > 0 && (
            <ul className="claim-drawer__votes">
              {row.approvals.map((vote) => (
                <li key={`${vote.userId}-${vote.atISO}`}>
                  <Check size={12} aria-hidden="true" /> <strong>{vote.name}</strong>
                  {vote.role ? <span className="muted"> · {vote.role}</span> : null}
                  <span className="muted"> · {formatDateTime(vote.atISO)}</span>
                </li>
              ))}
            </ul>
          )}
          {row.status === "Submitted" && !row.canApprove && row.cannotApproveReason && (
            <p className="claim-drawer__reason" role="note">{row.cannotApproveReason}</p>
          )}
          {row.declinedReason && (
            <p className="claim-drawer__declined"><strong>Declined:</strong> {row.declinedReason}</p>
          )}
        </section>
      )}

      {row.status === "Approved" && (
        <section className="claim-drawer__section" aria-labelledby="claim-payment">
          <h3 id="claim-payment" className="claim-drawer__section-title">Payment</h3>
          <Field label="Payment reference" hint="Cheque number, e-transfer or EFT reference.">
            <input className="input" value={payment.reference} onChange={(event) => setPayment({ ...payment, reference: event.target.value })} />
          </Field>
          {(accounts ?? []).length > 0 && (
            <div className="claim-drawer__accounts">
              <Field label="Expense account" hint="Optional. Choose both accounts to post the reimbursement to the ledger.">
                <Select value={payment.expenseAccountId} onChange={(expenseAccountId) => setPayment({ ...payment, expenseAccountId })} clearable clearLabel="Don't post" placeholder="Don't post"
                  options={expenseAccounts.map((account) => ({ value: account._id, label: account.code ? `${account.code} · ${account.name}` : account.name }))} />
              </Field>
              <Field label="Paid from">
                <Select value={payment.bankAccountId} onChange={(bankAccountId) => setPayment({ ...payment, bankAccountId })} clearable clearLabel="Don't post" placeholder="Don't post"
                  options={bankAccounts.map((account) => ({ value: account._id, label: account.code ? `${account.code} · ${account.name}` : account.name }))} />
              </Field>
            </div>
          )}
        </section>
      )}

      <section className="claim-drawer__section" aria-labelledby="claim-activity">
        <h3 id="claim-activity" className="claim-drawer__section-title">Activity</h3>
        {row.trail.length === 0 ? (
          <p className="muted">No activity recorded yet.</p>
        ) : (
          <ol className="claim-trail">
            {[...row.trail].reverse().map((entry, index) => (
              <li key={`${entry.atISO}-${index}`} className={`claim-trail__item claim-trail__item--${entry.action}`}>
                <span className="claim-trail__dot" aria-hidden="true" />
                <div>
                  <div><strong>{TRAIL_LABEL[entry.action] ?? entry.action}</strong> by {entry.actorName}</div>
                  {entry.note && <div className="claim-trail__note">{entry.note}</div>}
                  <div className="muted claim-trail__time">{formatDateTime(entry.atISO)}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </Drawer>
  );
}
