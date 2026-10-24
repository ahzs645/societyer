import { test, expect, type Download, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

async function pick(page: Page, scope: Locator, label: string, value: string) {
  const control = scope.getByLabel(label, { exact: true });
  if (await control.evaluate(element => element.tagName === "SELECT")) await control.selectOption({ label: value });
  else { await control.click(); await page.getByRole("option", { name: value, exact: true }).click(); }
}
async function setChecked(scope: Locator, label: string, checked: boolean) {
  const checkbox = scope.getByRole("checkbox", { name: label, exact: true });
  if (await checkbox.isChecked() !== checked) await scope.getByText(label, { exact: true }).click();
  if (checked) await expect(checkbox).toBeChecked(); else await expect(checkbox).not.toBeChecked();
}
async function downloadBytes(download: Download) { return readFile((await download.path())!); }
async function inspectPdf(bytes: Buffer) {
  const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true }).promise;
  let text = "", paths = 0;
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    text += (await page.getTextContent()).items.map((item: any) => item.str ?? "").join(" ") + " ";
    paths += (await page.getOperatorList()).fnArray.filter(operator => operator === OPS.constructPath).length;
  }
  const pages = pdf.numPages; await pdf.destroy(); return { text: text.replace(/\s+/g, " "), paths, pages };
}
const WINTER = { name: "Winter planning sample", startDate: "2027-01-01", endDate: "2027-04-30", currency: "CAD", allocationCents: 1_000_000, openingBalanceCents: 50_000, reserveCents: 100_000, basis: "allocated", includePlanned: true };
const MONTHLY = { name: "Sample software", category: "Software", currency: "CAD", amountCents: 10_000, cadence: "monthly", startDate: "2027-01-01", anchorDate: "2027-01-01", status: "committed", sourceKind: "manual" };
const ANNUAL = { name: "Sample annual insurance", category: "Insurance", currency: "CAD", amountCents: 120_000, cadence: "annual", startDate: "2026-09-01", anchorDate: "2026-09-01", status: "committed", sourceKind: "manual" };

async function addCost(page: Page, fields: typeof ANNUAL | typeof MONTHLY) {
  await page.getByRole("button", { name: "New cost", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Cost name", { exact: true }).fill(fields.name);
  await dialog.getByLabel("Category", { exact: true }).fill(fields.category);
  await dialog.getByLabel("Cost currency", { exact: true }).fill(fields.currency);
  await dialog.getByLabel("Cost amount", { exact: true }).fill((fields.amountCents / 100).toFixed(2));
  await pick(page, dialog, "Recurrence", fields.cadence === "annual" ? "Annually" : "Monthly");
  await dialog.getByLabel("Coverage starts", { exact: true }).fill(fields.startDate);
  await dialog.getByLabel("First payment / renewal date", { exact: true }).fill(fields.anchorDate);
  await pick(page, dialog, "Cost status", "Committed");
  await dialog.getByRole("button", { name: "Save cost", exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("semester funding, recurring costs and confirmed staff assumptions persist and export native branded graphs", async ({ page }, testInfo) => {
  page.setDefaultTimeout(30_000); const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/app/financials/planning");
  await expect(page.getByRole("heading", { name: "Semester cost planner", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { freshDocumentTemplatePreset } = await import("/shared/documentTemplatePresets.ts");
    const societyId = (await client.query("society:list", {}))[0]._id;
    const config = freshDocumentTemplatePreset("ddcnorth-signature");
    config.name = "Semester branded PDF";
    config.footer = "Semester planner branded sample";
    if (config.design) config.design.footer = { ...config.design.footer, text: config.footer, continuationText: config.footer };
    await client.mutation("invoices:upsertTemplate", { societyId, config, makeDefault: true });
  });
  await page.getByRole("button", { name: "New period", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await pick(page, dialog, "Semester preset", "Winter · January–April");
  await dialog.getByLabel("Preset year", { exact: true }).fill("2027");
  await expect(dialog.getByLabel("Start date", { exact: true })).toHaveValue("2027-01-01");
  await expect(dialog.getByLabel("End date", { exact: true })).toHaveValue("2027-04-30");
  await dialog.getByLabel("Period name", { exact: true }).fill(WINTER.name);
  await dialog.getByLabel("Allocation", { exact: true }).fill("10000.00");
  await dialog.getByLabel("Opening balance", { exact: true }).fill("500.00");
  await dialog.getByLabel("Reserve", { exact: true }).fill("1000.00");
  await pick(page, dialog, "Forecast basis", "Allocated · covered period");
  await dialog.getByRole("button", { name: "Save period", exact: true }).click();
  await expect(dialog).toBeHidden();
  await addCost(page, ANNUAL); await addCost(page, MONTHLY);

  await page.getByRole("button", { name: "Staff", exact: true }).click();
  await page.getByRole("button", { name: "Add staff cost", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Staff / position name", { exact: true }).fill("Semester sample assistant");
  await dialog.getByLabel("Employment start date", { exact: true }).fill("2027-01-01");
  await dialog.getByLabel("Employment end date", { exact: true }).fill("2027-04-30");
  await pick(page, dialog, "Compensation basis", "Hourly");
  await dialog.getByLabel("Rate (CAD)", { exact: true }).fill("20.00");
  await dialog.getByLabel("Hours per week", { exact: true }).fill("10");
  await pick(page, dialog, "Pay frequency", "Monthly");
  await dialog.getByLabel("First pay date", { exact: true }).fill("2027-01-31");
  await dialog.getByLabel("Vacation pay (%)", { exact: true }).fill("4");
  await dialog.getByLabel("Employer contributions (%)", { exact: true }).fill("10");
  await dialog.getByLabel("Monthly benefits (CAD)", { exact: true }).fill("50.00");
  await setChecked(dialog, "I reviewed these staff cost assumptions", true);
  await dialog.getByRole("button", { name: "Save staff cost", exact: true }).click();
  await expect(dialog).toBeHidden();

  // Changing assumptions clears confirmation; saved unconfirmed estimates stay
  // visible with a warning until the user explicitly reviews them again.
  await page.getByRole("button", { name: "Edit staff cost Semester sample assistant", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Hours per week", { exact: true }).fill("11");
  await expect(dialog.getByRole("checkbox", { name: "I reviewed these staff cost assumptions", exact: true })).not.toBeChecked();
  await dialog.getByLabel("Hours per week", { exact: true }).fill("10");
  await dialog.getByRole("button", { name: "Save staff cost", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("region", { name: "Planning warnings", exact: true })).toContainText("have not been confirmed");
  await page.getByRole("button", { name: "Edit staff cost Semester sample assistant", exact: true }).click();
  dialog = page.getByRole("dialog"); await setChecked(dialog, "I reviewed these staff cost assumptions", true);
  await dialog.getByRole("button", { name: "Save staff cost", exact: true }).click(); await expect(dialog).toBeHidden();
  await expect(page.getByRole("region", { name: "Planning warnings", exact: true })).not.toContainText("have not been confirmed");

  const summary = page.getByRole("region", { name: "Budget summary", exact: true });
  await expect(summary).toContainText("$4,929.88");
  await expect(summary).toContainText("$4,535.36");
  await expect(summary).toContainText("$4,570.12");
  await page.getByRole("button", { name: "Costs", exact: true }).click();
  const insurance = page.getByRole("row").filter({ hasText: ANNUAL.name });
  await expect(insurance).toContainText("$394.52"); await expect(insurance).toContainText("$0.00");
  const monthly = page.getByRole("region", { name: "Monthly forecast", exact: true });
  await expect(monthly).toContainText("$1,212.87"); await expect(monthly).toContainText("$1,157.26");
  await expect(monthly).toContainText("$1,304.40"); await expect(monthly).toContainText("$1,255.35");
  await expect(monthly.getByRole("img")).toBeVisible();
  await page.getByRole("button", { name: "Staff", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "Semester sample assistant" })).toContainText("$4,135.36");

  let downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download planning PDF", exact: true }).click();
  const graphDownload = await downloading; await graphDownload.saveAs(testInfo.outputPath("semester-forecast-graphs.pdf"));
  const graphPdf = await inspectPdf(await downloadBytes(graphDownload));
  expect(graphPdf.text).toContain(WINTER.name); expect(graphPdf.text).toContain("Semester planner branded sample");
  for (const value of ["$4,929.88", "$4,535.36", "$394.52", "$4,135.36", "$4,570.12"]) expect(graphPdf.text).toContain(value);
  expect(graphPdf.paths).toBeGreaterThan(0);
  await setChecked(page.locator("body"), "Include graphs", false);
  downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Download planning PDF", exact: true }).click();
  const tablePdf = await inspectPdf(await downloadBytes(await downloading));
  expect(graphPdf.paths).toBeGreaterThan(tablePdf.paths);
  expect(tablePdf.text).toContain("$4,929.88");

  downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const csv = (await downloadBytes(await downloading)).toString(); expect(csv).toContain("Sample annual insurance"); expect(csv).toContain("394.52"); expect(csv).toContain("4135.36");
  downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Export Excel", exact: true }).click();
  const workbook = await JSZip.loadAsync(await downloadBytes(await downloading));
  const sheets = await Promise.all(Object.values(workbook.files).filter(file => /^xl\/worksheets\/sheet\d+\.xml$/.test(file.name)).map(file => file.async("string")));
  expect(sheets.join(" ")).toContain(">394.52<"); expect(sheets.join(" ")).toContain(">4135.36<");

  await page.reload(); await expect(summary).toContainText("$4,570.12");
  await page.getByRole("button", { name: "Edit period", exact: true }).click(); dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Allocation", { exact: true })).toHaveValue("10000.00");
  await pick(page, dialog, "Forecast basis", "Cash · dated payments");
  await dialog.getByRole("button", { name: "Save period", exact: true }).click();
  await expect(dialog).toBeHidden(); await expect(summary).toContainText("$4,964.64");
  await page.reload(); await expect(summary).toContainText("$4,964.64");
  await page.screenshot({ path: testInfo.outputPath("semester-cash-forecast.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("complete source pages recalculate planned exclusions and next-term duplication without duplicating reusable costs", async ({ page }) => {
  page.setDefaultTimeout(30_000); const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/app/financials/planning");
  await expect(page.getByRole("heading", { name: "Semester cost planner", exact: true })).toBeVisible();
  const seeded = await page.evaluate(async ({ period, base }) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const societyId = (await client.query("society:list", {}))[0]._id;
    const periodId = await client.mutation("costPlanning:savePeriod", { societyId, fields: { ...period, name: "Complete paginated semester", includePlanned: false } });
    for (let index = 0; index < 105; index++) await client.mutation("costPlanning:saveCost", { societyId, fields: { ...base, name: `Committed sample ${String(index).padStart(3, "0")}`, amountCents: 100, cadence: "once" } });
    await client.mutation("costPlanning:saveCost", { societyId, fields: { ...base, name: "Optional sample event", amountCents: 2000, cadence: "once", status: "planned" } });
    await client.mutation("costPlanning:saveCost", { societyId, fields: { ...base, name: "Paused sample contract", amountCents: 999999, cadence: "once", status: "paused" } });
    await client.mutation("costPlanning:saveCost", { societyId, fields: { ...base, name: "Foreign sample expense", amountCents: 999999, cadence: "once", currency: "USD" } });
    return { societyId, periodId };
  }, { period: WINTER, base: MONTHLY });
  await page.goto(`/app/financials/planning?period=${seeded.periodId}`);
  const summary = page.getByRole("region", { name: "Budget summary", exact: true });
  await expect(summary).toContainText("$105.00");
  await expect(summary).toContainText("$9,395.00");
  await expect(page.getByRole("region", { name: "Reusable costs", exact: true })).toContainText("Committed sample 104");
  await expect(page.getByText(/foreign.*exclud|exclud.*currenc/i).first()).toBeVisible();
  await setChecked(page.locator("body"), "Include planned costs", true);
  await expect(summary).toContainText("$125.00"); await expect(summary).toContainText("$9,375.00");
  await page.reload(); await expect(summary).toContainText("$125.00");
  await expect(page.getByRole("checkbox", { name: "Include planned costs", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Duplicate next term", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Start date", { exact: true })).toHaveValue("2027-05-01");
  await expect(dialog.getByLabel("End date", { exact: true })).toHaveValue("2027-08-31");
  await expect(dialog.getByLabel("Allocation", { exact: true })).toHaveValue("10000.00");
  await dialog.getByRole("button", { name: "Save period", exact: true }).click();
  await expect(dialog).toBeHidden(); await expect(summary).toContainText("$0.00");
  const persisted = await page.evaluate(async ({ societyId }) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const periods = await client.query("costPlanning:workspace", { societyId });
    let cursor: string | null = null, total = 0;
    do {
      const result = await client.query("costPlanning:sourcePage", { societyId, collection: "costs", cursor });
      total += result.page.length; cursor = result.isDone ? null : result.continueCursor;
    } while (cursor);
    return { periods, total };
  }, seeded);
  expect(persisted.total).toBe(108);
  expect(persisted.periods, JSON.stringify(persisted.periods)).toHaveProperty("periods");
  expect(persisted.periods.periods).toHaveLength(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Edit period", exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});

test("finance readers can inspect forecasts while saves, source imports and exports remain permission controlled", async ({ page }) => {
  page.setDefaultTimeout(30_000);
  await page.goto("/app/financials/planning");
  await expect(page.getByRole("heading", { name: "Semester cost planner", exact: true })).toBeVisible();
  const seeded = await page.evaluate(async ({ period, cost }) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const societyId = (await client.query("society:list", {}))[0]._id;
    const periodId = await client.mutation("costPlanning:savePeriod", { societyId, fields: period });
    const costId = await client.mutation("costPlanning:saveCost", { societyId, fields: cost });
    const employeeId = await client.mutation("employees:create", { societyId, firstName: "Planner", lastName: "Privacy sample", email: "private-employee@example.test", phone: "555-0100", birthDate: "1990-01-01", addressLine1: "Synthetic private address", role: "Sample assistant", startDate: "2027-01-01", employmentType: "PartTime", hourlyWageCents: 2000, cppExempt: false, eiExempt: false, notes: "Private employee note" });
    const subscriptionId = await client.mutation("financialHub:upsertOperatingSubscription", { societyId, name: "Reader import check", category: "Software", amountCents: 10000, currency: "CAD", interval: "month", status: "Active", nextRenewalDate: "2027-01-01" });
    const reader = await client.mutation("users:upsert", { societyId, displayName: "Planner reader", email: "planner-reader@example.test", role: "Viewer", status: "Active" });
    const { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts"); setStoredUserId(reader);
    return { societyId, periodId, costId, employeeId, subscriptionId };
  }, { period: WINTER, cost: MONTHLY });
  await page.goto(`/app/financials/planning?period=${seeded.periodId}`);
  await expect(page.getByRole("region", { name: "Budget summary", exact: true })).toContainText("$400.00");
  for (const name of ["New period", "Edit period", "Duplicate next term", "Export CSV", "Export Excel", "Download planning PDF"]) {
    const button = page.getByRole("button", { name, exact: true });
    if (await button.count()) await expect(button).toBeDisabled();
  }
  await expect(page.getByRole("button", { name: "New cost", exact: true })).toHaveCount(0);
  const checks = await page.evaluate(async ({ societyId, periodId, costId, employeeId, subscriptionId, cost }) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const employeePage = await client.query("costPlanning:sourcePage", { societyId, collection: "employees" });
    const employee = employeePage.page.find((row: any) => row._id === employeeId);
    const failures: string[] = [];
    for (const [name, args] of [
      ["costPlanning:saveCost", { societyId, id: costId, fields: { ...cost, amountCents: 999999 } }],
      ["costPlanning:setArchived", { societyId, kind: "period", id: periodId, archived: true }],
      ["costPlanning:importSource", { societyId, kind: "subscription", sourceId: subscriptionId }],
    ] as const) {
      try { await client.mutation(name, args); failures.push("UNEXPECTED SUCCESS"); }
      catch (error) { failures.push(String(error)); }
    }
    return { employee, failures };
  }, { ...seeded, cost: MONTHLY });
  expect(checks.employee).toBeTruthy();
  for (const field of ["email", "phone", "birthDate", "addressLine1", "addressLine2", "city", "province", "postalCode", "country", "sinSecretVaultItemId", "notes"]) expect(checks.employee).not.toHaveProperty(field);
  expect(checks.failures).toHaveLength(3);
  expect(checks.failures.every(message => /permission|authoriz|forbidden/i.test(message))).toBe(true);
  await expect(page.getByRole("region", { name: "Budget summary", exact: true })).toContainText("$400.00");
});
