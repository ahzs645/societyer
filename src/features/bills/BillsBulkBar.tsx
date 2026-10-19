import { useState } from "react";
import { Ban, Check, CircleDollarSign, Download } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { RecordTableBulkBar, useRecordTableStoreHandle, type BulkAction } from "@/platform/record-engine";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { Modal, useConfirm, usePrompt } from "../../components/Modal";
import { Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { Money } from "../../components/Money";
import { useToast } from "../../components/Toast";
import { pluralize } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { BILL_PAYMENT_METHODS, BILL_PAYMENT_METHOD_LABEL, canPayStatus, type BillPaymentMethod } from "../../../shared/bills";
import { exportBillsCsv } from "./billExport";
import { errorMessage, type BillRow, type BillsWorkspace } from "./types";

/**
 * The floating selection island for the bills table: the selection's total
 * outstanding, approve, mark paid (one date, method and account for all),
 * cancel and export. Bills an action doesn't apply to are skipped and said so.
 */
export function BillsBulkBar({ societyId, workspace, canWrite, exportName }: { societyId: string; workspace: BillsWorkspace; canWrite: boolean; exportName: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const handle = useRecordTableStoreHandle();
  const bulkApprove = usePermissionedMutation(api.bills.bulkApprove, true);
  const markPaid = usePermissionedMutation(api.bills.markPaid, canWrite);
  const cancel = usePermissionedMutation(api.bills.cancel, canWrite);
  const [paying, setPaying] = useState<BillRow[] | null>(null);
  const [payment, setPayment] = useState<{ date: string; method: BillPaymentMethod; cashAccountId: string }>({ date: workspace.today, method: "eft", cashAccountId: workspace.accounts.payment[0]?._id ?? "" });
  const [busy, setBusy] = useState(false);
  const byId = new Map(workspace.bills.map((bill) => [bill._id, bill]));
  const rowsFor = (ids: string[]) => ids.map((id) => byId.get(id)).filter((bill): bill is BillRow => Boolean(bill));
  const asIds = (rows: readonly BillRow[]) => rows.map((bill) => bill._id as Id<"bills">);

  const approve = async (ids: string[]) => {
    const rows = rowsFor(ids).filter((bill) => bill.status === "awaiting_approval");
    if (!rows.length) return toast.info("Only bills waiting for approval can be approved");
    const total = rows.reduce((sum, bill) => sum + bill.totalCents, 0);
    const ok = await confirm({
      title: `Approve ${pluralize(rows.length, "bill")}?`,
      message: (
        <div className="bulk-approve-confirm">
          <ul>
            {rows.map((bill) => (
              <li key={bill._id}>
                <span>{bill.vendorName}{bill.billNumber ? <span className="muted"> · {bill.billNumber}</span> : null}</span>
                <Money cents={bill.totalCents} currency={bill.currency} />
              </li>
            ))}
          </ul>
          <div className="bulk-approve-confirm__total"><span>Total</span><Money cents={total} /></div>
          <p className="muted">Bills that get their last approval are posted to Accounts payable.</p>
        </div>
      ),
      confirmLabel: `Approve ${formatMoney(total)}`,
    });
    if (!ok) return;
    try {
      const result = (await bulkApprove({ societyId: societyId as Id<"societies">, ids: asIds(rows) })) as { approved: number; recorded: number; skipped: Array<{ error: string }> };
      const parts = [result.approved ? `${pluralize(result.approved, "bill")} approved` : "", result.recorded ? `${pluralize(result.recorded, "approval")} recorded` : ""].filter(Boolean);
      toast.success(parts.join(", ") || "Nothing approved", result.skipped.length ? `${result.skipped.length} skipped: ${result.skipped[0].error}` : undefined);
    } catch (error) {
      toast.error("Couldn't approve the bills", errorMessage(error));
    }
  };

  const startPaying = (ids: string[]) => {
    const rows = rowsFor(ids).filter((bill) => canPayStatus(bill.status));
    if (!rows.length) return toast.info("Only approved bills with a balance can be marked paid");
    setPayment((current) => ({ ...current, date: workspace.today }));
    setPaying(rows);
  };

  const confirmPaid = async () => {
    if (!paying) return;
    setBusy(true);
    try {
      const result = (await markPaid({ societyId: societyId as Id<"societies">, ids: asIds(paying), date: payment.date, method: payment.method, cashAccountId: payment.cashAccountId as Id<"financialAccounts"> })) as { paid: number; paidCents: number; skipped: Array<{ error: string }> };
      toast.success(`${pluralize(result.paid, "bill")} marked paid (${formatMoney(result.paidCents)})`, result.skipped.length ? `${result.skipped.length} skipped: ${result.skipped[0].error}` : "To match bank payments instead, record each payment from its bill.");
      setPaying(null);
      handle.get().clearSelection();
    } catch (error) {
      toast.error("Couldn't mark the bills paid", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const cancelBills = async (ids: string[]) => {
    const rows = rowsFor(ids).filter((bill) => bill.status !== "canceled");
    if (!rows.length) return;
    const withPayments = rows.filter((bill) => bill.payments.length > 0).length;
    const posted = rows.filter((bill) => bill.journalEntryId && !bill.payments.length).length;
    const reason = await prompt({
      title: `Cancel ${pluralize(rows.length, "bill")}?`,
      message: (
        <div>
          {posted > 0 && <p>{pluralize(posted, "approved bill")} get a reversing entry dated today.</p>}
          {withPayments > 0 && <p className="muted">{pluralize(withPayments, "bill")} with payments will be skipped. Remove the payments first.</p>}
        </div>
      ),
      placeholder: "Reason (optional)",
      confirmLabel: `Cancel ${pluralize(rows.length, "bill")}`,
    });
    if (reason === null) return;
    try {
      const result = (await cancel({ societyId: societyId as Id<"societies">, ids: asIds(rows), reason: reason || undefined })) as { canceled: number; reversed: number; skippedPaid: number };
      toast.success(`${pluralize(result.canceled, "bill")} canceled`, [result.reversed ? `${result.reversed} reversed in the books` : "", result.skippedPaid ? `${result.skippedPaid} with payments skipped` : ""].filter(Boolean).join(". ") || undefined);
    } catch (error) {
      toast.error("Couldn't cancel the bills", errorMessage(error));
    }
  };

  const actions: BulkAction[] = [
    { id: "bills-approve", label: "Approve", icon: <Check size={12} aria-hidden="true" />, onRun: (ids) => approve(ids) },
    ...(canWrite
      ? [
          { id: "bills-paid", label: "Mark paid…", icon: <CircleDollarSign size={12} aria-hidden="true" />, keepSelection: true, onRun: (ids: string[]) => startPaying(ids) },
          { id: "bills-cancel", label: "Cancel", icon: <Ban size={12} aria-hidden="true" />, tone: "danger" as const, onRun: (ids: string[]) => cancelBills(ids) },
        ]
      : []),
    {
      id: "bills-export",
      label: "Export",
      icon: <Download size={12} aria-hidden="true" />,
      keepSelection: true,
      onRun: (ids) => {
        const rows = rowsFor(ids);
        toast.success(`Exported ${pluralize(rows.length, "bill")}`, exportBillsCsv(rows, `${exportName} selection ${workspace.today}`));
      },
    },
  ];

  const payingTotal = (paying ?? []).reduce((sum, bill) => sum + bill.balanceCents, 0);

  return (
    <>
      <RecordTableBulkBar
        actions={actions}
        summary={(records) => <Money cents={records.reduce((sum, record) => sum + (byId.get(String(record._id))?.balanceCents ?? 0), 0)} />}
      />
      <Modal
        open={paying !== null}
        onClose={() => setPaying(null)}
        size="sm"
        title={`Mark ${pluralize(paying?.length ?? 0, "bill")} paid`}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setPaying(null)}>Cancel</button>
            <button type="button" className="btn btn--accent" disabled={busy || !payment.cashAccountId} onClick={() => void confirmPaid()}>
              Record {formatMoney(payingTotal)}
            </button>
          </>
        }
      >
        <p className="muted">Each bill's whole balance is recorded as paid and posted against Accounts payable.</p>
        <Field label="Date paid">
          <DatePicker value={payment.date} clearable={false} onChange={(date) => date && setPayment({ ...payment, date })} />
        </Field>
        <Field label="Method">
          <Select<BillPaymentMethod> value={payment.method} onChange={(method) => setPayment({ ...payment, method })} options={BILL_PAYMENT_METHODS.map((value) => ({ value, label: BILL_PAYMENT_METHOD_LABEL[value] }))} />
        </Field>
        <Field label="Paid from">
          <Select value={payment.cashAccountId} onChange={(cashAccountId) => setPayment({ ...payment, cashAccountId })} options={workspace.accounts.payment.map((account) => ({ value: account._id, label: account.label }))} placeholder="Choose account" />
        </Field>
      </Modal>
    </>
  );
}
