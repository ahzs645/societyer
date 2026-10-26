import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";

async function pick(page: Page, scope: Locator, label: string, option: string) {
  await scope.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("reusable templates and rates persist; repair billing links payments and downloads a PDF", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(30_000);
  const name = `Workshop ${Date.now()}`;
  await page.goto("/app/invoices?tab=templates");
  await page.getByRole("button", { name: "Use ddcnorth brand", exact: true }).click();
  let drawer = page.getByRole("dialog");
  await expect(drawer).toContainText("Document body font: Inter.");
  await drawer.getByLabel("Template name", { exact: true }).fill(name);
  await pick(page, drawer, "Layout", "Modern");
  await drawer.getByLabel("Footer", { exact: true }).fill("Repair warranty: 90 days");
  await drawer.getByText("Use for new invoices by default", { exact: true }).click();
  await drawer.getByRole("button", { name: "Save template", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page.locator(".invoice-template-card").filter({ hasText: name })).toContainText("Default");

  await page.goto("/app/invoices?tab=catalog");
  await page.getByRole("button", { name: "New item", exact: true }).click();
  drawer = page.getByRole("dialog");
  await drawer.getByLabel("Name", { exact: true }).fill(`${name} labour`);
  await drawer.getByLabel(/^Unit (price|rate)/).fill("85.00");
  await drawer.getByLabel("Unit", { exact: true }).fill("hour");
  await pick(page, drawer, "Type", "Service / labour");
  await drawer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page.locator("tr").filter({ hasText: `${name} labour` })).toContainText("CAD / hour");

  await page.goto("/app/invoices?tab=price_lists");
  await page.getByRole("button", { name: "New price list", exact: true }).click();
  drawer = page.getByRole("dialog");
  await drawer.getByLabel("Name", { exact: true }).fill(`${name} trade`);
  await drawer.getByLabel(`${name} labour / hour (CAD)`, { exact: true }).fill("70.00");
  await drawer.getByRole("button", { name: "Save price list", exact: true }).click();
  await expect(drawer).not.toBeVisible();

  await page.goto("/app/invoices?builder=new");
  await expect(page.getByLabel("Template", { exact: true })).toContainText(name);
  await pick(page, page.locator(".invoice-builder__form"), "Price list", `${name} trade (CAD)`);
  await page.getByRole("button", { name: "From catalog", exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(`${name} labour`) }).click();
  await expect(page.locator(".line-editor__field--price input")).toHaveValue("70.00");
  await page.goto("/app/invoices?tab=repairs");
  await page.getByRole("button", { name: "New repair", exact: true }).click();
  drawer = page.getByRole("dialog");
  await drawer.getByRole("combobox", { name: "Bill to", exact: true }).fill(name);
  await page.getByRole("option", { name: /Create customer/ }).last().click();
  await expect(drawer.locator(".billto__name")).toHaveText(name);
  await drawer.getByLabel("Equipment / item", { exact: true }).fill("Bicycle");
  await drawer.getByLabel("Serial number", { exact: true }).fill("FRAME-001");
  await drawer.getByLabel("Problem reported", { exact: true }).fill("Brake adjustment");
  await drawer.getByRole("button", { name: "From catalog", exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(`${name} labour`) }).click();
  await drawer.getByRole("button", { name: "Save repair", exact: true }).click();
  await expect(drawer).toContainText("Received");
  await drawer.getByRole("button", { name: "Create invoice", exact: true }).click();
  await expect(drawer).toContainText("View linked repair");
  await drawer.getByRole("button", { name: "Record payment", exact: true }).click();
  await drawer.getByLabel("Amount", { exact: true }).fill("25.00");
  await drawer.getByRole("form", { name: /^Record a payment for / }).getByRole("button", { name: "Record $25.00", exact: true }).click();
  await expect(drawer).toContainText("Partially paid");
  await expect(drawer).toContainText("E-transfer");
  await drawer.getByRole("button", { name: /More actions for/ }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download PDF", exact: true }).click();
  const download = await downloading;
  await download.saveAs("/workspace/scratch/invoice-pdf/ddcnorth-browser.pdf");
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const path = await download.path();
  const pdf = await PDFDocument.load(await readFile(path!));
  expect(pdf.getPageCount()).toBe(1);
  await page.reload();
  await expect(page.getByRole("dialog")).toContainText("Partially paid");
  await page.getByRole("link", { name: /View linked repair/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Balance");
  await expect(page.getByRole("dialog").getByRole("button", { name: "View invoice", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("portable Brandkit profiles import, preview and persist with explicit font fallback", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/app/invoices?tab=templates");
  await page.getByRole("button", { name: "New template", exact: true }).click();
  const drawer = page.getByRole("dialog");
  const name = `Portable Brandkit ${Date.now()}`;
  await drawer.getByLabel("Template name", { exact: true }).fill(name);
  for (const [id, title, font] of [
    ["ddcnorth", "ddcnorth", "Inter"], ["overtheedge", "Over the Edge", "Inter (fallback for Helvetica Neue)"],
    ["sparklab", "SPARK Lab", "Noto Serif (fallback for Source Serif 4)"], ["northwind", "northwind", "Inter"],
    ["bc-province-1977", "Province of British Columbia", "Inter (fallback for TeX Gyre Heros)"],
    ["bc-hydro-1983", "B.C.Hydro", "Noto Serif (fallback for TeX Gyre Termes)"],
    ["firstform", "First Form", "Inter (fallback for Sora)"],
  ]) {
    await drawer.getByLabel("Import Brandkit profile", { exact: true }).setInputFiles(fileURLToPath(new URL(`../scripts/fixtures/brandkit/${id}.json`, import.meta.url)));
    await expect(drawer.locator(".invoice-brand-controls")).toContainText(title);
    await expect(drawer.locator(".invoice-brand-controls")).toContainText(`Document body font: ${font}.`);
    await expect(drawer.getByRole("img", { name: `${title} logo`, exact: true })).toBeVisible();
  }
  const downloading = page.waitForEvent("download");
  await drawer.getByRole("button", { name: "Download sample PDF", exact: true }).click();
  const download = await downloading;
  const pdf = await PDFDocument.load(await readFile((await download.path())!));
  expect(pdf.getPageCount()).toBe(1);
  await drawer.getByRole("button", { name: "Save template", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await page.reload();
  const card = page.locator(".invoice-template-card").filter({ hasText: name });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Customize", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Inter (fallback for Sora)");
  expect(errors).toEqual([]);
});
