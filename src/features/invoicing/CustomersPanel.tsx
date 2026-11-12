import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FilePlus2, FileText, Pencil, Plus, Users } from "lucide-react";
import { FIELD_TYPES, RecordListTable, RecordTablePhoneCard, staticRecordTable } from "@/platform/record-engine";
import { EmptyState } from "../../components/ui";
import { Money } from "../../components/Money";
import type { CustomerSummary } from "../../../shared/invoicing";
import { CustomerEditor, type CustomerDetails } from "./CustomerEditor";
import { tablePerCurrency } from "./currencyTables";
import type { PartyOption } from "./types";

type Props = {
  currency?: string;
  customers: CustomerSummary[];
  /** Saved customer records, with the details that aren't on any invoice. */
  organizations: PartyOption[];
  societyId: string;
  canWrite: boolean;
  onShowInvoices: (customer: CustomerSummary) => void;
  onNewInvoice: (customer: CustomerSummary) => void;
  onStatement?: (customer: CustomerSummary) => void;
};

const KIND_LABEL: Record<string, string> = { member: "Member", organization: "Customer", custom: "One-off" };

const customersTable = tablePerCurrency((currency) => {
  const money = { isCents: true, currencyCode: currency };
  return staticRecordTable({
    id: "invoice-customers",
    nameSingular: "customer",
    namePlural: "customers",
    labelSingular: "Customer",
    labelPlural: "Customers",
    labelIdentifierFieldName: "name",
    density: "comfortable",
    fields: [
      { name: "name", label: "Customer", fieldType: FIELD_TYPES.TEXT, size: 260, config: { groupable: false } },
      {
        name: "kind",
        label: "Type",
        fieldType: FIELD_TYPES.SELECT,
        size: 110,
        isVisible: false,
        config: { options: [{ value: "member", label: "Member", color: "blue" }, { value: "organization", label: "Customer", color: "green" }, { value: "custom", label: "One-off", color: "gray" }] },
      },
      { name: "email", label: "Email", fieldType: FIELD_TYPES.EMAIL, size: 200, isVisible: false },
      { name: "invoiceCount", label: "Invoices", fieldType: FIELD_TYPES.NUMBER, size: 100 },
      { name: "billedCents", label: "Billed", fieldType: FIELD_TYPES.CURRENCY, size: 130, config: money },
      { name: "outstandingCents", label: "Outstanding", fieldType: FIELD_TYPES.CURRENCY, size: 150, config: money },
      { name: "overdueCents", label: "Overdue", fieldType: FIELD_TYPES.CURRENCY, size: 130, isVisible: false, config: money },
      { name: "lastIssueDate", label: "Last invoice", fieldType: FIELD_TYPES.DATE, size: 130 },
    ],
  });
});

type CustomerRecord = {
  _id: string;
  name: string;
  kind: string;
  email: string;
  invoiceCount: number;
  billedCents: number;
  outstandingCents: number;
  overdueCents: number;
  lastIssueDate: string | null;
  customer: CustomerSummary;
};

const kindAndEmail = (customer: CustomerSummary) => [KIND_LABEL[customer.partyKind] ?? "Customer", customer.email].filter(Boolean).join(" · ");

/** Saved customers and everyone else who has been billed, with what they owe. A customer opens as their invoices. */
export function CustomersPanel({ currency = "CAD", customers, organizations, societyId, canWrite, onShowInvoices, onNewInvoice, onStatement }: Props) {
  const [editing, setEditing] = useState<CustomerDetails | null>(null);
  const records = useMemo<CustomerRecord[]>(() => customers.map((customer) => ({
    _id: customer.key,
    name: customer.name,
    kind: customer.partyKind,
    email: customer.email ?? "",
    invoiceCount: customer.invoiceCount,
    billedCents: customer.billedCents,
    outstandingCents: customer.outstandingCents,
    overdueCents: customer.overdueCents,
    lastIssueDate: customer.lastIssueDate ?? null,
    customer,
  })), [customers]);

  const edit = (customer: CustomerSummary) => {
    const saved = organizations.find((party) => party._id === customer.counterpartyId);
    if (saved) setEditing({ id: saved._id, name: saved.name, contactName: saved.contactName, email: saved.email, phone: saved.phone, address: saved.address, notes: saved.notes });
    else setEditing({ name: customer.name, email: customer.email, address: customer.address, oneOffName: customer.name });
  };

  return (
    <div className="card invoice-card">
      <div className="card__head">
        <div className="invoice-customers__intro">
          <h2 className="card__title">Customers</h2>
          <span className="card__subtitle">Keep customer details up to date and see what each one owes.</span>
        </div>
        <button type="button" className="btn btn--sm btn--accent" disabled={!canWrite} onClick={() => setEditing({ name: "" })}>
          <Plus size={14} aria-hidden="true" /> Add customer
        </button>
      </div>
      <RecordListTable<CustomerRecord>
        variant="card"
        table={customersTable(currency)}
        tableId="invoice-customers"
        label="Customers"
        icon={<Users size={14} />}
        records={records}
        onOpen={(record) => onShowInvoices(record.customer)}
        renderCell={({ record, field }) => {
          const customer = record.customer;
          if (field.name === "name") {
            return (
              <span>
                <span className="invoice-table__name">{customer.name}</span>
                <span className="muted invoice-table__sub">{kindAndEmail(customer)}</span>
              </span>
            );
          }
          if (field.name === "outstandingCents") {
            return (
              <span>
                {customer.outstandingCents > 0 ? <Money cents={customer.outstandingCents} currency={currency} /> : <span className="muted">—</span>}
                {customer.overdueCents > 0 && <span className="invoice-table__overdue"><Money cents={customer.overdueCents} currency={currency} /> overdue</span>}
              </span>
            );
          }
          return undefined;
        }}
        renderRowActions={(record) => {
          const customer = record.customer;
          return (
            <>
              {customer.memberId ? (
                <Link className="btn btn--ghost btn--sm" to={`/app/members/${customer.memberId}`} aria-label={`Edit member ${customer.name}`}><Pencil size={14} aria-hidden="true" /> Edit</Link>
              ) : (
                <button type="button" className="btn btn--ghost btn--sm" disabled={!canWrite} aria-label={`Edit ${customer.name}`} onClick={() => edit(customer)}><Pencil size={14} aria-hidden="true" /> Edit</button>
              )}
              <button type="button" className="btn btn--ghost btn--sm" disabled={!canWrite} onClick={() => onNewInvoice(customer)}>
                <FilePlus2 size={14} aria-hidden="true" /> Invoice
              </button>
            </>
          );
        }}
        rowMenuSections={(record) => onStatement ? [{ id: "customer", items: [{ id: "statement", label: "Statement", icon: <FileText size={14} />, onSelect: () => onStatement(record.customer) }] }] : []}
        renderPhoneCard={(record, { open, selecting }) => {
          const customer = record.customer;
          return (
            <RecordTablePhoneCard
              title={customer.name}
              meta={[
                customer.outstandingCents > 0 ? <span key="owed"><Money cents={customer.outstandingCents} currency={currency} /> outstanding</span> : "Nothing outstanding",
                customer.overdueCents > 0 ? <span key="overdue" className="invoice-table__overdue"><Money cents={customer.overdueCents} currency={currency} /> overdue</span> : "",
              ]}
              detail={[kindAndEmail(customer)]}
              onOpen={open}
              selecting={selecting}
            />
          );
        }}
        emptyState={<EmptyState icon={<Users size={20} />} title="No customers yet" description="Add a customer here, or create one while billing them." />}
      />
      <CustomerEditor customer={editing} societyId={societyId} canWrite={canWrite} onClose={() => setEditing(null)} />
    </div>
  );
}
