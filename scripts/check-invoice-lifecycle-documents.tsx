import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderDocument, renderDocumentWithLayout, type ElementInfo } from "@formepdf/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  DEFAULT_INVOICE_TEMPLATE, cleanInvoiceTemplate, resolveDocumentAdvanced,
  resolveDocumentDesign, type InvoiceTemplate,
} from "../shared/invoiceCommerce";
import { deriveInvoiceStatus } from "../shared/invoicing";
import type { InvoiceDocumentData } from "../src/features/invoicing/InvoiceDocument";
import type { InvoiceOrganization } from "../src/features/invoicing/types";
import { paymentReceiptDocument } from "../src/features/invoicing/billingDocuments";
import { documentPresentation } from "../src/features/invoicing/documentPresentation";

// Exercise the production print component in Node; CSS layout is a browser concern.
register(`data:text/javascript,${encodeURIComponent('export async function load(url, context, next) { if (url.endsWith(".css")) return {format:"module",shortCircuit:true,source:"export default {}"}; return next(url, context); }')}`, import.meta.url);
const { InvoiceDocument } = await import("../src/features/invoicing/InvoiceDocument");
const { InvoicePdfDocument } = await import("../src/features/invoicing/InvoicePdfDocument");
const { decorateDocumentPdf } = await import("../src/features/invoicing/documentPdfDecoration");

const fonts = await Promise.all([
  { family: "Invoice", file: "NotoSerif-Regular.ttf" },
  { family: "Invoice", file: "NotoSerif-Bold.ttf", fontWeight: "bold" as const },
].map(async ({ file, ...font }) => ({
  ...font, src: new Uint8Array(await readFile(new URL(`../src/assets/pdf-fonts/${file}`, import.meta.url))),
})));

function template(visible: boolean, stampText: string, absoluteIssuer = false): InvoiceTemplate {
  const design = resolveDocumentDesign(DEFAULT_INVOICE_TEMPLATE);
  const advanced = resolveDocumentAdvanced(design);
  advanced.visibility.statusStamp = visible;
  advanced.stamp.text = stampText;
  // Include all issuer fields in both the normal and positioned address paths.
  advanced.addresses.organization.format = "{{name}}\n{{address}}\n{{email}}\n{{registrationNumber}}\n{{taxNumber}}";
  if (absoluteIssuer) {
    advanced.addresses.organization = {
      ...advanced.addresses.organization, placement: "absolute", x: 42, y: 530, width: 310,
    };
  }
  design.advanced = advanced;
  return cleanInvoiceTemplate({ ...DEFAULT_INVOICE_TEMPLATE, showLogo: false, design });
}

const currentOrganization: InvoiceOrganization = {
  name: "Current company identity", address: "999 Current Road", email: "current@example.test",
  registrationNumber: "CURRENT-REGISTRATION", gstNumber: "999999999RT0001",
  taxRegistrations: [{ taxId: "CA-GST", label: "GST/HST", number: "999999999RT0001" }],
  logoUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR3sAAAAASUVORK5CYII=",
};
const originalIdentity = {
  name: "Original issuer identity", address: "100 Original Street", email: "original@example.test",
  registrationNumber: "ORIGINAL-REGISTRATION",
};
const originalTax = {
  capturedAtISO: "2026-11-08T12:00:00.000Z", effectiveDate: "2026-11-08",
  registrations: [{ taxId: "CA-GST", label: "GST/HST", number: "123456789RT0001" }],
};
const base: InvoiceDocumentData = {
  number: "INV-LIFE-0001", issueDate: "2026-11-08", dueDate: "2026-12-08", terms: "net_30",
  currency: "CAD", billToName: "Synthetic customer", billToAddress: "200 Customer Lane",
  lines: [{ key: "service", item: "Planning service", quantity: 1, unitPriceCents: 10000, taxLabel: "GST", taxRatePercent: 5 }],
  paymentInstructions: "Use the saved payment reference", payments: [],
};

type Output = { html: string; pages: string[]; text: string; author?: unknown; imageCount: number };
function countImages(nodes: ElementInfo[]): number {
  return nodes.reduce((total, node) => total + (node.nodeType === "Image" ? 1 : 0) + countImages(node.children ?? []), 0);
}
async function render(invoice: InvoiceDocumentData): Promise<Output> {
  const html = renderToStaticMarkup(createElement(InvoiceDocument, { invoice, organization: currentOrganization }));
  const raw = await renderDocumentWithLayout(createElement(InvoicePdfDocument, { invoice, organization: currentOrganization, fonts }));
  // Decoration is essential: the DRAFT watermark and absolute addresses are
  // added after Forme renders the main PDF, so testing the raw PDF misses them.
  const bytes = await decorateDocumentPdf(raw.pdf, {
    config: cleanInvoiceTemplate(invoice.documentTemplate), fonts, layout: raw.layout,
    engine: { renderDocument, renderDocumentWithLayout },
    content: { invoice, organization: currentOrganization },
  });
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
  try {
    const pages: string[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " "));
    }
    const metadata = await pdf.getMetadata();
    return {
      html, pages, text: pages.join(" "), author: (metadata.info as { Author?: unknown }).Author,
      imageCount: raw.layout.pages.reduce((count, page) => count + countImages(page.elements), 0),
    };
  } finally {
    await pdf.destroy();
  }
}

function contains(output: Output, expected: string, reason: string) {
  for (const [format, text] of [["HTML", output.html], ["PDF", output.text]]) {
    assert.ok(text.includes(expected), `${reason}: ${format} contains ${expected}`);
  }
}
function excludes(output: Output, forbidden: string, reason: string) {
  for (const [format, text] of [["HTML", output.html], ["PDF", output.text]]) {
    assert.ok(!text.includes(forbidden), `${reason}: ${format} excludes ${forbidden}`);
  }
}
function excludesCurrentIdentity(output: Output) {
  for (const value of [currentOrganization.name, currentOrganization.address!, currentOrganization.email!, currentOrganization.registrationNumber!, "999999999RT0001"]) {
    excludes(output, value!, "Today's organization settings cannot replace issued details");
  }
}

// Draft identification cannot be hidden or replaced with a misleading template stamp.
for (const visible of [false, true]) {
  const draft: InvoiceDocumentData = {
    ...base, lifecycle: "draft", status: "draft", documentTemplate: template(visible, "APPROVED"),
    ...(visible ? {} : { lines: Array.from({ length: 48 }, (_, index) => ({ ...base.lines[0], key: `line-${index}`, item: `Planning service ${index + 1}` })) }),
  };
  const output = await render(draft);
  contains(output, "DRAFT", "An editable invoice remains a draft");
  excludes(output, "APPROVED", "Custom stamp text cannot disguise a draft");
  if (!visible) assert.ok(output.pages.length > 1, "The hidden-stamp fixture exercises a multipage PDF");
  assert.ok(output.pages.every(text => /\bDRAFT\b/.test(text)), "Every page of a draft PDF carries its draft identity");
}

const issued: InvoiceDocumentData = {
  ...base, lifecycle: "issued", status: "issued", issuedAtISO: "2026-11-08T12:00:00.000Z",
  issuerSnapshot: originalIdentity, issuerTaxRegistrationsSnapshot: originalTax,
  documentTemplate: template(true, " dRaFt "),
};
assert.equal(deriveInvoiceStatus({ status: "issued", totalCents: 10500, dueDate: issued.dueDate, payments: [] }, "2026-11-08"), "issued", "An issued unpaid invoice is not reported as sent or paid");
for (const absoluteIssuer of [false, true]) {
  const output = await render({ ...issued, documentTemplate: template(true, " dRaFt ", absoluteIssuer) });
  contains(output, "ISSUED", "A finalized invoice has its real document state");
  excludes(output, "DRAFT", "Finalization removes a saved custom DRAFT stamp");
  excludes(output, "dRaFt", "Finalization also removes case-varied custom draft text");
  excludes(output, "SENT", "Downloading an issued invoice does not claim delivery");
  for (const value of [...Object.values(originalIdentity), "123456789RT0001", "$105.00"]) {
    contains(output, value, "The issued document retains its original issuer, GST account and amount");
  }
  excludesCurrentIdentity(output);
  assert.equal(output.author, originalIdentity.name, "PDF author metadata also preserves the original issuer");
}

// Missing historical fields are intentional absence, not an invitation to read live settings.
const sparse: InvoiceDocumentData = {
  ...issued, issuerSnapshot: { name: "Historic minimal issuer" },
  issuerTaxRegistrationsSnapshot: { ...originalTax, registrations: [] },
  documentTemplate: { ...template(false, "DRAFT", true), showLogo: true },
};
const sparseOutput = await render(sparse);
contains(sparseOutput, "Historic minimal issuer", "A sparse saved issuer remains usable");
excludesCurrentIdentity(sparseOutput);
excludes(sparseOutput, "123456789RT0001", "An explicitly empty saved registration list stays empty");
excludes(sparseOutput, "DRAFT", "Optional stamps remain optional after finalization");
assert.ok(!sparseOutput.html.includes("<img"), "A historical issuer without a logo does not inherit the current logo in HTML");
assert.equal(sparseOutput.imageCount, 0, "A historical issuer without a logo does not inherit the current logo in the PDF layout");

// Historical issued records without a tax snapshot must not borrow today's GST account.
const legacyOutput = await render({ ...issued, issuerTaxRegistrationsSnapshot: undefined });
excludes(legacyOutput, "999999999RT0001", "A missing historic tax snapshot does not invent an original account");

const context = { transactions: [], ledger: { accounts: { deposit: [] } } } as Parameters<typeof paymentReceiptDocument>[2];
const unpaidSource = { ...issued, lifecycle: "issued" as const, status: "issued" as const, payments: [] };
assert.throws(() => paymentReceiptDocument(unpaidSource, "missing", context), /no longer recorded/, "Finalizing an unpaid invoice cannot generate a payment receipt");
const partial = {
  ...issued, lifecycle: "issued" as const, status: "partially_paid" as const,
  payments: [{ key: "recorded-cash", date: "2026-11-09", amountCents: 2500, method: "cash" }],
};
assert.equal(documentPresentation(partial).balance, 8000, "A recorded partial payment reduces the balance by its actual amount");
const partialOutput = await render(partial);
contains(partialOutput, "$80.00", "The issued invoice displays the remaining balance");
excludes(partialOutput, "DRAFT", "A payment on an issued invoice does not restore draft identity");
const receipt = paymentReceiptDocument(partial, "recorded-cash", context);
assert.deepEqual(receipt.issuerSnapshot, originalIdentity, "The receipt carries its invoice's issuer identity");
assert.deepEqual(receipt.issuerTaxRegistrationsSnapshot, originalTax, "The receipt carries its invoice's original registration snapshot");
assert.equal(documentPresentation(receipt).totals.totalCents, 2500, "A receipt acknowledges the actual payment rather than the full invoice");
const receiptOutput = await render(receipt);
for (const value of ["$25.00", "recorded-cash", originalIdentity.name, originalIdentity.email, "123456789RT0001"]) {
  contains(receiptOutput, value, "An externally unsent issued invoice still supports a genuine payment receipt");
}
excludesCurrentIdentity(receiptOutput);
excludes(receiptOutput, "DRAFT", "The payment receipt does not inherit the invoice template's draft stamp");
for (const lifecycle of ["draft", "void"] as const) {
  assert.throws(() => paymentReceiptDocument({ ...partial, lifecycle, status: lifecycle }, "recorded-cash", context), /issued invoices/, "Draft or void documents cannot issue payment receipts");
}

console.log("PASS invoice lifecycle documents: real HTML and decorated PDFs preserve draft identity on every page, remove DRAFT on finalization, retain complete/sparse issuer and GST snapshots including positioned addresses and PDF metadata, and support issued partial-payment receipts without claiming delivery.");
