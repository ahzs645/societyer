import React from "react";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FontRegistration } from "@formepdf/react";
import { PDFDocument } from "pdf-lib";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DOCUMENT_KINDS, cleanInvoiceTemplate, resolveDocumentDesign, type InvoiceTemplate } from "../shared/invoiceCommerce";
import { DOCUMENT_TEMPLATE_PRESETS, freshDocumentTemplatePreset } from "../shared/documentTemplatePresets";
import { documentTemplateSample } from "../src/features/invoicing/documentTemplateSamples";
import { renderSampleDocumentPdf } from "./lib/render-document-sample";
import { computeInvoiceTotals } from "../shared/invoicing";

const artifactDirectory = resolve(process.env.DOCUMENT_TEMPLATE_ARTIFACTS_DIR ?? "tmp/document-template-presets");
await mkdir(artifactDirectory, { recursive: true });
const font = async (name: string) => new Uint8Array(await readFile(name));
const [sans, sansBold, serif, serifBold, mono] = await Promise.all([
  font("src/assets/invoice-branding/Inter-Regular.ttf"), font("src/assets/invoice-branding/Inter-SemiBold.ttf"),
  font("src/assets/pdf-fonts/NotoSerif-Regular.ttf"), font("src/assets/pdf-fonts/NotoSerif-Bold.ttf"),
  font("src/assets/invoice-branding/SpaceMono-Regular.ttf"),
]);
const fontsFor = (config: InvoiceTemplate): FontRegistration[] => {
  const serifBrand = !config.brand || config.brand.font === "serif";
  return [
    { family: "Invoice", src: serifBrand ? serif : sans }, { family: "Invoice", src: serifBrand ? serifBold : sansBold, fontWeight: "bold" },
    { family: "InvoiceSans", src: sans }, { family: "InvoiceSans", src: sansBold, fontWeight: "bold" },
    { family: "InvoiceSerif", src: serif }, { family: "InvoiceSerif", src: serifBold, fontWeight: "bold" },
    { family: "InvoiceMono", src: mono }, { family: "InvoiceMono", src: mono, fontWeight: "bold" },
  ];
};

assert.equal(DOCUMENT_TEMPLATE_PRESETS.length, 12, "the visible library contains twelve ready-made designs");
assert.equal(new Set(DOCUMENT_TEMPLATE_PRESETS.map((preset) => preset.id)).size, 12, "preset IDs are unique");
assert.equal(new Set(DOCUMENT_TEMPLATE_PRESETS.map((preset) => preset.name)).size, 12, "preset names are unique");
assert.deepEqual(new Set(DOCUMENT_TEMPLATE_PRESETS.map((preset) => preset.recommendedDocumentKind)), new Set(DOCUMENT_KINDS), "the library covers every document type");
assert.equal(DOCUMENT_TEMPLATE_PRESETS.filter((preset) => preset.config.brand).length, 6, "six curated ddcnorth designs and six neutral designs are available");
assert.throws(() => freshDocumentTemplatePreset("missing-preset"), /template|preset|unknown|found/i);

const organization = { name: "Sample organization", address: "10 Example Avenue", email: "accounts@example.test", gstNumber: "SAMPLE-TAX" };
const artifacts: Array<{ id: string; name: string; kind: string; pages: number; file?: string }> = [];
let rendered = 0;
for (const preset of DOCUMENT_TEMPLATE_PRESETS) {
  const original = JSON.stringify(preset.config);
  const fresh = freshDocumentTemplatePreset(preset.id);
  assert.deepEqual(cleanInvoiceTemplate(JSON.parse(JSON.stringify(fresh))), fresh, `${preset.id}: clean serialization roundtrip`);
  assert.notStrictEqual(fresh, preset.config, `${preset.id}: user drafts do not alias the shared preset`);
  const clone = freshDocumentTemplatePreset(preset.id);
  clone.design!.page.margins.left = 99;
  clone.design!.labels.billTo = "Changed in a draft";
  clone.design!.table.columns[0].label = "Changed column";
  if (clone.brand) clone.brand.primary = "#112233";
  assert.equal(JSON.stringify(preset.config), original, `${preset.id}: nested draft edits leave the library intact`);
  assert.deepEqual(freshDocumentTemplatePreset(preset.id), fresh, `${preset.id}: a second user gets an independent pristine design`);

  for (const kind of DOCUMENT_KINDS) {
    const config = freshDocumentTemplatePreset(preset.id);
    const design = resolveDocumentDesign(config), fonts = fontsFor(config);
    const sample = documentTemplateSample(config, kind, { today: "2026-10-22", currency: "CAD" });
    if (sample.kind === "receipt") assert.equal(computeInvoiceTotals(sample.invoice.lines, sample.invoice.discount).totalCents, 15000, "the sample receipt acknowledges only its individual payment");
    const bytes = await renderSampleDocumentPdf(sample, config, organization, fonts, "Sample payment instructions");
    const pdf = await PDFDocument.load(bytes);
    const base = config.paperSize === "a4" ? [595.276, 841.89] : [612, 792];
    const size = design.page.orientation === "landscape" ? [base[1], base[0]] : base;
    assert.ok(pdf.getPageCount() > 0 && pdf.getPageCount() <= 5, `${preset.id}/${kind}: short gallery samples paginate sensibly`);
    for (const page of pdf.getPages()) {
      assert.ok(Math.abs(page.getWidth() - size[0]) < 0.1, `${preset.id}/${kind}: configured page width`);
      assert.ok(Math.abs(page.getHeight() - size[1]) < 0.1, `${preset.id}/${kind}: configured page height`);
    }
    const inspected = await getDocument({ data: bytes.slice(), disableFontFace: true, verbosity: 0 }).promise;
    const texts: string[] = []; let paths = 0;
    try {
      for (let pageNumber = 1; pageNumber <= inspected.numPages; pageNumber++) {
        const page = await inspected.getPage(pageNumber), content = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1 });
        for (const item of content.items as any[]) if (item.str?.trim()) {
          const [x, y] = [item.transform[4], item.transform[5]];
          assert.ok(Number.isFinite(x) && Number.isFinite(y), `${preset.id}/${kind}: finite text coordinates`);
          assert.ok(x >= -1 && y >= -1 && y <= viewport.height + 1 && x + item.width <= viewport.width + 3,
            `${preset.id}/${kind}: text must remain on page ${pageNumber}: ${item.str} (${x}, ${y}, width ${item.width})`);
        }
        texts.push(content.items.map((item: any) => item.str ?? "").join(" "));
        paths += (await page.getOperatorList()).fnArray.filter((operator) => operator === OPS.constructPath).length;
      }
    } finally { await inspected.destroy(); }
    const text = texts.join(" ").replace(/\s+/g, " ");
    const expected = sample.kind === "report"
      ? ["Sample financial report", "Statement of operations", "Revenue and expenses", "Service income", "Q4", "CAD"]
      : [sample.invoice.number, "Sample customer", "CAD", sample.kind === "receipt" ? "150.00" : sample.kind === "statement" ? "259.75" : "Professional service"];
    for (const value of expected) assert.ok(text.includes(value), `${preset.id}/${kind}: generated PDF contains ${value}`);
    if (kind === "report") assert.ok(paths > 0, `${preset.id}: report contains native chart drawing paths`);
    if (kind === "work_order") assert.ok(text.includes("SAMPLE-0042"), `${preset.id}: work-order technical details are retained`);
    if (kind === "statement") assert.ok(text.includes("Closing balance") && text.includes("PAY-SAMPLE-1042"), `${preset.id}: statement includes its actual running account rows`);
    if (kind === "receipt") assert.ok(text.includes("PAY-SAMPLE-1042") && text.includes("159.75"), `${preset.id}: receipt payment reference and remaining balance are factual`);
    const file = kind === preset.recommendedDocumentKind ? `${preset.id}.pdf` : undefined;
    if (file) await writeFile(resolve(artifactDirectory, file), bytes);
    artifacts.push({ id: preset.id, name: preset.name, kind, pages: pdf.getPageCount(), ...(file ? { file } : {}) });
    rendered++;
  }
}
await writeFile(resolve(artifactDirectory, "verification.json"), JSON.stringify({ presets: DOCUMENT_TEMPLATE_PRESETS.length, rendered, artifacts }, null, 2));
console.log(`Document template preset checks passed: ${DOCUMENT_TEMPLATE_PRESETS.length} valid isolated designs, ${rendered} real invoice/receipt/work-order/report/quote/statement PDFs, page bounds, searchable sample content and native graphs.`);
