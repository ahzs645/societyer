import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

async function pick(page: Page, scope: Locator, label: string, option: string) { await scope.getByLabel(label, { exact: true }).click(); await page.getByRole("option", { name: option, exact: true }).click(); }
async function customer(page: Page, scope: Locator, name: string) { await scope.getByRole("combobox", { name: "Bill to", exact: true }).fill(name); await page.getByRole("option", { name: `Bill “${name}” once` }).click(); }
async function line(scope: Locator, item: string, rate: string) { await scope.getByRole("button", { name: "Add line", exact: true }).click(); await scope.getByPlaceholder("What you're billing for", { exact: true }).last().fill(item); await scope.locator(".line-editor__field--price input").last().fill(rate); }
async function pdf(page: Page, button: Locator, path: string, expected: string[] = []) { const ready = page.waitForEvent("download"); await button.click(); const download = await ready; await download.saveAs(path); const bytes = await readFile(path); expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0); const searchable = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true }).promise; const text: string[] = []; for (let pageNumber = 1; pageNumber <= searchable.numPages; pageNumber++) text.push((await (await searchable.getPage(pageNumber)).getTextContent()).items.map((item: any) => item.str ?? "").join(" ")); await searchable.destroy(); for (const value of expected) expect(text.join(" ").replace(/\s+/g, " ")).toContain(value); }

test("native quote acceptance converts once; payment receipt and dated statement use shared PDFs", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const name = `Quote customer ${Date.now()}`;
  await page.goto("/app/invoices?tab=quotes");
  await page.getByRole("button", { name: "New quote", exact: true }).click();
  let drawer = page.getByRole("dialog").last();
  await customer(page, drawer, name); await line(drawer, "Repair estimate labour", "100.00");
  await drawer.getByLabel("Quote terms and conditions", { exact: true }).fill("Repair estimate accepted by the customer.");
  await drawer.getByRole("button", { name: "Save quote", exact: true }).click();
  drawer = page.getByRole("dialog").last(); await expect(drawer).toContainText(name);
  await drawer.getByRole("button", { name: "Mark quote sent", exact: true }).click();
  await drawer.getByRole("button", { name: "Preview quote", exact: true }).click();
  let preview = page.getByRole("dialog").last(); await pdf(page, preview.getByRole("button", { name: "Download quote PDF", exact: true }), "/workspace/scratch/invoice-pdf/native-quote.pdf", [name, "Repair estimate accepted by the customer.", "$100.00"]); await preview.getByRole("button", { name: "Close", exact: true }).first().click();
  for (let revision = 2; revision <= 5; revision++) {
    await drawer.getByRole("button", { name: "New revision", exact: true }).click(); drawer = page.getByRole("dialog").last(); await drawer.getByRole("button", { name: "Save quote", exact: true }).click(); drawer = page.getByRole("dialog").last(); await expect(drawer.getByRole("heading").first()).toContainText(`revision ${revision}`); await drawer.getByRole("button", { name: "Mark quote sent", exact: true }).click(); await expect(drawer.getByRole("button", { name: `Preview saved revision ${revision}`, exact: true })).toBeVisible();
  }
  await expect(drawer.getByRole("button", { name: /Preview saved revision/ })).toHaveCount(4);
  await drawer.getByRole("button", { name: "Next revisions page", exact: true }).click(); await expect(drawer.getByRole("button", { name: "Preview saved revision 1", exact: true })).toBeVisible(); await expect(drawer.getByRole("button", { name: /Preview saved revision/ })).toHaveCount(1);
  await drawer.getByRole("button", { name: "Previous revisions page", exact: true }).click(); await expect(drawer.getByRole("button", { name: "Preview saved revision 5", exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "Record acceptance", exact: true }).click();
  const decision = page.getByRole("dialog").last(); await decision.getByPlaceholder("Decision evidence").fill("Customer signed estimate during intake"); await decision.getByRole("button", { name: "Record decision", exact: true }).click();
  drawer = page.getByRole("dialog").last(); await drawer.getByRole("button", { name: "Convert to invoice", exact: true }).click();
  drawer = page.getByRole("dialog").last(); await expect(drawer).toContainText("revision 5");
  await drawer.getByRole("button", { name: "Record payment", exact: true }).click(); await drawer.getByLabel("Amount", { exact: true }).fill("25.00"); await drawer.getByRole("button", { name: "Record $25.00", exact: true }).click();
  await expect(drawer).toContainText("Partially paid");
  await drawer.getByRole("button", { name: /Preview receipt for payment/ }).click();
  preview = page.getByRole("dialog").last(); await expect(preview).toContainText("Amount received");
  await pdf(page, preview.getByRole("button", { name: "Download receipt PDF", exact: true }), "/workspace/scratch/invoice-pdf/native-receipt.pdf", [name, "Amount received", "$25.00"]);
  await preview.getByRole("button", { name: "Close", exact: true }).first().click();
  await page.goto("/app/invoices?tab=statements"); await pick(page, page.locator(".invoice-card"), "Statement customer", name);
  await expect(page.locator(".invoice-card")).toContainText("Closing balance");
  await page.getByRole("button", { name: "Preview statement", exact: true }).click();
  preview = page.getByRole("dialog").last(); await expect(preview).toContainText("$75.00");
  await preview.getByRole("button", { name: "Preview PDF", exact: true }).click(); await expect(preview.locator("iframe")).toHaveAttribute("src", /^blob:/);
  await pdf(page, preview.getByRole("button", { name: "Download statement PDF", exact: true }), "/workspace/scratch/invoice-pdf/native-statement.pdf", [name, "Customer statement", "$75.00"]);
  await preview.getByRole("button", { name: "Close", exact: true }).first().click();
  await page.getByRole("button", { name: "Save statement snapshot", exact: true }).click();
  await expect(page.getByRole("button", { name: /Saved \d{4}-/ })).toBeVisible();
  for (let index = 1; index <= 4; index++) {
    await page.getByLabel("Statement from", { exact: true }).click(); const typed = page.getByLabel("Type a date", { exact: true }); await typed.fill(`2000-01-0${index}`); await typed.press("Enter"); await page.getByRole("button", { name: "Save statement snapshot", exact: true }).click(); await expect(page.getByRole("button", { name: new RegExp(`2000-01-0${index}.*Saved`) })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /Saved \d{4}-/ })).toHaveCount(4); await page.getByRole("button", { name: "Next statements page", exact: true }).click(); await expect(page.getByRole("button", { name: /Saved \d{4}-/ })).toHaveCount(1); await page.getByRole("button", { name: "Previous statements page", exact: true }).click(); await expect(page.getByRole("button", { name: /Saved \d{4}-/ })).toHaveCount(4);
  await page.reload(); await expect(page.getByRole("heading", { name: "Customer statements", exact: true })).toBeVisible();
  await page.goto("/app/invoices?tab=quotes");
  for (let index = 1; index <= 4; index++) {
    await page.getByRole("button", { name: "New quote", exact: true }).click(); drawer = page.getByRole("dialog").last(); await customer(page, drawer, `${name} page ${index}`); await line(drawer, "Paged estimate", "10.00"); await drawer.getByRole("button", { name: "Save quote", exact: true }).click(); drawer = page.getByRole("dialog").last(); await expect(drawer).toContainText(`${name} page ${index}`); await drawer.getByRole("button", { name: "Close drawer", exact: true }).first().click();
  }
  await page.getByRole("button", { name: "Next quotes page", exact: true }).click(); const original = page.getByRole("row").filter({ hasText: name }); await expect(original).toHaveCount(1); await original.getByRole("button").first().click(); drawer = page.getByRole("dialog").last(); await expect(drawer).toContainText(name); await expect(drawer).toContainText("accepted"); await drawer.getByRole("button", { name: "Close drawer", exact: true }).first().click(); await page.getByRole("button", { name: "Previous quotes page", exact: true }).click(); await expect(page.getByRole("row").filter({ hasText: `${name} page` })).toHaveCount(4);
  expect(errors).toEqual([]);
});

test("repair approval, dispatch, timer and labour estimate guards work in the real page", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const name = `Repair operations ${Date.now()}`;
  await page.goto("/app/invoices?tab=repairs"); await page.getByRole("button", { name: "New repair", exact: true }).click();
  let drawer = page.getByRole("dialog").last(); await customer(page, drawer, name); await drawer.getByLabel("Equipment / item", { exact: true }).fill("Bicycle"); await drawer.getByLabel("Problem reported", { exact: true }).fill("Brakes stick"); await line(drawer, "Brake cable", "10.00"); await drawer.getByRole("button", { name: "Save repair", exact: true }).click();
  drawer = page.getByRole("dialog").last(); await expect(drawer.getByRole("heading", { name: "Dispatch", exact: true })).toBeVisible();
  await drawer.getByText("Require customer approval before work and billing", { exact: true }).click(); await drawer.getByRole("button", { name: "Save dispatch", exact: true }).click();
  await drawer.getByRole("button", { name: "Create invoice", exact: true }).click(); await expect(drawer.getByRole("alert").first()).toContainText("approval");
  await drawer.getByRole("button", { name: "Record approval request", exact: true }).click(); await drawer.getByLabel("Approval decision evidence", { exact: true }).fill("Customer signed the cable replacement estimate"); await drawer.getByRole("button", { name: "Record customer approval", exact: true }).click();
  await drawer.getByLabel("Time entry work performed", { exact: true }).fill("Replace cable and adjust brakes"); await drawer.getByRole("button", { name: "Add manual time", exact: true }).click(); await expect(drawer).toContainText("60.0 minutes");
  await drawer.getByRole("button", { name: "Sync logged labour to estimate", exact: true }).click(); await expect(drawer).toContainText("Approval needed for changed scope");
  await drawer.getByRole("button", { name: "Record approval request", exact: true }).click(); await drawer.getByLabel("Approval decision evidence", { exact: true }).fill("Customer accepted the updated labour estimate"); await drawer.getByRole("button", { name: "Record customer approval", exact: true }).click();
  await drawer.getByRole("button", { name: "Start repair timer", exact: true }).click(); await expect(drawer.getByRole("button", { name: "Stop repair timer", exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "Create invoice", exact: true }).click(); await expect(drawer.getByRole("alert").first()).toContainText("timers");
  await drawer.getByRole("button", { name: "Stop repair timer", exact: true }).click(); await expect(drawer.getByRole("button", { name: "Stop repair timer", exact: true })).not.toBeVisible();
  await drawer.getByRole("button", { name: "Preview work order", exact: true }).click(); let preview = page.getByRole("dialog").last(); await pdf(page, preview.getByRole("button", { name: "Download work order PDF", exact: true }), "/workspace/scratch/invoice-pdf/native-work-order.pdf", [name, "Bicycle", "Assigned technician", "Logged labour"]); await preview.getByRole("button", { name: "Close", exact: true }).first().click();
  drawer = page.getByRole("dialog").last(); await drawer.getByRole("button", { name: "Create invoice", exact: true }).click(); await expect(page.getByRole("dialog").last()).toContainText("View linked repair");
  expect(errors).toEqual([]);
});

test("quotes use assigned effective quantity tiers and retain an explicit rate", async ({ page }) => {
  const suffix = Date.now(), item = `Quote tier service ${suffix}`, name = `Quote trade ${suffix}`, customerName = `Quote pricing customer ${suffix}`;
  await page.goto("/app/invoices?tab=catalog"); await page.getByRole("button", { name: "New item", exact: true }).click(); let drawer = page.getByRole("dialog").last(); await drawer.getByLabel("Name", { exact: true }).fill(item); await drawer.getByLabel(/^Unit (price|rate)/).fill("100.00"); await drawer.getByRole("button", { name: "Save", exact: true }).click(); await expect(drawer).not.toBeVisible(); await expect(page.getByRole("row").filter({ hasText: item })).toBeVisible();
  await page.goto("/app/invoices?tab=quotes"); await page.getByRole("button", { name: "New quote", exact: true }).click(); drawer = page.getByRole("dialog").last(); await drawer.getByRole("combobox", { name: "Bill to", exact: true }).fill(customerName); await page.getByRole("option", { name: /Create customer/ }).last().click(); await expect(drawer.locator(".billto__name")).toHaveText(customerName); await drawer.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto("/app/invoices?tab=price_lists"); await page.getByRole("button", { name: "New price list", exact: true }).click(); drawer = page.getByRole("dialog").last(); await drawer.getByLabel("Name", { exact: true }).fill(name); await drawer.getByLabel(`${item} / each (CAD)`, { exact: true }).fill("90.00"); await drawer.getByLabel("Effective from", { exact: true }).fill("2000-01-01"); await drawer.getByLabel("Effective through", { exact: true }).fill("2099-12-31"); await drawer.getByRole("button", { name: "Add quantity tier", exact: true }).click(); await pick(page, drawer, "Tier item", item); await drawer.getByLabel("Minimum quantity", { exact: true }).fill("10"); await drawer.getByLabel("Tier rate", { exact: true }).fill("70.00"); await drawer.getByRole("button", { name: "Save price list", exact: true }).click(); await expect(drawer).not.toBeVisible(); await pick(page, page.locator(".invoice-card"), customerName, `${name} (CAD)`); await expect(page.getByLabel(customerName, { exact: true })).toContainText(name);
  await page.goto("/app/invoices?tab=quotes"); await page.getByRole("button", { name: "New quote", exact: true }).click(); drawer = page.getByRole("dialog").last(); await drawer.getByRole("combobox", { name: "Bill to", exact: true }).fill(customerName); await page.getByRole("option", { name: customerName, exact: true }).click(); await expect(drawer.getByLabel("Quote price list", { exact: true })).toContainText(name); await drawer.getByRole("button", { name: "From catalog", exact: true }).click(); await page.getByRole("menuitem", { name: new RegExp(item) }).click(); await expect(drawer.locator(".line-editor__field--price input")).toHaveValue("90.00"); await drawer.getByLabel("Qty", { exact: true }).fill("10"); await expect(drawer.locator(".line-editor__field--price input")).toHaveValue("70.00"); await drawer.locator(".line-editor__field--price input").fill("65.00"); await drawer.getByLabel("Qty", { exact: true }).fill("20"); await expect(drawer.locator(".line-editor__field--price input")).toHaveValue("65.00"); await drawer.getByRole("button", { name: "Save quote", exact: true }).click(); await expect(page.getByRole("dialog").last()).toContainText("$1,300.00");
});
