import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Drawer, Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { useToast } from "../../components/Toast";
import { INVOICE_TERMS, INVOICE_TERMS_LABEL, formatInvoiceNumber, normalizeInvoicePrefix } from "../../../shared/invoicing";
import type { InvoiceSettings } from "./types";

type Props = { open: boolean; onClose: () => void; settings: InvoiceSettings; societyId: string; canWrite: boolean };

/** Numbering, default terms and the payment instructions printed on every invoice. */
export function InvoiceSettingsDrawer({ open, onClose, settings, societyId, canWrite }: Props) {
  const save = useMutation(api.invoices.saveSettings);
  const toast = useToast();
  const [prefix, setPrefix] = useState(settings.prefix);
  const [nextNumber, setNextNumber] = useState(String(settings.nextNumber));
  const [defaultTerms, setDefaultTerms] = useState(settings.defaultTerms);
  const [paymentInstructions, setPaymentInstructions] = useState(settings.paymentInstructions ?? "");
  const [defaultMemo, setDefaultMemo] = useState(settings.defaultMemo ?? "");
  const [replyToEmail, setReplyToEmail] = useState(settings.replyToEmail ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    try {
      await save({
        societyId: societyId as any,
        prefix,
        nextNumber: Number(nextNumber),
        defaultTerms,
        paymentInstructions: paymentInstructions || undefined,
        defaultMemo: defaultMemo || undefined,
        replyToEmail: replyToEmail || undefined,
      });
      toast.success("Invoice settings saved");
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Could not save the settings.");
    }
  };

  const preview = formatInvoiceNumber(normalizeInvoicePrefix(prefix), Number(nextNumber) || 1);
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Invoice settings"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--accent" disabled={!canWrite} onClick={() => void submit()}>Save</button>
        </>
      }
    >
      {error && <p className="field__error" role="alert">{error}</p>}
      <div className="invoice-settings__row">
        <Field label="Number prefix">
          <input className="input" value={prefix} maxLength={12} onChange={(e) => setPrefix(e.target.value)} />
        </Field>
        <Field label="Next number" hint={`Next invoice: ${preview}`}>
          <input className="input num" inputMode="numeric" value={nextNumber} onChange={(e) => setNextNumber(e.target.value.replace(/\D/g, ""))} />
        </Field>
      </div>
      <Field label="Default terms">
        <Select value={defaultTerms} onChange={setDefaultTerms} options={INVOICE_TERMS.filter((t) => t !== "custom").map((t) => ({ value: t, label: INVOICE_TERMS_LABEL[t] }))} />
      </Field>
      <Field label="Payment instructions" hint="Printed on every invoice, e.g. an e-transfer address or where to mail a cheque.">
        <textarea className="input textarea" rows={4} value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} />
      </Field>
      <Field label="Default memo" hint="Pre-filled on new invoices; you can change it per invoice.">
        <textarea className="input textarea" rows={2} value={defaultMemo} onChange={(e) => setDefaultMemo(e.target.value)} />
      </Field>
      <Field label="Reply-to email" hint="Used on invoice and reminder emails drafted in the Outbox.">
        <input className="input" type="email" value={replyToEmail} onChange={(e) => setReplyToEmail(e.target.value)} />
      </Field>
    </Drawer>
  );
}
