import React from "react";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { Document, Page, Svg } from "@formepdf/react";
import { renderDocument } from "@formepdf/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import ddcnorth from "../shared/brandKits/ddcnorth.json";
import { importInvoiceBrand, invoiceBrandLogo, invoiceBrandPdfSvg } from "../shared/invoiceBranding";

const brand = importInvoiceBrand(ddcnorth);
const width = 200, height = width * brand.logoHeight / brand.logoWidth, scale = 6;
const reference = createCanvas(width * scale, Math.ceil(height * scale));
const referenceCtx = reference.getContext("2d"); referenceCtx.fillStyle = "white"; referenceCtx.fillRect(0, 0, reference.width, reference.height);
const svg = invoiceBrandLogo(brand);
const logo = await loadImage(Buffer.from(svg.replace("<svg ", `<svg width="${width * scale}" height="${height * scale}" `)));
referenceCtx.drawImage(logo, 0, 0, width * scale, height * scale);
const bytes = await renderDocument(<Document><Page size={{ width, height }} margin={0}><Svg width={width} height={height} content={invoiceBrandPdfSvg(brand)} /></Page></Document>);
const pdf = await getDocument({ data: bytes }).promise;
const page = await pdf.getPage(1), viewport = page.getViewport({ scale });
const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
await page.render({ canvas: canvas as any, canvasContext: canvas.getContext("2d") as any, viewport }).promise;
await mkdir("/workspace/scratch/logo-fidelity", { recursive: true });
await writeFile("/workspace/scratch/logo-fidelity/reference.png", reference.toBuffer("image/png"));
await writeFile("/workspace/scratch/logo-fidelity/pdf-fixed.png", canvas.toBuffer("image/png"));
const a = referenceCtx.getImageData(0, 0, reference.width, reference.height).data;
const b = canvas.getContext("2d").getImageData(0, 0, reference.width, reference.height).data;
let mismatch = 0, foreground = 0;
for (let i = 0; i < a.length; i += 4) {
  if (a[i] < 128) foreground++;
  if (Math.abs(a[i] - b[i]) > 60) mismatch++;
}
assert.ok(mismatch / foreground < 0.02, `PDF logo differs from source SVG by ${(mismatch / foreground * 100).toFixed(2)}%; check compound-path holes and winding.`);
console.log(`Invoice logo fidelity passed: ${(mismatch / foreground * 100).toFixed(2)}% pixel difference from the source SVG (2% rendering tolerance).`);
await pdf.destroy();
