import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Pencil, ReceiptText } from "lucide-react";
import { FIELD_TYPES, RecordListTable, RecordTablePhoneCard, staticRecordTable } from "@/platform/record-engine";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { Drawer, Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { Money } from "../../components/Money";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { BILL_PAYMENT_METHODS, BILL_PAYMENT_METHOD_LABEL, BILL_STATUSES, BILL_STATUS_LABEL, BILL_TERMS, BILL_TERMS_LABEL, isBillPaymentMethod, normalizeBillTerms, type BillPaymentMethod, type BillTerms } from "../../../shared/bills";
import { BillStatusPill } from "./BillStatusPill";
import { errorMessage, type BillRow, type BillsWorkspace, type BillVendor } from "./types";

const BILL_STATUS_COLOR: Record<string, string> = {
  draft: "gray", awaiting_approval: "purple", open: "blue", scheduled: "teal", partially_paid: "orange", paid: "green", overdue: "red", canceled: "gray",
};

/** The vendor's bill history: the same columns as the Bills register, without the vendor. */
const VENDOR_BILLS_TABLE = staticRecordTable({
  id: "vendor-drawer:bills",
  nameSingular: "vendorBill",
  namePlural: "vendorBills",
  labelSingular: "Bill",
  labelPlural: "Bills",
  labelIdentifierFieldName: "billNumber",
  viewName: "Bill history",
  fields: [
    { name: "billNumber", label: "Bill #", fieldType: FIELD_TYPES.TEXT, size: 130, config: { groupable: false } },
    { name: "billDate", label: "Date", fieldType: FIELD_TYPES.DATE, size: 110 },
    { name: "dueDate", label: "Due", fieldType: FIELD_TYPES.DATE, size: 110 },
    { name: "status", label: "Status", fieldType: FIELD_TYPES.SELECT, size: 140, config: { options: BILL_STATUSES.map((value) => ({ value, label: BILL_STATUS_LABEL[value], color: BILL_STATUS_COLOR[value] })) } },
    { name: "totalCents", label: "Amount", fieldType: FIELD_TYPES.CURRENCY, size: 120, config: { isCents: true } },
    { name: "balanceCents", label: "Outstanding", fieldType: FIELD_TYPES.CURRENCY, size: 130, config: { isCents: true } },
  ],
});

type VendorBillRecord = {
  _id: string;
  billNumber: string;
  billDate: string;
  dueDate: string;
  status: string;
  totalCents: number;
  balanceCents: number;
  bill: BillRow;
};

function vendorBillRecord(bill: BillRow): VendorBillRecord {
  return { _id: bill._id, billNumber: bill.billNumber ?? "", billDate: bill.billDate, dueDate: bill.dueDate, status: bill.status, totalCents: bill.totalCents, balanceCents: bill.balanceCents, bill };
}

/** Where the Bills page opens a bill: its editor while a draft, otherwise its panel. */
function billHref(bill: BillRow) {
  return `/app/bills?${bill.lifecycle === "draft" ? "edit" : "bill"}=${encodeURIComponent(bill._id)}`;
}

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
  const navigate = useNavigate();
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
              <RecordListTable<VendorBillRecord>
                variant="card"
                table={VENDOR_BILLS_TABLE}
                tableId="vendor-drawer-bills"
                label={`Bills from ${vendor.name}`}
                icon={<ReceiptText size={14} />}
                records={bills.map(vendorBillRecord)}
                onOpen={(record) => navigate(billHref(record.bill))}
                renderCell={({ record, field }) => {
                  const { bill } = record;
                  if (field.name === "billNumber" && !bill.billNumber) return <span className="muted">No number</span>;
                  if (field.name === "status") return <BillStatusPill status={bill.status} daysOverdue={bill.daysOverdue} />;
                  if (field.name === "totalCents") return <Money cents={bill.totalCents} currency={bill.currency} />;
                  if (field.name === "balanceCents") return <Money cents={bill.balanceCents} currency={bill.currency} />;
                  return undefined;
                }}
                renderPhoneCard={(record, { open, selecting }) => (
                  <RecordTablePhoneCard
                    title={record.bill.billNumber ?? "No number"}
                    badge={<BillStatusPill status={record.bill.status} daysOverdue={record.bill.daysOverdue} />}
                    meta={[<Money key="amount" cents={record.bill.totalCents} currency={record.bill.currency} />, `Due ${formatDate(record.dueDate)}`]}
                    detail={[record.bill.balanceCents ? `${formatMoney(record.bill.balanceCents, { currency: record.bill.currency })} outstanding` : ""]}
                    onOpen={open}
                    selecting={selecting}
                  />
                )}
              />
            )}
          </section>

          <section className="claim-drawer__section" aria-labelledby="vendor-payments">
            <h3 id="vendor-payments" className="claim-drawer__section-title">Payments</h3>
            {payments.length === 0 ? (
              <p className="muted">No payments recorded.</p>
            ) : (
              <table className="table table--report">
                <thead><tr><th>Date</th><th>Bill #</th><th>Method</th><th>Reference</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.key}>
                      <td>{formatDate(payment.date)}</td>
                      <td><Link to={`/app/bills?bill=${encodeURIComponent(payment.billId)}`}>{payment.billNumber ?? "Bill"}</Link></td>
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
