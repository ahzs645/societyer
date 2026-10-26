import React from "react";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { Document, Page, Svg } from "@formepdf/react";
import { renderDocument } from "@formepdf/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import ddcnorth from "../shared/brandKits/ddcnorth.json";
import { importInvoiceBrand, cleanInvoiceBrand, invoiceBrandFontDescription, invoiceBrandLogo, invoiceBrandPdfSvg } from "../shared/invoiceBranding";
import { BRANDKIT_PROFILE_SCHEMA } from "../shared/brandkitLogo";
import { cleanInvoiceTemplate, DEFAULT_INVOICE_TEMPLATE } from "../shared/invoiceCommerce";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { tables, society } from "../src/lib/staticConvexFixtures";
import * as invoices from "../shared/functions/invoices";

const ids = ["ddcnorth", "firstform", "overtheedge", "sparklab", "northwind", "bc-province-1977", "bc-hydro-1983"];
const profiles = await Promise.all(ids.map(async (id) => JSON.parse(await readFile(new URL(`./fixtures/brandkit/${id}.json`, import.meta.url), "utf8"))));
const brands = profiles.map((profile) => importInvoiceBrand(profile));
for (const brand of brands) {
  assert.equal(brand.consumerProfileSchema, BRANDKIT_PROFILE_SCHEMA);
  assert.deepEqual(cleanInvoiceBrand(brand), brand, `${brand.id}: saved artwork is stable`);
  assert.deepEqual(cleanInvoiceTemplate({ ...DEFAULT_INVOICE_TEMPLATE, brand }).brand, brand);
  assert.ok(!/transform=|<g\b|<text\b|<ellipse\b|<polygon\b/.test(brand.logoSvg));
}
assert.equal(invoiceBrandFontDescription(brands[1]), "Inter (fallback for Sora)");
assert.equal(invoiceBrandFontDescription(brands[3]), "Noto Serif (fallback for Source Serif 4)");
assert.equal(invoiceBrandFontDescription(brands[6]), "Noto Serif (fallback for TeX Gyre Termes)");
assert.equal(invoiceBrandFontDescription(brands[0]), "Inter");
assert.ok(new Set([...brands[3].logoSvg.matchAll(/fill="(#[0-9A-F]{6})"/g)].map((m) => m[1])).size > 1, "SparkLab retains its multicolor primary logo");
assert.match(brands[6].logoSvg, /stroke="#/);

const legacy = importInvoiceBrand(ddcnorth);
assert.equal((legacy.logoSvg.match(/<circle /g) ?? []).length, 6);
assert.equal(legacy.logoSvg, cleanInvoiceBrand(legacy).logoSvg);
assert.equal(legacy.consumerProfileSchema, undefined);
assert.match(invoiceBrandLogo(legacy, "reverse"), /fill="#FFFFFF"/);
const legacyStroke = cleanInvoiceBrand({ ...legacy, logoWidth: 100, logoHeight: 100, logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="none" stroke="#000000" stroke-width="5" d="M10 10H90"/></svg>' });
assert.match(invoiceBrandPdfSvg(legacyStroke, "primary", 200), /stroke-width="5"/, "legacy stroked snapshots retain their prior PDF stroke behavior");
assert.throws(() => importInvoiceBrand({ ...ddcnorth, symbol: { paths: [] } }), /consumer-profile\.json/);
assert.throws(() => importInvoiceBrand({ ...profiles[0], schema: "brandkit/consumer-profile/2" }), /version/);
assert.throws(() => importInvoiceBrand({ ...profiles[0], logos: { primary: profiles[0].logos.primary } }), /viewBox/);
assert.throws(() => importInvoiceBrand({ ...profiles[0], colours: { ...profiles[0].colours, primary: "url(https://example.test)" } }), /color/);
const mismatched = structuredClone(profiles[0]); mismatched.logos.black.viewBox[2]++;
assert.throws(() => importInvoiceBrand(mismatched), /share a viewBox/);

const attack = (svg: string) => {
  const profile = structuredClone(profiles[0]);
  profile.logos.primary = { svg, viewBox: [0, 0, 10, 10] };
  for (const key of ["black", "reverse"]) profile.logos[key] = { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0H10V10Z"/></svg>', viewBox: [0, 0, 10, 10] };
  assert.throws(() => importInvoiceBrand(profile), /vector/);
};
const wrap = (content: string, attributes = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" ${attributes}>${content}</svg>`;
attack(wrap('<script>alert(1)</script>'));
attack(wrap('<path d="M0 0H10V10Z" onload="alert(1)"/>'));
attack(wrap('<path d="M0 0H10V10Z" style="fill:red"/>'));
attack(wrap('<use href="https://example.test/logo.svg#mark"/>'));
attack(wrap('<path d="M0 0H10V10Z" fill="url(https://example.test)"/>'));
attack(wrap('<g xmlns="http://www.w3.org/1999/xhtml"><path d="M0 0H10V10Z"/></g>'));
attack('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + wrap('<title>&x;</title><path d="M0 0H10V10Z"/>'));
attack(wrap('<path d="M0 0H10V10Z" transform="bogus(1)"/>'));
attack(wrap('<path d="M1"/>'));
attack(wrap('<circle cx="5" cy="5" r="2" stroke="#000000" transform="scale(2 1)"/>'));
attack(wrap('<path d="M0 0H10V10Z"/>', 'viewBox="0 0 20 20"'));
attack(wrap('<path d="M0 0H10V10Z"/>' + " ".repeat(200000)));
assert.throws(() => cleanInvoiceBrand({ ...brands[0], logoVariants: { ...brands[0].logoVariants!, reverse: wrap('<script/>') } }), /vector/);

// A profile is a presentation choice. Existing invoice snapshots and organization facts survive.
const seed: Record<string, any[]> = structuredClone(tables);
seed.users = seed.users.map((user) => ({ ...user, status: "Active", authIssuer: "https://issuer.test", authSubject: `sub-${user._id}` }));
seed.societies = [structuredClone(society)];
const db = new MemoryDb({ seed }), user = seed.users[0], societyId = user.societyId;
const ctx: any = { db, principal: { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: user.authSubject, issuer: user.authIssuer, userId: user._id, societyId }, capabilities: makeCapabilities({}) };
const organizationBefore = structuredClone(await db.get(societyId));
const templateId = await invoices.upsertTemplatePortable(ctx, { societyId, config: { ...DEFAULT_INVOICE_TEMPLATE, brand: legacy }, makeDefault: true });
const args = { societyId, partyKind: "custom", billToName: "Profile test customer", issueDate: "2026-10-26", terms: "due_on_receipt", currency: "CAD", lines: [{ key: "service", item: "Service", quantity: 1, unitPriceCents: 10000 }] };
const oldId = await invoices.upsertPortable(ctx, args);
await db.patch(oldId, { status: "sent" });
const issuedBefore = structuredClone(await db.get(oldId));
await invoices.upsertTemplatePortable(ctx, { societyId, id: templateId, config: { ...DEFAULT_INVOICE_TEMPLATE, brand: brands[1] }, makeDefault: true });
assert.deepEqual(await db.get(oldId), issuedBefore, "applying another brand cannot restyle an issued invoice");
assert.deepEqual(await db.get(societyId), organizationBefore, "legal, contact and billing organization data is unchanged");
const fresh: any = await db.get(await invoices.upsertPortable(ctx, args));
assert.deepEqual(fresh.documentTemplate.brand, JSON.parse(JSON.stringify(brands[1])), "new invoices snapshot the selected portable brand");
assert.equal(fresh.billToName, args.billToName);
assert.equal(fresh.totalCents, 10000);

// Compare the exact exported SVG, normalized HTML artwork, and the PDF vector rendering.
const width = 240, scale = 4;
async function svgPixels(svg: string, viewBox: number[], height: number, background: string) {
  const canvas = createCanvas(width * scale, Math.ceil(height * scale)), context = canvas.getContext("2d");
  context.fillStyle = background; context.fillRect(0, 0, canvas.width, canvas.height);
  // Use an integral raster viewport without stretching a truncated source image back to a
  // fractional height; that resampling can obscure real geometry differences on thin artwork.
  const sized = svg.replace(/<svg\b[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="${viewBox.join(" ")}" preserveAspectRatio="xMinYMin">`);
  context.drawImage(await loadImage(Buffer.from(sized)), 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}
function difference(a: Uint8ClampedArray, b: Uint8ClampedArray, background: string) {
  const bg = [1, 3, 5].map((offset) => parseInt(background.slice(offset, offset + 2), 16));
  let foreground = 0, mismatch = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (bg.some((n, c) => Math.abs(a[i + c] - n) > 60 || Math.abs(b[i + c] - n) > 60)) foreground++;
    if (bg.some((_, c) => Math.abs(a[i + c] - b[i + c]) > 60)) mismatch++;
  }
  assert.ok(foreground > 0, "the logo must render visible artwork");
  return mismatch / foreground;
}
const fidelityFailures: string[] = [];
for (let index = 0; index < profiles.length; index++) {
  const profile = profiles[index], brand = brands[index], height = width * brand.logoHeight / brand.logoWidth;
  for (const variant of ["primary", "black", "reverse"] as const) {
    const background = variant === "reverse" ? brand.primary : "#FFFFFF";
    const source = await svgPixels(profile.logos[variant].svg, profile.logos[variant].viewBox, height, background);
    const normalized = await svgPixels(invoiceBrandLogo(brand, variant), profile.logos[variant].viewBox, height, background);
    const htmlDifference = difference(source, normalized, background);
    assert.ok(htmlDifference < 0.02, `${brand.id}/${variant}: normalized logo differs from source by ${(htmlDifference * 100).toFixed(2)}%`);
    const bytes = await renderDocument(<Document><Page size={{ width, height }} margin={0}><Svg width={width} height={height} content={invoiceBrandPdfSvg(brand, variant, width)} /></Page></Document>);
    const pdf = await getDocument({ data: bytes }).promise;
    try {
      const page = await pdf.getPage(1), viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvas: canvas as any, canvasContext: canvas.getContext("2d") as any, viewport, background }).promise;
      const pdfDifference = difference(source, canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data, background);
      if (pdfDifference >= 0.02) fidelityFailures.push(`${brand.id}/${variant}: PDF logo differs from source by ${(pdfDifference * 100).toFixed(2)}%`);
      console.log(`${brand.id}/${variant}: HTML ${(htmlDifference * 100).toFixed(2)}%, PDF ${(pdfDifference * 100).toFixed(2)}% pixel difference`);
    } finally { await pdf.destroy(); }
  }
}
assert.deepEqual(fidelityFailures, [], "PDF artwork should match source within the 2% rasterization tolerance");
console.log("Brandkit profiles passed: seven brands, three variants each, SVG/PDF fidelity, passive-vector validation, font fallback and immutable invoice snapshots.");
