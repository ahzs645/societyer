import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { Drawer, Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { Money } from "../../components/Money";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import { BILL_PAYMENT_METHODS, BILL_PAYMENT_METHOD_LABEL, BILL_TERMS, BILL_TERMS_LABEL, isBillPaymentMethod, normalizeBillTerms, type BillPaymentMethod, type BillTerms } from "../../../shared/bills";
import { BillStatusPill } from "./BillStatusPill";
import { errorMessage, type BillsWorkspace, type BillVendor } from "./types";

type Form = {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  taxIdentifier: string;
  defaultAccountId: string;
  defaultTerms: BillTerms | "";
  paymentMethod: BillPaymentMethod | "";
  paymentDetails: string;
  notes: string;
};

function formFor(vendor: BillVendor | null): Form {
  return {
    name: vendor?.name ?? "",
    contactName: vendor?.contactName ?? "",
    email: vendor?.email ?? "",
    phone: vendor?.phone ?? "",
    address: vendor?.address ?? "",
    taxIdentifier: vendor?.taxIdentifier ?? "",
    defaultAccountId: vendor?.defaultAccountId ?? "",
    defaultTerms: vendor?.defaultTerms ? normalizeBillTerms(vendor.defaultTerms) : "",
    paymentMethod: isBillPaymentMethod(vendor?.paymentMethod) ? vendor.paymentMethod : "",
    paymentDetails: vendor?.paymentDetails ?? "",
    notes: vendor?.notes ?? "",
  };
}

/**
 * A vendor: outstanding, overdue and total paid, the bill history and every
 * payment, and the details bills use (default account and terms, how to pay).
 * Opens straight into the form for a new vendor.
 */
export function VendorDrawer({
  open,
  onClose,
  societyId,
  workspace,
  vendor,
  canWrite,
}: {
  open: boolean;
  onClose: () => void;
  societyId: string;
  workspace: BillsWorkspace;
  /** null for a new vendor. */
  vendor: BillVendor | null;
  canWrite: boolean;
}) {
  const toast = useToast();
  const save = usePermissionedMutation(api.bills.upsertVendor, canWrite);
  const [editing, setEditing] = useState(!vendor);
  const [form, setForm] = useState<Form>(() => formFor(vendor));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm(formFor(vendor));
    setEditing(!vendor);
    // Reset only when another vendor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vendor?._id]);

  const bills = vendor ? workspace.bills.filter((bill) => bill.vendorId === vendor._id) : [];
  const payments = bills
    .flatMap((bill) => bill.payments.map((payment) => ({ ...payment, billId: bill._id, billNumber: bill.billNumber, currency: bill.currency })))
    .sort((a, b) => b.date.localeCompare(a.date));

  const submit = async () => {
    setBusy(true);
    try {
      await save({
        ...(vendor ? { id: vendor._id as Id<"accountingCounterparties"> } : {}),
        societyId: societyId as Id<"societies">,
        name: form.name,
        contactName: form.contactName || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
        taxIdentifier: form.taxIdentifier || undefined,
        defaultAccountId: (form.defaultAccountId || undefined) as Id<"financialAccounts"> | undefined,
        defaultTerms: form.defaultTerms || undefined,
        paymentMethod: form.paymentMethod || undefined,
        paymentDetails: form.paymentDetails || undefined,
        notes: form.notes || undefined,
      });
      toast.success(vendor ? "Vendor saved" : `${form.name.trim()} added`);
      if (vendor) setEditing(false);
      else onClose();
    } catch (error) {
      toast.error("Couldn't save the vendor", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={vendor ? vendor.name : "New vendor"}
      size="wide"
      footer={
        editing ? (
          <>
            <span className="register-drawer__spacer" />
            <button type="button" className="btn" onClick={() => (vendor ? setEditing(false) : onClose())}>Cancel</button>
            {canWrite && <button type="button" className="btn btn--accent" onClick={() => void submit()} disabled={busy || !form.name.trim()}>Save</button>}
          </>
        ) : (
          <>
            <span className="register-drawer__spacer" />
            <button type="button" className="btn" onClick={onClose}>Close</button>
            {canWrite && <button type="button" className="btn btn--accent" onClick={() => setEditing(true)}><Pencil size={12} aria-hidden="true" /> Edit details</button>}
          </>
        )
      }
    >
      {vendor && !editing && (
        <>
          <dl className="claim-drawer__facts vendor-totals">
            <div><dt>Outstanding</dt><dd><Money cents={vendor.outstandingCents} /></dd></div>
            <div><dt>Overdue</dt><dd><Money cents={vendor.overdueCents} tone={vendor.overdueCents ? "out" : "auto"} /></dd></div>
            <div><dt>Total paid</dt><dd><Money cents={vendor.paidCents} /></dd></div>
            <div><dt>Default account</dt><dd>{vendor.defaultAccountLabel ?? <span className="muted">None</span>}</dd></div>
            <div><dt>Terms</dt><dd>{vendor.defaultTerms ? BILL_TERMS_LABEL[normalizeBillTerms(vendor.defaultTerms)] : <span className="muted">Net 30</span>}</dd></div>
            <div><dt>Pays by</dt><dd>{isBillPaymentMethod(vendor.paymentMethod) ? BILL_PAYMENT_METHOD_LABEL[vendor.paymentMethod] : <span className="muted">Not set</span>}</dd></div>
            {vendor.contactName && <div><dt>Contact</dt><dd>{vendor.contactName}</dd></div>}
            {vendor.email && <div><dt>Email</dt><dd><a href={`mailto:${vendor.email}`}>{vendor.email}</a></dd></div>}
            {vendor.phone && <div><dt>Phone</dt><dd>{vendor.phone}</dd></div>}
            {vendor.taxIdentifier && <div><dt>GST/HST number</dt><dd>{vendor.taxIdentifier}</dd></div>}
          </dl>
          {vendor.paymentDetails && <p className="claim-drawer__notes"><strong>How to pay:</strong> {vendor.paymentDetails}</p>}
          {vendor.address && <p className="claim-drawer__notes vendor-address">{vendor.address}</p>}
          {vendor.notes && <p className="claim-drawer__notes">{vendor.notes}</p>}

          <section className="claim-drawer__section" aria-labelledby="vendor-bills">
            <h3 id="vendor-bills" className="claim-drawer__section-title">Bills</h3>
            {bills.length === 0 ? (
              <p className="muted">No bills from {vendor.name} yet. <Link to="/app/bills?edit=new">Create a bill</Link></p>
            ) : (
              <table className="table vendor-history">
                <thead><tr><th>Bill #</th><th>Date</th><th>Due</th><th>Status</th><th className="num">Amount</th><th className="num">Outstanding</th></tr></thead>
                <tbody>
                  {bills.map((bill) => (
                    <tr key={bill._id}>
                      <td><Link to={`/app/bills?${bill.lifecycle === "draft" ? "edit" : "bill"}=${bill._id}`}>{bill.billNumber ?? "No number"}</Link></td>
                      <td>{formatDate(bill.billDate)}</td>
                      <td>{formatDate(bill.dueDate)}</td>
                      <td><BillStatusPill status={bill.status} daysOverdue={bill.daysOverdue} /></td>
                      <td className="num"><Money cents={bill.totalCents} currency={bill.currency} /></td>
                      <td className="num"><Money cents={bill.balanceCents} currency={bill.currency} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="claim-drawer__section" aria-labelledby="vendor-payments">
            <h3 id="vendor-payments" className="claim-drawer__section-title">Payments</h3>
            {payments.length === 0 ? (
              <p className="muted">No payments recorded.</p>
            ) : (
              <table className="table vendor-history">
                <thead><tr><th>Date</th><th>Bill #</th><th>Method</th><th>Reference</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.key}>
                      <td>{formatDate(payment.date)}</td>
                      <td>{payment.billNumber ?? <span className="muted">—</span>}</td>
                      <td>{isBillPaymentMethod(payment.method) ? BILL_PAYMENT_METHOD_LABEL[payment.method] : payment.method}{payment.transaction ? <span className="muted"> · matched</span> : null}</td>
                      <td>{payment.reference ?? <span className="muted">—</span>}</td>
                      <td className="num"><Money cents={payment.amountCents} currency={payment.currency} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      {editing && (
        <>
          <Field label="Name" required>
            <input className="input" value={form.name} onChange={(event) => set("name", event.target.value)} disabled={!canWrite} placeholder="e.g. Coastal Hydro" />
          </Field>
          <div className="register-field-row">
            <Field label="Contact"><input className="input" value={form.contactName} onChange={(event) => set("contactName", event.target.value)} disabled={!canWrite} /></Field>
            <Field label="Email"><input className="input" type="email" value={form.email} onChange={(event) => set("email", event.target.value)} disabled={!canWrite} placeholder="accounts@vendor.example" /></Field>
            <Field label="Phone"><input className="input" type="tel" value={form.phone} onChange={(event) => set("phone", event.target.value)} disabled={!canWrite} /></Field>
          </div>
          <Field label="Address">
            <textarea className="input textarea" rows={2} value={form.address} onChange={(event) => set("address", event.target.value)} disabled={!canWrite} placeholder="Street, city, province, postal code" />
          </Field>
          <div className="register-field-row">
            <Field label="Default account" hint="New bill lines from this vendor start here.">
              <Select value={form.defaultAccountId} onChange={(value) => set("defaultAccountId", value)} options={workspace.accounts.expense.map((account) => ({ value: account._id, label: account.label }))} placeholder="None" searchable clearable clearLabel="None" disabled={!canWrite} />
            </Field>
            <Field label="Default terms">
              <Select<BillTerms> value={form.defaultTerms} onChange={(value) => set("defaultTerms", value)} options={BILL_TERMS.filter((terms) => terms !== "custom").map((terms) => ({ value: terms, label: BILL_TERMS_LABEL[terms] }))} placeholder="Net 30" clearable clearLabel="Net 30" disabled={!canWrite} />
            </Field>
            <Field label="GST/HST number"><input className="input" value={form.taxIdentifier} onChange={(event) => set("taxIdentifier", event.target.value)} disabled={!canWrite} placeholder="12345 6789 RT0001" /></Field>
          </div>
          <div className="register-field-row">
            <Field label="Pays by">
              <Select<BillPaymentMethod> value={form.paymentMethod} onChange={(value) => set("paymentMethod", value)} options={BILL_PAYMENT_METHODS.map((value) => ({ value, label: BILL_PAYMENT_METHOD_LABEL[value] }))} placeholder="Not set" clearable clearLabel="Not set" disabled={!canWrite} />
            </Field>
            <Field label="Payment details" hint="Where the money goes, e.g. an e-transfer address or the last digits of the account.">
              <input className="input" value={form.paymentDetails} onChange={(event) => set("paymentDetails", event.target.value)} disabled={!canWrite} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea className="input textarea" rows={2} value={form.notes} onChange={(event) => set("notes", event.target.value)} disabled={!canWrite} />
          </Field>
        </>
      )}
    </Drawer>
  );
}
