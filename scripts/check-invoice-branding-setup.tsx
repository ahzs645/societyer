import React from "react";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import { renderDocument } from "@formepdf/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { importInvoiceBrand } from "../shared/invoiceBranding";
import { cleanInvoiceTemplate, DEFAULT_INVOICE_TEMPLATE, resolveDocumentDesign } from "../shared/invoiceCommerce";
import { InvoicePdfDocument } from "../src/features/invoicing/InvoicePdfDocument";
import { BrandedReportPdfDocument } from "../src/features/financials/reports/BrandedReportPdfDocument";

const artifacts = "/workspace/scratch/invoice-branding-setup";
await mkdir(artifacts, { recursive: true });
const image = createCanvas(400, 100), ink = image.getContext("2d");
ink.fillStyle = "#13A6B8"; ink.fillRect(0, 0, 300, 100);
ink.fillStyle = "#E98C21"; ink.fillRect(300, 0, 100, 100);
const png = image.toBuffer("image/png"), customLogo = `data:image/png;base64,${png.toString("base64")}`;
await writeFile(`${artifacts}/custom-logo.png`, png);

assert.throws(() => cleanInvoiceTemplate({ ...DEFAULT_INVOICE_TEMPLATE, customLogo: "https://example.test/logo.png" }), /PNG or JPEG/);
assert.throws(() => cleanInvoiceTemplate({ ...DEFAULT_INVOICE_TEMPLATE, customLogo: "data:image/svg+xml;base64,PHN2Zz4=" }), /PNG or JPEG/);
assert.throws(() => cleanInvoiceTemplate({ ...DEFAULT_INVOICE_TEMPLATE, customLogo: "data:image/png;base64,YmFk" }), /image content/);
assert.throws(() => cleanInvoiceTemplate({ ...DEFAULT_INVOICE_TEMPLATE, customLogo: customLogo + "A".repeat(240000) }), /PNG or JPEG/);

// Exercise Convex's real table validator, including metadata omitted by the old Brandkit validator.
const hosted = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
});
const profiles = ["ddcnorth", "firstform", "overtheedge", "sparklab", "northwind", "bc-province-1977", "bc-hydro-1983"];
await hosted.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "Brand setup test", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  for (const profile of profiles) {
    const brand = importInvoiceBrand(JSON.parse(await readFile(new URL(`./fixtures/brandkit/${profile}.json`, import.meta.url), "utf8")));
    const config = cleanInvoiceTemplate({ ...DEFAULT_INVOICE_TEMPLATE, name: profile, brand, customLogo, accentColor: "#8D2369" });
    const id = await ctx.db.insert("invoiceTemplates", { societyId, config, active: true, createdAtISO: "2026-11-05", updatedAtISO: "2026-11-05" });
    const saved = await ctx.db.get(id);
    assert.deepEqual(saved?.config, JSON.parse(JSON.stringify(config)), `${profile}: hosted schema accepts all portable profile and custom-logo fields`);
  }
});

const fonts = await Promise.all([
  { family: "Invoice", file: "Inter-Regular.ttf" },
  { family: "Invoice", file: "Inter-SemiBold.ttf", fontWeight: "bold" as const },
].map(async ({ file, ...font }) => ({ ...font, src: new Uint8Array(await readFile(`src/assets/invoice-branding/${file}`)) })));

for (const layout of ["classic", "modern", "compact"] as const) {
  const config = cleanInvoiceTemplate({ ...DEFAULT_INVOICE_TEMPLATE, customLogo, accentColor: "#8D2369", layout });
  const invoice = {
    number: `UPLOAD-${layout}`, issueDate: "2026-11-05", dueDate: "2026-12-05", terms: "net_30", currency: "CAD",
    billToName: "Custom logo customer", lines: [{ key: "a", item: "Program registration", quantity: 1, unitPriceCents: 12500 }],
    documentTemplate: config, paymentInstructions: "Reference this invoice number.",
    paymentMethods: [{ id: "eft", name: "Society EFT", type: "eft" as const, details: "Test account holder\nInstitution 000 · Transit 12345 · Account 0000000" }],
  };
  const bytes = await renderDocument(<InvoicePdfDocument invoice={invoice} organization={{ name: "Society branded for testing" }} fonts={fonts} paymentInstructions="OBSOLETE LIVE SETTINGS" />);
  await writeFile(`${artifacts}/${layout}.pdf`, bytes);
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: true, disableFontFace: true }).promise;
  assert.equal(pdf.numPages, 1);
  const page = await pdf.getPage(1), viewport = page.getViewport({ scale: 2 });
  const extracted = (await page.getTextContent()).items.map((item: any) => item.str ?? "").join(" ");
  for (const expected of [invoice.number, "Society EFT", "12345", "0000000", "Reference this invoice number."]) assert.ok(extracted.includes(expected), `${layout}: expected PDF text ${expected}`);
  assert.ok(!extracted.includes("OBSOLETE LIVE SETTINGS"), "invoice payment snapshots override later settings");
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvas: canvas as any, canvasContext: canvas.getContext("2d") as any, viewport }).promise;
  await writeFile(`${artifacts}/${layout}.png`, canvas.toBuffer("image/png"));
  const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const i = (y * canvas.width + x) * 4;
    if (Math.abs(pixels[i] - 19) < 10 && Math.abs(pixels[i + 1] - 166) < 10 && Math.abs(pixels[i + 2] - 184) < 10) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  }
  assert.ok(Number.isFinite(minX), `${layout}: uploaded logo actually paints into PDF`);
  const ratio = (maxX - minX + 1) / (maxY - minY + 1);
  assert.ok(Math.abs(ratio - 3) < 0.08, `${layout}: uploaded logo preserves its source aspect ratio (${ratio})`);
  const design = resolveDocumentDesign(config);
  assert.equal(design.typography.header.color, "#8D2369");
  await pdf.destroy();
}
const reportBrand = importInvoiceBrand(JSON.parse(await readFile(new URL("./fixtures/brandkit/firstform.json", import.meta.url), "utf8")));
const reportBytes = await renderDocument(<BrandedReportPdfDocument
  template={{ ...DEFAULT_INVOICE_TEMPLATE, brand: reportBrand, customLogo, logoVariant: "reverse" }}
  organization={{ name: "Society report" }} fonts={fonts}
  report={{ title: "Custom logo report", currency: "CAD", filterSummary: ["Synthetic invoice setup verification"], columns: [{ key: "metric", label: "Metric" }, { key: "amount", label: "Amount", align: "right" }], rows: [{ key: "revenue", cells: ["Revenue", "$125.00"] }] }}
/>);
await writeFile(`${artifacts}/report-custom-logo.pdf`, reportBytes);
const reportPdf = await getDocument({ data: reportBytes.slice(), useSystemFonts: true, disableFontFace: true }).promise;
const reportPage = await reportPdf.getPage(1), reportViewport = reportPage.getViewport({ scale: 2 });
const reportCanvas = createCanvas(Math.ceil(reportViewport.width), Math.ceil(reportViewport.height));
await reportPage.render({ canvas: reportCanvas as any, canvasContext: reportCanvas.getContext("2d") as any, viewport: reportViewport }).promise;
await writeFile(`${artifacts}/report-custom-logo.png`, reportCanvas.toBuffer("image/png"));
const reportPixels = reportCanvas.getContext("2d").getImageData(0, 0, reportCanvas.width, reportCanvas.height).data;
let paintedLogoPixels = 0;
for (let i = 0; i < reportPixels.length; i += 4) if (Math.abs(reportPixels[i] - 19) < 10 && Math.abs(reportPixels[i + 1] - 166) < 10 && Math.abs(reportPixels[i + 2] - 184) < 10) paintedLogoPixels++;
assert.ok(paintedLogoPixels > 25000, "report PDF paints the custom logo instead of the Brandkit reverse variant");
await reportPdf.destroy();
console.log("Invoice branding setup passed: seven Brandkit profiles accepted by the real hosted schema, bounded custom image validation, uploaded-logo PDF painting/aspect ratio in all three layouts and reports, saved payment text and custom accent colors.");
