import { useState } from "react";
import { useMutation } from "convex/react";
import { Checkbox } from "../../components/Controls";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { Drawer, Field } from "../../components/ui";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";

export type CustomerDetails = { id?: string; name: string; contactName?: string; email?: string; phone?: string; address?: string; notes?: string; oneOffName?: string };
export type SavedCustomer = { id: string; name: string; email?: string; address?: string };

type Props = {
  /** The customer to edit or start from; null keeps the editor closed. */
  customer: CustomerDetails | null;
  societyId: string;
  canWrite: boolean;
  /** Opened from an invoice, quote or repair rather than the Customers tab. */
  asModal?: boolean;
  onClose: () => void;
  onSaved?: (customer: SavedCustomer) => void;
};

/** The one add and edit form for customers, on the Customers tab and wherever one is billed. */
export function CustomerEditor({ customer, ...props }: Props) {
  return customer ? <CustomerForm key={customer.id ?? "new"} customer={customer} {...props} /> : null;
}

function CustomerForm({ customer, societyId, canWrite, asModal, onClose, onSaved }: Props & { customer: CustomerDetails }) {
  const upsert = useMutation(api.invoices.upsertCustomer);
  const toast = useToast();
  const [draft, setDraft] = useState(customer);
  const [updateSentInvoices, setUpdateSentInvoices] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Partial<CustomerDetails>) => setDraft((current) => ({ ...current, ...patch }));
  const renamed = draft.name.trim() !== customer.name.trim();
  const showSentChoice = renamed && Boolean(customer.id || customer.oneOffName);

  const save = async () => {
    const name = draft.name.trim();
    if (!name) return setError("Enter the customer's name.");
    const details = { name, contactName: draft.contactName?.trim() || undefined, email: draft.email?.trim() || undefined, phone: draft.phone?.trim() || undefined, address: draft.address?.trim() || undefined, notes: draft.notes?.trim() || undefined };
    setBusy(true);
    try {
      const id: string = await upsert({ ...details, id: customer.id as Id<"accountingCounterparties"> | undefined, societyId: societyId as Id<"societies">, oneOffName: customer.oneOffName, updateSentInvoices: showSentChoice && updateSentInvoices ? true : undefined });
      toast.success(customer.id ? "Customer saved" : `${name} added as a customer`);
      onSaved?.({ id, name, email: details.email, address: details.address });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the customer.");
    } finally {
      setBusy(false);
    }
  };

  const title = customer.oneOffName ? "Save as customer" : customer.id ? "Edit customer" : "Add customer";
  const footer = (
    <>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn--accent" disabled={!canWrite || busy} onClick={() => void save()}>Save</button>
    </>
  );
  const form = (
    <div>
      {error && <p className="field__error" role="alert">{error}</p>}
      <Field label="Name" required>
        <input className="input" value={draft.name} onChange={(e) => update({ name: e.target.value })} placeholder="Riverside Farmers Market" />
      </Field>
      {showSentChoice && (
        <div className="field">
          <Checkbox checked={updateSentInvoices} onChange={setUpdateSentInvoices} label="Also change the name on sent invoices" hint="Draft invoices and recurring series always update. Sent invoices keep the name they were issued with unless you tick this." />
        </div>
      )}
      <Field label="Contact person"><input className="input" value={draft.contactName ?? ""} onChange={(e) => update({ contactName: e.target.value })} /></Field>
      <Field label="Email"><input className="input" type="email" value={draft.email ?? ""} placeholder="billing@example.org" onChange={(e) => update({ email: e.target.value })} /></Field>
      <Field label="Phone"><input className="input" type="tel" value={draft.phone ?? ""} onChange={(e) => update({ phone: e.target.value })} /></Field>
      <Field label="Billing address"><textarea className="input textarea" rows={3} value={draft.address ?? ""} placeholder="Street, city, province, postal code" onChange={(e) => update({ address: e.target.value })} /></Field>
      <Field label="Notes" hint="For your records. Not printed on invoices."><textarea className="input textarea" rows={2} value={draft.notes ?? ""} onChange={(e) => update({ notes: e.target.value })} /></Field>
    </div>
  );

  return asModal
    ? <Modal open onClose={onClose} title={title} size="md" footer={footer}>{form}</Modal>
    : <Drawer open onClose={onClose} title={title} footer={footer}>{form}</Drawer>;
}
