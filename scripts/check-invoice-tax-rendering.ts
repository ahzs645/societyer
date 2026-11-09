import assert from "node:assert/strict";
import { register } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderDocument } from "@formepdf/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DEFAULT_INVOICE_TEMPLATE, cleanInvoiceTemplate, resolveDocumentDesign } from "../shared/invoiceCommerce";
import { assessTax, defaultTaxAnswers, taxAssessmentRates } from "../shared/tax";
import { captureIssuerTaxRegistrations } from "../shared/invoiceTaxRegistrations";
import { paymentReceiptDocument } from "../src/features/invoicing/billingDocuments";

// Exercise the real HTML component in Node; CSS is covered by browser tests.
register(`data:text/javascript,${encodeURIComponent('export async function load(url, context, next) { if (url.endsWith(".css")) return {format:"module",shortCircuit:true,source:"export default {}"}; return next(url, context); }')}`, import.meta.url);
const { InvoiceDocument } = await import("../src/features/invoicing/InvoiceDocument");
const { InvoicePdfDocument } = await import("../src/features/invoicing/InvoicePdfDocument");

// The builder constructs its own document projection. Guard that integration
// separately: direct renderer fixtures cannot catch a dropped saved snapshot.
const builderSource = await readFile(new URL("../src/features/invoicing/InvoiceBuilder.tsx", import.meta.url), "utf8");
const builderPreview = builderSource.match(/const draftPreviewData = \{([\s\S]*?)\n  \};/)?.[1];
assert.ok(builderPreview, "the builder document projection is present");
assert.match(builderPreview, /issuerTaxRegistrationsSnapshot:\s*invoice\?\.issuerTaxRegistrationsSnapshot\s*[,\n]/, "builder preview, download and print retain the saved issuer registrations instead of falling back to current organization data");
assert.match(builderSource, /const previewData = invoice && documentLocked \? invoice : draftPreviewData/, "reactively finalized and prepared previews use the saved record, not stale local draft edits");
assert.match(builderSource, /client\.query\(api\.invoices\.document, \{ id: invoice\._id \}\)/, "finalized PDF download fetches the saved document");
assert.match(builderSource, /downloadInvoicePdf\(document,/, "PDF download uses the canonical document projection");
assert.match(builderSource, /<InvoicePdfPreview invoice=\{previewData\}/, "PDF preview uses the guarded projection");
assert.match(builderSource, /<InvoicePrintPortal invoice=\{previewData\}/, "printing uses the guarded projection");

const date = "2026-11-06";
const answers = { ...defaultTaxAnswers("transaction", date), jurisdictionCode: "CA-BC", itemCategory: "goods", sellerKind: "business", scopeConfirmed: "yes", federalException: "none", gstRegistration: "registered", provincialException: "category", pstRegistration: "registered", customerRelief: "none" };
const standard = assessTax(answers, true);
const relief = assessTax({ ...answers, customerRelief: "pst", customerEvidence: "PRIVATE CUSTOMER EVIDENCE", pstReliefDocumentation: "pst_number", purchaserPstNumber: "PST-8765-4321", pstReliefConditions: "confirmed" }, true);
const exempt = assessTax({ ...answers, federalException: "zero_rated", federalEvidence: "PRIVATE FEDERAL EVIDENCE", provincialException: "exempt", provincialEvidence: "PRIVATE PROVINCIAL EVIDENCE" }, true);
for (const assessment of [standard, relief, exempt]) assert.equal(assessment.confirmed, true);
const lines = [standard, relief, exempt].map((taxAssessment, index) => ({ key: `line-${index}`, item: ["Equipment", "Resale supply", "Reviewed exception"][index], quantity: 1, unitPriceCents: 10000, taxAssessment, ...taxAssessmentRates(taxAssessment) }));
const snapshot = captureIssuerTaxRegistrations([
  { kind: "gst", number: "123456789RT0001", status: "active" },
  { kind: "pst", number: "PST-1234-5678", jurisdiction: "CA-BC", status: "active" },
], lines, date, `${date}T12:00:00Z`);
const design = resolveDocumentDesign(DEFAULT_INVOICE_TEMPLATE);
design.fields.taxRegistration = false;
design.totals.showTax = false;
design.table.columns = design.table.columns.map(column => ({ ...column, visible: column.key === "tax" ? false : column.visible }));
const invoice = { number: "INV-TAX-REGRESSION", status: "sent", lifecycle: "sent" as const, issuerTaxRegistrationsSnapshot: snapshot, issueDate: date, dueDate: "2026-12-06", terms: "net_30", currency: "CAD", billToName: "Synthetic buyer", lines, documentTemplate: cleanInvoiceTemplate({ ...DEFAULT_INVOICE_TEMPLATE, design }) };
const organization = { name: "Synthetic seller", gstNumber: "999999999RT0001", pstNumber: "PST-9999-9999" };
function assertPublicTaxDetails(text: string) {
  for (const expected of ["123456789RT0001", "PST-1234-5678", "PST-8765-4321", "Tax treatment", "zero-rated", "exempt"]) {
    assert.ok(text.includes(expected), `Public invoice includes ${expected}`);
  }
  assert.ok(text.includes("$7.00"), "separate PST amount survives hidden tax template settings");
  assert.ok(!text.includes("999999999RT0001") && !text.includes("PST-9999-9999"), "current organization numbers cannot replace the issue snapshot");
  assert.ok(!text.includes("PRIVATE"), "internal evidence never appears in public output");
}
const html = renderToStaticMarkup(createElement(InvoiceDocument, { invoice, organization }));
assertPublicTaxDetails(html);
const legacyHtml = renderToStaticMarkup(createElement(InvoiceDocument, { invoice: { ...invoice, issuerTaxRegistrationsSnapshot: undefined }, organization }));
assert.ok(!legacyHtml.includes("999999999RT0001") && !legacyHtml.includes("PST-9999-9999"));
const fonts = await Promise.all([
  { family: "Invoice", file: "NotoSerif-Regular.ttf" },
  { family: "Invoice", file: "NotoSerif-Bold.ttf", fontWeight: "bold" as const },
].map(async ({ file, ...font }) => ({ ...font, src: new Uint8Array(await readFile(`src/assets/pdf-fonts/${file}`)) })));
const bytes = await renderDocument(createElement(InvoicePdfDocument, { invoice, organization, fonts }));
if (process.env.SOCIETYER_TAX_PREVIEW_PDF) await writeFile(process.env.SOCIETYER_TAX_PREVIEW_PDF, bytes);
const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
const pages: string[] = [];
for (let page = 1; page <= pdf.numPages; page++) pages.push((await (await pdf.getPage(page)).getTextContent()).items.map((item: any) => item.str ?? "").join(" "));
assertPublicTaxDetails(pages.join(" "));
await pdf.destroy();
const receipt = paymentReceiptDocument({ ...invoice, status: "partially_paid", payments: [{ key: "payment", date, method: "cash", amountCents: 1000 }] } as any, "payment", { transactions: [], ledger: { accounts: { deposit: [] } } } as any);
assert.deepEqual(receipt.issuerTaxRegistrationsSnapshot, snapshot);
console.log("PASS actual HTML/PDF tax output: issuer snapshots, forced seller registration and separate PST amount, purchaser exemption number, public treatment, private evidence exclusion, legacy behavior and receipt propagation.");
