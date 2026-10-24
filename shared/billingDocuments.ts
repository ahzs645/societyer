import { computeInvoiceTotals, isCalendarDate, partyKey, type InvoiceLine, type InvoiceDiscount } from "./invoicing";
import type { InvoiceTemplate } from "./invoiceCommerce";
import type { InvoiceMoneyOptions } from "./invoiceMoney";

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "declined", "expired"] as const;
export type QuoteStatus = typeof QUOTE_STATUSES[number];
export type QuoteFields = {
  partyKind: "member" | "organization" | "custom"; memberId?: string; counterpartyId?: string;
  billToName: string; billToEmail?: string; billToAddress?: string; shipToName?: string; shipToAddress?: string;
  issueDate: string; validUntil: string; currency: string; lines: InvoiceLine[]; discount?: InvoiceDiscount;
  memo?: string; termsAndConditions?: string; documentTemplate: InvoiceTemplate; money?: InvoiceMoneyOptions;
};
export type BillingQuote = { _id: string; societyId: string; number: string; revision: number; status: QuoteStatus; fields: QuoteFields; totalCents: number; convertedInvoiceId?: string; createdAtISO: string; updatedAtISO: string; timeline: Array<{ atISO: string; actorUserId: string; action: string; note?: string }> };
export type CustomerStatementRow = { date: string; kind: string; reference: string; description: string; chargeCents: number; creditCents: number; balanceCents: number; invoiceId?: string };
export type CustomerStatement = { customerKey: string; customerName: string; customerEmail?: string; customerAddress?: string; currency: string; from: string; to: string; openingCents: number; chargeCents: number; creditCents: number; closingCents: number; rows: CustomerStatementRow[]; generatedAtISO: string; documentTemplate?: InvoiceTemplate };

/** Reconstructs dated account movements from source invoices and signed settlement records. */
export function buildCustomerStatement(invoices: Array<Record<string, any>>, args: { customerKey: string; currency: string; from: string; to: string; generatedAtISO?: string }): CustomerStatement {
  if (!isCalendarDate(args.from) || !isCalendarDate(args.to) || args.from > args.to) throw new Error("Choose a valid statement date range.");
  const customerInvoices = invoices.filter((invoice) => invoice.currency === args.currency && partyKey(invoice as any) === args.customerKey);
  const last = [...customerInvoices].sort((a, b) => String(b.issueDate).localeCompare(String(a.issueDate)))[0];
  if (!last) throw new Error("No invoices match this customer and currency.");
  const movements: Array<Omit<CustomerStatementRow, "balanceCents"> & { order: number; id: string }> = [];
  for (const invoice of customerInvoices) {
    const lifecycle = invoice.lifecycle ?? invoice.status;
    if (lifecycle === "draft") continue;
    const total = computeInvoiceTotals(invoice.lines ?? [], invoice.discount, invoice.money).totalCents;
    // Voids have no payments. Keep the original charge and an explicit dated reversal.
    const reversals = (invoice.timeline ?? []).filter((event: any) => ["voided", "restored"].includes(event.kind) && isCalendarDate(String(event.atISO).slice(0, 10)));
    const voidDate = invoice.voidedAtISO?.slice(0, 10);
    if (lifecycle === "void" && !voidDate && !reversals.length) continue;
    movements.push({ id: `${invoice._id}:invoice`, order: 0, date: invoice.issueDate, kind: "Invoice", reference: invoice.number, description: invoice.memo || "Invoice issued", chargeCents: total, creditCents: 0, invoiceId: invoice._id });
    if (reversals.length) for (const [index, reversal] of reversals.entries()) movements.push({ id: `${invoice._id}:lifecycle:${index}`, order: 2, date: reversal.atISO.slice(0, 10), kind: reversal.kind === "voided" ? "Void" : "Restored invoice", reference: invoice.number, description: reversal.label || reversal.kind, chargeCents: reversal.kind === "restored" ? total : 0, creditCents: reversal.kind === "voided" ? total : 0, invoiceId: invoice._id });
    else if (lifecycle === "void") movements.push({ id: `${invoice._id}:void`, order: 2, date: voidDate, kind: "Void", reference: invoice.number, description: invoice.voidReason || "Invoice voided", chargeCents: 0, creditCents: total, invoiceId: invoice._id });
    for (const payment of invoice.payments ?? []) {
      const kind = payment.kind ?? "payment";
      const amount = Number(payment.amountCents);
      if (!Number.isSafeInteger(amount) || !isCalendarDate(payment.date)) throw new Error("A settlement record has an invalid date or amount.");
      movements.push({ id: `${invoice._id}:${payment.key}`, order: 1, date: payment.date, kind: kind === "credit" ? "Credit note" : kind === "write_off" ? "Write-off" : kind === "refund" ? "Refund" : "Payment", reference: payment.reference || invoice.number, description: payment.note || `${kind === "refund" ? "Refund on" : "Applied to"} ${invoice.number}`, chargeCents: amount < 0 ? -amount : 0, creditCents: amount > 0 ? amount : 0, invoiceId: invoice._id });
      if (payment.reversedDate) movements.push({ id: `${invoice._id}:${payment.key}:reversed`, order: 2, date: payment.reversedDate, kind: "Settlement reversed", reference: payment.reference || invoice.number, description: `Reversal of ${kind.replace("_", " ")} on ${invoice.number}`, chargeCents: amount > 0 ? amount : 0, creditCents: amount < 0 ? -amount : 0, invoiceId: invoice._id });
    }
  }
  movements.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.id.localeCompare(b.id));
  const openingCents = movements.filter((movement) => movement.date < args.from).reduce((sum, movement) => sum + movement.chargeCents - movement.creditCents, 0);
  let balanceCents = openingCents;
  const rows = movements.filter((movement) => movement.date >= args.from && movement.date <= args.to).map(({ id: _id, order: _order, ...movement }) => { balanceCents += movement.chargeCents - movement.creditCents; return { ...movement, balanceCents }; });
  return { customerKey: args.customerKey, customerName: last.billToName, customerEmail: last.billToEmail, customerAddress: last.billToAddress, currency: args.currency, from: args.from, to: args.to, openingCents, chargeCents: rows.reduce((sum, row) => sum + row.chargeCents, 0), creditCents: rows.reduce((sum, row) => sum + row.creditCents, 0), closingCents: balanceCents, rows, generatedAtISO: args.generatedAtISO ?? new Date().toISOString() };
}
