import { Field } from "../../components/ui";
import { Checkbox } from "../../components/Controls";
import { InfoPopover } from "../../components/InfoPopover";
import { INVOICE_PAYMENT_METHOD_TYPES, type InvoiceReceivingMethod } from "../../../shared/invoicePaymentMethods";

type Props = {
  methods: InvoiceReceivingMethod[];
  defaults: string[];
  onChange: (methods: InvoiceReceivingMethod[], defaults: string[]) => void;
  disabled: boolean;
};

export function InvoicePaymentMethodDetails({ method, saved = false }: { method: InvoiceReceivingMethod; saved?: boolean }) {
  return <div className="invoice-payment-details"><strong>{method.name || "Payment method"}</strong><p>{INVOICE_PAYMENT_METHOD_TYPES[method.type]}</p><p>{method.details || "No receiving details entered yet."}</p>{saved && <p className="muted">These receiving details are saved with this invoice.</p>}</div>;
}

export function InvoicePaymentMethodFields({ methods, defaults, onChange, disabled }: Props) {
  return <section aria-label="Society payment methods">
    <h3>Payment methods <InfoPopover label="About society payment methods" hover><p>These are your society's receiving instructions. Select one or more defaults for new invoices, then choose which methods to include on each invoice.</p><p>Saved invoices keep their existing details. Adding a receiving method does not initiate a bank transfer.</p></InfoPopover></h3>
    <p className="muted">Save EFT details, e-transfer addresses, payment links or other ways to pay. Choose one or more defaults for new invoices.</p>
    {methods.map((method, index) => {
      const update = (patch: Partial<InvoiceReceivingMethod>) => onChange(methods.map((item) => item.id === method.id ? { ...item, ...patch } : item), defaults);
      return <fieldset className="invoice-payment-method" aria-label={`Payment method ${index + 1}`} key={method.id} disabled={disabled}>
        <legend>Payment method {index + 1} <InfoPopover label={`Payment details for ${method.name || `method ${index + 1}`}`} hover><InvoicePaymentMethodDetails method={method} /></InfoPopover></legend>
        <Field label="Method name"><input className="input" maxLength={100} value={method.name} onChange={(event) => update({ name: event.target.value })} placeholder="Society operating account" /></Field>
        <Field label="Method type"><select className="input" value={method.type} onChange={(event) => update({ type: event.target.value as InvoiceReceivingMethod["type"] })}>{Object.entries(INVOICE_PAYMENT_METHOD_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Payment details" hint={method.type === "eft" ? "Include the account holder, bank, institution, transit and account numbers, and any reference required." : "Enter the receiving email, mailing address, HTTPS payment link or other instructions to print on invoices."}><textarea className="input textarea" rows={4} maxLength={2000} value={method.details} onChange={(event) => update({ details: event.target.value })} /></Field>
        <Checkbox label="Use by default on new invoices" checked={defaults.includes(method.id)} onChange={(checked) => onChange(methods, checked ? [...defaults, method.id] : defaults.filter((id) => id !== method.id))} />
        <button className="btn btn--sm" type="button" onClick={() => onChange(methods.filter((item) => item.id !== method.id), defaults.filter((id) => id !== method.id))}>Remove payment method {index + 1}</button>
      </fieldset>;
    })}
    <button className="btn btn--sm" type="button" disabled={disabled || methods.length >= 20} onClick={() => onChange([...methods, { id: crypto.randomUUID(), name: "", type: "eft", details: "" }], defaults)}>Add payment method</button>
  </section>;
}
