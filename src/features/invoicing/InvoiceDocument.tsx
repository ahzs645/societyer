import { createPortal } from "react-dom";
import { Money } from "../../components/Money";
import { formatDate } from "../../lib/format";
import { INVOICE_TERMS_LABEL, computeInvoiceTotals, lineAmountCents, type InvoiceLine, type InvoiceTerms } from "../../../shared/invoicing";
import type { InvoiceOrganization, InvoicePaymentView } from "./types";

export type InvoiceDocumentData = {
  number: string;
  issueDate: string;
  dueDate: string;
  terms: string;
  reference?: string;
  currency: string;
  billToName: string;
  billToEmail?: string;
  billToAddress?: string;
  lines: InvoiceLine[];
  discount?: { kind: "percent" | "amount"; value: number };
  memo?: string;
  payments?: InvoicePaymentView[];
  status?: string;
};

type Props = {
  invoice: InvoiceDocumentData;
  organization: InvoiceOrganization & { logoUrl?: string | null };
  paymentInstructions?: string;
};

function formatQuantity(quantity: number) {
  return new Intl.NumberFormat("en-CA", { maximumFractionDigits: 3 }).format(quantity);
}

function formatRate(rate: number) {
  return `${new Intl.NumberFormat("en-CA", { maximumFractionDigits: 3 }).format(rate)}%`;
}

/**
 * The invoice as a customer sees it. Rendered on "paper" tokens that stay
 * light in both themes so the preview matches what prints.
 */
export function InvoiceDocument({ invoice, organization, paymentInstructions }: Props) {
  const totals = computeInvoiceTotals(invoice.lines, invoice.discount);
  const paid = (invoice.payments ?? []).reduce((sum, payment) => sum + payment.amountCents, 0);
  const balance = totals.totalCents - paid;
  const hasTax = totals.taxes.length > 0;
  const currency = invoice.currency || "CAD";
  const stamp = invoice.status === "void" ? "Void" : invoice.status === "paid" ? "Paid" : invoice.status === "draft" ? "Draft" : null;
  return (
    <article className="invoice-doc" aria-label={`Invoice ${invoice.number}`}>
      <header className="invoice-doc__head">
        <div className="invoice-doc__from">
          {organization.logoUrl ? <img className="invoice-doc__logo" src={organization.logoUrl} alt="" /> : null}
          <div className="invoice-doc__org">{organization.name ?? "Your organization"}</div>
          {organization.address && <div className="invoice-doc__address">{organization.address}</div>}
          {organization.email && <div className="invoice-doc__muted">{organization.email}</div>}
          {organization.registrationNumber && <div className="invoice-doc__muted">Incorporation no. {organization.registrationNumber}</div>}
        </div>
        <div className="invoice-doc__meta">
          <div className="invoice-doc__title">Invoice</div>
          <dl>
            <div><dt>Number</dt><dd>{invoice.number}</dd></div>
            <div><dt>Issued</dt><dd>{formatDate(invoice.issueDate)}</dd></div>
            <div><dt>Due</dt><dd>{formatDate(invoice.dueDate)}</dd></div>
            <div><dt>Terms</dt><dd>{INVOICE_TERMS_LABEL[invoice.terms as InvoiceTerms] ?? invoice.terms}</dd></div>
            {invoice.reference && <div><dt>Reference</dt><dd>{invoice.reference}</dd></div>}
          </dl>
        </div>
      </header>

      <section className="invoice-doc__billto">
        {stamp && <div className={`invoice-doc__stamp invoice-doc__stamp--${stamp.toLowerCase()}`} aria-hidden="true">{stamp}</div>}
        <div className="invoice-doc__label">Bill to</div>
        <div className="invoice-doc__party">{invoice.billToName || "—"}</div>
        {invoice.billToAddress && <div className="invoice-doc__address">{invoice.billToAddress}</div>}
        {invoice.billToEmail && <div className="invoice-doc__muted">{invoice.billToEmail}</div>}
      </section>

      <table className="invoice-doc__lines">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col" className="num">Qty</th>
            <th scope="col" className="num">Price</th>
            {hasTax && <th scope="col" className="num">Tax</th>}
            <th scope="col" className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.length === 0 && (
            <tr><td colSpan={hasTax ? 5 : 4} className="invoice-doc__muted">No line items yet.</td></tr>
          )}
          {invoice.lines.map((line) => (
            <tr key={line.key}>
              <td>
                <div className="invoice-doc__item">{line.item || "Untitled item"}</div>
                {line.description && <div className="invoice-doc__muted">{line.description}</div>}
              </td>
              <td className="num" data-label="Qty">{formatQuantity(line.quantity)}</td>
              <td className="num" data-label="Price"><Money cents={line.unitPriceCents} currency={currency} /></td>
              {hasTax && <td className="num" data-label="Tax">{line.taxRatePercent ? `${line.taxLabel ?? "Tax"} ${formatRate(line.taxRatePercent)}` : "—"}</td>}
              <td className="num" data-label="Amount"><Money cents={lineAmountCents(line)} currency={currency} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="invoice-doc__totals">
        <dl>
          <div><dt>Subtotal</dt><dd><Money cents={totals.subtotalCents} currency={currency} /></dd></div>
          {totals.discountCents > 0 && (
            <div>
              <dt>Discount{invoice.discount?.kind === "percent" ? ` (${formatRate(invoice.discount.value)})` : ""}</dt>
              <dd><Money cents={-totals.discountCents} currency={currency} /></dd>
            </div>
          )}
          {totals.taxes.map((tax) => (
            <div key={`${tax.label}-${tax.ratePercent}`}>
              <dt>{tax.label} {formatRate(tax.ratePercent)}</dt>
              <dd><Money cents={tax.cents} currency={currency} /></dd>
            </div>
          ))}
          <div className="invoice-doc__total"><dt>Total {currency}</dt><dd><Money cents={totals.totalCents} currency={currency} /></dd></div>
          {paid > 0 && <div><dt>Paid</dt><dd><Money cents={-paid} currency={currency} /></dd></div>}
          {paid > 0 && <div className="invoice-doc__total"><dt>Balance due</dt><dd><Money cents={Math.max(0, balance)} currency={currency} /></dd></div>}
        </dl>
      </div>

      {invoice.memo && (
        <section className="invoice-doc__notes">
          <div className="invoice-doc__label">Notes</div>
          <p>{invoice.memo}</p>
        </section>
      )}
      {paymentInstructions && (
        <section className="invoice-doc__pay">
          <div className="invoice-doc__label">How to pay</div>
          <p>{paymentInstructions}</p>
        </section>
      )}
      {organization.gstNumber && (
        <footer className="invoice-doc__foot">GST/HST registration no. {organization.gstNumber}</footer>
      )}
    </article>
  );
}

/**
 * Mounts a copy of the invoice at the end of <body>. Print CSS hides the app
 * whenever this is present, so the browser's Print / Save as PDF produces
 * just the invoice.
 */
export function InvoicePrintPortal(props: Props) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="invoice-print-portal" aria-hidden="true">
      <InvoiceDocument {...props} />
    </div>,
    document.body,
  );
}
