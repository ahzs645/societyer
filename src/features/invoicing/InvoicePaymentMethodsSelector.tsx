import { Checkbox } from "../../components/Controls";
import { InfoPopover } from "../../components/InfoPopover";
import type { InvoiceReceivingMethod } from "../../../shared/invoicePaymentMethods";
import { InvoicePaymentMethodDetails } from "./InvoicePaymentMethodFields";

type Props = {
  methods: InvoiceReceivingMethod[];
  selected: InvoiceReceivingMethod[];
  canWrite: boolean;
  onChange: (methods: InvoiceReceivingMethod[]) => void;
  onManage: () => void;
};

export function InvoicePaymentMethodsSelector({ methods, selected, canWrite, onChange, onManage }: Props) {
  const choices = [...methods, ...selected.filter((method) => !methods.some((item) => item.id === method.id))];
  return <fieldset className="invoice-payment-selection" aria-label="Payment methods on this invoice">
    <legend>Payment methods on this invoice <InfoPopover label="About invoice payment methods" hover><p>Select the ways your customer can pay. Use Manage payment methods to add or edit society receiving details and defaults.</p><p>Saved invoices retain their payment details when society defaults change. The information icon beside each method shows the details printed on this invoice.</p></InfoPopover></legend>
    {choices.map((method) => {
      const saved = selected.find((item) => item.id === method.id);
      const available = methods.some((item) => item.id === method.id);
      return <div className="invoice-payment-selection__row" key={method.id}>
        <Checkbox label={`${method.name}${available ? "" : " (saved with invoice)"}`} checked={Boolean(saved)} disabled={!canWrite} onChange={(checked) => onChange(checked ? [...selected, method] : selected.filter((item) => item.id !== method.id))} />
        <InfoPopover label={`Payment details for ${method.name}`} hover><InvoicePaymentMethodDetails method={saved ?? method} saved={!available} /></InfoPopover>
      </div>;
    })}
    {!choices.length && <p className="muted">Add a payment method to include EFT details, an e-transfer address or other receiving instructions.</p>}
    <button className="btn btn--sm" type="button" disabled={!canWrite} onClick={onManage}>Manage payment methods</button>
  </fieldset>;
}
