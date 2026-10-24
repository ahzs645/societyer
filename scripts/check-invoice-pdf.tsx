import ddcnorth from "../shared/brandKits/ddcnorth.json";
import { importInvoiceBrand } from "../shared/invoiceBranding";
import React from "react";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { renderDocument } from "@formepdf/core";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { InvoicePdfDocument } from "../src/features/invoicing/InvoicePdfDocument";
import { decorateDocumentPdf } from "../src/features/invoicing/documentPdfDecoration";
import { cleanInvoiceTemplate, resolveDocumentDesign } from "../shared/invoiceCommerce";
import { DEFAULT_INVOICE_TEMPLATE } from "../shared/invoiceCommerce";

const fonts = [{ family: "Invoice", src: new Uint8Array(await readFile("src/assets/pdf-fonts/NotoSerif-Regular.ttf")) }, { family: "Invoice", src: new Uint8Array(await readFile("src/assets/pdf-fonts/NotoSerif-Bold.ttf")), fontWeight: "bold" as const }];
for (const layout of ["classic", "modern", "compact"] as const) {
  const long = layout === "modern";
  const invoice = { number: `INV-${layout}`, issueDate: "2026-10-22", dueDate: "2026-11-21", terms: "net_30", currency: "USD", billToName: "Renée's workshop", billToAddress: "100 Main Street", lines: Array.from({ length: long ? 100 : 2 }, (_, i) => ({ key: String(i), item: `Repair service ${i + 1}`, description: "Inspection and repair", quantity: 1.5, unit: "hour", unitPriceCents: 8500, taxLabel: "GST", taxRatePercent: 5 })), documentTemplate: { ...DEFAULT_INVOICE_TEMPLATE, layout, paperSize: long ? "a4" as const : "letter" as const, footer: "Thank you for your business" }, payments: [{ key: "p1", date: "2026-10-22", amountCents: 5000, method: "e_transfer" }], memo: "Warranty work checked" };
  const raw = await renderDocument(<InvoicePdfDocument invoice={invoice} organization={{ name: "Societyer Workshop", gstNumber: "GST-TEST" }} paymentInstructions="Pay by e-transfer" fonts={fonts} />);
  const bytes = await decorateDocumentPdf(raw, { config: cleanInvoiceTemplate(invoice.documentTemplate), fonts });
  const pdf = await PDFDocument.load(bytes);
  assert.ok(Math.abs(pdf.getPage(0).getWidth() - (long ? 595.276 : 612)) < 0.1);
  assert.ok(long ? pdf.getPageCount() > 1 : pdf.getPageCount() === 1);
  await mkdir("/workspace/scratch/invoice-pdf", { recursive: true });
  await writeFile(`/workspace/scratch/invoice-pdf/${layout}.pdf`, bytes);
  const extracted = await getDocument({ data: bytes.slice(), useSystemFonts: true, disableFontFace: true }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= extracted.numPages; i++) pages.push((await (await extracted.getPage(i)).getTextContent()).items.map((item: any) => item.str ?? "").join(" "));
  const text = pages.join(" ");
  for (const expected of [invoice.number, "Renée", "Rate (USD)", "1.5 hour", "GST", "Total USD", "Balance due", "Thank you", "Pay by e-transfer", "Warranty work checked"]) assert.ok(text.includes(expected), `${layout}: PDF contains ${expected}`);
  assert.ok(text.includes(`Repair service ${long ? 100 : 2}`));
  if (long) assert.ok(pages.slice(1).some((page) => page.includes("Rate (USD)")), "table header repeats across pages");
  await mkdir("/workspace/scratch/invoice-pdf", { recursive: true });
  await writeFile(`/workspace/scratch/invoice-pdf/${layout}.pdf`, bytes);
  await extracted.destroy();
}
const brand = importInvoiceBrand(ddcnorth);
const brandFonts = await Promise.all([
  { family: "Invoice", file: "Inter-Regular.ttf" }, { family: "Invoice", file: "Inter-SemiBold.ttf", fontWeight: "bold" as const },
  { family: "InvoiceDisplay", file: "InterDisplay-Medium.ttf" }, { family: "InvoiceLabel", file: "SpaceMono-Regular.ttf" },
].map(async ({ file, ...font }) => ({ ...font, src: new Uint8Array(await readFile(`src/assets/invoice-branding/${file}`)) })));
const branded = await renderDocument(<InvoicePdfDocument invoice={{ number: "DDC-0001", issueDate: "2026-10-22", dueDate: "2026-11-21", terms: "net_30", currency: "CAD", billToName: "Sample customer", lines: [{ key: "service", item: "Repair labour", quantity: 2, unit: "hour", unitPriceCents: 8500 }], documentTemplate: { ...DEFAULT_INVOICE_TEMPLATE, brand, accentColor: brand.primary } }} organization={{ name: "ddcnorth", email: "billing@example.test" }} fonts={brandFonts} />);
const brandedDoc = await PDFDocument.load(branded);
assert.equal(brandedDoc.getPageCount(), 1);
await writeFile("/workspace/scratch/invoice-pdf/ddcnorth.pdf", branded);
console.log("pdfcn / Forme PDF checks passed: all layouts, Unicode, currency, tax, payments, notes, paper sizes and multipage tables.");

// A saved versioned design must change the downloaded PDF, not just its editor preview.
const custom = resolveDocumentDesign({ ...DEFAULT_INVOICE_TEMPLATE, brand });
custom.page = { orientation: "landscape", margins: { top: 72, right: 64, bottom: 82, left: 70 } };
custom.logo = { width: 145, alignment: "right" };
custom.typography.table = { fontFamily: "sans", fontSize: 9, color: "#223344" };
custom.typography.totals = { fontFamily: "serif", fontSize: 11, color: "#345678" };
custom.typography.footer = { fontFamily: "mono", fontSize: 8, color: "#445566" };
custom.labels.billTo = "Client"; custom.labels.issued = "Prepared"; custom.labels.total = "Grand total";
custom.fields.dueDate = false; custom.fields.terms = false; custom.fields.notes = false; custom.fields.customerEmail = false;
custom.fields.shipTo = true;
custom.table.columns = [...custom.table.columns].reverse().map((column) => ({ ...column, visible: ["item", "quantity", "rate", "amount", "sku"].includes(column.key), label: column.key === "item" ? "Work performed" : column.label, width: column.key === "item" ? 60 : 15 }));
custom.table.striped = true; custom.table.rowPadding = 6;
custom.header = { text: "FIRST PAGE HEADER", continuationText: "CONTINUED HEADER", repeat: true };
custom.footer = { text: "FIRST PAGE FOOTER", continuationText: "CONTINUED FOOTER", repeat: true, pageNumbers: true, pageNumberFormat: "page_of_total" };
custom.signature = { enabled: true, label: "Approved by customer", name: "Renée Example" };
custom.titles = { invoice: "Service invoice", receipt: "Received payment", work_order: "Workshop job", report: "Financial report" };
custom.totals = { showSubtotal: false, showDiscount: false, showTax: false, showPaid: false, showBalance: false };
custom.sections = ["header", "customer", "notes", "items", "paymentInstructions", "totals", "signature"];
const allFonts = [...brandFonts,
  { family: "InvoiceSans", src: new Uint8Array(await readFile("src/assets/invoice-branding/Inter-Regular.ttf")) },
  { family: "InvoiceSans", src: new Uint8Array(await readFile("src/assets/invoice-branding/Inter-SemiBold.ttf")), fontWeight: "bold" as const },
  { family: "InvoiceSerif", src: new Uint8Array(await readFile("src/assets/pdf-fonts/NotoSerif-Regular.ttf")) },
  { family: "InvoiceSerif", src: new Uint8Array(await readFile("src/assets/pdf-fonts/NotoSerif-Bold.ttf")), fontWeight: "bold" as const },
  { family: "InvoiceMono", src: new Uint8Array(await readFile("src/assets/invoice-branding/SpaceMono-Regular.ttf")) },
];
const customTemplate = cleanInvoiceTemplate({ ...DEFAULT_INVOICE_TEMPLATE, brand, design: custom });
const customInvoice = { number: "DESIGN-TEST", issueDate: "2026-10-22", dueDate: "2030-12-31", terms: "net_90", currency: "CAD", billToName: "Designer customer", billToEmail: "hidden@example.test", shipToName: "Delivery contact", shipToAddress: "42 Workshop Road", lines: Array.from({ length: 95 }, (_, index) => ({ key: String(index), item: `Inspection ${index + 1}`, sku: `PART-${index + 1}`, quantity: 2, unit: "hour", unitPriceCents: 1000, description: "HIDDEN DESCRIPTION" })), memo: "HIDDEN MEMO", documentTemplate: customTemplate };
const customRaw = await renderDocument(<InvoicePdfDocument invoice={customInvoice} organization={{ name: "Workshop" }} fonts={allFonts} />);
const customBytes = await decorateDocumentPdf(customRaw, { config: customTemplate, fonts: allFonts });
await writeFile("/workspace/scratch/invoice-pdf/designer-multipage.pdf", customBytes);
const customDoc = await PDFDocument.load(customBytes);
assert.ok(customDoc.getPageCount() > 1);
assert.equal(customDoc.getPage(0).getWidth(), 792);
assert.equal(customDoc.getPage(0).getHeight(), 612);
const customPdf = await getDocument({ data: customBytes.slice(), useSystemFonts: true, disableFontFace: true }).promise;
const customPages: string[] = [];
for (let index = 1; index <= customPdf.numPages; index++) {
  const page = await customPdf.getPage(index);
  const content = await page.getTextContent();
  customPages.push(content.items.map((item: any) => item.str ?? "").join(" ").replace(/\s+/g, " "));
  const textItems = content.items.filter((item: any) => item.str?.trim()) as any[];
  assert.ok(textItems.every((item) => item.transform[4] >= 69), "custom left margin applies to all content");
}
// Text extraction alone misses broken glyph outlines in custom-font PDF margin bands.
GlobalFonts.registerFromPath("src/assets/invoice-branding/Inter-Regular.ttf", "DecorationReference");
const visualPage = await customPdf.getPage(1), visualViewport = visualPage.getViewport({ scale: 2 });
const visualCanvas = createCanvas(Math.ceil(visualViewport.width), Math.ceil(visualViewport.height));
await visualPage.render({ canvas: visualCanvas as any, canvasContext: visualCanvas.getContext("2d") as any, viewport: visualViewport }).promise;
const referenceCanvas = createCanvas(visualCanvas.width, visualCanvas.height), referenceContext = referenceCanvas.getContext("2d");
referenceContext.fillStyle = "white"; referenceContext.fillRect(0, 0, referenceCanvas.width, referenceCanvas.height);
referenceContext.scale(2, 2); referenceContext.font = "22px DecorationReference"; referenceContext.fillStyle = custom.typography.header.color; referenceContext.fillText(custom.header.text, 70, 27);
const referencePixels = referenceContext.getImageData(140, 6, 600, 54).data;
const actualPixels = visualCanvas.getContext("2d").getImageData(140, 6, 600, 54).data;
let referenceInk = 0, actualInk = 0;
const referenceRegions = Array(10).fill(0), actualRegions = Array(10).fill(0);
for (let index = 0; index < referencePixels.length; index += 4) {
  const region = Math.floor(((index / 4) % 600) / 60);
  if (referencePixels[index] < 180) { referenceInk++; referenceRegions[region]++; }
  if (actualPixels[index] < 180) { actualInk++; actualRegions[region]++; }
}
// Canvas applies kerning while PDF drawText uses font advance widths. Compare glyph coverage,
// allowing their small spacing differences, instead of requiring identical edge pixels.
assert.ok(actualInk / referenceInk > 0.9 && actualInk / referenceInk < 1.1, "Custom-font header must retain every visible glyph outline.");
for (let index = 0; index < referenceRegions.length; index++) if (referenceRegions[index] > 100) assert.ok(actualRegions[index] / referenceRegions[index] > 0.6 && actualRegions[index] / referenceRegions[index] < 1.5, "Custom-font header glyph coverage matches the source font throughout the line.");
await writeFile("/workspace/scratch/invoice-pdf/header-visual.png", visualCanvas.toBuffer("image/png"));
assert.ok(customPages[0].includes("FIRST PAGE HEADER"));
assert.ok(customPages[0].includes("FIRST PAGE FOOTER"));
for (let index = 1; index < customPages.length; index++) {
  assert.ok(customPages[index].includes("CONTINUED HEADER"));
  assert.ok(customPages[index].includes("CONTINUED FOOTER"));
  assert.ok(customPages[index].includes("Work performed"), "custom table heading repeats");
  assert.ok(!customPages[index].includes("FIRST PAGE FOOTER"));
}
for (let index = 0; index < customPages.length; index++) assert.ok(customPages[index].includes(`Page ${index + 1} of ${customPages.length}`));
const customText = customPages.join(" ");
for (const expected of ["Service invoice", "Client", "Prepared", "Grand total CAD", "PART-95", "Inspection 95", "Approved by customer", "Renée Example", "Delivery contact", "42 Workshop Road"]) assert.ok(customText.includes(expected), `custom PDF contains ${expected}`);
for (const hidden of ["2030-12-31", "Net 90", "Subtotal", "HIDDEN DESCRIPTION", "HIDDEN MEMO", "hidden@example.test"]) assert.ok(!customText.includes(hidden), `custom PDF hides ${hidden}`);
await customPdf.destroy();

for (const documentKind of ["receipt", "work_order"] as const) {
  const invoice = { ...customInvoice, documentKind, lines: customInvoice.lines.slice(0, 1), documentDetails: [{ label: "Payment reference", value: "BANK-123" }, { label: "Reported problem", value: "Equipment will not start.\nInspect the power supply and replace the damaged connector." }], status: "draft" };
  const bytes = await decorateDocumentPdf(await renderDocument(<InvoicePdfDocument invoice={invoice} organization={{ name: "Workshop" }} fonts={allFonts} paymentInstructions="HIDDEN PAYMENT INSTRUCTIONS" />), { config: customTemplate, fonts: allFonts });
  await writeFile(`/workspace/scratch/invoice-pdf/${documentKind}.pdf`, bytes);
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: true, disableFontFace: true }).promise;
  const text = (await (await pdf.getPage(1)).getTextContent()).items.map((item: any) => item.str ?? "").join(" ").replace(/\s+/g, " ");
  assert.ok(text.includes(custom.titles[documentKind]));
  assert.ok(text.includes("BANK-123"));
  assert.ok(text.includes("damaged connector"));
  for (const hidden of ["draft", "2030-12-31", "Net 90", "HIDDEN PAYMENT INSTRUCTIONS"]) assert.ok(!text.includes(hidden), `${documentKind} suppresses invoice-only ${hidden}`);
  await pdf.destroy();
}
console.log("Document designer PDF checks passed: margins/orientation, fonts, labels, ordered/hidden columns, row styles, ship-to, hidden fields, signatures, shared titles, repeating bands and real page counts.");
