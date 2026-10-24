import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderDocument } from "@formepdf/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { defaultDocumentTemplate, paymentReceiptDocument, repairWorkOrderDocument } from "../src/features/invoicing/billingDocuments";
import { InvoicePdfDocument } from "../src/features/invoicing/InvoicePdfDocument";
import { cleanInvoiceTemplate, DEFAULT_INVOICE_TEMPLATE } from "../shared/invoiceCommerce";
import { computeInvoiceTotals } from "../shared/invoicing";
import type { InvoiceRow, InvoiceWorkspace, RepairJob } from "../src/features/invoicing/types";

const invoice = {
  number: "INV-007", lifecycle: "sent", status: "partially_paid", currency: "CAD", billToName: "Repair customer",
  billToEmail: "customer@example.test", billToAddress: "1 Workshop Street", documentTemplate: { ...DEFAULT_INVOICE_TEMPLATE, name: "Issued design" },
  lines: [{ key: "service", item: "Repair", quantity: 1, unitPriceCents: 10000, taxRatePercent: 5, taxLabel: "GST" }],
  payments: [
    { key: "payment-a", date: "2026-10-21", amountCents: 3000, method: "e_transfer", reference: "ET-1", note: "Deposit for repair", financialTransactionId: "bank-a", depositAccountId: "deposit-a", journalEntryId: "journal-a" },
    { key: "payment-b", date: "2026-10-22", amountCents: 2000, method: "cash" },
  ],
} satisfies Pick<InvoiceRow, "number" | "lifecycle" | "status" | "currency" | "billToName" | "billToEmail" | "billToAddress" | "documentTemplate" | "lines" | "payments">;
const context = {
  transactions: [{ _id: "bank-a", date: "2026-10-21", amountCents: 3000, accountId: "bank-account", accountLabel: "Workshop chequing", description: "Customer repair deposit" }],
  ledger: { accounts: { deposit: [{ _id: "deposit-a", label: "Default deposit", accountType: "Bank" }] } },
} as Pick<InvoiceWorkspace, "transactions" | "ledger">;
const before = JSON.stringify(invoice);
const receipt = paymentReceiptDocument(invoice, "payment-a", context);
const details = new Map(receipt.documentDetails?.map((detail) => [detail.label, detail.value]));
assert.equal(receipt.documentKind, "receipt");
assert.equal(receipt.issueDate, "2026-10-21");
assert.equal(receipt.number, "RCPT-INV-007-payment-a");
assert.equal(receipt.lines.length, 1);
assert.equal(computeInvoiceTotals(receipt.lines).totalCents, 3000, "partial payment receipt never claims the whole invoice total");
assert.equal(receipt.payments, undefined, "receipt totals do not deduct the payment a second time");
assert.equal(details.get("Payment method"), "E-transfer");
assert.equal(details.get("Payment reference"), "ET-1");
assert.equal(details.get("Destination"), "Workshop chequing", "actual linked bank destination wins over fallback mapping");
assert.equal(details.get("Bank transaction"), "bank-a");
assert.equal(details.get("Payment journal entry"), "journal-a");
assert.match(details.get("Invoice balance at export")!, /55\.00/);
assert.equal(receipt.documentTemplate?.name, "Issued design");
assert.equal(receipt.memo, "Deposit for repair");
assert.equal(JSON.stringify(invoice), before, "adapter does not mutate payment or template history");
const cashReceipt = paymentReceiptDocument(invoice, "payment-b", context);
assert.equal(cashReceipt.documentDetails?.find((row) => row.label === "Destination")?.value, "Not recorded", "never invent a bank destination from defaults");
assert.equal(computeInvoiceTotals(cashReceipt.lines).totalCents, 2000);
assert.throws(() => paymentReceiptDocument({ ...invoice, lifecycle: "void", status: "void" }, "payment-a", context), /issued invoices/);
assert.throws(() => paymentReceiptDocument({ ...invoice, lifecycle: "draft", status: "draft" }, "payment-a", context), /issued invoices/);
assert.throws(() => paymentReceiptDocument(invoice, "removed-payment", context), /no longer recorded/);
assert.throws(() => paymentReceiptDocument({ ...invoice, payments: [{ ...invoice.payments[0], amountCents: 0 }] }, "payment-a", context), /positive/);

const job: RepairJob = {
  _id: "repair-1", number: "REP-001", partyKind: "custom", billToName: invoice.billToName, billToEmail: invoice.billToEmail,
  billToAddress: invoice.billToAddress, asset: "Bicycle", serialNumber: "FRAME-123", problem: "Brakes stick",
  notes: "Replace cable and road test", receivedDate: "2026-10-20", targetDate: "2026-10-24", currency: "CAD", status: "received",
  lines: invoice.lines, totalCents: 10500, timeline: [],
};
const workOrder = repairWorkOrderDocument(job, { ...DEFAULT_INVOICE_TEMPLATE, name: "Workshop design" });
assert.equal(workOrder.documentKind, "work_order");
assert.equal(workOrder.number, job.number);
assert.equal(workOrder.documentTemplate?.name, "Workshop design");
assert.equal(workOrder.memo, job.notes);
assert.equal(workOrder.payments, undefined);
assert.equal(workOrder.documentDetails?.find((detail) => detail.label === "Serial number")?.value, "FRAME-123");
assert.equal(workOrder.documentDetails?.find((detail) => detail.label === "Problem reported")?.value, job.problem);
assert.equal(workOrder.documentDetails?.find((detail) => detail.label === "Target date")?.value, job.targetDate);
assert.equal(workOrder.documentDetails?.find((detail) => detail.label === "Repair status")?.value, "Received");
assert.equal(job.invoice, undefined, "a saved intake can have a work order before billing");
workOrder.lines[0].item = "Changed copy";
assert.equal(job.lines[0].item, "Repair", "work-order editing cannot mutate repair charges");
const templates = [{ _id: "inactive", active: false, config: { ...DEFAULT_INVOICE_TEMPLATE, name: "Inactive" } }, { _id: "default", active: true, config: { ...DEFAULT_INVOICE_TEMPLATE, name: "Saved default" } }];
assert.equal(defaultDocumentTemplate({ settings: { defaultTemplateId: "default" } as InvoiceWorkspace["settings"], templates }).name, "Saved default");
assert.equal(defaultDocumentTemplate({ settings: { defaultTemplateId: "inactive" } as InvoiceWorkspace["settings"], templates }).name, "Saved default", "inactive templates are not used as new work-order defaults");
assert.deepEqual(defaultDocumentTemplate({ settings: {} as InvoiceWorkspace["settings"] }), cleanInvoiceTemplate());
const fonts = await Promise.all([
  { family: "InvoiceSerif", file: "NotoSerif-Regular.ttf" },
  { family: "InvoiceSerif", file: "NotoSerif-Bold.ttf", fontWeight: "bold" as const },
].map(async ({ file, ...font }) => ({ ...font, src: new Uint8Array(await readFile(`src/assets/pdf-fonts/${file}`)) })));
const renderedText = async (document: ReturnType<typeof paymentReceiptDocument>) => {
  const bytes = await renderDocument(createElement(InvoicePdfDocument, { invoice: document, organization: { name: "Workshop" }, fonts }));
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: true, disableFontFace: true }).promise;
  const pages: string[] = [];
  for (let page = 1; page <= pdf.numPages; page++) pages.push((await (await pdf.getPage(page)).getTextContent()).items.map((item: any) => item.str ?? "").join(" "));
  await pdf.destroy();
  return pages.join(" ");
};
const receiptText = await renderedText(receipt);
for (const expected of ["Payment receipt", "INV-007", "Payment for invoice INV-007", "Amount received", "$30.00", "$55.00", "E-transfer", "ET-1", "Workshop chequing", "bank-a"]) assert.ok(receiptText.includes(expected), `receipt PDF contains ${expected}`);
assert.ok(!/\bDue\b|\bTerms\b/.test(receiptText), "receipt PDF does not present the invoice due date or payment terms");
const orderText = await renderedText(repairWorkOrderDocument(job));
for (const expected of ["Work order", "REP-001", "Bicycle", "FRAME-123", "Brakes stick", "Replace cable and road test", "Target date", "2026-10-24"]) assert.ok(orderText.includes(expected), `work-order PDF contains ${expected}`);
assert.ok(!/\bDue\b|\bTerms\b/.test(orderText), "work-order PDF does not masquerade as an invoice");
console.log("Billing document checks passed: per-payment receipts, bank provenance, draft/void/stale guards, work-order intake, template selection and snapshot isolation.");
