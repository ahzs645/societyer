import { test, expect, type Download, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";

async function pick(page: Page, scope: Locator, label: string, option: string | RegExp) {
  await scope.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function check(scope: Locator, label: string, checked = true) {
  const input = scope.getByRole("checkbox", { name: label, exact: true });
  if (await input.isChecked() !== checked) await scope.getByText(label, { exact: true }).click();
  if (checked) await expect(input).toBeChecked();
  else await expect(input).not.toBeChecked();
}

async function downloadedBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  expect(path, "the browser produced a local artifact").toBeTruthy();
  return readFile(path!);
}

async function pdfText(bytes: Buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true }).promise;
  const pages = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    pages.push((await page.getTextContent()).items.map((item: any) => item.str ?? "").join(" "));
  }
  await pdf.destroy();
  return pages.join(" ").replace(/\s+/g, " ");
}

/** Use real portable mutations, with synthetic accounts confined to this test's IndexedDB. */
async function seedReportEntry(page: Page) {
  return page.evaluate(async () => {
    const modulePath = "/src/lib/localDataClient.ts";
    const { localDataClient: client } = await import(modulePath);
    const societies = await client.query("society:list", {});
    const societyId = societies[0]._id;
    const suffix = Date.now().toString(36).slice(-5);
    const cash = await client.mutation("accounting:upsertChartAccount", { societyId, code: `VC${suffix}`, name: "Verification USD bank", accountType: "Asset", subtype: "cash", currency: "USD" });
    const revenue = await client.mutation("accounting:upsertChartAccount", { societyId, code: `VR${suffix}`, name: "Verification USD revenue", accountType: "Income", currency: "USD" });
    const fund = await client.mutation("accounting:upsertFundRestriction", { societyId, name: "Verification reserve", purpose: "Synthetic report integration check", status: "active" });
    const group = await client.mutation("financeTags:upsertGroup", { societyId, name: `Verification group ${suffix}` });
    const tag = await client.mutation("financeTags:upsertTag", { societyId, groupId: group, name: "Verification tag" });
    await client.mutation("accounting:upsertJournalEntry", {
      societyId, date: "2026-10-21", memo: "Verification export transaction", source: "manual", status: "posted", basis: "both",
      lines: [
        { accountId: cash, amountCents: 12_345, side: "debit", programCode: "VERIFY", fundRestrictionId: fund },
        { accountId: revenue, amountCents: 12_345, side: "credit", programCode: "VERIFY", fundRestrictionId: fund },
      ],
    });
    return { societyId, cash, revenue, fund, tag };
  });
}

test("designer settings persist through invoice, payment receipt and repair work-order PDFs", async ({ page }, testInfo) => {
  page.setDefaultTimeout(30_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const name = `Designer integration ${Date.now()}`;
  await page.goto("/app/invoices?tab=templates");
  await page.getByRole("button", { name: "Use ddcnorth brand", exact: true }).click();
  let drawer = page.getByRole("dialog");
  await drawer.getByLabel("Template name", { exact: true }).fill(name);
  await pick(page, drawer, "Orientation", "Landscape");
  await drawer.getByLabel("Top margin (pt)", { exact: true }).fill("36");
  await drawer.getByLabel("Left margin (pt)", { exact: true }).fill("34");
  await drawer.getByLabel("Logo width (pt)", { exact: true }).fill("168");
  await pick(page, drawer, "Logo alignment", "Center");
  await pick(page, drawer, "Body font", "Monospace");
  await drawer.getByLabel("Body font size (pt)", { exact: true }).fill("11");
  await drawer.getByLabel("Document title", { exact: true }).fill("Service invoice");
  await drawer.getByLabel("Receipt title", { exact: true }).fill("Payment confirmation");
  await drawer.getByLabel("Work order title", { exact: true }).fill("Service work order");
  await drawer.getByLabel("Bill To label", { exact: true }).fill("Customer account");
  await drawer.getByLabel("Item column label", { exact: true }).fill("Work performed");
  await drawer.getByLabel("Rate column label", { exact: true }).fill("Unit charge");
  await drawer.getByLabel("Item column width", { exact: true }).fill("45");
  await check(drawer, "Show sku column");
  await drawer.getByRole("button", { name: "Move sku column left", exact: true }).click();
  await check(drawer, "Show tax column", false);
  await check(drawer, "Alternate row shading");
  await drawer.getByLabel("First page header text", { exact: true }).fill("SERVICE HEADER");
  await check(drawer, "Repeat header on continuation pages");
  await drawer.getByLabel("Continuation header text", { exact: true }).fill("SERVICE CONTINUED");
  await drawer.getByLabel("Footer", { exact: true }).fill("WARRANTY 90 DAYS");
  await check(drawer, "Repeat footer on continuation pages");
  await drawer.getByLabel("Continuation footer text", { exact: true }).fill("CONTINUED WARRANTY");
  await check(drawer, "Show page numbers");
  await pick(page, drawer, "Page number format", "Page 1 of 3");
  await check(drawer, "Show signature block");
  await drawer.getByLabel("Signature label", { exact: true }).fill("Approved by");
  await drawer.getByLabel("Signature name", { exact: true }).fill("Workshop technician");
  await check(drawer, "Use for new invoices by default");
  await check(drawer, "Multi-page sample");

  const preview = drawer.locator(".document-preview");
  expect(await preview.evaluate((element) => parseFloat(getComputedStyle(element).paddingLeft))).toBeCloseTo(34 * 96 / 72, 2);
  await expect(preview.getByRole("columnheader", { name: "Work performed", exact: true })).toBeVisible();
  await expect(preview.getByRole("columnheader", { name: /Unit charge/ })).toBeVisible();
  await expect(preview.getByRole("columnheader", { name: "Tax", exact: true })).toHaveCount(0);
  let downloading = page.waitForEvent("download");
  await drawer.getByRole("button", { name: "Download sample PDF", exact: true }).click();
  const sampleDownload = await downloading;
  await sampleDownload.saveAs(testInfo.outputPath("landscape-designer-sample.pdf"));
  const sampleBytes = await downloadedBytes(sampleDownload);
  const sample = await PDFDocument.load(sampleBytes);
  expect(sample.getPageCount()).toBeGreaterThan(1);
  expect(sample.getPage(0).getWidth()).toBeGreaterThan(sample.getPage(0).getHeight());
  const sampleText = await pdfText(sampleBytes);
  for (const expected of ["Service invoice", "Customer account", "Work performed", "Unit charge", "SERVICE HEADER", "SERVICE CONTINUED", "CONTINUED WARRANTY", "Workshop technician"]) expect(sampleText).toContain(expected);
  expect(sampleText).toMatch(/Page 1 of \d+/);
  await drawer.getByRole("navigation", { name: "Document designer sections", exact: true }).getByRole("button", { name: "Page", exact: true }).click();
  await expect(drawer.getByLabel("Template name", { exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("document-designer.png") });
  await drawer.getByRole("button", { name: "Save template", exact: true }).click();
  await expect(drawer).toBeHidden();
  await page.reload();
  const card = page.locator(".invoice-template-card").filter({ hasText: name });
  await expect(card).toContainText("Default");
  await card.getByRole("button", { name: "Customize", exact: true }).click();
  drawer = page.getByRole("dialog");
  await expect(drawer.getByLabel("Orientation", { exact: true })).toContainText("Landscape");
  await expect(drawer.getByLabel("Left margin (pt)", { exact: true })).toHaveValue("34");
  await expect(drawer.getByLabel("Item column label", { exact: true })).toHaveValue("Work performed");
  await expect(drawer.getByLabel("Body font", { exact: true })).toContainText("Monospace");
  await drawer.getByRole("button", { name: "Cancel", exact: true }).click();
  downloading = page.waitForEvent("download");
  await card.getByRole("button", { name: "Export JSON", exact: true }).click();
  const templateBytes = await downloadedBytes(await downloading);
  const templateFile = JSON.parse(templateBytes.toString("utf8"));
  expect(templateFile.format).toBe("societyer-document-template");
  expect(templateFile.template.design.page.orientation).toBe("landscape");
  expect(templateFile.template.design.page.margins.left).toBe(34);
  expect(templateFile.template.design.typography.body.fontFamily).toBe("mono");
  await page.getByLabel("Import template JSON", { exact: true }).setInputFiles({ name: "unsupported.template.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "societyer-document-template", version: 99, template: templateFile.template })) });
  await expect(page.getByRole("alert")).toContainText("not supported");
  templateFile.template.name = `${name} imported`;
  await page.getByLabel("Import template JSON", { exact: true }).setInputFiles({ name: "roundtrip.template.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(templateFile)) });
  drawer = page.getByRole("dialog");
  await expect(drawer.getByLabel("Template name", { exact: true })).toHaveValue(`${name} imported`);
  await expect(drawer.getByLabel("Left margin (pt)", { exact: true })).toHaveValue("34");
  await drawer.getByRole("button", { name: "Cancel", exact: true }).click();

  const repairId = await page.evaluate(async () => {
    const modulePath = "/src/lib/localDataClient.ts";
    const { localDataClient: client } = await import(modulePath);
    const societyId = (await client.query("society:list", {}))[0]._id;
    return client.mutation("invoices:upsertRepairJob", {
      societyId, partyKind: "custom", billToName: "Designer workshop customer", billToEmail: "workshop@example.test",
      asset: "Bicycle", serialNumber: "FRAME-DESIGN-001", problem: "Brake adjustment", notes: "Use the customer-approved parts.",
      receivedDate: "2026-10-21", targetDate: "2026-10-22", currency: "CAD",
      lines: [{ key: "test-labour", item: "Repair labour", description: "Brake inspection", sku: "LABOUR-001", quantity: 2, unit: "hour", unitPriceCents: 8500 }],
    });
  });
  await page.goto(`/app/invoices?tab=repairs&repair=${encodeURIComponent(repairId)}`);
  drawer = page.getByRole("dialog");
  await drawer.getByRole("button", { name: "Preview work order", exact: true }).click();
  const workOrder = page.getByRole("dialog", { name: /^Work order / });
  await expect(workOrder.getByLabel("Document template", { exact: true })).toContainText(name);
  await expect(workOrder.locator(".document-preview")).toContainText("Service work order");
  await expect(workOrder.locator(".document-preview")).toContainText("FRAME-DESIGN-001");
  downloading = page.waitForEvent("download");
  await workOrder.getByRole("button", { name: "Download work order PDF", exact: true }).click();
  const workOrderDownload = await downloading;
  await workOrderDownload.saveAs(testInfo.outputPath("work-order.pdf"));
  const workOrderText = await pdfText(await downloadedBytes(workOrderDownload));
  for (const value of ["Service work order", "FRAME-DESIGN-001", "Brake adjustment", "LABOUR-001", "Work performed"]) expect(workOrderText).toContain(value);
  await workOrder.getByRole("button", { name: "Close", exact: true }).last().click();
  await drawer.getByRole("button", { name: "Create invoice", exact: true }).click();
  await drawer.getByRole("button", { name: "Record payment", exact: true }).click();
  await drawer.getByLabel("Amount", { exact: true }).fill("25.00");
  await drawer.getByRole("form", { name: /^Record a payment for / }).getByLabel("Reference", { exact: true }).fill("DESIGN-PAY-001");
  await drawer.getByRole("form", { name: /^Record a payment for / }).getByRole("button", { name: "Record $25.00", exact: true }).click();
  await expect(drawer).toContainText("Partially paid");
  await drawer.getByRole("button", { name: /^Preview receipt for payment / }).click();
  const receipt = page.getByRole("dialog", { name: /^Receipt / });
  await expect(receipt.locator(".document-preview")).toContainText("Payment confirmation");
  await expect(receipt.locator(".document-preview__totals")).toContainText("25.00");
  await expect(receipt.locator(".document-preview__totals")).not.toContainText("170.00");
  await expect(receipt.locator(".document-preview")).toContainText("DESIGN-PAY-001");
  downloading = page.waitForEvent("download");
  await receipt.getByRole("button", { name: "Download receipt PDF", exact: true }).click();
  const receiptDownload = await downloading;
  await receiptDownload.saveAs(testInfo.outputPath("payment-receipt.pdf"));
  const receiptText = await pdfText(await downloadedBytes(receiptDownload));
  for (const value of ["Payment confirmation", "Amount received", "25.00", "DESIGN-PAY-001", "E-transfer", "Invoice balance at export", "145.00"]) expect(receiptText).toContain(value);
  await receipt.getByRole("button", { name: "Close", exact: true }).last().click();
  await page.goto("/app/financials/reports/balance-sheet?preset=custom&from=2026-01-01&to=2026-10-22");
  await expect(page.getByRole("button", { name: "PDF template", exact: true })).toContainText(name);
  downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download branded PDF", exact: true }).click();
  const sharedReportDownload = await downloading;
  await sharedReportDownload.saveAs(testInfo.outputPath("branded-balance-sheet.pdf"));
  const sharedReportBytes = await downloadedBytes(sharedReportDownload);
  const sharedReport = await PDFDocument.load(sharedReportBytes);
  expect(sharedReport.getPage(0).getWidth()).toBeGreaterThan(sharedReport.getPage(0).getHeight());
  const sharedReportText = await pdfText(sharedReportBytes);
  for (const value of ["Balance sheet", "Working capital", "SERVICE HEADER", "WARRANTY 90 DAYS"]) expect(sharedReportText).toContain(value);
  expect(errors).toEqual([]);
});

test("financial report filters survive navigation and downloads keep the filtered figures", async ({ page }) => {
  page.setDefaultTimeout(30_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/app/invoices");
  await expect(page.getByRole("heading", { name: "Invoices", exact: true })).toBeVisible();
  const fixture = await seedReportEntry(page);
  await page.goto("/app/financials/reports/operations?preset=custom&from=2026-10-01&to=2026-10-22&currency=USD");
  const statement = page.locator("section.books-report");
  await expect(page.getByRole("heading", { name: "Revenue and expenses", exact: true })).toBeVisible();
  await expect(statement.locator(".report-table__table")).toContainText("Verification USD revenue");
  await pick(page, statement, "Currency", "CAD");
  await expect(page).toHaveURL(/currency=CAD/);
  await expect(statement.locator(".report-table__table")).not.toContainText("Verification USD revenue");
  await pick(page, statement, "Currency", "USD");
  await expect(statement.locator(".report-table__table")).toContainText("Verification USD revenue");
  await page.getByRole("group", { name: "Columns", exact: true }).getByRole("button", { name: "Quarterly", exact: true }).click();
  await expect(page).toHaveURL(/freq=quarter/);
  await page.getByRole("group", { name: "Accounting basis", exact: true }).getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("group", { name: "Filter by fund", exact: true }).getByRole("button", { name: "Verification reserve", exact: true }).click();
  await pick(page, statement, "Program", "VERIFY");
  await expect(page).toHaveURL(/basis=cash/);
  await expect(page).toHaveURL(new RegExp(`fund=${encodeURIComponent(fixture.fund)}`));
  await expect(page).toHaveURL(/program=VERIFY/);
  await expect(page).toHaveURL(/currency=USD/);

  const chart = page.getByRole("region", { name: "Revenue and expenses", exact: true });
  await chart.getByRole("button", { name: "View as table", exact: true }).click();
  await expect(chart.getByRole("table")).toContainText("123.45");
  await chart.getByRole("button", { name: "View as chart", exact: true }).click();
  await expect(chart.getByRole("button", { name: "View as table", exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Verification USD revenue, .*: show entries/ }).first().click();
  const drill = page.getByRole("dialog");
  await expect(drill).toContainText("Verification export transaction");
  await expect(drill).toContainText("Cash basis");
  await expect(drill).toContainText("Verification reserve");
  await drill.getByRole("button", { name: /Close/ }).first().click();

  await page.getByRole("button", { name: "Download Statement of operations", exact: true }).click();
  let downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "CSV", exact: true }).click();
  const csv = (await downloadedBytes(await downloading)).toString("utf8");
  for (const value of ["Cash basis", "USD", "Verification reserve", "VERIFY", "Verification USD revenue", "123.45"]) expect(csv).toContain(value);
  await page.getByRole("button", { name: "Download Statement of operations", exact: true }).click();
  downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Excel (.xlsx)", exact: true }).click();
  const xlsx = await JSZip.loadAsync(await downloadedBytes(await downloading));
  expect(xlsx.file("xl/workbook.xml")).toBeTruthy();

  downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download branded PDF", exact: true }).click();
  const reportBytes = await downloadedBytes(await downloading);
  expect((await PDFDocument.load(reportBytes)).getPageCount()).toBeGreaterThan(0);
  const exported = await pdfText(reportBytes);
  for (const value of ["Statement of operations", "USD", "Cash", "Verification reserve", "VERIFY", "Verification USD revenue", "123.45", "Revenue"]) expect(exported).toContain(value);
  await check(page.locator("section.books-report"), "Include graphs", false);
  downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download branded PDF", exact: true }).click();
  const tableOnly = await pdfText(await downloadedBytes(await downloading));
  expect(tableOnly).toContain("Verification USD revenue");
  expect(tableOnly).not.toContain("Revenue and expenses");

  await page.locator(".books-reports__switcher").getByRole("button", { name: "Cash flow", exact: true }).click();
  await expect(page).toHaveURL(/reports\/cash-flow\?/);
  await expect(page).toHaveURL(/basis=cash/);
  await expect(page).toHaveURL(/program=VERIFY/);
  await expect(page.getByRole("heading", { name: "Cash in and out", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("group", { name: "Accounting basis", exact: true }).getByRole("button", { name: "Cash", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Program", exact: true })).toContainText("VERIFY");
  await page.locator(".books-reports__switcher").getByRole("button", { name: "General ledger", exact: true }).click();
  const ledger = page.getByRole("region", { name: "General ledger", exact: true });
  await pick(page, ledger, "Account", /Verification USD bank$/);
  await expect(page).toHaveURL(new RegExp(`account=${encodeURIComponent(fixture.cash)}`));
  await expect(ledger.getByRole("table")).toContainText("Verification export transaction");
  await expect(ledger.getByRole("table")).toContainText("Opening balance");

  // Tag selection changes the actual query, and remains in the shareable URL.
  await page.getByRole("button", { name: "Tags All tags", exact: true }).click();
  await page.getByRole("menuitem", { name: "Verification tag", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`tag=${encodeURIComponent(fixture.tag)}`));
  await expect(ledger.getByRole("table")).toContainText("No posted lines in this range.");
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`tag=${encodeURIComponent(fixture.tag)}`));
  await expect(page.getByRole("button", { name: "Tags Verification tag", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("overview, Sankey and year-end pages produce their own searchable report PDFs", async ({ page }, testInfo) => {
  page.setDefaultTimeout(30_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/app/financials");
  const overview = page.getByRole("region", { name: "Financial trends", exact: true });
  await expect(overview.getByRole("button", { name: "Overview PDF", exact: true })).toBeEnabled();
  await overview.getByRole("group", { name: "Date range", exact: true }).getByRole("button", { name: "All", exact: true }).click();
  let downloading = page.waitForEvent("download");
  await overview.getByRole("button", { name: "Overview PDF", exact: true }).click();
  const overviewDownload = await downloading;
  await overviewDownload.saveAs(testInfo.outputPath("financial-overview.pdf"));
  const overviewText = await pdfText(await downloadedBytes(overviewDownload));
  for (const value of ["Financial overview", "Cash over time", "Money in vs out by month", "Selected-range totals", "Source: bank/card"]) expect(overviewText).toContain(value);

  const sankey = page.getByRole("region", { name: "Where the money came from and went", exact: true });
  await sankey.getByRole("button", { name: "View as table", exact: true }).click();
  await expect(sankey.getByRole("table")).toContainText("Net amount");
  await sankey.getByRole("button", { name: "View as chart", exact: true }).click();
  downloading = page.waitForEvent("download");
  await sankey.getByRole("button", { name: "Diagram PDF", exact: true }).click();
  const diagramDownload = await downloading;
  await diagramDownload.saveAs(testInfo.outputPath("cash-flow-diagram.pdf"));
  const diagramText = await pdfText(await downloadedBytes(diagramDownload));
  for (const value of ["Where the money came from and went", "Cash-flow diagram", "Internal transfers excluded", "Cash-flow totals", "All categories"]) expect(diagramText).toContain(value);

  await page.goto("/app/financials/year-end");
  await expect(page.getByRole("button", { name: "Download branded PDF", exact: true })).toBeEnabled();
  const fiscalYear = await page.getByLabel("Fiscal year", { exact: true }).inputValue();
  const yearEndTabs = page.locator(".financials-tabs");
  for (const [tab, title, graph] of [
    ["Readiness checklist", "Year-End Readiness Checklist", "Readiness progress"],
    ["Annual statement", "Annual Financial Statement", "Revenue and expenses"],
    ["Restricted funds", "Statement of Restricted Funds", "Restricted fund movement"],
    ["Organization revenue & expenses", "Organization Revenue and Expense Statement", "Revenue and expenses by fund"],
  ]) {
    await yearEndTabs.getByRole("button", { name: tab, exact: true }).click();
    await expect(page.getByRole("button", { name: "Download branded PDF", exact: true })).toBeEnabled();
    downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download branded PDF", exact: true }).click();
    const bytes = await downloadedBytes(await downloading);
    const text = await pdfText(bytes);
    expect(text).toContain(title);
    expect(text).toContain(graph);
    if (tab !== "Restricted funds") expect(text).toContain(fiscalYear);
    await expect(page.getByRole("button", { name: "Export Word", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Print", exact: true })).toBeVisible();
  }
  await yearEndTabs.getByRole("button", { name: "Program actuals & budget", exact: true }).click();
  await page.getByRole("button", { name: "New statement", exact: true }).click();
  await page.getByLabel("Program name", { exact: true }).fill("Verification program draft");
  downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download branded PDF", exact: true }).click();
  const programText = await pdfText(await downloadedBytes(await downloading));
  for (const value of ["Program Actual Revenue and Expenses and Budget", "Verification program draft", "Program actuals and budget", "Draft"]) expect(programText).toContain(value);
  expect(errors).toEqual([]);
});

test("ready-made template gallery previews real designs before saving and respects reader permissions", async ({ page }, testInfo) => {
  page.setDefaultTimeout(30_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/app/invoices?tab=templates");
  const gallery = page.getByRole("region", { name: "Template gallery", exact: true });
  await expect(gallery).toBeVisible();
  await expect(gallery.getByRole("article")).toHaveCount(12);
  const savedBefore = await page.evaluate(async () => {
    const modulePath = "/src/lib/localDataClient.ts";
    const { localDataClient: client } = await import(modulePath);
    const societyId = (await client.query("society:list", {}))[0]._id;
    return (await client.query("invoices:documentTemplates", { societyId })).templates.length;
  });
  expect(savedBefore).toBe(0);

  // Lazy-loaded thumbnails are real rendered documents, available before the first saved template.
  await expect(gallery.locator("img")).toHaveCount(12);
  for (const image of await gallery.locator("img").all()) {
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 100)).toBe(true);
  }
  const filters = gallery.getByRole("group", { name: "Template type", exact: true });
  await filters.getByRole("button", { name: "Reports", exact: true }).click();
  expect(await gallery.getByRole("article").count()).toBeGreaterThan(0);
  expect(await gallery.getByRole("article").count()).toBeLessThan(12);
  await gallery.getByRole("textbox", { name: "Search templates", exact: true }).fill("Landscape financials");
  await expect(gallery.getByRole("article")).toHaveCount(1);
  const name = "ddcnorth · Landscape financials";
  const card = gallery.getByRole("article", { name, exact: true });
  await card.getByRole("button", { name: `Preview ${name}`, exact: true }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(name);
  await expect(dialog.getByRole("button", { name: "Preview document", exact: true })).toContainText("Financial report");
  await expect(dialog.getByTitle("Template PDF preview", { exact: true })).toHaveAttribute("src", /^blob:/);
  let downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download sample PDF", exact: true }).click();
  const reportDownload = await downloading;
  await reportDownload.saveAs(testInfo.outputPath("gallery-financial-report.pdf"));
  const reportBytes = await downloadedBytes(reportDownload);
  const report = await PDFDocument.load(reportBytes);
  expect(report.getPage(0).getWidth()).toBeGreaterThan(report.getPage(0).getHeight());
  const reportText = await pdfText(reportBytes);
  for (const value of ["Sample financial report", "Statement of operations", "Revenue and expenses", "Service income", "Q4"]) expect(reportText).toContain(value);

  await pick(page, dialog, "Preview document", "Payment receipt");
  await expect(dialog.getByTitle("Template PDF preview", { exact: true })).toHaveAttribute("src", /^blob:/);
  downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download sample PDF", exact: true }).click();
  const receiptText = await pdfText(await downloadedBytes(await downloading));
  for (const value of ["RCPT-SAMPLE-001", "Amount received", "150.00", "PAY-SAMPLE-1042", "159.75"]) expect(receiptText).toContain(value);
  await dialog.getByRole("button", { name: "Customize template", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "New document template", exact: true });
  await expect(dialog.getByLabel("Template name", { exact: true })).toHaveValue(name);
  await expect(dialog.getByRole("button", { name: "Orientation", exact: true })).toContainText("Landscape");
  const savedName = `Gallery report ${Date.now()}`;
  await dialog.getByLabel("Template name", { exact: true }).fill(savedName);
  await dialog.getByRole("button", { name: "Save template", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  const saved = page.locator(".invoice-template-card").filter({ hasText: savedName });
  await expect(saved).toBeVisible();
  await saved.getByRole("button", { name: `Preview saved ${savedName}`, exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(savedName);
  await expect(dialog.getByTitle("Template PDF preview", { exact: true })).toHaveAttribute("src", /^blob:/);
  await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(gallery.getByRole("article")).toHaveCount(12);
  await gallery.getByRole("heading", { name: "Choose a starting design", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("ready-made-template-gallery.png"), fullPage: true });

  // Switch the local test operator to an actual Viewer membership; both UI and mutation enforce read-only access.
  await page.evaluate(async () => {
    const clientPath = "/src/lib/localDataClient.ts", userPath = "/src/hooks/useCurrentUser.ts";
    const { localDataClient: client } = await import(clientPath);
    const societyId = (await client.query("society:list", {}))[0]._id;
    const reader = await client.mutation("users:upsert", { societyId, displayName: "Template gallery reader", email: "template-reader@example.test", role: "Viewer", status: "Active" });
    const { setStoredUserId } = await import(userPath);
    setStoredUserId(reader);
  });
  await expect(page.getByRole("button", { name: "New template", exact: true })).toBeDisabled();
  await expect(gallery.getByRole("button", { name: `Use ${name}`, exact: true })).toBeDisabled();
  await gallery.getByRole("button", { name: `Preview ${name}`, exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByTitle("Template PDF preview", { exact: true })).toHaveAttribute("src", /^blob:/);
  await expect(dialog.getByRole("button", { name: "Customize template", exact: true })).toBeDisabled();
  const denied = await page.evaluate(async () => {
    const modulePath = "/src/lib/localDataClient.ts";
    const { localDataClient: client } = await import(modulePath);
    const societyId = (await client.query("society:list", {}))[0]._id;
    const workspace = await client.query("invoices:documentTemplates", { societyId });
    try {
      await client.mutation("invoices:upsertTemplate", { societyId, config: { ...workspace.templates[0].config, name: "Unauthorized reader draft" } });
      return { denied: false, count: (await client.query("invoices:documentTemplates", { societyId })).templates.length };
    } catch (error) {
      return { denied: true, message: String(error), count: (await client.query("invoices:documentTemplates", { societyId })).templates.length };
    }
  });
  expect(denied.denied).toBe(true);
  expect(denied.message).toMatch(/permission|forbidden|authoriz/i);
  expect(denied.count).toBe(1);
  expect(errors).toEqual([]);
});
