import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { BellRing, Check, CircleDollarSign, Link2, Send, Undo2, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge, Drawer, Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { Money } from "../../../components/Money";
import { usePrompt } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { formatDate, formatDateTime } from "../../../lib/format";
import { formatMoney } from "../../../lib/money";
import { ApprovalProgress, CLAIM_STATUS_LABEL, CLAIM_STATUS_TONE } from "./ApprovalProgress";
import { DuplicateNotice, ExceptionRequest, PolicyNotice, ReminderMeta, useClaimShareActions } from "./ClaimChecks";
import { ReceiptDropZone } from "./ReceiptDropZone";
import { FINANCE_EDIT_REQUIRED_REASON } from "../../../../shared/expenseApprovals";
import {
  claimPartyKey,
  claimSubmissionDecision,
  evaluateClaimPolicy,
  findLikelyDuplicate,
  type ExpenseClaimPolicy,
} from "../../../../shared/expensePolicy";
import { todayDateOnly } from "../../../../shared/dateOnly";
import type { QueueRow } from "./types";

/** Reasons that come from the matching rule (who it names, self-approval) rather than workspace access. */
const RULE_REASON = /approver for claims of this size|own claim/;

const TRAIL_LABEL: Record<string, string> = {
  submitted: "Submitted",
  approved: "Approved",
  declined: "Declined",
  paid: "Marked paid",
  recalled: "Recalled",
  reset: "Approvals reset",
  draft: "Moved to draft",
  reminded: "Approvers reminded",
  receipt: "Receipt attached",
};

/** Statuses a claim can be (re)submitted from in this drawer. */
const SUBMITTABLE = new Set(["Draft", "Rejected", "Recalled"]);

export function ClaimDetailDrawer({
  row,
  rows = [],
  policy,
  societyId,
  canWrite,
  onClose,
  onOpenClaim,
}: {
  row: QueueRow | null;
  /** Every claim in the queue, for the duplicate check on (re)submit. */
  rows?: readonly QueueRow[];
  /** The workspace claim policy, checked before (re)submitting. */
  policy?: ExpenseClaimPolicy;
  societyId: string;
  canWrite: boolean;
  onClose: () => void;
  /** Open another claim (the duplicate's "View"). */
  onOpenClaim?: (id: string) => void;
}) {
  const decide = useMutation(api.expenseReports.decide);
  const setStatus = useMutation(api.expenseReports.setStatus);
  const attachReceipt = useMutation(api.expenseReports.attachReceipt);
  const accounts = useQuery(api.financialHub.accounts, row ? { societyId: societyId as any } : "skip") as any[] | undefined;
  const prompt = usePrompt();
  const toast = useToast();
  const share = useClaimShareActions();
  const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState({ reference: "", expenseAccountId: "", bankAccountId: "" });
  const [exceptionReason, setExceptionReason] = useState("");
  const [submitTried, setSubmitTried] = useState(false);
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
  const [duplicatePrompt, setDuplicatePrompt] = useState(false);

  useEffect(() => {
    setPayment({ reference: row?.paymentReference ?? "", expenseAccountId: "", bankAccountId: "" });
  }, [row?._id, row?.paymentReference]);
  useEffect(() => {
    setExceptionReason("");
    setSubmitTried(false);
    setDuplicateAcknowledged(false);
    setDuplicatePrompt(false);
  }, [row?._id]);

  // (Re)submission checks run here too, so the requester sees them before the server refuses.
  const submittable = Boolean(row && SUBMITTABLE.has(row.status));
  const submitIssues = useMemo(
    () => (row && submittable && policy
      ? evaluateClaimPolicy(policy, { amountCents: row.amountCents, receiptDocumentId: row.receiptDocument?._id, notes: row.notes, incurredAtISO: row.incurredAtISO }, todayDateOnly())
      : []),
    [row, submittable, policy],
  );
  const submitDuplicate = useMemo(() => {
    if (!row || !submittable) return null;
    const candidates = rows
      .filter((other) => !["Rejected", "Recalled"].includes(other.status))
      .map((other) => ({ _id: other._id, partyKey: claimPartyKey(other), amountCents: other.amountCents, date: other.incurredAtISO, title: other.title }));
    return findLikelyDuplicate({ _id: row._id, partyKey: claimPartyKey(row), amountCents: row.amountCents, date: row.incurredAtISO }, candidates);
  }, [row, rows, submittable]);

  if (!row) return null;

  const submit = async (label: string, success: string, duplicateOk = duplicateAcknowledged) => {
    setSubmitTried(true);
    if (policy && !claimSubmissionDecision(policy, submitIssues, exceptionReason).allowed) return;
    if (submitDuplicate && !duplicateOk) {
      setDuplicatePrompt(true);
      return;
    }
    await run(label, () => setStatus({ id: row._id as any, status: "Submitted", policyExceptionReason: exceptionReason.trim() || undefined }), success,
      submitIssues.length ? (exceptionReason.trim() ? "Approvers will see your exception request." : "Approvers will see that it misses the claim policy.") : undefined);
  };

  const onReceipt = async (documentId: string) => {
    try {
      await attachReceipt({ id: row._id as any, receiptDocumentId: documentId as any });
      toast.success("Receipt attached");
    } catch (error: any) {
      toast.error("Could not attach the receipt", error?.message);
    }
  };

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
        <button className="btn btn--accent" type="button" disabled={!canWrite || busy} onClick={() => void submit("submit", "Claim submitted for approval")}>
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
        <button className="btn" type="button" disabled={!canWrite || busy} onClick={() => void submit("resubmit", "Claim resubmitted")}>
          <Undo2 size={12} aria-hidden="true" /> Resubmit
        </button>
      )}
    </>
  );

  return (
    <Drawer open onClose={onClose} title={row.title} footer={footer} className="claim-drawer">
      <div className="claim-drawer__hero">
        <Money cents={row.amountCents} currency={row.currency} variant="hero" />
        <span className="claim-drawer__badges">
          <Badge tone={CLAIM_STATUS_TONE[row.status] ?? "neutral"}>{CLAIM_STATUS_LABEL[row.status] ?? row.status}</Badge>
          {row.policyException && <Badge tone="warn">Policy exception</Badge>}
          {!row.policyException && row.policyIssues.length > 0 && row.status === "Submitted" && <Badge tone="warn">Misses policy</Badge>}
          {row.possibleDuplicate && <Badge tone="orange">Possible duplicate</Badge>}
        </span>
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
      {!row.receiptDocument && row.status !== "Paid" && canWrite && (
        <ReceiptDropZone societyId={societyId} claimTitle={row.title} onUploaded={(documentId) => onReceipt(documentId)} />
      )}
      {row.notes && <p className="claim-drawer__notes">{row.notes}</p>}

      {row.status === "Submitted" && <PolicyNotice issues={row.policyIssues} exception={row.policyException} />}
      {row.status !== "Submitted" && !submittable && row.policyException && <PolicyNotice issues={[]} exception={row.policyException} />}
      {row.status === "Submitted" && row.possibleDuplicate && (
        <DuplicateNotice duplicate={row.possibleDuplicate} onView={onOpenClaim ? () => onOpenClaim(row.possibleDuplicate!._id) : undefined} />
      )}
      {submittable && canWrite && policy && (
        <ExceptionRequest issues={submitIssues} enforcement={policy.enforcement} value={exceptionReason} onChange={setExceptionReason} showError={submitTried} />
      )}
      {submittable && submitDuplicate && (duplicatePrompt || row.status === "Draft") && !duplicateAcknowledged && (
        <DuplicateNotice
          duplicate={submitDuplicate}
          onView={onOpenClaim ? () => onOpenClaim(submitDuplicate._id) : undefined}
          onContinue={duplicatePrompt ? () => { setDuplicateAcknowledged(true); setDuplicatePrompt(false); void submit(row.status === "Draft" ? "submit" : "resubmit", row.status === "Draft" ? "Claim submitted for approval" : "Claim resubmitted", true); } : undefined}
          continueLabel={row.status === "Draft" ? "Submit anyway" : "Resubmit anyway"}
        />
      )}

      {row.status === "Submitted" && (
        <section className="claim-drawer__section claim-drawer__share" aria-label="Nudge approvers">
          <div className="claim-drawer__share-actions">
            <button
              type="button"
              className="btn btn--sm"
              disabled={!row.canRemind}
              title={row.canRemind ? undefined : row.nextReminderAtISO ? "Approvers can be reminded once a day." : "Only the requester or someone with finance edit access can remind approvers."}
              onClick={() => void share.remindApprovers(row._id)}
            >
              <BellRing size={12} aria-hidden="true" /> Remind approvers
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => void share.copyApprovalLink(row._id)}>
              <Link2 size={12} aria-hidden="true" /> Copy approval link
            </button>
          </div>
          <ReminderMeta lastReminderAtISO={row.lastReminderAtISO} nextReminderAtISO={row.nextReminderAtISO} />
        </section>
      )}

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
            <p className="claim-drawer__reason" role="note">
              <strong>Why you can't approve:</strong> {row.cannotApproveReason}
              {row.cannotApproveReason === FINANCE_EDIT_REQUIRED_REASON ? (
                <span className="claim-drawer__reason-source">
                  {" "}Set by this workspace's <Link to="/app/approvals?tab=rules" onClick={onClose}>who can approve claims</Link> setting.
                </span>
              ) : RULE_REASON.test(row.cannotApproveReason) ? (
                <span className="claim-drawer__reason-source">
                  {" "}Set by the approval rule for claims of {formatMoney(row.ruleThresholdCents)} or more.
                </span>
              ) : null}
            </p>
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
