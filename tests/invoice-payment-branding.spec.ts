import { test, expect, type Locator, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const artifacts = "/workspace/scratch/invoice-payment-branding";
type Raster = { pixels: Uint8ClampedArray; width: number; height: number };

async function actualPreview(page: Page) {
  const paper = page.locator(".invoice-paper");
  await expect(paper.locator('canvas[aria-label="PDF page 1"]')).toBeVisible();
  await expect(paper.locator(".textLayer").first()).toBeVisible();
  return paper;
}

function colorPixels(raster: Raster, color: string, region = { left: 0, right: 1, top: 0, bottom: 1 }) {
  const rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
  let count = 0;
  for (let y = Math.floor(raster.height * region.top); y < raster.height * region.bottom; y++) {
    for (let x = Math.floor(raster.width * region.left); x < raster.width * region.right; x++) {
      const index = (y * raster.width + x) * 4;
      if (rgb.every((value, channel) => Math.abs(raster.pixels[index + channel] - value) <= 12)) count++;
    }
  }
  return count;
}

async function pick(page: Page, scope: Locator, label: string, option: string) {
  await scope.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function settings(page: Page, base = "/app") {
  await page.goto(`${base}/invoices`);
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Invoice settings", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  return drawer;
}

async function addMethods(page: Page, base = "/app") {
  const drawer = await settings(page, base);
  await drawer.getByLabel("Payment instructions", { exact: true }).fill("Please quote the invoice number with your payment.");
  const methods = [
    { name: "Society EFT", type: "eft", details: "Account holder: Demo Community Society\nBank: Demo Credit Union\nInstitution: 809 · Transit: 12345\nAccount: 0001234567", default: true },
    { name: "Society e-transfer", type: "e_transfer", details: "Send an e-transfer to payments@example.test. Auto-deposit is enabled.", default: false },
    { name: "Society cheque", type: "cheque", details: "Payable to Demo Community Society\n100 Community Road, Vancouver, BC V6B 1A1", default: false },
  ];
  for (let index = 0; index < methods.length; index++) {
    const method = methods[index];
    await drawer.getByRole("button", { name: "Add payment method", exact: true }).click();
    const group = drawer.getByRole("group", { name: `Payment method ${index + 1}`, exact: true });
    await group.getByLabel("Method name", { exact: true }).fill(method.name);
    await group.getByLabel("Method type", { exact: true }).selectOption(method.type);
    await group.getByLabel("Payment details", { exact: true }).fill(method.details);
    if (method.default) await group.getByText("Use by default on new invoices", { exact: true }).click();
  }
  await drawer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  return methods;
}

async function createThroughInterface(page: Page, customer: string, item: string, base = "/app") {
  await page.goto(`${base}/invoices?builder=new`);
  const form = page.locator(".invoice-builder__form");
  await expect(form).toBeVisible();
  await form.getByRole("combobox", { name: "Bill to", exact: true }).fill(customer);
  await page.getByRole("option", { name: `Bill “${customer}” once` }).click();
  await form.getByPlaceholder("What you're billing for", { exact: true }).first().fill(item);
  await form.locator(".line-editor__field--price input").first().fill("124.75");
  return form;
}

async function saveInvoice(page: Page) {
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/builder=(?!new)[^&]+/);
  return new URL(page.url()).searchParams.get("builder")!;
}

async function downloadBuilderPdf(page: Page, name: string) {
  const downloading = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("complementary", { name: "Invoice preview", exact: true }).getByRole("button", { name: "Download PDF", exact: true }).click();
  const download = await downloading;
  const path = `${artifacts}/${name}.pdf`;
  await download.saveAs(path);
  const pdf = await getDocument({ data: new Uint8Array(await readFile(path)), useSystemFonts: true, disableFontFace: true }).promise;
  const pages: string[] = [];
  let firstRaster: Raster | undefined;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    pages.push((await page.getTextContent()).items.map((item: any) => item.str ?? "").join(" "));
    if (pageNumber === 1 || pageNumber === pdf.numPages) {
      const viewport = page.getViewport({ scale: 1.3 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvas: canvas as any, canvasContext: canvas.getContext("2d") as any, viewport }).promise;
      await writeFile(`${artifacts}/${name}-page-${pageNumber}.png`, canvas.toBuffer("image/png"));
      if (pageNumber === 1) firstRaster = { pixels: canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
    }
  }
  const count = pdf.numPages;
  await pdf.destroy();
  return { text: pages.join(" ").replace(/\s+/g, " "), count, firstRaster: firstRaster! };
}

async function workspace(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/lib/localDataClient.ts";
    const { localDataClient: client } = await import(path);
    const societies = await client.query("society:list", {});
    return client.query("invoices:workspace", { societyId: societies[0]._id });
  });
}

test.beforeAll(async () => { await mkdir(artifacts, { recursive: true }); });
test.beforeEach(async ({ page }) => { page.setDefaultTimeout(30_000); });

test("EFT defaults, multiple invoice choices and saved receiving details survive settings edits", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await addMethods(page);
  let drawer = await settings(page);
  await expect(drawer.getByRole("group", { name: "Payment method 1", exact: true }).getByLabel("Use by default on new invoices", { exact: true })).toBeChecked();
  await drawer.getByRole("button", { name: "Cancel", exact: true }).click();

  const form = await createThroughInterface(page, "Élodie Community Programs", "Program delivery and materials");
  await expect(form.getByLabel("Society EFT", { exact: true })).toBeChecked();
  await expect(form.getByLabel("Society e-transfer", { exact: true })).not.toBeChecked();
  await form.getByText("Society e-transfer", { exact: true }).click();
  await actualPreview(page);
  await expect(page.locator(".invoice-paper")).toContainText("Institution: 809");
  await expect(page.locator(".invoice-paper")).toContainText("payments@example.test");
  const invoiceId = await saveInvoice(page);
  await page.reload();
  await actualPreview(page);
  await expect(page.locator(".invoice-paper")).toContainText("Account: 0001234567");
  const pdf = await downloadBuilderPdf(page, "eft-and-etransfer");
  expect(pdf.text).toContain("Account: 0001234567");
  expect(pdf.text).toContain("payments@example.test");
  expect(pdf.text).not.toContain("Society cheque");
  await page.locator(".invoice-paper").screenshot({ path: `${artifacts}/eft-and-etransfer-desktop-preview.png` });

  drawer = await settings(page);
  await drawer.getByRole("group", { name: "Payment method 1", exact: true }).getByLabel("Payment details", { exact: true }).fill("UPDATED EFT DETAILS — for future invoices only.");
  await drawer.getByRole("group", { name: "Payment method 2", exact: true }).getByText("Use by default on new invoices", { exact: true }).click();
  await drawer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await page.goto(`/app/invoices?builder=${encodeURIComponent(invoiceId)}`);
  await actualPreview(page);
  await expect(page.locator(".invoice-paper")).toContainText("Account: 0001234567");
  await expect(page.locator(".invoice-paper")).not.toContainText("UPDATED EFT DETAILS");
  await page.goto("/app/invoices?builder=new");
  await actualPreview(page);
  await expect(page.getByLabel("Society EFT", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Society e-transfer", { exact: true })).toBeChecked();
  await expect(page.locator(".invoice-paper")).toContainText("UPDATED EFT DETAILS");
  const saved = (await workspace(page)).invoices.find((invoice: any) => invoice._id === invoiceId);
  expect(saved.paymentMethods).toHaveLength(2);
  expect(saved.paymentMethods[0].details).toContain("0001234567");
  expect(errors).toEqual([]);
});

test("custom PNG logos validate, preview, export and remain with a saved template", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/app/invoices?tab=templates");
  await page.getByRole("button", { name: "New template", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Template name", { exact: true }).fill("Custom society logo — plum");
  await drawer.getByLabel("Upload custom logo", { exact: true }).setInputFiles({ name: "active-logo.png", mimeType: "image/png", buffer: Buffer.from('<svg onload="alert(1)"></svg>') });
  await expect(drawer.getByRole("alert")).toContainText(/PNG|JPEG|image/i);
  const canvas = createCanvas(480, 120), context = canvas.getContext("2d");
  context.fillStyle = "#652b73"; context.fillRect(0, 0, 480, 120);
  context.fillStyle = "white"; context.font = "bold 40px sans-serif"; context.fillText("COMMUNITY", 20, 77);
  await drawer.getByLabel("Upload custom logo", { exact: true }).setInputFiles({ name: "community.png", mimeType: "image/png", buffer: canvas.toBuffer("image/png") });
  await expect(drawer).toContainText("Custom logo uploaded.");
  await drawer.getByLabel("Accent color", { exact: true }).fill("#652b73");
  await drawer.getByText("Use for new invoices by default", { exact: true }).click();
  await drawer.getByRole("button", { name: "Save template", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await page.reload();
  const card = page.locator(".invoice-template-card").filter({ hasText: "Custom society logo — plum" });
  await expect(card).toContainText("Default");
  const form = await createThroughInterface(page, "North Shore Neighbours", "Community hall booking");
  await expect(form.getByLabel("Template", { exact: true })).toContainText("Custom society logo — plum");
  await actualPreview(page);
  const invoiceId = await saveInvoice(page);
  const saved = (await workspace(page)).invoices.find((invoice: any) => invoice._id === invoiceId);
  expect(saved.documentTemplate.customLogo).toMatch(/^data:image\/png;base64,/);
  expect(saved.documentTemplate.accentColor).toBe("#652b73");
  const pdf = await downloadBuilderPdf(page, "custom-logo-plum");
  expect(pdf.text).toContain("North Shore Neighbours");
  expect(colorPixels(pdf.firstRaster, "#652b73", { left: 0, right: 0.58, top: 0, bottom: 0.2 })).toBeGreaterThan(3000);
  expect(colorPixels(pdf.firstRaster, "#652b73", { left: 0, right: 1, top: 0.2, bottom: 1 })).toBeGreaterThan(500);
  await page.locator(".invoice-paper").screenshot({ path: `${artifacts}/custom-logo-desktop-preview.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Invoice preview", exact: true })).toBeVisible();
  await actualPreview(page);
  const mobileCanvas = (await page.locator('.invoice-paper canvas[aria-label="PDF page 1"]').boundingBox())!;
  expect(mobileCanvas.width / mobileCanvas.height).toBeCloseTo(612 / 792, 2);
  await page.screenshot({ path: `${artifacts}/custom-logo-mobile-preview.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test("seeded varied invoices render Brandkit colors, Unicode, currencies and multipage tables", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await addMethods(page);
  const profiles = [
    { id: "northwind", name: "Northwind blue", accent: "#245779", layout: "Modern", currency: "CAD", lineCount: 4, customer: "Société des amis — Montréal" },
    { id: "sparklab", name: "Spark Lab amber", accent: "#b86b12", layout: "Classic", currency: "USD", lineCount: 12, customer: "Alejandro García Foundation" },
    { id: "firstform", name: "First Form forest", accent: "#216244", layout: "Compact", currency: "EUR", lineCount: 65, customer: "Björk Community Exchange" },
  ];
  let seed = 730119;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (const scenario of profiles) {
    await page.goto("/app/invoices?tab=templates");
    await page.getByRole("button", { name: "New template", exact: true }).click();
    const drawer = page.getByRole("dialog");
    await drawer.getByLabel("Template name", { exact: true }).fill(scenario.name);
    await drawer.getByLabel("Import Brandkit profile", { exact: true }).setInputFiles(fileURLToPath(new URL(`../scripts/fixtures/brandkit/${scenario.id}.json`, import.meta.url)));
    await pick(page, drawer, "Layout", scenario.layout);
    await drawer.getByLabel("Accent color", { exact: true }).fill(scenario.accent);
    await drawer.getByLabel("Footer", { exact: true }).fill("Thank you for supporting our community. Questions? billing@example.test");
    await drawer.getByText("Use for new invoices by default", { exact: true }).click();
    await drawer.getByRole("button", { name: "Save template", exact: true }).click();
    await expect(drawer).not.toBeVisible();
    const current = await workspace(page);
    const template = current.templates.find((row: any) => row.config.name === scenario.name);
    const methods = current.settings.paymentMethods;
    const lines = Array.from({ length: scenario.lineCount }, (_, index) => ({
      key: `seeded-${index}`, item: ["Community programming", "Hall rental", "Workshop materials", "Volunteer training", "Member support"][Math.floor(random() * 5)] + ` ${index + 1}`,
      description: index % 3 === 0 ? "Planning, preparation and delivery for community participants." : undefined,
      quantity: 1 + Math.floor(random() * 6), unit: index % 2 ? "hour" : "each", unitPriceCents: 1250 + Math.floor(random() * 20000),
      taxRatePercent: scenario.currency === "CAD" ? 5 : undefined, taxLabel: scenario.currency === "CAD" ? "GST" : undefined,
    }));
    const invoiceId = await page.evaluate(async ({ societyId, config, scenario, lines, ids, date }) => {
      const path = "/src/lib/localDataClient.ts";
      const { localDataClient: client } = await import(path);
      return client.mutation("invoices:upsert", { societyId, partyKind: "custom", billToName: scenario.customer, billToEmail: "demo-customer@example.test", billToAddress: "123 Community Avenue\nVancouver, BC V6B 1A1", currency: scenario.currency, documentTemplate: config, issueDate: date, terms: "net_30", reference: `DEMO-${scenario.id}`, lines, paymentMethodIds: ids, memo: "Demo invoice. Please review the listed services and quote the reference with payment." });
    }, { societyId: current.invoices[0].societyId, config: template.config, scenario, lines, ids: methods.slice(0, scenario.currency === "USD" ? 1 : 3).map((method: any) => method.id), date: current.today });
    await page.goto(`/app/invoices?builder=${encodeURIComponent(invoiceId)}`);
    await actualPreview(page);
    await expect(page.locator(".invoice-paper")).toContainText(scenario.customer);
    const saved = (await workspace(page)).invoices.find((invoice: any) => invoice._id === invoiceId);
    expect(saved.documentTemplate.brand.id).toBe(scenario.id);
    expect(saved.documentTemplate.accentColor).toBe(scenario.accent);
    expect(saved.documentTemplate.design.advanced.colors.tableHeaderBackground).toBe(scenario.accent);
    const pdf = await downloadBuilderPdf(page, `seeded-${scenario.id}-${scenario.currency.toLowerCase()}`);
    expect(colorPixels(pdf.firstRaster, template.config.brand.primary, { left: 0, right: 0.58, top: 0, bottom: 0.2 })).toBeGreaterThan(25);
    expect(colorPixels(pdf.firstRaster, scenario.accent, { left: 0, right: 1, top: 0.2, bottom: 1 })).toBeGreaterThan(500);
    expect(pdf.text).toContain(scenario.customer);
    expect(pdf.text).toContain(`DEMO-${scenario.id}`);
    expect(pdf.text).toContain("Society EFT");
    expect(pdf.text).toContain(lines[lines.length - 1].item);
    if (scenario.lineCount > 50) {
      expect(pdf.count).toBeGreaterThan(1);
      const paper = page.locator(".invoice-paper");
      await expect(paper.getByLabel(`Page number, of ${pdf.count}`, { exact: true })).toHaveValue("1");
      await paper.getByRole("button", { name: "Next page", exact: true }).click();
      await expect(paper.getByLabel(`Page number, of ${pdf.count}`, { exact: true })).toHaveValue("2");
      await expect(paper.locator('canvas[aria-label="PDF page 2"]')).toBeVisible();
      await paper.getByRole("button", { name: "Previous page", exact: true }).click();
      await expect(paper.getByLabel(`Page number, of ${pdf.count}`, { exact: true })).toHaveValue("1");
    }
    await page.locator(".invoice-paper").screenshot({ path: `${artifacts}/seeded-${scenario.id}-desktop-preview.png` });
  }
  expect(errors).toEqual([]);
});


test("public demo creates an issued Brandkit invoice with society EFT instructions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/demo/app/invoices?tab=templates");
  await page.getByRole("button", { name: "New template", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Import Brandkit profile", { exact: true }).setInputFiles("scripts/fixtures/brandkit/ddcnorth.json");
  await expect(drawer.getByRole("img", { name: "ddcnorth logo", exact: true })).toBeVisible();
  await drawer.getByLabel("Template name", { exact: true }).fill("Public demo Brandkit invoice");
  await drawer.getByText("Use for new invoices by default", { exact: true }).click();
  await drawer.getByRole("button", { name: "Save template", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await addMethods(page, "/demo/app");
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileSettings = await settings(page, "/demo/app");
  const longName = "Society cheque or community office payment — please bring the invoice reference to the front desk";
  await mobileSettings.getByRole("group", { name: "Payment method 3", exact: true }).getByLabel("Method name", { exact: true }).fill(longName);
  for (const group of await mobileSettings.locator(".invoice-payment-method").all()) {
    const box = (await group.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
    expect(await group.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  await page.screenshot({ path: `${artifacts}/public-demo-payment-settings-mobile.png`, fullPage: true });
  await mobileSettings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(mobileSettings).not.toBeVisible();
  const form = await createThroughInterface(page, "Public demo society member", "Community equipment rental", "/demo/app");
  await expect(form.getByLabel("Society EFT", { exact: true })).toBeChecked();
  await expect(form.getByLabel("Template", { exact: true })).toContainText("Public demo Brandkit invoice");
  const selection = form.getByRole("group", { name: "Payment methods on this invoice", exact: true });
  await selection.scrollIntoViewIfNeeded();
  const selectionBox = (await selection.boundingBox())!;
  expect(selectionBox.x).toBeGreaterThanOrEqual(-1);
  expect(selectionBox.x + selectionBox.width).toBeLessThanOrEqual(391);
  expect(await selection.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const firstChoice = (await selection.locator(".check-row").nth(0).boundingBox())!;
  const secondChoice = (await selection.locator(".check-row").nth(1).boundingBox())!;
  expect(firstChoice.height).toBeGreaterThanOrEqual(40);
  expect(secondChoice.y).toBeGreaterThanOrEqual(firstChoice.y + firstChoice.height - 1);
  await page.screenshot({ path: `${artifacts}/public-demo-payment-selection-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1600, height: 1100 });
  const invoiceId = await saveInvoice(page);
  await page.getByRole("button", { name: "More invoice actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Finalize without downloading", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Finalize invoice?", exact: true });
  await confirmation.getByRole("button", { name: "Finalize invoice", exact: true }).click();
  await expect(page.locator(".invoice-builder")).not.toBeVisible();
  await expect(page.locator(".invoice-drawer").getByRole("region", { name: "Invoice workflow", exact: true })).toContainText("Ready for you to send");
  await page.goto(`/demo/app/invoices?builder=${encodeURIComponent(invoiceId)}`);
  await actualPreview(page);
  await expect(page.locator(".line-editor__field--price input").first()).toBeDisabled();
  const pdf = await downloadBuilderPdf(page, "public-demo-issued-ddcnorth");
  expect(pdf.text).toContain("Public demo society member");
  expect(pdf.text).toContain("Account: 0001234567");
  expect(pdf.text).not.toContain("DRAFT");
  await page.locator(".invoice-paper").screenshot({ path: `${artifacts}/public-demo-issued-ddcnorth-desktop-preview.png` });
  await page.goto(`/demo/app/invoices?invoice=${encodeURIComponent(invoiceId)}`);
  const invoiceDrawer = page.getByRole("dialog");
  await invoiceDrawer.getByRole("button", { name: "Record payment", exact: true }).click();
  const paymentForm = invoiceDrawer.getByRole("form", { name: /^Record a payment for/ });
  await expect(paymentForm.getByLabel("Method", { exact: true })).toContainText("Direct deposit");
  await paymentForm.getByLabel("Amount", { exact: true }).fill("25.00");
  await paymentForm.getByLabel("Reference", { exact: true }).fill("DEMO-EFT-001");
  const noLink = paymentForm.getByRole("button", { name: "Don't link", exact: true });
  if (await noLink.isVisible()) await noLink.click();
  await paymentForm.locator("button[type=submit]").click();
  await expect(paymentForm).not.toBeVisible();
  await expect(invoiceDrawer).toContainText("Partially paid");
  await expect(invoiceDrawer.locator(".invoice-payments__row").filter({ hasText: "DEMO-EFT-001" })).toContainText("Direct deposit");
  expect(errors).toEqual([]);
});
