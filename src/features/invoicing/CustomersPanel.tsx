import { FilePlus2, Users } from "lucide-react";
import { EmptyState } from "../../components/ui";
import { Money } from "../../components/Money";
import { formatDate } from "../../lib/format";
import type { CustomerSummary } from "../../../shared/invoicing";

type Props = {
  customers: CustomerSummary[];
  canWrite: boolean;
  onShowInvoices: (customer: CustomerSummary) => void;
  onNewInvoice: (customer: CustomerSummary) => void;
};

const KIND_LABEL: Record<string, string> = { member: "Member", organization: "Customer", custom: "One-off" };

/** Everyone who has been billed, with what they owe. */
export function CustomersPanel({ customers, canWrite, onShowInvoices, onNewInvoice }: Props) {
  return (
    <div className="card invoice-card">
      <div className="card__head">
        <div>
          <h2 className="card__title">Customers</h2>
          <span className="card__subtitle">Bill-to parties with sent invoices, largest balance first.</span>
        </div>
      </div>
      {customers.length === 0 ? (
        <div className="card__body">
          <EmptyState icon={<Users size={20} />} title="No customers yet" description="Anyone you send an invoice to appears here with their balance." />
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
            {customers.map((customer) => (
              <tr key={customer.key}>
                <td data-label="Customer" className="invoice-table__primary">
                  <button type="button" className="invoice-table__link" onClick={() => onShowInvoices(customer)}>{customer.name}</button>
                  <span className="muted invoice-table__sub">{[KIND_LABEL[customer.partyKind] ?? "Customer", customer.email].filter(Boolean).join(" · ")}</span>
                </td>
                <td data-label="Invoices" className="num">{customer.invoiceCount}</td>
                <td data-label="Billed" className="num"><Money cents={customer.billedCents} /></td>
                <td data-label="Outstanding" className="num">
                  {customer.outstandingCents > 0 ? <Money cents={customer.outstandingCents} /> : <span className="muted">—</span>}
                  {customer.overdueCents > 0 && <span className="invoice-table__overdue"><Money cents={customer.overdueCents} /> overdue</span>}
                </td>
                <td data-label="Last invoice">{customer.lastIssueDate ? formatDate(customer.lastIssueDate) : "—"}</td>
                <td className="invoice-table__actions">
                  <button type="button" className="btn btn--ghost btn--sm" disabled={!canWrite} onClick={() => onNewInvoice(customer)}>
                    <FilePlus2 size={14} aria-hidden="true" /> Invoice
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
