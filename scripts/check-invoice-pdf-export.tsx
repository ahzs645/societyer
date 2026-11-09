import React from "react";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { renderDocument } from "@formepdf/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { InvoicePdfDocument } from "../src/features/invoicing/InvoicePdfDocument";
import { decorateDocumentPdf } from "../src/features/invoicing/documentPdfDecoration";
import { DEFAULT_INVOICE_TEMPLATE, resolveDocumentDesign } from "../shared/invoiceCommerce";
import { assessTax, defaultTaxAnswers, taxAssessmentRates } from "../shared/tax";
import { captureIssuerTaxRegistrations } from "../shared/invoiceTaxRegistrations";
import type { InvoiceDocumentData } from "../src/features/invoicing/InvoiceDocument";
import { invoicePdfExportView, TEMPLATE_PDF_EXPORT, SIMPLIFIED_PDF_EXPORT, type InvoicePdfExportOptions } from "../src/features/invoicing/invoicePdfExportOptions";

const date = "2026-11-09";
const taxAssessment = assessTax({ ...defaultTaxAnswers("transaction", date), jurisdictionCode: "CA-BC", itemCategory: "general_services", sellerKind: "business", scopeConfirmed: "yes", federalException: "none", gstRegistration: "registered", provincialException: "category", pstRegistration: "unknown", customerRelief: "none" }, true);
assert.equal(taxAssessment.confirmed, true);
const design = resolveDocumentDesign(DEFAULT_INVOICE_TEMPLATE);
design.footer.pageNumbers = true;
const invoice: InvoiceDocumentData = {
  number: "INV-EXPORT", issueDate: date, dueDate: "2026-11-24", terms: "net_15", currency: "CAD", billToName: "Synthetic customer", lifecycle: "issued", issuedAtISO: `${date}T12:00:00Z`,
  lines: [{ key: "build", item: "Website design", description: "A fixed-price website build", quantity: 1, unitPriceCents: 700000, taxMode: "inclusive", taxAssessment, ...taxAssessmentRates(taxAssessment) }],
  documentTemplate: { ...DEFAULT_INVOICE_TEMPLATE, design },
  paymentMethods: [{ id: "eft", type: "eft", name: "EFT / bank transfer", details: "Institution number: 123\nTransit / branch number: 00001\nAccount number: 12345678\nCurrency: CAD" }],
};
invoice.issuerTaxRegistrationsSnapshot = captureIssuerTaxRegistrations([{ kind: "gst", number: "123456789RT0001", status: "active" }], invoice.lines, date, `${date}T12:00:00Z`);
const before = JSON.stringify(invoice);
const fonts = await Promise.all([{ family: "Invoice", file: "NotoSerif-Regular.ttf" }, { family: "Invoice", file: "NotoSerif-Bold.ttf", fontWeight: "bold" as const }].map(async ({ file, ...font }) => ({ ...font, src: new Uint8Array(await readFile(`src/assets/pdf-fonts/${file}`)) })));
const organization = { name: "Synthetic seller" };
async function exported(source: InvoiceDocumentData, options?: InvoicePdfExportOptions) {
  const view = invoicePdfExportView(source, options);
  const raw = await renderDocument(<InvoicePdfDocument invoice={source} organization={organization} fonts={fonts} exportOptions={options} />);
  const bytes = await decorateDocumentPdf(raw, { config: view.documentTemplate!, fonts, pageNumbers: options?.pageNumbers });
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) pages.push((await (await pdf.getPage(i)).getTextContent()).items.map((item: any) => item.str ?? "").join(" ").replace(/\s+/g, " "));
  await pdf.destroy();
  return { bytes, pages, text: pages.join(" ") };
}
const original = await exported(invoice);
for (const value of ["Quantity", "Rate (CAD)", "Tax treatment", "Currency: CAD", "Page 1 of 1"]) assert.ok(original.text.includes(value), `saved template retains ${value}`);
const simplified = await exported(invoice, SIMPLIFIED_PDF_EXPORT);
assert.equal(simplified.pages.length, 1);
for (const value of ["Quantity", "Rate (CAD)", "Tax treatment", "Currency: CAD", "Page 1 of 1", "PST not subject"]) assert.ok(!simplified.text.includes(value), `simplified excludes ${value}`);
for (const value of ["Amounts include tax", "$6,666.67", "$333.33", "$7,000.00", "GST 5%", "123456789RT0001", "00001", "12345678"]) assert.ok(simplified.text.includes(value), `simplified retains ${value}`);
assert.equal(JSON.stringify(invoice), before, "export leaves saved data and payment details untouched");
assert.equal(invoicePdfExportView(invoice), invoice, "default exports preserve the original projection");
const explicit = await exported(invoice, { ...SIMPLIFIED_PDF_EXPORT, quantity: "show", rate: "show", tax: "show", taxTreatmentNotes: true, eftCurrency: true, pageNumbers: "always" });
for (const value of ["Quantity", "Rate (CAD)", "Tax treatment", "Currency: CAD", "Page 1 of 1"]) assert.ok(explicit.text.includes(value), `each option can restore ${value}`);
const foreign = invoicePdfExportView({ ...invoice, paymentMethods: [{ ...invoice.paymentMethods![0], details: "Currency: USD\nAccount number: 12345678" }] }, SIMPLIFIED_PDF_EXPORT);
assert.ok(foreign.paymentMethods![0].details.includes("Currency: USD"), "different EFT currency remains explicit");
const many = { ...invoice, lines: Array.from({ length: 80 }, (_, index) => ({ key: `line-${index}`, item: `Hourly service ${index + 1}`, quantity: index + 1, unit: "hour", unitPriceCents: 10000, taxLabel: "GST", taxRatePercent: index % 2 ? 0 : 5 })) };
const multipage = await exported(many, SIMPLIFIED_PDF_EXPORT);
assert.ok(multipage.pages.length > 1);
assert.ok(multipage.text.includes("Quantity") && multipage.text.includes("Rate (CAD)") && multipage.text.includes("Tax"), "automatic keeps meaningful quantity/rate and mixed tax columns");
for (let index = 0; index < multipage.pages.length; index++) assert.ok(multipage.pages[index].includes(`Page ${index + 1} of ${multipage.pages.length}`), "page count uses the actual exported pages");
const unnumbered = await exported(many, { ...TEMPLATE_PDF_EXPORT, pageNumbers: "off" });
assert.ok(!/Page \d+ of \d+/.test(unnumbered.text), "numbering can be disabled on multi-page exports");
const hidden = invoicePdfExportView(invoice, { ...TEMPLATE_PDF_EXPORT, quantity: "hide", rate: "show", tax: "hide" });
assert.equal(hidden.documentTemplate!.design!.table.columns.find(column => column.key === "quantity")!.visible, false);
assert.equal(hidden.documentTemplate!.design!.table.columns.find(column => column.key === "rate")!.visible, true);
await mkdir("test-results/invoice-pdf-export", { recursive: true });
await Promise.all([writeFile("test-results/invoice-pdf-export/simplified.pdf", simplified.bytes), writeFile("test-results/invoice-pdf-export/template.pdf", original.bytes), writeFile("test-results/invoice-pdf-export/multipage.pdf", multipage.bytes)]);
console.log("PASS PDF export options: unchanged template defaults, independent controls, fixed-price simplification, mixed taxes, GST totals/registration, same/foreign EFT currency, real page counts and immutable invoice data.");
