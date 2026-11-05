import { cleanInvoicePaymentMethods, type InvoiceReceivingMethod } from "../../../shared/invoicePaymentMethods";
import { InvoicePaymentMethodFields } from "./InvoicePaymentMethodFields";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Drawer, Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { useToast } from "../../components/Toast";
import { INVOICE_TERMS, INVOICE_TERMS_LABEL, formatInvoiceNumber, normalizeInvoicePrefix } from "../../../shared/invoicing";
import type { InvoiceSettings } from "./types";

export type SavedInvoicePaymentMethods = { methods: InvoiceReceivingMethod[]; defaultIds: string[]; addedIds: string[]; instructions: string };
type Props = { open: boolean; onClose: () => void; settings: InvoiceSettings; societyId: string; canWrite: boolean; paymentsOnly?: boolean; onPaymentMethodsSaved?: (result: SavedInvoicePaymentMethods) => void };

/** Numbering, default terms and the payment instructions printed on every invoice. */
export function InvoiceSettingsDrawer({ open, onClose, settings, societyId, canWrite, paymentsOnly = false, onPaymentMethodsSaved }: Props) {
  const save = useMutation(api.invoices.saveSettings);
  const toast = useToast();
  const [prefix, setPrefix] = useState(settings.prefix);
  const [nextNumber, setNextNumber] = useState(String(settings.nextNumber));
  const [defaultTerms, setDefaultTerms] = useState(settings.defaultTerms);
  const [paymentInstructions, setPaymentInstructions] = useState(settings.paymentInstructions ?? "");
  const [defaultMemo, setDefaultMemo] = useState(settings.defaultMemo ?? "");
  const [replyToEmail, setReplyToEmail] = useState(settings.replyToEmail ?? "");
  const [paymentMethods, setPaymentMethods] = useState(settings.paymentMethods ?? []);
  const [defaultPaymentMethodIds, setDefaultPaymentMethodIds] = useState(settings.defaultPaymentMethodIds ?? []);
  const [originalMethodIds] = useState(() => new Set((settings.paymentMethods ?? []).map((method) => method.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!canWrite || busy) return;
    setBusy(true);
    try {
      const methods = cleanInvoicePaymentMethods(paymentMethods);
      const instructions = paymentInstructions.trim().slice(0, 2000);
      await save({
        societyId: societyId as any,
        prefix: paymentsOnly ? settings.prefix : prefix,
        nextNumber: paymentsOnly ? settings.nextNumber : Number(nextNumber),
        defaultTerms: paymentsOnly ? settings.defaultTerms : defaultTerms,
        paymentMethods: methods, defaultPaymentMethodIds,
        paymentInstructions: instructions || undefined,
        defaultMemo: (paymentsOnly ? settings.defaultMemo : defaultMemo) || undefined,
        replyToEmail: (paymentsOnly ? settings.replyToEmail : replyToEmail) || undefined,
      });
      onPaymentMethodsSaved?.({ methods, defaultIds: defaultPaymentMethodIds, addedIds: methods.filter((method) => !originalMethodIds.has(method.id)).map((method) => method.id), instructions });
      toast.success(paymentsOnly ? "Payment methods saved" : "Invoice settings saved");
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Could not save the settings.");
    } finally { setBusy(false); }
  };

  const preview = formatInvoiceNumber(normalizeInvoicePrefix(prefix), Number(nextNumber) || 1);
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={paymentsOnly ? "Payment methods" : "Invoice settings"}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--accent" disabled={!canWrite || busy} onClick={() => void submit()}>{busy ? "Saving…" : paymentsOnly ? "Save payment methods" : "Save"}</button>
        </>
      }
    >
      {error && <p className="field__error" role="alert">{error}</p>}
      {!paymentsOnly && <><div className="invoice-settings__row">
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
      </>}
      <InvoicePaymentMethodFields methods={paymentMethods} defaults={defaultPaymentMethodIds} disabled={!canWrite || busy} onChange={(methods, defaults) => { setPaymentMethods(methods); setDefaultPaymentMethodIds(defaults); }} />
      <Field label="Payment instructions" hint="Additional instructions copied onto new invoices alongside their selected payment methods.">
        <textarea className="input textarea" rows={4} maxLength={2000} value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} />
      </Field>
      {!paymentsOnly && <><Field label="Default memo" hint="Pre-filled on new invoices; you can change it per invoice.">
        <textarea className="input textarea" rows={2} value={defaultMemo} onChange={(e) => setDefaultMemo(e.target.value)} />
      </Field>
      <Field label="Reply-to email" hint="Used on invoice and reminder emails drafted in the Outbox.">
        <input className="input" type="email" value={replyToEmail} onChange={(e) => setReplyToEmail(e.target.value)} />
      </Field></>}
    </Drawer>
  );
}
