import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, CalendarCheck, Check, CircleDollarSign, Landmark, Pencil, Undo2, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { Drawer, Field, InspectorNote } from "../../components/ui";
import { DatePicker } from "../../components/DatePicker";
import { Money } from "../../components/Money";
import { useConfirm, usePrompt } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { formatDate, formatDateTime } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { BILL_PAYMENT_METHOD_LABEL, BILL_TERMS_LABEL, canPayStatus, isBillPaymentMethod, normalizeBillTerms } from "../../../shared/bills";
import { FINANCE_EDIT_REQUIRED_REASON } from "../../../shared/expenseApprovals";
import { BillDocumentDropZone } from "./BillDocumentDropZone";
import { BillPaymentForm } from "./BillPaymentForm";
import { BillStatusPill } from "./BillStatusPill";
import { TagChips } from "../financials/transactions/TagPicker";
import { useFinanceTags } from "../financials/transactions/useFinanceTags";
import { errorMessage, type BillRow, type BillsWorkspace } from "./types";

const EVENT_DOT: Record<string, string> = {
  approved: "approved",
  posted: "approved",
  payment: "paid",
  declined: "declined",
  canceled: "declined",
  reversed: "declined",
  recalled: "recalled",
  reset: "reset",
  payment_removed: "reset",
};

/**
 * One bill: amounts and dates, approval progress (approve, or decline with a
 * reason), the lines and where they post, payments with their bank matches
 * (record, or remove to undo and unlink), the planned payment date, the bill
 * file and the activity trail. Canceling an approved bill reverses its entry.
 */
export function BillDetailDrawer({
  bill,
  workspace,
  societyId,
  canWrite,
  onClose,
  onEdit,
  onOpenBill,
}: {
  bill: BillRow;
  workspace: BillsWorkspace;
  societyId: string;
  canWrite: boolean;
  onClose: () => void;
  onEdit: () => void;
  onOpenBill: (id: string) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  // Approval votes are checked by the approval rules on the server, not by finance edit access alone.
  const decide = usePermissionedMutation(api.bills.decide, true);
  const recall = usePermissionedMutation(api.bills.recall, canWrite);
  const submit = usePermissionedMutation(api.bills.submit, canWrite);
  const setSchedule = usePermissionedMutation(api.bills.setSchedule, canWrite);
  const removePayment = usePermissionedMutation(api.bills.removePayment, canWrite);
  const cancel = usePermissionedMutation(api.bills.cancel, canWrite);
  const attachDocument = usePermissionedMutation(api.bills.attachDocument, canWrite);
  const tags = useFinanceTags(bill.lines.some((line) => line.tagIds?.length) ? societyId : undefined);
  const [paying, setPaying] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(bill.scheduledDate ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPaying(false);
    setScheduleDate(bill.scheduledDate ?? "");
  }, [bill._id, bill.scheduledDate]);

  const vendor = workspace.vendors.find((row) => row._id === bill.vendorId);
  const funds = new Map(workspace.funds.map((fund) => [fund._id, fund.name]));
  const awaiting = bill.status === "awaiting_approval";
  const payable = canPayStatus(bill.status);

  const run = async (label: string, action: () => Promise<unknown>, success: string, description?: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success, description);
      return true;
    } catch (error) {
      toast.error(`Couldn't ${label}`, errorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const approve = () =>
    run("approve", () => decide({ id: bill._id as Id<"bills">, decision: "approve" }), bill.approvalsRemaining <= 1 ? "Bill approved" : "Approval recorded",
      bill.approvalsRemaining <= 1 ? "It's posted to Accounts payable and ready to pay." : `${bill.approvalsRemaining - 1} more approval needed.`);

  const decline = async () => {
    const reason = await prompt({ title: "Decline this bill?", message: <p>It goes back to draft with your reason, so it can be fixed and sent again.</p>, placeholder: "What needs to change", confirmLabel: "Decline", multiline: true, required: true });
    if (!reason) return;
    await run("decline", () => decide({ id: bill._id as Id<"bills">, decision: "decline", reason }), "Bill declined", "It's back in drafts with your reason.");
  };

  const cancelBill = async () => {
    const posted = Boolean(bill.journalEntryId);
    const reason = await prompt({
      title: "Cancel this bill?",
      message: <p>{posted ? "It was approved, so a reversing entry takes it back out of Accounts payable, dated today." : "Nothing was posted to the books for it yet."} Canceled bills stay in the list with their trail.</p>,
      placeholder: "Reason (optional)",
      confirmLabel: "Cancel bill",
    });
    if (reason === null) return;
    await run("cancel the bill", () => cancel({ societyId: societyId as Id<"societies">, ids: [bill._id as Id<"bills">], reason: reason || undefined }), "Bill canceled", posted ? "A reversing entry was posted." : undefined);
  };

  const undoPayment = async (key: string, linked: boolean, amountCents: number) => {
    const ok = await confirm({
      title: `Remove the ${formatMoney(amountCents)} payment?`,
      message: <p>Its journal entry is voided{linked ? " and the bank transaction goes back to unmatched, with the category it had before" : ""}. Use this for a payment recorded by mistake.</p>,
      confirmLabel: "Remove payment",
      tone: "danger",
    });
    if (!ok) return;
    await run("remove the payment", () => removePayment({ id: bill._id as Id<"bills">, paymentKey: key }), "Payment removed", linked ? "The bank transaction is unmatched again." : undefined);
  };

  const footer = (
    <>
      {canWrite && bill.status !== "canceled" && bill.payments.length === 0 && (
        <button type="button" className="btn btn--ghost btn--danger-text" disabled={busy} onClick={() => void cancelBill()}>
          <Ban size={12} aria-hidden="true" /> Cancel bill
        </button>
      )}
      <span className="register-drawer__spacer" />
      {awaiting && bill.isMine && canWrite && (
        <button type="button" className="btn" disabled={busy} onClick={() => void run("take the bill back", () => recall({ id: bill._id as Id<"bills"> }), "Bill taken back to draft")}>
          <Undo2 size={12} aria-hidden="true" /> Take back
        </button>
      )}
      {(awaiting || bill.status === "draft") && canWrite && (
        <button type="button" className="btn" disabled={busy} onClick={onEdit}>
          <Pencil size={12} aria-hidden="true" /> Edit
        </button>
      )}
      {awaiting && !bill.isMine && (
        <>
          <button type="button" className="btn btn--danger" disabled={busy || (!bill.canApprove && !/already approved/.test(bill.cannotApproveReason ?? ""))} onClick={() => void decline()}>
            <X size={12} aria-hidden="true" /> Decline
          </button>
          <button type="button" className="btn btn--accent" disabled={busy || !bill.canApprove} title={bill.cannotApproveReason} onClick={() => void approve()}>
            <Check size={12} aria-hidden="true" /> Approve
          </button>
        </>
      )}
      {bill.status === "draft" && canWrite && (
        <button type="button" className="btn btn--accent" disabled={busy} onClick={() => void run("send the bill for approval", () => submit({ id: bill._id as Id<"bills"> }), "Sent for approval")}>
          Send for approval
        </button>
      )}
      {payable && !paying && canWrite && (
        <button type="button" className="btn btn--accent" disabled={busy} onClick={() => setPaying(true)}>
          <CircleDollarSign size={12} aria-hidden="true" /> Record payment
        </button>
      )}
    </>
  );

  return (
    <Drawer open onClose={onClose} title={`${bill.vendorName ?? "Bill"}${bill.billNumber ? ` · ${bill.billNumber}` : ""}`} footer={footer} size="wide" className="bill-detail">
      <div className="claim-drawer__hero">
        <Money cents={bill.status === "canceled" ? bill.totalCents : bill.balanceCents} currency={bill.currency} variant="hero" struck={bill.status === "canceled"} />
        <BillStatusPill status={bill.status} daysOverdue={bill.daysOverdue} />
      </div>
      <dl className="claim-drawer__facts">
        <div><dt>Vendor</dt><dd>{bill.vendorName ?? <span className="muted">Not set</span>}</dd></div>
        <div><dt>Bill #</dt><dd>{bill.billNumber ?? <span className="muted">None</span>}</dd></div>
        <div><dt>Bill date</dt><dd>{formatDate(bill.billDate)}</dd></div>
        <div><dt>Due</dt><dd>{formatDate(bill.dueDate)} <span className="muted">· {BILL_TERMS_LABEL[normalizeBillTerms(bill.terms)]}</span></dd></div>
        <div><dt>Amount</dt><dd><Money cents={bill.totalCents} currency={bill.currency} /></dd></div>
        <div><dt>Paid</dt><dd><Money cents={bill.paidCents} currency={bill.currency} /></dd></div>
        {bill.scheduledDate && bill.status !== "canceled" && <div><dt>Planned payment</dt><dd>{formatDate(bill.scheduledDate)}</dd></div>}
        {vendor?.paymentDetails && <div><dt>How to pay</dt><dd>{vendor.paymentDetails}</dd></div>}
      </dl>
      {bill.notes && <p className="claim-drawer__notes">{bill.notes}</p>}
      {bill.possibleDuplicate && bill.status !== "canceled" && (
        <InspectorNote tone="warn" title="Possible duplicate">
          Another bill from {bill.vendorName} has number {bill.possibleDuplicate.billNumber}.{" "}
          <button type="button" className="link-button" onClick={() => onOpenBill(bill.possibleDuplicate!._id)}>Open it</button>
        </InspectorNote>
      )}
      {bill.status === "canceled" && (
        <InspectorNote title="Canceled">
          {bill.cancelReason ? `${bill.cancelReason}. ` : ""}{bill.reversalJournalEntryId ? "A reversing entry took it back out of Accounts payable." : "It was never posted to the books."}
        </InspectorNote>
      )}

      {(awaiting || bill.approvals.length > 0) && (
        <section className="claim-drawer__section" aria-labelledby="bill-approvals">
          <h3 id="bill-approvals" className="claim-drawer__section-title">Approvals</h3>
          <p className="bill-approvals__progress">
            <strong>{bill.approvals.length} of {bill.requiredApprovals}</strong> approval{bill.requiredApprovals === 1 ? "" : "s"}
            {bill.ruleLabel ? <span className="muted"> · {bill.ruleLabel} rule</span> : null}
          </p>
          {bill.approvals.length > 0 && (
            <ul className="claim-drawer__votes">
              {bill.approvals.map((vote) => (
                <li key={`${vote.userId}-${vote.atISO}`}>
                  <Check size={12} aria-hidden="true" /> <strong>{vote.name}</strong>
                  {vote.role ? <span className="muted"> · {vote.role}</span> : null}
                  <span className="muted"> · {formatDateTime(vote.atISO)}</span>
                </li>
              ))}
            </ul>
          )}
          {awaiting && !bill.canApprove && bill.cannotApproveReason && (
            <p className="claim-drawer__reason" role="note">
              <strong>Why you can't approve:</strong> {bill.cannotApproveReason}
              {bill.cannotApproveReason === FINANCE_EDIT_REQUIRED_REASON && (
                <> Set by this workspace's <Link to="/app/approvals?tab=rules" onClick={onClose}>who can approve</Link> setting.</>
              )}
            </p>
          )}
          {awaiting && <p className="claim-drawer__rule muted">Bills use the same approval rules as expense claims.</p>}
        </section>
      )}

      <section className="claim-drawer__section" aria-labelledby="bill-lines">
        <h3 id="bill-lines" className="claim-drawer__section-title">Lines</h3>
        <table className="table bill-detail__lines">
          <thead>
            <tr><th>Account</th><th>Memo</th><th className="num">Amount</th></tr>
          </thead>
          <tbody>
            {bill.lines.map((line) => (
              <tr key={line.key}>
                <td>{line.accountLabel ?? <span className="muted">No account</span>}{line.fundRestrictionId && funds.get(line.fundRestrictionId) ? <div className="muted">{funds.get(line.fundRestrictionId)}</div> : null}</td>
                <td>{line.memo ?? <span className="muted">—</span>}{line.tagIds?.length ? <div><TagChips tagIds={line.tagIds} tags={tags} /></div> : null}</td>
                <td className="num"><Money cents={line.amountCents} currency={bill.currency} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={2}>Total</td><td className="num"><Money cents={bill.totalCents} currency={bill.currency} /></td></tr>
          </tfoot>
        </table>
        {bill.journalEntryId && (
          <p className="muted bill-detail__posting">
            Posted {formatDate(bill.billDate)}: debit the accounts above, credit {workspace.accounts.payables?.label ?? "Accounts payable"}. <Link to="/app/financials/accounting">Open the journal</Link>
          </p>
        )}
      </section>

      {(payable || bill.payments.length > 0) && (
        <section className="claim-drawer__section" aria-labelledby="bill-payments">
          <h3 id="bill-payments" className="claim-drawer__section-title">Payments</h3>
          {paying && (
            <BillPaymentForm bill={bill} workspace={workspace} defaultMethod={vendor?.paymentMethod} canWrite={canWrite} onDone={() => setPaying(false)} onCancel={() => setPaying(false)} />
          )}
          {bill.payments.length === 0 ? (
            !paying && <p className="muted">No payments recorded yet.</p>
          ) : (
            <ul className="bill-payments">
              {bill.payments.map((payment) => (
                <li key={payment.key} className="bill-payments__item">
                  <span className="bill-payments__main">
                    <strong><Money cents={payment.amountCents} currency={bill.currency} /></strong>
                    <span className="muted">
                      {formatDate(payment.date)} · {isBillPaymentMethod(payment.method) ? BILL_PAYMENT_METHOD_LABEL[payment.method] : payment.method}
                      {payment.reference ? ` · ${payment.reference}` : ""}
                      {payment.cashAccountLabel ? ` · from ${payment.cashAccountLabel}` : ""}
                    </span>
                    {payment.transaction && (
                      <span className="bill-payments__match">
                        <Landmark size={12} aria-hidden="true" /> Matched to {payment.transaction.description} ({formatDate(payment.transaction.date)})
                      </span>
                    )}
                  </span>
                  {canWrite && (
                    <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void undoPayment(payment.key, Boolean(payment.financialTransactionId), payment.amountCents)}>
                      <Undo2 size={12} aria-hidden="true" /> {payment.financialTransactionId ? "Remove and unmatch" : "Remove"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {payable && canWrite && (
        <section className="claim-drawer__section" aria-labelledby="bill-schedule">
          <h3 id="bill-schedule" className="claim-drawer__section-title">Planned payment</h3>
          <div className="bill-schedule">
            <Field label="Pay on" hint="A reminder for your team; Societyer doesn't send payments.">
              <DatePicker value={scheduleDate} onChange={setScheduleDate} />
            </Field>
            <button
              type="button"
              className="btn btn--sm"
              disabled={busy || (scheduleDate || "") === (bill.scheduledDate ?? "")}
              onClick={() => void run(
                "save the planned payment",
                () => setSchedule({ id: bill._id as Id<"bills">, scheduledDate: scheduleDate || undefined }),
                scheduleDate ? `Payment planned for ${formatDate(scheduleDate)}` : "Planned payment cleared",
              )}
            >
              <CalendarCheck size={12} aria-hidden="true" /> {scheduleDate ? "Schedule" : "Clear"}
            </button>
          </div>
        </section>
      )}

      <section className="claim-drawer__section" aria-labelledby="bill-document">
        <h3 id="bill-document" className="claim-drawer__section-title">Bill document</h3>
        {bill.document ? (
          <p className="bill-document"><Link to={`/app/documents/${bill.document._id}`}>{bill.document.title}</Link></p>
        ) : bill.status !== "canceled" && canWrite ? (
          <BillDocumentDropZone
            societyId={societyId}
            label={[bill.vendorName, bill.billNumber].filter(Boolean).join(" ")}
            onUploaded={(documentId) => void run("attach the document", () => attachDocument({ id: bill._id as Id<"bills">, documentId: documentId as Id<"documents"> }), "Bill document attached")}
          />
        ) : (
          <p className="muted">No document attached.</p>
        )}
      </section>

      <section className="claim-drawer__section" aria-labelledby="bill-activity">
        <h3 id="bill-activity" className="claim-drawer__section-title">Activity</h3>
        <ol className="claim-trail">
          {[...bill.timeline].reverse().map((entry, index) => (
            <li key={`${entry.atISO}-${index}`} className={`claim-trail__item claim-trail__item--${EVENT_DOT[entry.kind] ?? entry.kind}`}>
              <span className="claim-trail__dot" aria-hidden="true" />
              <div>
                <div><strong>{entry.label}</strong>{entry.actorName ? <> by {entry.actorName}</> : null}</div>
                {entry.amountCents != null && <div className="claim-trail__note"><Money cents={entry.amountCents} currency={bill.currency} /></div>}
                <div className="muted claim-trail__time">{formatDateTime(entry.atISO)}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </Drawer>
  );
}
