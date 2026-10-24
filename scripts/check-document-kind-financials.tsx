import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createElement } from "react";
import type { FontRegistration } from "@formepdf/react";
import { renderDocumentWithLayout } from "@formepdf/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { cleanInvoiceTemplate, DEFAULT_INVOICE_TEMPLATE, resolveDocumentAdvanced, resolveDocumentDesign } from "../shared/invoiceCommerce";
import { documentTemplateSample } from "../src/features/invoicing/documentTemplateSamples";
import { documentPresentation } from "../src/features/invoicing/documentPresentation";
import { InvoicePdfDocument, documentPaymentStubHeight } from "../src/features/invoicing/InvoicePdfDocument";
import { statementDocument } from "../src/features/invoicing/billingDocuments";
import type { InvoiceDocumentData } from "../src/features/invoicing/InvoiceDocument";
import { renderSampleDocumentPdf } from "./lib/render-document-sample";

const design = resolveDocumentDesign(DEFAULT_INVOICE_TEMPLATE), advanced = resolveDocumentAdvanced(design);
advanced.visibility.headerBalance = true;
advanced.paymentStub.enabled = true;
advanced.amountWords.enabled = true;
design.advanced = advanced;
const config = cleanInvoiceTemplate({ ...DEFAULT_INVOICE_TEMPLATE, design });
const fonts: FontRegistration[] = await Promise.all([
  ["Invoice", "NotoSerif-Regular.ttf"], ["Invoice", "NotoSerif-Bold.ttf", "bold"],
  ["InvoiceSerif", "NotoSerif-Regular.ttf"], ["InvoiceSerif", "NotoSerif-Bold.ttf", "bold"],
].map(async ([family, file, weight]) => ({ family, src: new Uint8Array(await readFile(`src/assets/pdf-fonts/${file}`)), ...(weight ? { fontWeight: "bold" as const } : {}) })));
const organization = { name: "Sample organization" };
const samples = ["receipt", "quote", "work_order"].map((kind) => documentTemplateSample(config, kind as "receipt" | "quote" | "work_order", { today: "2026-10-23", currency: "CAD" }));
const statement = statementDocument({ customerKey: "sample", customerName: "Sample customer", currency: "CAD", from: "2026-10-01", to: "2026-10-23", generatedAtISO: "2026-10-23T12:00:00Z", openingCents: 10000, chargeCents: 30975, creditCents: 15000, closingCents: 25975, rows: [{ date: "2026-10-23", kind: "Invoice", reference: "INV-EXAMPLE", description: "Service", chargeCents: 30975, creditCents: 15000, balanceCents: 25975 }], documentTemplate: config });
assert.deepEqual(statement.documentFinancials, { totalCents: 25975, balanceCents: 25975 }, "statement adapter carries original numeric closing amount");
const negativeStatement: InvoiceDocumentData = { ...statement, number: "CREDIT-STATEMENT", documentFinancials: { totalCents: -1000, balanceCents: -1000 }, documentSummary: [{ label: "Closing balance CAD", value: "-$10.00", strong: true }] };
const unquotedStatement = documentPresentation({ ...statement, documentFinancials: undefined });
assert.ok(!unquotedStatement.metadata.some((row) => row.balance), "a statement without numeric amounts cannot invent a zero header balance");
assert.equal(unquotedStatement.amountWords, "");
assert.equal(unquotedStatement.paymentStubDetails, undefined);
assert.throws(() => documentPresentation({ ...statement, documentFinancials: { totalCents: 1.5 } }), /integer/);

const outputDirectory = "/workspace/scratch/document-kind-financials";
await mkdir(outputDirectory, { recursive: true });
for (const sample of [...samples, { kind: "statement" as const, invoice: statement }, { kind: "statement" as const, invoice: negativeStatement }]) {
  assert.notEqual(sample.kind, "report");
  if (sample.kind === "report") continue;
  const data = documentPresentation(sample.invoice), header = data.metadata.find((row) => row.balance);
  assert.ok(header, "enabled header summary is available for every financially meaningful document");
  if (sample.kind === "statement") {
    const negative = sample.invoice.number === "CREDIT-STATEMENT";
    assert.equal(data.balance, negative ? -1000 : 25975);
    assert.equal(header.label, negative ? "Credit balance" : "Closing balance");
    assert.equal(header.value, negative ? "-$10.00" : "$259.75");
    assert.ok(data.amountWords.includes(negative ? "Minus ten CAD" : "Two hundred fifty-nine CAD"));
    assert.ok(data.paymentStubDetails && !data.paymentStubDetails.showBalance);
    assert.equal(data.paymentStubDetails.total, header.value);
  } else {
    assert.equal(header.label, sample.kind === "receipt" ? "Amount received" : sample.kind === "quote" ? "Quote total" : "Estimated total");
    assert.equal(data.balance, 0, "a receipt, quote or work order does not establish an invoice debt");
    assert.equal(data.paymentStubDetails, undefined);
    assert.equal(documentPaymentStubHeight(data), 0);
    if (sample.kind === "receipt") assert.equal(header.value, "$150.00");
  }
  const bytes = await renderSampleDocumentPdf(sample, config, organization, fonts);
  const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true, verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let page = 1; page <= pdf.numPages; page++) pages.push((await (await pdf.getPage(page)).getTextContent()).items.map((item: any) => item.str || "").join(" "));
  await pdf.destroy();
  const text = pages.join(" ").replace(/\s+/g, " ");
  assert.ok(text.includes(header.label) && text.includes(header.value), "actual PDF includes the semantic header amount");
  assert.ok(text.includes(data.amountWords), "actual PDF spells the correct document amount");
  if (sample.kind === "statement") assert.ok(text.includes(advanced.labels.paymentStub), "statement remittance stub contains its real closing amount");
  else {
    assert.ok(!text.includes(advanced.labels.paymentStub), "receipts, quotes and work orders have no debt remittance stub");
    assert.ok(!text.includes(design.labels.balance), "receipts, quotes and work orders cannot label their total as an amount due");
  }
  await writeFile(`${outputDirectory}/${sample.invoice.number}.pdf`, bytes);
}
const customLabelDesign = resolveDocumentDesign(config);
customLabelDesign.labels.total = "Document amount";
const customLabelConfig = cleanInvoiceTemplate({ ...config, design: customLabelDesign });
const customReceipt = documentTemplateSample(customLabelConfig, "receipt", { today: "2026-10-23", currency: "CAD" });
if (customReceipt.kind === "report") throw new Error("Expected a receipt sample.");
const customLabelData = documentPresentation(customReceipt.invoice);
assert.equal(customLabelData.metadata.find((row) => row.balance)?.label, "Document amount", "explicit shared labels override kind-specific defaults");
assert.ok(customLabelData.summary.some((row) => row.label === "Document amount CAD"));
assert.equal(documentPresentation({ ...statement, documentTemplate: customLabelConfig }).metadata.find((row) => row.balance)?.label, "Document amount", "statement header preserves the shared custom total label");
const customLabelPdf = await getDocument({ data: await renderSampleDocumentPdf(customReceipt, customLabelConfig, organization, fonts), disableFontFace: true, verbosity: 0 }).promise;
const customLabelText = (await (await customLabelPdf.getPage(1)).getTextContent()).items.map((item: any) => item.str || "").join(" ");
assert.ok((customLabelText.match(/Document amount/g) || []).length >= 2, "actual receipt PDF honors the custom label in both header and total");
await customLabelPdf.destroy();

const annexDesign = resolveDocumentDesign(config), annexAdvanced = resolveDocumentAdvanced(annexDesign);
annexAdvanced.paymentStub.firstPageOnly = false;
annexAdvanced.annexures.enabled = true;
annexDesign.advanced = annexAdvanced;
const annexConfig = cleanInvoiceTemplate({ ...config, design: annexDesign });
const annexSample = documentTemplateSample(annexConfig, "invoice", { today: "2026-10-23", currency: "CAD" });
if (annexSample.kind === "report") throw new Error("Expected an invoice sample.");
annexSample.invoice.documentExtras = { annexures: [{ title: "Long annex", columns: ["Reference", "Description"], rows: Array.from({ length: 80 }, (_, index) => [`ANNEX-${index + 1}`, "Service inventory detail"]) }] };
const annexData = documentPresentation(annexSample.invoice);
const annexLayout = await renderDocumentWithLayout(createElement(InvoicePdfDocument, { invoice: annexSample.invoice, organization, fonts }));
const flatten = (nodes: any[]): any[] => nodes.flatMap((node) => [node, ...flatten(node.children || [])]);
const annexPages = annexLayout.layout.pages.filter((page) => flatten(page.elements).some((node) => node.textContent?.includes("ANNEX-")));
assert.ok(annexPages.length >= 2, "long native annex spans multiple physical pages");
for (const page of annexPages) for (const node of flatten(page.elements).filter((node) => node.nodeType === "TextLine")) assert.ok(node.y + node.height <= annexData.page.height - annexData.design.page.margins.bottom - documentPaymentStubHeight(annexData) + 1, "every annex text line stays above the repeated payment-stub area");
console.log("Document-kind financial checks passed: factual receipt/quote/work-order summaries, signed statement closing balances, correct amount words and invoice/statement-only remittance stubs.");
