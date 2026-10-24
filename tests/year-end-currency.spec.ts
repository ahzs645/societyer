import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("year-end currency changes source rows, drilldowns, Word, PDF and base-currency program prefills", async ({ page }, testInfo) => {
  page.setDefaultTimeout(30_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/app/financials/year-end");
  await expect(page.getByRole("heading", { name: "Year-end reports", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const societyId = (await client.query("society:list", {}))[0]._id;
    const cad = await client.mutation("accounting:upsertChartAccount", { societyId, code: "YECAD", name: "Year-end CAD bank", accountType: "Bank", currency: "CAD" });
    const usd = await client.mutation("accounting:upsertChartAccount", { societyId, code: "YEUSD", name: "Year-end USD bank", accountType: "Bank", currency: "USD" });
    await client.mutation("financialHub:importBankCsvTransactions", { societyId, accountId: cad, rows: [{ date: "2026-07-01", description: "CAD receipt", amountCents: 90000, category: "CAD-only year-end revenue" }] });
    await client.mutation("financialHub:importBankCsvTransactions", { societyId, accountId: usd, rows: [{ date: "2026-07-01", description: "USD receipt", amountCents: 12345, category: "USD-only year-end revenue" }, { date: "2026-07-02", description: "USD payment", amountCents: -2345, category: "USD-only year-end expense" }] });
    await client.mutation("financials:create", { societyId, fiscalYear: "2026", periodEnd: "2026-12-31", revenueCents: 90000, expensesCents: 0, netAssetsCents: 90000, auditStatus: "Unaudited", remunerationDisclosures: [] });
    const cadGrant = await client.mutation("grants:upsertGrant", { societyId, title: "Year-end CAD program", funder: "CAD foundation", status: "Active", linkedFinancialAccountId: cad, restrictedPurpose: "CAD purpose", amountAwardedCents: 90000 });
    const usdGrant = await client.mutation("grants:upsertGrant", { societyId, title: "Year-end USD program", funder: "USD foundation", status: "Active", linkedFinancialAccountId: usd, restrictedPurpose: "USD purpose", amountAwardedCents: 12345 });
    await client.mutation("grants:upsertTransaction", { societyId, grantId: cadGrant, date: "2026-07-01", direction: "inflow", amountCents: 90000, description: "CAD grant receipt" });
    await client.mutation("grants:upsertTransaction", { societyId, grantId: usdGrant, date: "2026-07-01", direction: "inflow", amountCents: 12345, description: "USD grant receipt" });
  });
  await page.getByLabel("Fiscal year", { exact: true }).selectOption("2026");
  const tabs = page.locator(".financials-tabs");
  await tabs.getByRole("button", { name: "Annual statement", exact: true }).click();
  await page.getByLabel("Report currency", { exact: true }).selectOption("USD");
  await expect(page.locator(".year-end-preview, .card").filter({ hasText: "Annual Financial Statement" }).first()).toContainText("US$123.45");
  await expect(page.getByText("USD-only year-end revenue", { exact: true })).toBeVisible();
  await expect(page.getByText("CAD-only year-end revenue", { exact: true })).toHaveCount(0);
  let downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download branded PDF", exact: true }).click();
  const download = await downloading;
  await download.saveAs(testInfo.outputPath("annual-usd.pdf"));
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await getDocument({ data: new Uint8Array(await readFile((await download.path())!)), useSystemFonts: true }).promise;
  let text = "";
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) text += (await (await pdf.getPage(pageNumber)).getTextContent()).items.map((item: any) => item.str ?? "").join(" ");
  await pdf.destroy();
  expect(text).toContain("Source currency: USD"); expect(text).toContain("US$123.45"); expect(text).not.toContain("CAD-only year-end revenue");
  downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Export Word", exact: true }).click();
  expect((await downloading).suggestedFilename()).toContain("USD.docx");
  await tabs.getByRole("button", { name: "Organization revenue & expenses", exact: true }).click();
  const table = page.getByRole("region", { name: "Statement of revenues and expenses", exact: true });
  await expect(table).toContainText("USD-only year-end revenue"); await expect(table).not.toContainText("CAD-only year-end revenue");
  await page.getByLabel("Report currency", { exact: true }).selectOption("CAD");
  await expect(table).toContainText("CAD-only year-end revenue"); await expect(table).not.toContainText("USD-only year-end revenue");
  await tabs.getByRole("button", { name: "Restricted funds", exact: true }).click();
  await page.getByLabel("Report currency", { exact: true }).selectOption("USD");
  const fundTable = page.getByRole("region", { name: "Statement of restricted funds", exact: true });
  await expect(fundTable).toContainText("Year-end USD program"); await expect(fundTable).not.toContainText("Year-end CAD program");
  await fundTable.getByText("Year-end USD program", { exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("USD grant receipt"); await expect(page.getByRole("dialog")).not.toContainText("CAD grant receipt");
  await page.getByRole("dialog").getByRole("button", { name: "Close drawer", exact: true }).click();
  await tabs.getByRole("button", { name: "Program actuals & budget", exact: true }).click();
  await expect(page.getByLabel("Prefill from grant", { exact: true }).getByRole("option", { name: "Year-end CAD program — CAD foundation", exact: true })).toHaveCount(1);
  await expect(page.getByLabel("Prefill from grant", { exact: true }).getByRole("option", { name: "Year-end USD program — USD foundation", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("report PDFs use defaults beyond 200 templates and react to the oldest paginated template", async ({ page }, testInfo) => {
  page.setDefaultTimeout(30_000);
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/app/financials/year-end");
  await expect(page.getByRole("heading", { name: "Year-end reports", exact: true })).toBeVisible();
  const fixture = await page.evaluate(async () => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { DEFAULT_INVOICE_TEMPLATE, resolveDocumentDesign } = await import("/shared/invoiceCommerce.ts");
    const societyId = (await client.query("society:list", {}))[0]._id;
    const ids: string[] = [];
    for (let index = 1; index <= 205; index++) {
      const design = resolveDocumentDesign(DEFAULT_INVOICE_TEMPLATE); design.titles.report = index === 205 ? "LATE DEFAULT REPORT" : "PAGED REPORT DESIGN";
      ids.push(await client.mutation("invoices:upsertTemplate", { societyId, config: { ...DEFAULT_INVOICE_TEMPLATE, name: `Paged report template ${String(index).padStart(3, "0")}`, design }, makeDefault: index === 205 }));
    }
    const direct = await client.query("invoices:documentTemplates", { societyId, templateId: ids[150] });
    if (direct.selectedTemplate?._id !== ids[150]) throw new Error("Direct selected-template lookup lost the requested design.");
    return { societyId, oldestId: ids[0] };
  });
  await page.locator(".financials-tabs").getByRole("button", { name: "Annual statement", exact: true }).click();
  const template = page.getByRole("button", { name: "PDF template", exact: true });
  await expect(template).toBeEnabled(); await expect(template).toContainText("Paged report template 205");
  let downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Download branded PDF", exact: true }).click();
  const defaultDownload = await downloading; await defaultDownload.saveAs(testInfo.outputPath("late-default-report.pdf"));
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const textOf = async (path: string) => {
    const pdf = await getDocument({ data: new Uint8Array(await readFile(path)), useSystemFonts: true }).promise;
    let text = ""; for (let index = 1; index <= pdf.numPages; index++) text += (await (await pdf.getPage(index)).getTextContent()).items.map((item: any) => item.str ?? "").join(" ");
    await pdf.destroy(); return text;
  };
  expect(await textOf((await defaultDownload.path())!)).toContain("LATE DEFAULT REPORT");
  await template.click(); await page.getByRole("option", { name: "Paged report template 001", exact: true }).click();
  await expect(template).toContainText("Paged report template 001");
  await page.evaluate(async ({ societyId, oldestId }) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { DEFAULT_INVOICE_TEMPLATE, resolveDocumentDesign } = await import("/shared/invoiceCommerce.ts");
    const design = resolveDocumentDesign(DEFAULT_INVOICE_TEMPLATE); design.titles.report = "UPDATED OLDEST REPORT";
    await client.mutation("invoices:upsertTemplate", { societyId, id: oldestId, config: { ...DEFAULT_INVOICE_TEMPLATE, name: "Updated oldest report template", design } });
  }, fixture);
  await expect(template).toContainText("Updated oldest report template");
  downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Download branded PDF", exact: true }).click();
  const updatedDownload = await downloading; await updatedDownload.saveAs(testInfo.outputPath("updated-oldest-report.pdf"));
  expect(await textOf((await updatedDownload.path())!)).toContain("UPDATED OLDEST REPORT");
  await page.evaluate(async ({ societyId, oldestId }) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { DEFAULT_INVOICE_TEMPLATE } = await import("/shared/invoiceCommerce.ts");
    await client.mutation("invoices:upsertTemplate", { societyId, id: oldestId, config: { ...DEFAULT_INVOICE_TEMPLATE, name: "Archived oldest report template" }, active: false });
  }, fixture);
  await expect(template).toContainText("Paged report template 205");
  await template.click(); await expect(page.getByRole("option", { name: "Updated oldest report template", exact: true })).toHaveCount(0); await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});
