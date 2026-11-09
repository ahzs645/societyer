import { useState } from "react";
import { useMutation } from "convex/react";
import { MessageSquare, Send } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Modal } from "../../components/Modal";
import { Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import type { InvoiceClientResponse, InvoiceDeliveryMethod, InvoiceRow } from "./types";
import { INVOICE_DELIVERY_METHOD_LABEL as DELIVERY_METHOD_LABEL, INVOICE_CLIENT_RESPONSE_LABEL as CLIENT_RESPONSE_LABEL } from "../../../shared/invoicing";
import "./invoiceWorkflow.css";

/** Delivery and the client's response are user-recorded facts, separate from settlement. */
export function InvoiceWorkflowPanel({ invoice, today, canWrite }: { invoice: InvoiceRow; today: string; canWrite: boolean }) {
  const [mode, setMode] = useState<"delivery" | "response" | null>(null);
  const delivery = invoice.externalDelivery;
  const response = invoice.clientResponse;
  const sent = invoice.lifecycle === "sent" || Boolean(invoice.sentAtISO);
  const finalized = invoice.lifecycle !== "draft";
  const actionable = finalized && invoice.lifecycle !== "void";
  return <section className="invoice-workflow" aria-label="Invoice workflow">
    <h3 className="invoice-drawer__heading">Invoice workflow</h3>
    <dl className="invoice-workflow__stages">
      <div><dt>Document</dt><dd>{invoice.lifecycle === "draft" ? "Draft" : invoice.lifecycle === "void" ? "Voided" : "Finalized"}{invoice.issuedAtISO && <small>Invoice date: {formatDate(invoice.issueDate)}</small>}</dd></div>
      <div><dt>Delivery</dt><dd>{delivery ? `${DELIVERY_METHOD_LABEL[delivery.method]} · ${formatDate(delivery.sentDate)}` : sent ? "Marked as sent" : "Not recorded"}{delivery?.recipient && <small>{delivery.recipient}</small>}{delivery?.source === "automation" && <small>Sent by Billing Automation</small>}</dd></div>
      <div><dt>Client response</dt><dd>{response ? CLIENT_RESPONSE_LABEL[response.response] : sent ? "Awaiting response" : "Not recorded"}{response && <small>{response.customerName} · {formatDate(response.date)}</small>}</dd></div>
    </dl>
    {!finalized && <p className="muted">Finalize the invoice to remove Draft, then download it and send it to your client.</p>}
    {actionable && !sent && <p className="muted">Ready for you to send. Downloading does not record delivery.</p>}
    {delivery?.reference && <p className="muted">Delivery reference: {delivery.reference}</p>}
    {delivery?.note && <p className="invoice-workflow__note">Sending note: {delivery.note}</p>}
    {response?.note && <p className="invoice-workflow__note">{response.note}</p>}
    {response?.reference && <p className="muted">Response reference: {response.reference}</p>}
    {response && <p className="muted">Recorded by {response.recordedByName || "your team"}. Client responses do not change payments or the balance.</p>}
    {actionable && <div className="invoice-workflow__actions">
      {!sent && <button type="button" className="btn btn--sm" disabled={!canWrite} onClick={() => setMode("delivery")}><Send size={14} aria-hidden="true" />Record external sending</button>}
      <button type="button" className="btn btn--sm" disabled={!canWrite || !sent} title={!sent ? "Record when you sent the invoice first" : undefined} onClick={() => setMode("response")}><MessageSquare size={14} aria-hidden="true" />{response ? "Update client response" : "Record client response"}</button>
    </div>}
    {mode && <InvoiceWorkflowEventForm key={mode} mode={mode} invoice={invoice} today={today} onClose={() => setMode(null)} />}
  </section>;
}

function InvoiceWorkflowEventForm({ mode, invoice, today, onClose }: { mode: "delivery" | "response"; invoice: InvoiceRow; today: string; onClose: () => void }) {
  const markSent = useMutation(api.invoices.markSent);
  const recordResponse = useMutation(api.invoices.recordClientResponse);
  const toast = useToast();
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<InvoiceDeliveryMethod>("email");
  const [recipient, setRecipient] = useState(invoice.billToEmail || invoice.billToName);
  const [response, setResponse] = useState<InvoiceClientResponse>(invoice.clientResponse?.response ?? "accepted");
  const [customerName, setCustomerName] = useState(invoice.clientResponse?.customerName ?? invoice.billToName);
  const [note, setNote] = useState(mode === "response" ? invoice.clientResponse?.note ?? "" : "");
  const [reference, setReference] = useState(mode === "response" ? invoice.clientResponse?.reference ?? "" : "");
  const [requestKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const delivery = mode === "delivery";
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!date || date > today) return setError("Choose the date this happened, no later than today.");
    if (!delivery && !customerName.trim()) return setError("Enter the person or organization that responded.");
    if (!delivery && response !== "accepted" && !note.trim()) return setError("Add the client's reason or requested changes.");
    setBusy(true);
    setError("");
    try {
      if (delivery) {
        const result = await markSent({ societyId: invoice.societyId, ids: [invoice._id], sentDate: date, method, recipient: recipient.trim() || undefined, reference: reference.trim() || undefined, note: note.trim() || undefined });
        if (!result.sent) throw new Error("Sending was not recorded. This invoice may already have been sent or voided in another tab. Close this form and review its current workflow.");
        toast.success("External sending recorded", "Societyer has not sent an email.");
      } else {
        await recordResponse({ id: invoice._id, response, date, customerName: customerName.trim(), note: note.trim() || undefined, reference: reference.trim() || undefined, idempotencyKey: requestKey });
        toast.success(`Client response: ${CLIENT_RESPONSE_LABEL[response].toLowerCase()}`, "Payments and the invoice balance are unchanged.");
      }
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save this event.");
    } finally {
      setBusy(false);
    }
  };
  return <Modal open onClose={() => { if (!busy) onClose(); }} title={delivery ? "Record external sending" : "Record client response"} size="md" dismissOnBackdrop={!busy}
    footer={<><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" form="invoice-workflow-event" className="btn btn--accent" disabled={busy}>{busy ? "Saving…" : delivery ? "Record sending" : "Save client response"}</button></>}>
    <form id="invoice-workflow-event" className="invoice-workflow__form" onSubmit={submit}>
      <p className="muted">{delivery ? "Record the invoice you have already sent yourself. Societyer will not send it to the client." : "Record what the client told you outside Societyer. Acceptance is not a payment; a decline or dispute does not cancel the invoice."}</p>
      <Field label={delivery ? "Date sent" : "Response date"}><DatePicker value={date} clearable={false} onChange={(value) => value && setDate(value)} /></Field>
      {delivery ? <>
        <Field label="Delivery method"><Select value={method} onChange={(value) => setMethod(value as InvoiceDeliveryMethod)} options={Object.entries(DELIVERY_METHOD_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Sent to" hint="Email address, contact, or portal account."><input className="input" value={recipient} maxLength={300} onChange={(event) => setRecipient(event.target.value)} /></Field>
      </> : <>
        <Field label="Client response"><Select value={response} onChange={(value) => setResponse(value as InvoiceClientResponse)} options={Object.entries(CLIENT_RESPONSE_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Responding person or organization"><input className="input" value={customerName} maxLength={200} required onChange={(event) => setCustomerName(event.target.value)} /></Field>
      </>}
      <Field label="Reference (optional)" hint="Email subject, conversation reference, or portal confirmation."><input className="input" value={reference} maxLength={300} onChange={(event) => setReference(event.target.value)} /></Field>
      <Field label={!delivery && response !== "accepted" ? "Reason or requested changes" : "Notes (optional)"}><textarea className="input textarea" value={note} maxLength={2000} required={!delivery && response !== "accepted"} onChange={(event) => setNote(event.target.value)} /></Field>
      {error && <p role="alert" className="field__error">{error}</p>}
    </form>
  </Modal>;
}
