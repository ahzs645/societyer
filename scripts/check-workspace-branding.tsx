import assert from "node:assert/strict";
import React from "react";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { importInvoiceBrand } from "../shared/invoiceBranding";
import { workspaceAccentPalette, workspaceColorContrast, workspaceInitial, workspaceLogoSvg } from "../shared/workspaceBranding";
import { cleanWorkspaceBrand } from "../shared/workspaceBrandValidation";
import { WorkspaceLogo } from "../src/components/WorkspaceLogo";
import { formatDocumentTitle } from "../src/lib/documentTitle";

const ids = ["ddcnorth", "firstform", "overtheedge", "sparklab", "northwind", "bc-province-1977", "bc-hydro-1983"];
const brands = await Promise.all(ids.map(async id => importInvoiceBrand(JSON.parse(await readFile(new URL(`fixtures/brandkit/${id}.json`, import.meta.url), "utf8")))));
const colors = [...brands.map(brand => brand.primary), "#FFFFFF", "#000000", "#FFFF00", "#FF0000", "#00FF00", "#0000FF", "#808080"];
for (const dark of [false, true]) {
  const surfaces = dark ? ["#111113", "#19191b"] : ["#ffffff", "#f9f9fb"];
  for (const color of colors) {
    const palette = workspaceAccentPalette(color, dark, surfaces);
    for (const surface of [...surfaces, palette.soft, palette.strong]) assert.ok(workspaceColorContrast(palette.accent, surface) >= 4.5, `${color}: accent readable in ${dark ? "dark" : "light"}`);
    for (const surface of [...surfaces, palette.soft, palette.strong]) assert.ok(workspaceColorContrast(palette.text, surface) >= 4.5, `${color}: text readable on selected surfaces`);
    assert.ok(workspaceColorContrast(palette.on, palette.accent) >= 4.5, `${color}: button label contrast`);
    assert.ok(workspaceColorContrast(palette.on, palette.hover) >= 4.5, `${color}: hovered button label contrast`);
  }
}

for (const brand of brands) {
  const html = renderToStaticMarkup(<WorkspaceLogo organization={{ name: "Actual organization", workspaceBrand: brand }} presentation="full" />);
  const logos = [...html.matchAll(/src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/g)].map(match => decodeURIComponent(match[1].replace(/&amp;/g, "&")));
  assert.deepEqual(logos, [brand.logoSvg, brand.logoVariants!.reverse], `${brand.id}: supplied light/dark artwork is not recolored or cropped`);
  assert.ok(!html.includes("dangerouslySetInnerHTML"));
}
const fallback = renderToStaticMarkup(<WorkspaceLogo organization={{ name: " Actual organization " }} />);
const legacyStroke = cleanWorkspaceBrand({ ...brands[0], consumerProfileSchema: undefined, logoVariants: undefined,
  logoWidth: 100, logoHeight: 100, logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="none" stroke="#000000" stroke-width="5" d="M10 10H90"/></svg>' });
assert.match(workspaceLogoSvg(legacyStroke, "reverse"), /stroke="#FFFFFF"/);
assert.match(workspaceLogoSvg(legacyStroke, "reverse"), /fill="none"/);
assert.match(workspaceLogoSvg(legacyStroke, "primary"), /stroke="#000000"/);
assert.match(fallback, /workspace-logo__initial">A/);
assert.equal(workspaceInitial("   "), "W");
assert.equal(workspaceInitial("أحمد"), "أ");
assert.equal(formatDocumentTitle("Dashboard", "Workspace Alpha"), "Dashboard · Workspace Alpha · Societyer");
assert.equal(formatDocumentTitle("Settings", "\n Workspace   Beta \n"), "Settings · Workspace Beta · Societyer");
assert.equal(formatDocumentTitle("Dashboard"), "Dashboard · Societyer");
assert.equal(formatDocumentTitle(null), "Societyer");
console.log(`Workspace branding: ${brands.length} exact logo variants, ${colors.length * 2} readable accent palettes, fallback and workspace titles passed.`);
