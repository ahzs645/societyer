import { cleanInvoiceTemplate, REPAIR_STATUS_LABEL, type InvoiceTemplate } from "../../../shared/invoiceCommerce";
import { computeInvoiceTotals, PAYMENT_METHOD_LABEL, type PaymentMethod } from "../../../shared/invoicing";
import type { InvoiceDocumentData } from "./InvoiceDocument";
import type { InvoiceRow, InvoiceWorkspace, RepairJob } from "./types";
import { settlementTotals, type InvoiceMoneyOptions } from "../../../shared/invoiceMoney";
import type { BillingQuote, CustomerStatement } from "../../../shared/billingDocuments";

type ReceiptSource = Pick<InvoiceRow, "number" | "lifecycle" | "status" | "currency" | "billToName" | "billToEmail" | "billToAddress" | "documentTemplate" | "lines" | "discount" | "payments"> & { money?: InvoiceMoneyOptions };
type PaymentContext = Pick<InvoiceWorkspace, "transactions" | "ledger">;

const money = (cents: number, currency: string) => new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);

/** A receipt acknowledges one extant recorded payment, never the invoice's face value. */
export function paymentReceiptDocument(invoice: ReceiptSource, paymentKey: string, context: PaymentContext): InvoiceDocumentData {
  if (invoice.lifecycle !== "sent" || invoice.status === "draft" || invoice.status === "void") throw new Error("Receipts are available for payments on issued invoices.");
  const payment = invoice.payments.find((row) => row.key === paymentKey);
  if (!payment) throw new Error("This payment is no longer recorded. Close the preview and select a current payment.");
  if (payment.reversedDate || (payment.kind && payment.kind !== "payment")) throw new Error("Receipts acknowledge active cash payments. Credit notes, write-offs, refunds and reversed payments use their settlement records.");
  if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0) throw new Error("A receipt requires a positive recorded payment amount.");
  const total = computeInvoiceTotals(invoice.lines, invoice.discount, invoice.money).totalCents;
  const settlements = settlementTotals(invoice.payments), paid = settlements.settledCents;
  const transaction = context.transactions.find((row) => row._id === payment.financialTransactionId);
  const linked = payment.transaction ?? transaction;
  const deposit = context.ledger.accounts.deposit.find((row) => row._id === payment.depositAccountId);
  const destination = transaction?.accountLabel ?? deposit?.label ?? (payment.depositAccountId ? `Account ${payment.depositAccountId}` : transaction?.accountId ? `Account ${transaction.accountId}` : undefined);
  const details: Array<{ label: string; value: string }> = [
    { label: "Invoice", value: invoice.number },
    { label: "Payment date", value: payment.date },
    { label: "Amount received", value: `${money(payment.amountCents, invoice.currency)} ${invoice.currency}` },
    { label: "Payment method", value: PAYMENT_METHOD_LABEL[payment.method as PaymentMethod] ?? payment.method },
    { label: "Payment record", value: payment.key },
    ...(payment.reference ? [{ label: "Payment reference", value: payment.reference }] : []),
    { label: "Destination", value: destination ?? "Not recorded" },
    ...(linked ? [{ label: "Linked bank deposit", value: `${linked.description || "Bank deposit"} · ${linked.date} · ${money(linked.amountCents, invoice.currency)} ${invoice.currency}` }, { label: "Bank transaction", value: linked._id }] : []),
    ...(payment.journalEntryId ? [{ label: "Payment journal entry", value: payment.journalEntryId }] : []),
    { label: "Invoice total", value: `${money(total, invoice.currency)} ${invoice.currency}` },
    { label: "Invoice payments at export", value: `${money(settlements.cashPaidCents, invoice.currency)} ${invoice.currency}` },
    ...(settlements.creditCents ? [{ label: "Invoice credits at export", value: `${money(settlements.creditCents, invoice.currency)} ${invoice.currency}` }] : []),
    ...(settlements.writeOffCents ? [{ label: "Invoice write-offs at export", value: `${money(settlements.writeOffCents, invoice.currency)} ${invoice.currency}` }] : []),
    ...(settlements.refundCents ? [{ label: "Invoice refunds at export", value: `${money(settlements.refundCents, invoice.currency)} ${invoice.currency}` }] : []),
    { label: "Invoice balance at export", value: `${money(total - paid, invoice.currency)} ${invoice.currency}` },
  ];
  return {
    documentKind: "receipt",
    documentTemplate: cleanInvoiceTemplate(invoice.documentTemplate),
    // Payment keys are stable and retained in the document even when dates/amounts coincide.
    number: `RCPT-${invoice.number}-${payment.key}`,
    issueDate: payment.date, dueDate: payment.date, terms: "due_on_receipt", reference: invoice.number,
    currency: invoice.currency, billToName: invoice.billToName, billToEmail: invoice.billToEmail, billToAddress: invoice.billToAddress,
    lines: [{ key: payment.key, item: `Payment for invoice ${invoice.number}`, quantity: 1, unit: "payment", unitPriceCents: payment.amountCents }],
    documentDetails: details, memo: payment.note, status: "received",
  };
}

/** Work orders are available at intake, independently of whether a repair has been invoiced. */
export function repairWorkOrderDocument(job: RepairJob, template?: InvoiceTemplate, operationsDetails: Array<{ label: string; value: string }> = []): InvoiceDocumentData {
  return {
    documentKind: "work_order", documentTemplate: cleanInvoiceTemplate(template), number: job.number,
    issueDate: job.receivedDate, dueDate: job.targetDate ?? job.receivedDate, terms: "custom",
    reference: job.invoice?.number, currency: job.currency,
    billToName: job.billToName, billToEmail: job.billToEmail, billToAddress: job.billToAddress,
    lines: job.lines.map((line) => ({ ...line })), memo: job.notes,
    documentDetails: [
      { label: "Repair status", value: REPAIR_STATUS_LABEL[job.status] },
      { label: "Equipment / item", value: job.asset },
      ...(job.serialNumber ? [{ label: "Serial number", value: job.serialNumber }] : []),
      { label: "Received", value: job.receivedDate },
      ...(job.targetDate ? [{ label: "Target date", value: job.targetDate }] : []),
      { label: "Problem reported", value: job.problem },
      ...(job.invoice ? [{ label: "Linked invoice", value: job.invoice.number }] : []),
      ...operationsDetails,
    ],
    status: job.status,
  };
}

export function defaultDocumentTemplate(workspace: Pick<InvoiceWorkspace, "settings" | "templates">): InvoiceTemplate {
  const active = workspace.templates?.filter((template) => template.active) ?? [];
  return cleanInvoiceTemplate(active.find((template) => template._id === workspace.settings.defaultTemplateId)?.config ?? active[0]?.config);
}

export function quoteDocument(quote: Pick<BillingQuote, "number" | "revision" | "status" | "fields">): InvoiceDocumentData {
  const fields = quote.fields;
  return { ...fields, documentKind: "quote", number: quote.number, dueDate: fields.validUntil, terms: "custom", documentDetails: [{ label: "Revision", value: String(quote.revision) }, { label: "Valid until", value: fields.validUntil }, { label: "Quote status", value: quote.status }], documentExtras: { termsAndConditions: fields.termsAndConditions } };
}

export function statementDocument(statement: CustomerStatement): InvoiceDocumentData {
  const amount = (cents: number) => money(cents, statement.currency);
  return { documentKind: "statement", documentTemplate: statement.documentTemplate, number: `STMT-${statement.to}`, issueDate: statement.generatedAtISO.slice(0, 10), dueDate: statement.to, terms: "custom", currency: statement.currency, billToName: statement.customerName, billToEmail: statement.customerEmail, billToAddress: statement.customerAddress, lines: [],
    documentDetails: [{ label: "Statement period", value: `${statement.from} to ${statement.to}` }, { label: "Currency", value: statement.currency }], documentFinancials: { totalCents: statement.closingCents, balanceCents: statement.closingCents },
    documentTable: { columns: [{ label: "Date", width: 12 }, { label: "Type", width: 13 }, { label: "Reference / description", width: 33 }, { label: "Charges", width: 14, align: "right" }, { label: "Credits", width: 14, align: "right" }, { label: "Balance", width: 14, align: "right" }], rows: statement.rows.map((row) => [row.date, row.kind, `${row.reference}\n${row.description}`, row.chargeCents ? amount(row.chargeCents) : "—", row.creditCents ? amount(row.creditCents) : "—", amount(row.balanceCents)]) },
    documentSummary: [{ label: "Opening balance", value: amount(statement.openingCents) }, { label: "Charges / refunds", value: amount(statement.chargeCents) }, { label: "Payments / credits", value: amount(statement.creditCents) }, { label: `Closing balance ${statement.currency}`, value: amount(statement.closingCents), strong: true }],
  };
}
