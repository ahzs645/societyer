import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FilePlus2, FileText, MoreHorizontal, Pencil, Plus, Search, Users } from "lucide-react";
import { EmptyState } from "../../components/ui";
import { Menu } from "../../components/Menu";
import { Money } from "../../components/Money";
import { formatDate } from "../../lib/format";
import type { CustomerSummary } from "../../../shared/invoicing";
import { CustomerEditor, type CustomerDetails } from "./CustomerEditor";
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

/** Saved customers and everyone else who has been billed, with what they owe. */
export function CustomersPanel({ currency = "CAD", customers, organizations, societyId, canWrite, onShowInvoices, onNewInvoice, onStatement }: Props) {
  const [editing, setEditing] = useState<CustomerDetails | null>(null);
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? customers.filter((customer) => `${customer.name} ${customer.email ?? ""}`.toLowerCase().includes(query)) : customers;
  }, [customers, search]);

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
        <div className="invoice-customers__tools">
          {customers.length > 0 && (
            <label className="invoice-customers__search">
              <Search size={14} aria-hidden="true" />
              <input className="input" type="search" aria-label="Search customers" placeholder="Search customers" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
          )}
          <button type="button" className="btn btn--sm btn--accent" disabled={!canWrite} onClick={() => setEditing({ name: "" })}>
            <Plus size={14} aria-hidden="true" /> Add customer
          </button>
        </div>
      </div>
      {customers.length === 0 ? (
        <div className="card__body">
          <EmptyState icon={<Users size={20} />} title="No customers yet" description="Add a customer here, or create one while billing them." />
        </div>
      ) : shown.length === 0 ? (
        <div className="card__body">
          <EmptyState variant="filtered" onClearFilters={() => setSearch("")} />
        </div>
      ) : (
        <table className="table table--comfortable invoice-table invoice-table--customers">
          <thead>
            <tr>
              <th>Customer</th>
              <th className="num">Invoices</th>
              <th className="num">Billed</th>
              <th className="num">Outstanding</th>
              <th>Last invoice</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((customer) => (
              <tr key={customer.key}>
                <td data-label="Customer" className="invoice-table__primary">
                  <button type="button" className="invoice-table__link" onClick={() => onShowInvoices(customer)}>{customer.name}</button>
                  <span className="muted invoice-table__sub">{[KIND_LABEL[customer.partyKind] ?? "Customer", customer.email].filter(Boolean).join(" · ")}</span>
                </td>
                <td data-label="Invoices" className="num">{customer.invoiceCount}</td>
                <td data-label="Billed" className="num"><Money cents={customer.billedCents} currency={currency} /></td>
                <td data-label="Outstanding" className="num">
                  {customer.outstandingCents > 0 ? <Money cents={customer.outstandingCents} currency={currency} /> : <span className="muted">—</span>}
                  {customer.overdueCents > 0 && <span className="invoice-table__overdue"><Money cents={customer.overdueCents} currency={currency} /> overdue</span>}
                </td>
                <td data-label="Last invoice">{customer.lastIssueDate ? formatDate(customer.lastIssueDate) : "—"}</td>
                <td className="invoice-table__actions">
                  {customer.memberId ? (
                    <Link className="btn btn--ghost btn--sm" to={`/app/members/${customer.memberId}`} aria-label={`Edit member ${customer.name}`}><Pencil size={14} aria-hidden="true" /> Edit</Link>
                  ) : (
                    <button type="button" className="btn btn--ghost btn--sm" disabled={!canWrite} aria-label={`Edit ${customer.name}`} onClick={() => edit(customer)}><Pencil size={14} aria-hidden="true" /> Edit</button>
                  )}
                  <button type="button" className="btn btn--ghost btn--sm" disabled={!canWrite} onClick={() => onNewInvoice(customer)}>
                    <FilePlus2 size={14} aria-hidden="true" /> Invoice
                  </button>
                  {onStatement && (
                    <Menu
                      align="right"
                      trigger={<button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`More actions for ${customer.name}`}><MoreHorizontal size={14} /></button>}
                      sections={[{ id: "customer", items: [{ id: "statement", label: "Statement", icon: <FileText size={14} />, onSelect: () => onStatement(customer) }] }]}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <CustomerEditor customer={editing} societyId={societyId} canWrite={canWrite} onClose={() => setEditing(null)} />
    </div>
  );
}
