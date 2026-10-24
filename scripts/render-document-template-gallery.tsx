import React from "react";
import JSZip from "jszip";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import type { FontRegistration } from "@formepdf/react";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DOCUMENT_TEMPLATE_PRESETS } from "../shared/documentTemplatePresets";
import { cleanInvoiceTemplate, resolveDocumentDesign, type InvoiceTemplate } from "../shared/invoiceCommerce";
import { documentTemplateSample } from "../src/features/invoicing/documentTemplateSamples";
import { renderSampleDocumentPdf } from "./lib/render-document-sample";

/** Render actual application documents for the visible preset gallery, never mock thumbnails. */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const writeThumbnails = process.argv.includes("--write-thumbnails");
const outputDirectory = resolve(process.argv.slice(2).find((argument) => !argument.startsWith("--")) ?? "/workspace/scratch/document-template-gallery");
const thumbnailDirectory = resolve(repositoryRoot, "src/assets/document-templates");
const organization = { name: "Your organization", email: "billing@example.test", address: "Example organization address" };
const context = { today: "2026-10-22", currency: "CAD" };
const bytesFor = (file: string) => readFile(resolve(repositoryRoot, file)).then((bytes) => new Uint8Array(bytes));
const [sans, sansBold, serif, serifBold, mono, display] = await Promise.all([
  bytesFor("src/assets/invoice-branding/Inter-Regular.ttf"), bytesFor("src/assets/invoice-branding/Inter-SemiBold.ttf"),
  bytesFor("src/assets/pdf-fonts/NotoSerif-Regular.ttf"), bytesFor("src/assets/pdf-fonts/NotoSerif-Bold.ttf"),
  bytesFor("src/assets/invoice-branding/SpaceMono-Regular.ttf"), bytesFor("src/assets/invoice-branding/InterDisplay-Medium.ttf"),
]);
GlobalFonts.registerFromPath(resolve(repositoryRoot, "src/assets/invoice-branding/Inter-Regular.ttf"), "GalleryInter");
GlobalFonts.registerFromPath(resolve(repositoryRoot, "src/assets/invoice-branding/Inter-SemiBold.ttf"), "GalleryInterBold");
function fontsFor(config: InvoiceTemplate): FontRegistration[] {
  const brandSerif = !config.brand || config.brand.font === "serif";
  return [
    { family: "Invoice", src: brandSerif ? serif : sans }, { family: "Invoice", src: brandSerif ? serifBold : sansBold, fontWeight: "bold" },
    { family: "InvoiceSans", src: sans }, { family: "InvoiceSans", src: sansBold, fontWeight: "bold" },
    { family: "InvoiceSerif", src: serif }, { family: "InvoiceSerif", src: serifBold, fontWeight: "bold" },
    { family: "InvoiceMono", src: mono }, { family: "InvoiceMono", src: mono, fontWeight: "bold" },
    { family: "InvoiceDisplay", src: display }, { family: "InvoiceLabel", src: mono },
  ];
}
await mkdir(outputDirectory, { recursive: true });
if (writeThumbnails) await mkdir(thumbnailDirectory, { recursive: true });
assert.equal(DOCUMENT_TEMPLATE_PRESETS.length, 12, "The starter gallery contains twelve distinct templates.");
assert.equal(new Set(DOCUMENT_TEMPLATE_PRESETS.map((preset) => preset.id)).size, DOCUMENT_TEMPLATE_PRESETS.length, "Preset identifiers are unique.");
const rendered: Array<{ id: string; name: string; description: string; kind: string; pdf: string; png: string; pages: number; pageSize: { width: number; height: number }; inkPixels: number }> = [];
for (const [index, preset] of DOCUMENT_TEMPLATE_PRESETS.entries()) {
  const config = cleanInvoiceTemplate(preset.config), design = resolveDocumentDesign(config), fonts = fontsFor(config);
  const sample = documentTemplateSample(config, preset.recommendedDocumentKind, context);
  const bytes = await renderSampleDocumentPdf(sample, config, organization, fonts, "Pay by e-transfer using the document number as your reference.");
  const safeId = preset.id.replace(/[^a-z0-9_-]/gi, "-");
  const filename = `${String(index + 1).padStart(2, "0")}-${safeId}`;
  const pdfPath = resolve(outputDirectory, `${filename}.pdf`), pngPath = resolve(outputDirectory, `${filename}.png`);
  await writeFile(pdfPath, bytes);
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: true, disableFontFace: true }).promise;
  assert.ok(pdf.numPages > 0 && pdf.numPages < 12, `${preset.name}: sample has a reasonable page count.`);
  let extracted = "";
  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex++) {
    const page = await pdf.getPage(pageIndex), viewport = page.getViewport({ scale: 1 });
    const text = await page.getTextContent();
    const items = text.items.filter((item: any) => item.str?.trim()) as Array<{ str: string; width: number; height: number; transform: number[] }>;
    assert.ok(items.length > 4, `${preset.name}: page ${pageIndex} has searchable document content.`);
    extracted += ` ${items.map((item) => item.str).join(" ")}`;
    // Baselines and glyph runs must stay inside the physical page. Intentional font ascenders
    // have a small tolerance; margin bands and regular content share this same check.
    for (const item of items) {
      assert.ok(item.transform[4] >= -1 && item.transform[4] + item.width <= viewport.width + 3, `${preset.name}: text runs remain inside page width (${item.str}).`);
      assert.ok(item.transform[5] >= -1 && item.transform[5] <= viewport.height + 1, `${preset.name}: text baseline remains inside page height.`);
    }
  }
  assert.ok(extracted.includes(organization.name), `${preset.name}: clearly marked sample organization is present.`);
  if (sample.kind === "report") assert.ok(extracted.includes(sample.report.title), `${preset.name}: report title is searchable.`);
  else assert.ok(extracted.includes(sample.invoice.number), `${preset.name}: document number is searchable.`);
  const page = await pdf.getPage(1), dimensions = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: 760 / dimensions.width });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const canvasContext = canvas.getContext("2d");
  await page.render({ canvas: canvas as any, canvasContext: canvasContext as any, viewport }).promise;
  const pixels = canvasContext.getImageData(0, 0, canvas.width, canvas.height).data;
  let inkPixels = 0;
  for (let pixel = 0; pixel < pixels.length; pixel += 4) if (pixels[pixel] < 210 || pixels[pixel + 1] < 210 || pixels[pixel + 2] < 210) inkPixels++;
  assert.ok(inkPixels > canvas.width * canvas.height * 0.005, `${preset.name}: rendered thumbnail contains visible document artwork.`);
  await writeFile(pngPath, canvas.toBuffer("image/png"));
  if (writeThumbnails) {
    const thumbnail = createCanvas(400, Math.ceil(canvas.height * 400 / canvas.width));
    thumbnail.getContext("2d").drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
    await writeFile(resolve(thumbnailDirectory, `${safeId}.png`), thumbnail.toBuffer("image/png"));
  }
  rendered.push({ id: preset.id, name: preset.name, description: preset.description, kind: sample.kind, pdf: pdfPath, png: pngPath, pages: pdf.numPages, pageSize: { width: dimensions.width, height: dimensions.height }, inkPixels });
  await pdf.destroy();
  console.log(`Rendered ${index + 1}/${DOCUMENT_TEMPLATE_PRESETS.length}: ${preset.name} (${sample.kind}, ${rendered.at(-1)!.pages} page${rendered.at(-1)!.pages === 1 ? "" : "s"}, ${design.page.orientation}).`);
}

const sheetWidth = 1400, margin = 24, gap = 20, columns = 4, cardHeight = 502, titleHeight = 100;
const cardWidth = (sheetWidth - margin * 2 - gap * (columns - 1)) / columns;
const rows = Math.ceil(rendered.length / columns), sheetHeight = titleHeight + rows * cardHeight + (rows - 1) * gap + margin;
const sheet = createCanvas(sheetWidth, sheetHeight), ctx = sheet.getContext("2d");
ctx.fillStyle = "#eef1f5"; ctx.fillRect(0, 0, sheetWidth, sheetHeight);
ctx.fillStyle = "#102d48"; ctx.font = "34px GalleryInterBold"; ctx.fillText("Societyer document templates", margin, 44);
ctx.fillStyle = "#526173"; ctx.font = "16px GalleryInter"; ctx.fillText("12 editable starting points · Actual PDF renders · Sample organization and customer data", margin, 76);
for (const [index, item] of rendered.entries()) {
  const x = margin + index % columns * (cardWidth + gap), y = titleHeight + Math.floor(index / columns) * (cardHeight + gap);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(x, y, cardWidth, cardHeight);
  ctx.strokeStyle = "#d0d8e2"; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, cardWidth - 1, cardHeight - 1);
  ctx.fillStyle = "#102d48"; ctx.font = "18px GalleryInterBold";
  // Preset names stay at their true label; long names wrap over two lines.
  const words = `${String(index + 1).padStart(2, "0")}  ${item.name}`.split(" ");
  const lines: string[] = []; let line = "";
  for (const word of words) { const next = line ? `${line} ${word}` : word; if (line && ctx.measureText(next).width > cardWidth - 24) { lines.push(line); line = word; } else line = next; }
  if (line) lines.push(line);
  lines.slice(0, 2).forEach((text, row) => ctx.fillText(text, x + 12, y + 25 + row * 22));
  const subtitleY = y + (lines.length > 1 ? 64 : 48);
  ctx.font = "12px GalleryInter"; ctx.fillStyle = "#526173";
  ctx.fillText(`${item.kind.replace("_", " ")} · ${item.pages} page${item.pages === 1 ? "" : "s"}`, x + 12, subtitleY);
  const image = await loadImage(item.png), maxWidth = cardWidth - 28, maxHeight = cardHeight - 90;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const imageWidth = image.width * scale, imageHeight = image.height * scale;
  const imageX = x + (cardWidth - imageWidth) / 2, imageY = y + 78;
  ctx.fillStyle = "#e6eaf0"; ctx.fillRect(imageX + 2, imageY + 3, imageWidth, imageHeight);
  ctx.drawImage(image, imageX, imageY, imageWidth, imageHeight);
  ctx.strokeStyle = "#d4dbe4"; ctx.strokeRect(imageX, imageY, imageWidth, imageHeight);
}
const contactSheet = resolve(outputDirectory, "template-contact-sheet.png");
await writeFile(contactSheet, sheet.toBuffer("image/png"));
const manifest = JSON.stringify({ generatedWith: "Societyer native document renderer", sampleDate: context.today, sampleCurrency: context.currency, organization, contactSheet, templates: rendered }, null, 2);
await writeFile(resolve(outputDirectory, "manifest.json"), manifest);
const archive = new JSZip();
for (const item of rendered) {
  archive.file(`pdfs/${item.pdf.split("/").at(-1)}`, await readFile(item.pdf));
  archive.file(`previews/${item.png.split("/").at(-1)}`, await readFile(item.png));
}
archive.file("template-contact-sheet.png", sheet.toBuffer("image/png"));
archive.file("manifest.json", manifest);
await writeFile(resolve(outputDirectory, "societyer-template-gallery.zip"), await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));
console.log(`Gallery ready: ${contactSheet}`);
