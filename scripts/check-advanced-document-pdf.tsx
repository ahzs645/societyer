import React from "react";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import { renderDocument, renderDocumentWithLayout } from "@formepdf/core";
import { Document, Page, Text, type FontRegistration } from "@formepdf/react";
import { PDFDocument, PDFName, PDFArray } from "pdf-lib";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import ddcnorth from "../shared/brandKits/ddcnorth.json";
import { importInvoiceBrand } from "../shared/invoiceBranding";
import { DEFAULT_INVOICE_TEMPLATE, cleanInvoiceTemplate, resolveDocumentDesign, resolveDocumentAdvanced } from "../shared/invoiceCommerce";
import { cleanDocumentImage, sanitizeDocumentHtml, parseDocumentHtml, documentHtmlText } from "../shared/documentRichContent";
import { cleanDocumentExtras, documentAmountInWords } from "../shared/documentExtras";
import { InvoicePdfDocument, documentPaymentStubHeight } from "../src/features/invoicing/InvoicePdfDocument";
import { documentPresentation } from "../src/features/invoicing/documentPresentation";
import { resolveDocumentOrganizationLogo } from "../src/features/invoicing/documentOrganizationLogo";
import { appendDocumentAttachments } from "../src/features/invoicing/documentPdfAttachments";
import { decorateDocumentPdf } from "../src/features/invoicing/documentPdfDecoration";
import type { InvoiceDocumentData } from "../src/features/invoicing/InvoiceDocument";

assert.equal(documentHtmlText(sanitizeDocumentHtml('<p>Hello <strong>customer</strong><br>Next &amp; final</p>')).trim(), "Hello customer\nNext & final");
for (const html of ['<script>alert(1)</script>', '<img src="https://outside.test/image.png">', '<p onclick="alert(1)">Test</p>', '<a href="javascript:alert(1)">Pay</a>', '<p style="background:url(https://outside.test)">Bad</p>', '<b><i>Bad</b></i>']) assert.throws(() => sanitizeDocumentHtml(html), "Active or malformed HTML is rejected");
assert.equal(documentAmountInWords(10105, "CAD"), "One hundred one CAD and 05/100");
const artwork = createCanvas(120, 30), art = artwork.getContext("2d");
art.fillStyle = "#345b85"; art.fillRect(0, 0, 120, 30); art.fillStyle = "#f3c784"; art.fillRect(40, 0, 40, 30);
const image = `data:image/png;base64,${artwork.toBuffer("image/png").toString("base64")}`;
assert.equal(cleanDocumentImage(image), image);
assert.ok(parseDocumentHtml(`<p><strong>Receipt</strong> <a href="https://example.test/pay">Pay</a></p><img src="${image}" width="70" height="18">`).length);
const oversized = image.replace("image/png", "image/svg+xml"); assert.throws(() => cleanDocumentImage(oversized));
assert.throws(() => cleanDocumentExtras({ attachments: [{ name: "bad.pdf", mimeType: "application/pdf", dataUrl: "https://outside.test/file.pdf" }] }));

const registrations = [
  ["Invoice", "Inter-Regular.ttf"], ["Invoice", "Inter-SemiBold.ttf", "bold"], ["InvoiceSans", "Inter-Regular.ttf"], ["InvoiceSans", "Inter-SemiBold.ttf", "bold"],
  ["InvoiceSerif", "../pdf-fonts/NotoSerif-Regular.ttf"], ["InvoiceSerif", "../pdf-fonts/NotoSerif-Bold.ttf", "bold"], ["InvoiceMono", "SpaceMono-Regular.ttf"], ["InvoiceMono", "SpaceMono-Regular.ttf", "bold"],
  ["InvoiceDisplay", "InterDisplay-Medium.ttf"], ["InvoiceLabel", "SpaceMono-Regular.ttf"], ["InvoiceOpenSans", "OpenSans-Regular.ttf"], ["InvoiceOpenSans", "OpenSans-Bold.ttf", "bold"], ["InvoiceLiberationSerif", "LiberationSerif-Regular.ttf"], ["InvoiceLiberationSerif", "LiberationSerif-Bold.ttf", "bold"],
];
const fonts: FontRegistration[] = await Promise.all(registrations.map(async ([family, filename, weight]) => ({ family, src: new Uint8Array(await readFile(`src/assets/invoice-branding/${filename}`)), ...(weight ? { fontWeight: "bold" as const } : {}) })));
const organizationLogo = await resolveDocumentOrganizationLogo({ name: "Aspect sample", logoUrl: image });
assert.equal(organizationLogo.logoAspectRatio, 4);
const aspectDesign = resolveDocumentDesign(DEFAULT_INVOICE_TEMPLATE), aspectAdvanced = resolveDocumentAdvanced(aspectDesign);
aspectAdvanced.logo.height = 60; aspectAdvanced.logo.preserveAspectRatio = true; aspectDesign.advanced = aspectAdvanced;
const aspectSample = await renderDocumentWithLayout(<InvoicePdfDocument invoice={{ number: "ASPECT", issueDate: "2026-10-23", dueDate: "2026-10-23", terms: "due_on_receipt", currency: "CAD", billToName: "Example", lines: [], documentTemplate: { ...DEFAULT_INVOICE_TEMPLATE, design: aspectDesign } }} organization={organizationLogo} fonts={fonts} />);
const collectImages = (nodes: any[]): any[] => nodes.flatMap((node) => [ ...(node.nodeType === "Image" ? [node] : []), ...collectImages(node.children || []) ]);
const normalizedImage = collectImages(aspectSample.layout.pages[0].elements)[0];
assert.ok(normalizedImage && Math.abs(normalizedImage.width / normalizedImage.height - 4) < .01 && normalizedImage.width <= 200 && normalizedImage.height <= 60, "organization logo fits both dimensions while preserving its source aspect ratio");
const attachmentBytes = await renderDocument(<Document><Page><Text>Attached warranty certificate</Text><Text>Warranty terms remain searchable in the appended PDF.</Text></Page></Document>);
const design = resolveDocumentDesign({ ...DEFAULT_INVOICE_TEMPLATE, brand: importInvoiceBrand(ddcnorth) });
design.page.margins = { top: 100, right: 45, bottom: 110, left: 45 }; design.typography.header.fontSize = 12; design.typography.footer.fontSize = 8;
design.header = { text: "Plain first header", continuationText: "Plain continued header", repeat: true };
design.footer = { text: "Plain first footer", continuationText: "Plain continued footer", repeat: true, pageNumbers: true, pageNumberFormat: "page_of_total" };
design.fields.shipTo = true; design.table.striped = true; design.table.rowPadding = 4;
design.signature = { enabled: true, label: "Authorized approval", name: "Example approver" };
const advanced = resolveDocumentAdvanced(design);
advanced.page.customSize = true; advanced.page.width = 1100; advanced.page.height = 1000; advanced.page.firstHeaderHeight = 130;
advanced.page.pageNumber = { position: "custom", alignment: "left", x: 50, y: 18 };
advanced.logo = { height: 55, preserveAspectRatio: false };
advanced.addresses.organization.format = "{{name}}\nOrganization registration {{registrationNumber}}";
advanced.addresses.billing = { format: "ATTENTION {{name}}\n{{address}}", placement: "absolute", x: 230, y: 260, width: 140 };
advanced.backgrounds.body = { color: "#fbfaf7", image, opacity: 0.12, position: "center", fit: "contain" };
advanced.backgrounds.header = { color: "#e4eff7", image, opacity: 0.18, position: "top_right", fit: "contain" };
advanced.backgrounds.footer = { color: "#eff4e9", image, opacity: 0.15, position: "bottom_left", fit: "cover" };
advanced.colors = { border: "#6f8499", sectionBackground: "#f6f8fa", tableHeaderBackground: "#304c66", rowBackground: "#ffffff", alternateRowBackground: "#e5edf4", totalsBackground: "#f1f4f6", balanceBackground: "#e5f2dc" };
advanced.typography.title = { fontFamily: "liberation_serif", fontSize: 28, color: "#24475d" };
advanced.typography.notes = { fontFamily: "open_sans", fontSize: 10, color: "#4c5a41" };
advanced.typography.columnHeader = { fontFamily: "space_mono", fontSize: 7, color: "#ffffff" };
advanced.typography.itemDescription.fontSize = 7;
advanced.typography.labels = { fontFamily: "inter", fontSize: 8, color: "#35506b" };
advanced.typography.documentNumber = { fontFamily: "noto_serif", fontSize: 11, color: "#325f46" };
advanced.visibility.headerBalance = true; advanced.visibility.organizationAddress = false;
advanced.labels.documentNumber = "Document ID"; advanced.stamp = { text: "APPROVED", color: "#8d3827", rotation: -9, placement: "totals" };
advanced.rich.headerHtml = `<p><strong>Rich first header</strong> <a href="https://example.test/portal">Customer portal</a></p><img src="${image}" width="60" height="15">`;
advanced.rich.continuationHeaderHtml = "<p><em>Rich continued header</em></p>";
advanced.rich.footerHtml = "<table><tr><td>Rich first footer</td><td align=\"right\">Service desk</td></tr></table>";
advanced.rich.continuationFooterHtml = "<p>Rich continued footer</p>";
advanced.terms = { enabled: true, html: "<h3>Service conditions</h3><p><strong>Approval required.</strong> Work carries a limited service warranty.</p><ul><li>Retain this document.</li><li>Contact the service desk.</li></ul>", placement: "end" };
advanced.bank = { enabled: true, fields: [{ label: "Bank", value: "Example financial institution" }, { label: "Account", value: "EXAMPLE-ACCOUNT-001" }], placement: "after_totals" };
advanced.onlinePayment = { enabled: true, url: "https://payments.example.test/advanced", label: "Open secure payment", showQr: true, placement: "after_totals" };
advanced.paymentStub = { enabled: true, firstPageOnly: true, instructions: "Return this stub with your payment.", placement: "end" };
advanced.taxSummary = { enabled: true, showTaxableBase: true, showTaxAmount: true, placement: "after_totals" };
advanced.amountWords = { enabled: true, placement: "after_totals" }; advanced.baseCurrency = { enabled: true, showRate: true };
advanced.signature = { image, placement: "flow", x: 0, y: 0, width: 140, height: 35 };
advanced.receiverSignature = { enabled: true, label: "Received and checked", name: "Sample receiver", image, placement: "absolute", x: 520, y: 8, width: 130, height: 32 };
advanced.annexures = { enabled: true, title: "Inventory traceability", showAttachments: true, showBatches: true, showSerials: true };
advanced.appendices = [{ title: "Service appendix", html: "<p>Appendix content remains searchable.</p>", image }];
design.advanced = advanced;
design.table.columns = design.table.columns.map((column) => ({ ...column, visible: ["item", "image", "manufacturer", "partNumber", "upc", "ean", "isbn", "customField", "quantity", "rate", "amount"].includes(column.key), width: column.key === "item" ? 20 : column.key === "amount" ? 12 : 10 }));
const config = cleanInvoiceTemplate({ ...DEFAULT_INVOICE_TEMPLATE, name: "Advanced document checks", brand: importInvoiceBrand(ddcnorth), design });
const invoice: InvoiceDocumentData = {
  number: "ADV-001", issueDate: "2026-10-23", dueDate: "2026-11-22", terms: "net_30", currency: "USD", status: "sent", billToName: "Advanced sample customer", billToAddress: "100 Example Street", shipToName: "Example delivery contact", shipToAddress: "200 Example Avenue",
  documentTemplate: config,
  lines: Array.from({ length: 12 }, (_, index) => ({ key: String(index), item: `Advanced service ${index + 1}`, quantity: 1, unitPriceCents: 10500, taxRatePercent: 5, taxLabel: "GST", imageUrl: image, manufacturer: "Example maker", partNumber: `PN-${index + 1}`, upc: "012345678905", ean: "0012345678905", isbn: "9780000000002", customField: `Custom-${index + 1}`, batchNumber: `BATCH-${index + 1}`, serialNumbers: [`SERIAL-${index + 1}`] })),
  money: { taxMode: "inclusive", shipping: { amountCents: 1050, taxRatePercent: 5, taxLabel: "GST", taxMode: "inclusive" }, withholding: { kind: "percent", value: 10 }, fx: { baseCurrency: "CAD", rateMicros: 1350000, asOfDate: "2026-10-23", source: "Recorded example quote" } },
  payments: [{ key: "cash", date: "2026-10-23", amountCents: 10000, method: "e_transfer" }, { key: "credit", kind: "credit", date: "2026-10-23", amountCents: 1000, method: "other" }, { key: "writeoff", kind: "write_off", date: "2026-10-23", amountCents: 500, method: "other" }],
  memo: "Detailed service notes use the Open Sans family.",
  documentExtras: { termsAndConditions: "Customer-specific additional terms.", annexures: [{ title: "Custom delivery annex", columns: ["Box", "Contents"], rows: [["BOX-01", "Replacement assembly"]] }], attachments: [{ name: "warranty.pdf", mimeType: "application/pdf", dataUrl: `data:application/pdf;base64,${Buffer.from(attachmentBytes).toString("base64")}` }, { name: "Service photograph", mimeType: "image/png", dataUrl: image }] },
};
const data = documentPresentation(invoice);
const creditBalance = documentPresentation({ ...invoice, payments: [{ key: "excess-credit", kind: "credit", date: "2026-10-23", amountCents: data.totals.totalCents + 1000, method: "other" }] });
assert.equal(creditBalance.balance, -1000);
assert.ok(creditBalance.summary.some((row) => row.balance && row.label === "Credit balance" && row.value.includes("-")), "unapplied customer credits remain signed in the document");
assert.ok(creditBalance.metadata.some((row) => row.balance && row.label === "Credit balance" && row.value.includes("-")), "header balance retains customer credit");
assert.equal(data.totals.subtotalCents, 120000); assert.equal(data.totals.shippingCents, 1000); assert.equal(data.totals.taxCents, 6050); assert.equal(data.totals.withholdingCents, 12705); assert.equal(data.settlements.creditCents, 1000);
const laidOut = await renderDocumentWithLayout(<InvoicePdfDocument invoice={invoice} organization={{ name: "Example organization", address: "HIDDEN ORGANIZATION ADDRESS", email: "billing@example.test", registrationNumber: "REG-123" }} fonts={fonts} />);
const collectText = (nodes: any[]): string => nodes.map((node) => `${node.textContent || ""} ${collectText(node.children || [])}`).join(" ");
const imageAttachmentPage = laidOut.layout.pages.find((page) => collectText(page.elements).includes("Service photograph"));
assert.ok(imageAttachmentPage && collectImages(imageAttachmentPage.elements).length === 1, "image attachment page contains the actual uploaded image");
const raw = laidOut.pdf;
const verifyCellBounds = (nodes: any[], cell?: any) => { for (const node of nodes) { const parent = node.nodeType === "TableCell" ? node : cell; if (parent && node.nodeType === "TextLine") assert.ok(node.x >= parent.x - 1 && node.x + node.width <= parent.x + parent.width + 1, `Table text stays within its column: ${node.textContent}`); verifyCellBounds(node.children || [], parent); } };
laidOut.layout.pages.forEach((page) => verifyCellBounds(page.elements));
const bytes = await decorateDocumentPdf(await appendDocumentAttachments(raw, invoice), { config, fonts, layout: laidOut.layout, content: { invoice, organization: { name: "Example organization", address: "HIDDEN ORGANIZATION ADDRESS", registrationNumber: "REG-123" } }, paymentStub: { number: invoice.number, customer: invoice.billToName, total: data.money(data.totals.totalCents), balance: data.money(data.balance), height: documentPaymentStubHeight(data) } });
await mkdir("/workspace/scratch/advanced-document", { recursive: true }); await writeFile("/workspace/scratch/advanced-document/complete.pdf", bytes);
const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: true, disableFontFace: true }).promise;
let images = 0, paths = 0; const pages: string[] = [];
for (let index = 1; index <= pdf.numPages; index++) {
  const page = await pdf.getPage(index), content = await page.getTextContent(), operators = await page.getOperatorList();
  pages.push(content.items.map((item: any) => item.str || "").join(" ").replace(/\s+/g, " "));
  images += operators.fnArray.filter((operator) => [OPS.paintImageXObject, OPS.paintInlineImageXObject].includes(operator)).length;
  paths += operators.fnArray.filter((operator) => operator === OPS.constructPath).length;
}
const all = pages.join(" ");
await writeFile("/workspace/scratch/advanced-document/extracted.txt", pages.join("\n\nPAGE\n\n"));
for (const expected of ["Document ID", "Rich first header", "Rich continued header", "Rich first footer", "Rich continued footer", "APPROVED", "Tax summary", "Taxable amount", "Tax amount", "Shipping", "Credits applied", "Write-off", "Withholding", "Base currency", "Recorded example quote", "Amount in words", "EXAMPLE-ACCOUNT-001", "Open secure payment", "Service conditions", "Approval required", "Customer-specific additional terms", "Example maker", "PN-12", "9780000000002", "Custom-12", "Inventory traceability", "BATCH-12", "SERIAL-12", "Custom delivery annex", "Replacement assembly", "Service appendix", "Appendix content remains searchable", "Attached warranty certificate", "Service photograph", "Sample receiver", "Received and checked"]) assert.ok(all.includes(expected), `advanced PDF contains ${expected}`);
assert.ok(!all.includes("HIDDEN ORGANIZATION ADDRESS"));
assert.ok(pages[0].includes("Payment stub"), "first-page stub remains on page one despite a long item table");
assert.ok(pages.slice(1).every((page) => !page.includes("Payment stub")), "first-page-only stub does not repeat");
assert.ok(pdf.numPages >= 5 && images > 10 && paths > 20, "multipage document includes passive artwork, item pictures, signatures and native QR drawing");
assert.ok(pages[0].includes(`Page 1 of ${pdf.numPages}`));
const parsed = await PDFDocument.load(bytes); assert.equal(parsed.getPage(0).getWidth(), 1100); assert.equal(parsed.getPage(0).getHeight(), 1000);
assert.equal(parsed.getPage(parsed.getPageCount() - 1).node.Annots()?.size() || 0, 0, "appended source pages do not carry interactive annotations");
const firstText = await (await pdf.getPage(1)).getTextContent();
const positioned = firstText.items.find((item: any) => item.str?.includes("ATTENTION")) as any;
assert.ok(positioned && Math.abs(positioned.transform[4] - 230) < 1 && Math.abs(positioned.transform[5] - 719.6) < 1, "address X/Y offsets are physical points on the first page");
const receiver = firstText.items.find((item: any) => item.str?.includes("Sample receiver")) as any;
assert.ok(receiver && Math.abs(receiver.transform[4] - 520) < 1 && Math.abs(receiver.transform[5] - 944) < 1, "receiver signature is positioned on the first page");
const annotations = await (await pdf.getPage(1)).getAnnotations();
assert.ok(annotations.some((annotation: any) => annotation.url === "https://example.test/portal"), "safe rich-header links remain clickable after band embedding");
await mkdir("/workspace/scratch/advanced-document", { recursive: true }); await writeFile("/workspace/scratch/advanced-document/complete.pdf", bytes);
for (const index of [1, 2, pdf.numPages]) { const page = await pdf.getPage(index), viewport = page.getViewport({ scale: 0.9 }), canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height)); await page.render({ canvas: canvas as any, canvasContext: canvas.getContext("2d") as any, viewport }).promise; if (index === 1) { const pixels = canvas.getContext("2d").getImageData(Math.round(230 * .9), Math.round(260 * .9), Math.round(140 * .9), Math.round(60 * .9)).data; let dark = 0; for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset] < 180 && pixels[offset + 1] < 180 && pixels[offset + 2] < 180) dark++; assert.ok(dark > 80, "absolute customer text is visibly painted in its intended first-page rectangle"); } await writeFile(`/workspace/scratch/advanced-document/page-${index}.png`, canvas.toBuffer("image/png")); }
await pdf.destroy();
console.log("Advanced document checks passed: passive rich HTML/images, all blocks, custom geometry, independent styles/visibility, money/tax/FX, QR, first-page stub, signatures, item attributes, annexures and appended PDFs.");
