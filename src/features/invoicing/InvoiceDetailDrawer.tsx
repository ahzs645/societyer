import { useState } from "react";
import { useMutation } from "convex/react";
import { Ban, Bell, CheckCircle2, CircleDashed, Copy, Eye, FilePlus2, Landmark, MoreHorizontal, Pencil, Printer, Repeat, RotateCcw, Send, Trash2, Undo2, Wallet } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Drawer } from "../../components/ui";
import { Menu } from "../../components/Menu";
import { Money } from "../../components/Money";
import { useConfirm, usePrompt } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { formatDate, formatDateTime } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { INVOICE_TERMS_LABEL, PAYMENT_METHOD_LABEL, isOpenStatus, type InvoiceTerms, type PaymentMethod } from "../../../shared/invoicing";
import { InvoiceDocument, InvoicePrintPortal } from "./InvoiceDocument";
import { InvoiceStatusPill } from "./InvoiceStatusPill";
import { RecordPaymentForm } from "./RecordPaymentForm";
import type { InvoiceRow, InvoiceWorkspace } from "./types";

const TIMELINE_ICONS: Record<string, typeof CircleDashed> = {
  created: FilePlus2,
  issued_from_series: Repeat,
  duplicated: Copy,
  sent: Send,
  reminder: Bell,
  payment: Wallet,
  payment_removed: Undo2,
  reverted: RotateCcw,
  voided: Ban,
  restored: RotateCcw,
};

type Props = {
  invoice: InvoiceRow;
  workspace: InvoiceWorkspace;
  logoUrl?: string | null;
  canWrite: boolean;
  onClose: () => void;
  onEdit: (id: string) => void;
  onOpenSeries: (seriesId: string) => void;
};

/** Invoice panel: balance, actions, payments (with bank links), timeline and a preview. */
export function InvoiceDetailDrawer({ invoice, workspace, logoUrl, canWrite, onClose, onEdit, onOpenSeries }: Props) {
  const markSent = useMutation(api.invoices.markSent);
  const voidInvoices = useMutation(api.invoices.voidInvoices);
  const restoreVoided = useMutation(api.invoices.restoreVoided);
  const duplicate = useMutation(api.invoices.duplicate);
  const remove = useMutation(api.invoices.remove);
  const revertToUnpaid = useMutation(api.invoices.revertToUnpaid);
  const removePayment = useMutation(api.invoices.removePayment);
  const sendReminders = useMutation(api.invoices.sendReminders);
  const confirm = useConfirm();
  const prompt = usePrompt();
  const toast = useToast();
  const [paying, setPaying] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const open = isOpenStatus(invoice.status);
  const organization = { ...workspace.organization, logoUrl };
  const run = async (action: () => Promise<unknown>, success: string, description?: string) => {
    try {
      await action();
      toast.success(success, description);
    } catch (err: any) {
      toast.error("Something went wrong", err?.message);
    }
  };

  const doVoid = async () => {
    const reason = await prompt({
      title: `Void ${invoice.number}?`,
      message: "A void invoice stays on record with its number but no longer counts as owed. You can restore it later. Add a reason if you like.",
      placeholder: "Reason (optional): issued in error, booking cancelled…",
      confirmLabel: "Void invoice",
    });
    if (reason === null || reason === undefined) return;
    const result: any = await voidInvoices({ societyId: invoice.societyId as any, ids: [invoice._id as any], reason: String(reason) || undefined }).catch((err: any) => {
      toast.error("Could not void", err?.message);
      return null;
    });
    if (!result) return;
    if (result.skippedPaid) toast.warn("Remove the payments first", "An invoice with payments can't be voided. Revert it to unpaid, then void it.");
    else toast.success(`${invoice.number} voided`);
  };

  const doRevert = async () => {
    const ok = await confirm({
      title: `Revert ${invoice.number} to unpaid?`,
      message: `This removes ${invoice.payments.length === 1 ? "the payment" : `all ${invoice.payments.length} payments`} (${formatMoney(invoice.paidCents)}) and unlinks any bank deposits. The bank lines themselves are not changed.`,
      confirmLabel: "Revert to unpaid",
      tone: "warn",
    });
    if (ok) await run(() => revertToUnpaid({ id: invoice._id as any }), `${invoice.number} is unpaid again`);
  };

  const doDelete = async () => {
    const ok = await confirm({ title: `Delete draft ${invoice.number}?`, message: "The draft is removed and its number is not reused.", confirmLabel: "Delete draft", tone: "danger" });
    if (!ok) return;
    await run(() => remove({ id: invoice._id as any }), "Draft deleted");
    onClose();
  };

  const moreItems = [
    { id: "preview", label: showPreview ? "Hide preview" : "Preview invoice", icon: <Eye size={14} />, onSelect: () => setShowPreview((v) => !v) },
    { id: "print", label: "Print / Save as PDF", icon: <Printer size={14} />, onSelect: () => window.print() },
    { id: "duplicate", label: "Duplicate", icon: <Copy size={14} />, disabled: !canWrite, onSelect: () => void duplicate({ id: invoice._id as any }).then((id: string) => { toast.success(`Duplicated ${invoice.number}`); onEdit(id); }).catch((err: any) => toast.error("Could not duplicate", err?.message)) },
    ...(invoice.seriesId ? [{ id: "series", label: `Open series${invoice.seriesName ? ` · ${invoice.seriesName}` : ""}`, icon: <Repeat size={14} />, onSelect: () => onOpenSeries(invoice.seriesId!) }] : []),
    ...(invoice.payments.length ? [{ id: "revert", label: "Revert to unpaid", icon: <RotateCcw size={14} />, disabled: !canWrite, onSelect: () => void doRevert() }] : []),
    ...(invoice.lifecycle === "void"
      ? [{ id: "restore", label: "Restore from void", icon: <RotateCcw size={14} />, disabled: !canWrite, onSelect: () => void run(() => restoreVoided({ id: invoice._id as any }), `${invoice.number} restored`) }]
      : [{ id: "void", label: "Void invoice", icon: <Ban size={14} />, destructive: true, disabled: !canWrite, onSelect: () => void doVoid() }]),
    ...(invoice.lifecycle === "draft" && !invoice.payments.length ? [{ id: "delete", label: "Delete draft", icon: <Trash2 size={14} />, destructive: true, disabled: !canWrite, onSelect: () => void doDelete() }] : []),
  ];

  return (
    <Drawer
      open
      onClose={onClose}
      size="wide"
      title={`Invoice ${invoice.number}`}
      className="invoice-drawer"
      header={
        <div className="invoice-drawer__head">
          <span className="invoice-drawer__number">{invoice.number}</span>
          <InvoiceStatusPill status={invoice.status} daysOverdue={invoice.daysOverdue} partial={invoice.paidCents > 0} />
        </div>
      }
    >
      <section className="invoice-drawer__summary">
        <div>
          <div className="invoice-drawer__party">{invoice.billToName}</div>
          <div className="muted invoice-drawer__meta">
            Issued {formatDate(invoice.issueDate)} · {invoice.status === "draft" ? "Due" : invoice.status === "overdue" ? "Was due" : "Due"} {formatDate(invoice.dueDate)} · {INVOICE_TERMS_LABEL[invoice.terms as InvoiceTerms] ?? invoice.terms}
            {invoice.reference ? ` · Ref ${invoice.reference}` : ""}
          </div>
        </div>
        <dl className="invoice-drawer__figures">
          <div><dt>Total</dt><dd><Money cents={invoice.totalCents} currency={invoice.currency} struck={invoice.status === "void"} /></dd></div>
          <div><dt>Paid</dt><dd><Money cents={invoice.paidCents} currency={invoice.currency} /></dd></div>
          <div className={invoice.status === "overdue" ? "is-overdue" : undefined}>
            <dt>Balance due</dt>
            <dd><Money cents={invoice.status === "void" ? 0 : invoice.balanceCents} currency={invoice.currency} variant="hero" /></dd>
          </div>
        </dl>
      </section>

      <div className="invoice-drawer__actions">
        {invoice.lifecycle !== "void" && (
          <button type="button" className="btn btn--sm" disabled={!canWrite} onClick={() => onEdit(invoice._id)}>
            <Pencil size={14} aria-hidden="true" /> Edit
          </button>
        )}
        {invoice.lifecycle === "draft" && (
          <button type="button" className="btn btn--sm btn--accent" disabled={!canWrite} onClick={() => void run(() => markSent({ societyId: invoice.societyId as any, ids: [invoice._id as any] }), `${invoice.number} marked as sent`)}>
            <Send size={14} aria-hidden="true" /> Mark as sent
          </button>
        )}
        {(open || invoice.lifecycle === "draft") && invoice.balanceCents > 0 && (
          <button type="button" className={`btn btn--sm${invoice.lifecycle === "draft" ? "" : " btn--accent"}`} disabled={!canWrite} aria-expanded={paying} onClick={() => setPaying((v) => !v)}>
            <Wallet size={14} aria-hidden="true" /> Record payment
          </button>
        )}
        {open && (
          <button
            type="button"
            className="btn btn--sm"
            disabled={!canWrite || !invoice.billToEmail}
            title={invoice.billToEmail ? undefined : "Add an email address to send reminders"}
            onClick={() => void sendReminders({ societyId: invoice.societyId as any, ids: [invoice._id as any] }).then((r: any) => toast.success(r.created ? "Reminder drafted in the Outbox" : "No reminder drafted", r.created ? "Review and send it from the Outbox." : undefined)).catch((err: any) => toast.error("Could not draft a reminder", err?.message))}
          >
            <Bell size={14} aria-hidden="true" /> Reminder
          </button>
        )}
        <Menu
          align="right"
          trigger={
            <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`More actions for ${invoice.number}`}>
              <MoreHorizontal size={14} />
            </button>
          }
          sections={[{ id: "more", items: moreItems }]}
        />
      </div>

      {invoice.voidReason && invoice.lifecycle === "void" && <p className="muted invoice-drawer__note">Voided: {invoice.voidReason}</p>}

      {paying && (
        <RecordPaymentForm invoice={invoice} transactions={workspace.transactions} today={workspace.today} onDone={() => setPaying(false)} onCancel={() => setPaying(false)} />
      )}

      <section className="invoice-drawer__section" aria-labelledby="inv-payments">
        <h3 id="inv-payments" className="invoice-drawer__heading">Payments</h3>
        {invoice.payments.length === 0 ? (
          <p className="muted">No payments recorded yet.</p>
        ) : (
          <ul className="invoice-payments">
            {invoice.payments.map((payment) => (
              <li key={payment.key} className="invoice-payments__row">
                <span className="invoice-payments__icon" aria-hidden="true"><CheckCircle2 size={14} /></span>
                <span className="invoice-payments__main">
                  <span>{formatDate(payment.date)} · {PAYMENT_METHOD_LABEL[payment.method as PaymentMethod] ?? payment.method}{payment.reference ? ` · ${payment.reference}` : ""}</span>
                  {payment.transaction ? (
                    <span className="invoice-bank-chip" title="Linked bank deposit">
                      <Landmark size={12} aria-hidden="true" />
                      <span className="invoice-bank-chip__text">{payment.transaction.description ?? "Bank deposit"} · {formatDate(payment.transaction.date)}</span>
                    </span>
                  ) : null}
                </span>
                <Money cents={payment.amountCents} currency={invoice.currency} tone="in" />
                {canWrite && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm btn--icon"
                    aria-label={`Remove the ${formatMoney(payment.amountCents)} payment from ${formatDate(payment.date)}`}
                    onClick={async () => {
                      const ok = await confirm({ title: "Remove this payment?", message: `${formatMoney(payment.amountCents)} received ${formatDate(payment.date)}${payment.transaction ? " (its bank deposit is unlinked, not deleted)" : ""}.`, confirmLabel: "Remove payment", tone: "warn" });
                      if (ok) await run(() => removePayment({ id: invoice._id as any, paymentKey: payment.key }), "Payment removed");
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="invoice-drawer__section" aria-labelledby="inv-timeline">
        <h3 id="inv-timeline" className="invoice-drawer__heading">Timeline</h3>
        <ol className="invoice-timeline">
          {[...invoice.timeline].sort((a, b) => b.atISO.localeCompare(a.atISO)).map((event, index) => {
            const Icon = TIMELINE_ICONS[event.kind] ?? CircleDashed;
            return (
              <li key={`${event.atISO}-${index}`} className={`invoice-timeline__item invoice-timeline__item--${event.kind.replace(/_/g, "-")}`}>
                <span className="invoice-timeline__dot" aria-hidden="true"><Icon size={12} /></span>
                <span className="invoice-timeline__body">
                  <span>{event.label}{event.amountCents != null ? <> · <Money cents={event.amountCents} currency={invoice.currency} /></> : null}</span>
                  <span className="muted">{formatDateTime(event.atISO)}{event.actorName ? ` · ${event.actorName}` : ""}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      {showPreview && (
        <section className="invoice-drawer__section" aria-label="Invoice preview">
          <div className="invoice-paper invoice-paper--compact">
            <InvoiceDocument invoice={invoice} organization={organization} paymentInstructions={workspace.settings.paymentInstructions} />
          </div>
        </section>
      )}
      <InvoicePrintPortal invoice={invoice} organization={organization} paymentInstructions={workspace.settings.paymentInstructions} />
    </Drawer>
  );
}
