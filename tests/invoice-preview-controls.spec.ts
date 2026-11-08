import { test, expect, type Locator, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const artifacts = "/workspace/scratch/invoice-preview-controls";
const managerLabel = "Manage payment methods";
const paymentInfoLabel = "About invoice payment methods";

async function activate(locator: Locator, hasTouch: boolean) {
  if (hasTouch) await locator.tap(); else await locator.click();
}

async function dismissToasts(page: Page, hasTouch: boolean) {
  for (const dismiss of await page.locator(".toast").getByRole("button", { name: "Dismiss", exact: true }).all()) {
    if (await dismiss.isVisible()) await activate(dismiss, hasTouch);
  }
  await expect(page.locator(".toast")).toHaveCount(0);
}

async function expectFooterInViewport(page: Page, dialog: Locator, saveLabel: string) {
  for (const name of ["Cancel", saveLabel]) {
    const button = dialog.getByRole("button", { name, exact: true });
    await expect.poll(() => button.evaluate(element => {
      const box = element.getBoundingClientRect();
      return box.top >= 0 && box.left >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
    })).toBe(true);
  }
}

async function invoiceBuilder(page: Page, hasTouch: boolean, customer = "Preview controls customer") {
  await page.goto("/app/invoices?builder=new");
  const form = page.locator(".invoice-builder__form");
  await expect(form).toBeVisible();
  await form.getByRole("combobox", { name: "Bill to", exact: true }).fill(customer);
  await activate(page.getByRole("option", { name: `Bill “${customer}” once` }), hasTouch);
  await form.getByPlaceholder("What you're billing for", { exact: true }).first().fill("Preserved unsaved invoice service");
  await form.locator(".line-editor__field--price input").first().fill("145.50");
  return form;
}

async function checkInfo(page: Page, trigger: Locator, hasTouch: boolean) {
  if (hasTouch) await trigger.tap(); else await trigger.hover();
  const hint = hasTouch ? page.getByRole("dialog", { name: paymentInfoLabel, exact: true }) : page.getByRole("tooltip");
  await expect(hint).toBeVisible();
  await expect(hint).toContainText(/payment|invoice/i);
  await page.keyboard.press("Escape");
  await expect(hint).not.toBeVisible();
  const info = page.getByRole("dialog", { name: paymentInfoLabel, exact: true });
  // Keyboard activation has the same disclosure and dismissal behavior.
  await trigger.focus();
  await trigger.press("Enter");
  await expect(info).toBeVisible();
  await activate(page.getByRole("heading", { name: "Notes", exact: true }), hasTouch);
  await expect(info).not.toBeVisible();
}

async function expectPageGeometry(page: Page, exported: PDFDocument) {
  const preview = page.getByTestId("invoice-pdf-preview");
  const first = preview.locator(".pdf-preview__page[data-page='1']");
  const canvas = first.locator("canvas[aria-label='PDF page 1']");
  await expect(canvas).toBeVisible();
  const pdfPage = exported.getPage(0);
  const expectedRatio = pdfPage.getWidth() / pdfPage.getHeight();
  const geometry = await canvas.evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    return { width: box.width, height: box.height, pixelsWidth: canvas.width, pixelsHeight: canvas.height };
  });
  expect(geometry.width / geometry.height).toBeCloseTo(expectedRatio, 2);
  expect(geometry.pixelsWidth / geometry.pixelsHeight).toBeCloseTo(expectedRatio, 2);
  expect(geometry.pixelsWidth).toBeGreaterThan(100);
  expect(geometry.pixelsHeight).toBeGreaterThan(100);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  return { preview, first, geometry };
}

test.beforeAll(async () => { await mkdir(artifacts, { recursive: true }); });
test.beforeEach(async ({ page }) => { page.setDefaultTimeout(30_000); });

test("a one-page invoice fits the preview and shows both tax rates on the item row", async ({ page, hasTouch }) => {
  if (!hasTouch) await page.setViewportSize({ width: 1280, height: 720 });
  const form = await invoiceBuilder(page, hasTouch);
  await form.getByPlaceholder("What you're billing for", { exact: true }).first().fill("Site services");
  await activate(form.getByLabel("Tax for line 1", { exact: true }), hasTouch);
  await activate(page.getByRole("option", { name: "GST 5% + PST 7%", exact: true }), hasTouch);
  if (hasTouch) await activate(page.getByRole("tab", { name: "Preview", exact: true }), true);

  const scope = page.getByRole("complementary", { name: "Invoice preview" });
  const preview = scope.getByTestId("invoice-pdf-preview");
  const layer = preview.locator(".textLayer");
  const tax = layer.getByText("GST 5% + PST 7%", { exact: true });
  await expect(preview.locator(".pdf-preview__page")).toHaveCount(1);
  await expect(tax).toBeVisible();
  await expect(layer.getByText("Description", { exact: true })).toHaveCount(0);
  const item = layer.getByText("Site services", { exact: true });
  expect((await tax.boundingBox())!.y).toBeCloseTo((await item.boundingBox())!.y, 0);
  await expect.poll(() => preview.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
  await activate(scope.getByRole("button", { name: "Zoom in", exact: true }), hasTouch);
  await expect.poll(() => preview.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(1);
  await activate(scope.getByRole("button", { name: /fit page/i }), hasTouch);
  await expect.poll(() => preview.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
});

test("the shared payment manager opens from an unsaved invoice and settings; info works for pointer, touch and keyboard", async ({ page, hasTouch }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const form = await invoiceBuilder(page, hasTouch);
  const infoTrigger = form.getByRole("button", { name: paymentInfoLabel, exact: true });
  await checkInfo(page, infoTrigger, hasTouch);
  await activate(form.getByRole("button", { name: managerLabel, exact: true }), hasTouch);
  const manager = page.getByRole("dialog", { name: "Payment methods", exact: true });
  await expect(manager).toBeVisible();
  await activate(manager.getByRole("button", { name: "Add payment method", exact: true }), hasTouch);
  const method = manager.getByRole("group", { name: "Payment method 1", exact: true });
  await method.getByLabel("Method name", { exact: true }).fill("Community EFT");
  await method.getByLabel("Method type", { exact: true }).selectOption("eft");
  await method.getByLabel("Payment details", { exact: true }).fill("Account holder: Community Society\nBank: Demo Credit Union\nInstitution: 809; transit: 12345; account: 0001234567");
  await activate(method.getByText("Use by default on new invoices", { exact: true }), hasTouch);
  const instructions = manager.getByLabel("Payment instructions", { exact: true });
  await expect(instructions).toHaveAttribute("maxlength", "2000");
  await instructions.fill("  " + "Use invoice reference DEMO-LIMIT-001. ".repeat(70) + "TAIL-MUST-NOT-PRINT");
  expect((await instructions.inputValue()).length).toBeLessThanOrEqual(2000);
  const expectedInstructions = (await instructions.inputValue()).trim().slice(0, 2000);
  await activate(manager.getByRole("button", { name: "Save payment methods", exact: true }), hasTouch);
  await expect(manager).not.toBeVisible();
  await expect(form.getByPlaceholder("What you're billing for", { exact: true }).first()).toHaveValue("Preserved unsaved invoice service");
  await expect(form.locator(".line-editor__field--price input").first()).toHaveValue("145.50");
  await expect(form.locator(".billto__name")).toHaveText("Preview controls customer");
  const selected = form.getByLabel("Community EFT", { exact: true });
  await expect(selected).toBeChecked();
  await dismissToasts(page, hasTouch);
  const detailsLabel = "Payment details for Community EFT";
  const detailsTrigger = form.getByRole("button", { name: detailsLabel, exact: true });
  if (hasTouch) await detailsTrigger.tap(); else await detailsTrigger.hover();
  const details = hasTouch ? page.getByRole("dialog", { name: detailsLabel, exact: true }) : page.getByRole("tooltip");
  await expect(details).toBeVisible();
  await expect(details).toContainText("account: 0001234567");
  await details.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const detailsBox = (await details.boundingBox())!;
  expect(detailsBox.x).toBeGreaterThanOrEqual(0);
  expect(detailsBox.x + detailsBox.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(detailsBox.y + detailsBox.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  await page.screenshot({ path: `${artifacts}/${info.project.name}-payment-method-details.png`, fullPage: true, animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(details).not.toBeVisible();
  await expect(selected).toBeChecked();
  if (hasTouch) await activate(page.getByRole("tab", { name: "Preview", exact: true }), true);
  const unsavedPreview = page.getByRole("complementary", { name: "Invoice preview", exact: true });
  await expect(unsavedPreview.getByTestId("invoice-pdf-preview").locator("canvas").first()).toBeVisible();
  const pendingPreview = page.waitForEvent("download", { timeout: 90_000 });
  await activate(unsavedPreview.getByRole("button", { name: "Download PDF", exact: true }), hasTouch);
  const unsavedDownload = await pendingPreview;
  const unsavedPath = `${artifacts}/${info.project.name}-bounded-payment-instructions.pdf`;
  await unsavedDownload.saveAs(unsavedPath);
  const unsavedPdf = await getDocument({ data: new Uint8Array(await readFile(unsavedPath)), useSystemFonts: true, disableFontFace: true }).promise;
  const instructionPages: string[] = [];
  for (let number = 1; number <= unsavedPdf.numPages; number++) instructionPages.push((await (await unsavedPdf.getPage(number)).getTextContent()).items.map((part: any) => part.str ?? "").filter((value: string) => value !== "DRAFT").join(" "));
  // Wrapped words and the draft watermark are rendering details, not instruction content.
  const instructionText = instructionPages.join(" ").replace(/\s/g, "");
  expect(instructionText).toContain(expectedInstructions.replace(/\s/g, ""));
  expect(instructionText).not.toContain("TAIL-MUST-NOT-PRINT");
  await unsavedPdf.destroy();
  if (hasTouch) await activate(page.getByRole("tab", { name: "Edit", exact: true }), true);
  await activate(page.getByRole("button", { name: "Save draft", exact: true }), hasTouch);
  await expect(page).toHaveURL(/builder=(?!new)[^&]+/);
  const id = new URL(page.url()).searchParams.get("builder")!;
  await page.goto("/app/invoices");
  await activate(page.getByRole("button", { name: "More actions", exact: true }), hasTouch);
  await activate(page.getByRole("menuitem", { name: "Invoice settings", exact: true }), hasTouch);
  const settings = page.getByRole("dialog", { name: "Invoice settings", exact: true });
  await expect(settings.getByLabel("Method name", { exact: true }).first()).toHaveValue("Community EFT");
  await expect(settings.getByLabel("Use by default on new invoices", { exact: true }).first()).toBeChecked();
  await expect(settings.getByLabel("Payment instructions", { exact: true })).toHaveValue(expectedInstructions);
  await dismissToasts(page, hasTouch);
  await expectFooterInViewport(page, settings, "Save");
  await page.screenshot({ path: `${artifacts}/${info.project.name}-shared-payment-settings.png`, fullPage: true, animations: "disabled" });
  await settings.getByLabel("Method name", { exact: true }).first().fill("Community EFT account");
  await activate(settings.getByRole("button", { name: "Save", exact: true }), hasTouch);
  await expect(settings).not.toBeVisible();
  await page.goto(`/app/invoices?builder=${encodeURIComponent(id)}`);
  await expect(page.getByLabel("Community EFT", { exact: true })).toBeChecked();
  await activate(page.getByRole("button", { name: managerLabel, exact: true }), hasTouch);
  await expect(manager.getByLabel("Method name", { exact: true }).first()).toHaveValue("Community EFT account");
  await expect(manager.getByLabel("Payment instructions", { exact: true })).toHaveValue(expectedInstructions);
  await dismissToasts(page, hasTouch);
  await expectFooterInViewport(page, manager, "Save payment methods");
  await page.screenshot({ path: `${artifacts}/${info.project.name}-shared-payment-manager.png`, fullPage: true, animations: "disabled" });
  await activate(manager.getByRole("button", { name: "Cancel", exact: true }), hasTouch);
  expect(errors).toEqual([]);
});

test("actual PDF pages retain export geometry, navigation and zoom on desktop and phone", async ({ page, hasTouch }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/app/invoices?tab=templates");
  await activate(page.getByRole("button", { name: "New template", exact: true }), hasTouch);
  const designer = page.getByRole("dialog");
  await designer.getByLabel("Import Brandkit profile", { exact: true }).setInputFiles("scripts/fixtures/brandkit/ddcnorth.json");
  await expect(designer.getByRole("img", { name: "ddcnorth logo", exact: true })).toBeVisible();
  await designer.getByLabel("Template name", { exact: true }).fill("Actual PDF preview design");
  await activate(designer.getByText("Use for new invoices by default", { exact: true }), hasTouch);
  await activate(designer.getByRole("button", { name: "Save template", exact: true }), hasTouch);
  await expect(designer).not.toBeVisible();
  const id = await page.evaluate(async () => {
    const path = "/src/lib/localDataClient.ts";
    const { localDataClient: client } = await import(path);
    const societies = await client.query("society:list", {});
    const societyId = societies[0]._id;
    const workspace = await client.query("invoices:workspace", { societyId });
    const template = workspace.templates.find((row: any) => row._id === workspace.settings.defaultTemplateId);
    return client.mutation("invoices:upsert", {
      societyId, partyKind: "custom", billToName: "Actual PDF customer — Élodie", billToAddress: "123 Community Avenue\nVancouver, BC V6B 1A1",
      currency: "CAD", documentTemplate: template.config, issueDate: workspace.today, terms: "net_30", reference: "ACTUAL-PDF-PREVIEW",
      lines: Array.from({ length: 35 }, (_, index) => ({ key: `geometry-${index}`, item: `Geometry service ${index + 1}`, description: "Preparation and delivery for community participants.", quantity: index % 3 + 1, unitPriceCents: 12500 + index * 37, taxRatePercent: 5, taxLabel: "GST" })),
      memo: "This invoice should preserve its printed page proportions at every viewport size.",
    });
  });
  await page.goto(`/app/invoices?builder=${encodeURIComponent(id)}`);
  if (hasTouch) await activate(page.getByRole("tab", { name: "Preview", exact: true }), true);
  const scope = page.getByRole("complementary", { name: "Invoice preview", exact: true });
  await expect(scope.getByTestId("invoice-pdf-preview").locator("canvas").first()).toBeVisible();
  const downloading = page.waitForEvent("download", { timeout: 90_000 });
  await activate(scope.getByRole("button", { name: "Download PDF", exact: true }), hasTouch);
  const download = await downloading;
  const output = `${artifacts}/${info.project.name}-actual-preview.pdf`;
  await download.saveAs(output);
  const bytes = new Uint8Array(await readFile(output));
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBeGreaterThan(1);
  const { preview, first, geometry } = await expectPageGeometry(page, pdf);
  await expect(scope.getByRole("textbox", { name: `Page number, of ${pdf.getPageCount()}`, exact: true })).toHaveValue("1");
  await expect(preview.locator(".textLayer").first()).toContainText("Actual PDF customer — Élodie");
  for (const dismiss of await page.locator(".toast").getByRole("button", { name: "Dismiss", exact: true }).all()) {
    if (await dismiss.isVisible()) await activate(dismiss, hasTouch);
  }
  await expect(page.locator(".toast")).toHaveCount(0);
  await page.screenshot({ path: `${artifacts}/${info.project.name}-actual-pdf-preview.png`, fullPage: true, animations: "disabled" });
  await first.screenshot({ path: `${artifacts}/${info.project.name}-actual-pdf-page-1.png`, animations: "disabled" });
  await scope.screenshot({ path: `${artifacts}/${info.project.name}-actual-pdf-preview-only.png`, animations: "disabled" });
  await activate(scope.getByRole("button", { name: "Zoom in", exact: true }), hasTouch);
  await expect.poll(async () => (await first.boundingBox())!.width).toBeGreaterThan(geometry.width + 10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await activate(scope.getByRole("button", { name: /fit page/i }), hasTouch);
  await expect.poll(async () => Math.abs((await first.boundingBox())!.width - geometry.width)).toBeLessThan(2);
  await activate(scope.getByRole("button", { name: "Next page", exact: true }), hasTouch);
  const field = scope.getByRole("textbox", { name: `Page number, of ${pdf.getPageCount()}`, exact: true });
  await expect(field).toHaveValue("2");
  await field.fill(String(pdf.getPageCount()));
  await field.press("Enter");
  await expect(field).toHaveValue(String(pdf.getPageCount()));
  await expect(preview.locator(`canvas[aria-label='PDF page ${pdf.getPageCount()}']`)).toBeVisible();
  await page.screenshot({ path: `${artifacts}/${info.project.name}-actual-pdf-last-page.png`, fullPage: true, animations: "disabled" });
  const searchable = await getDocument({ data: bytes.slice(), useSystemFonts: true, disableFontFace: true }).promise;
  const text: string[] = [];
  for (let number = 1; number <= searchable.numPages; number++) text.push((await (await searchable.getPage(number)).getTextContent()).items.map((item: any) => item.str ?? "").join(" "));
  expect(text.join(" ")).toContain("Geometry service 35");
  expect(text.join(" ")).toContain("ACTUAL-PDF-PREVIEW");
  await searchable.destroy();
  if (hasTouch) await activate(page.getByRole("tab", { name: "Edit", exact: true }), true);
  const item = page.locator(".invoice-builder__form").getByPlaceholder("What you're billing for", { exact: true }).first();
  await item.fill("Outdated first preview edit");
  await item.fill("Outdated second preview edit");
  await item.fill("Latest invoice preview service");
  if (hasTouch) await activate(page.getByRole("tab", { name: "Preview", exact: true }), true);
  await expect(scope.locator(".invoice-pdf-preview")).toHaveAttribute("aria-busy", "false");
  await expect(scope.getByTestId("invoice-pdf-preview").locator(".textLayer").first()).toContainText("Latest invoice preview service");
  await expect(scope.getByTestId("invoice-pdf-preview").locator(".textLayer").first()).not.toContainText("Outdated first preview edit");
  await expect(scope.getByTestId("invoice-pdf-preview").locator(".textLayer").first()).not.toContainText("Outdated second preview edit");
  const updatedDownload = page.waitForEvent("download", { timeout: 90_000 });
  await activate(scope.getByRole("button", { name: "Download PDF", exact: true }), hasTouch);
  const latestDownload = await updatedDownload;
  const latestPath = `${artifacts}/${info.project.name}-updated-actual-preview.pdf`;
  await latestDownload.saveAs(latestPath);
  const latestPdf = await getDocument({ data: new Uint8Array(await readFile(latestPath)), useSystemFonts: true, disableFontFace: true }).promise;
  const latestText = (await (await latestPdf.getPage(1)).getTextContent()).items.map((part: any) => part.str ?? "").join(" ");
  expect(latestText).toContain("Latest invoice preview service");
  expect(latestText).not.toContain("Outdated first preview edit");
  await latestPdf.destroy();
  if (hasTouch) {
    await page.setViewportSize({ width: 360, height: 800 });
    await expect.poll(() => scope.getByTestId("invoice-pdf-preview").evaluate(element => element.clientWidth)).toBeLessThan(360);
    const narrow = await expectPageGeometry(page, pdf);
    expect(narrow.geometry.width).toBeLessThan(geometry.width);
    await scope.screenshot({ path: `${artifacts}/phone-360-actual-pdf-preview-only.png`, animations: "disabled" });
  }
  await page.goto(`/app/invoices?invoice=${encodeURIComponent(id)}`);
  const detail = page.getByRole("dialog");
  await activate(detail.getByRole("button", { name: /^More actions for/ }), hasTouch);
  await activate(page.getByRole("menuitem", { name: "Preview invoice", exact: true }), hasTouch);
  await expectPageGeometry(page, pdf);
  await detail.getByRole("region", { name: "Invoice preview", exact: true }).screenshot({ path: `${artifacts}/${info.project.name}-detail-actual-pdf-preview.png`, animations: "disabled" });
  expect(errors).toEqual([]);
});
