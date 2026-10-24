import { checkPayrollResponsiveViewport, watchPayrollResponsiveErrors } from "./helpers/payrollResponsiveChecks";
import { test, expect, type Download, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.beforeEach(watchPayrollResponsiveErrors);
test.afterEach(checkPayrollResponsiveViewport);

async function checked(scope: Locator, label: string | RegExp) {
  const input = scope.getByRole("checkbox", { name: label, exact: typeof label === "string" });
  if (!await input.isChecked()) await input.check();
  await expect(input).toBeChecked();
}
async function csv(download: Download) { return readFile((await download.path())!, "utf8"); }
async function tools(page: Page) {
  await page.goto("/app/payroll/calculator?tab=tools");
  await expect(page.getByRole("heading", { name: "Payroll calculator", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Mileage reimbursement calculator", exact: true })).toBeVisible();
}

async function inspectPdf(download: Download) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await getDocument({ data: new Uint8Array(await readFile((await download.path())!)), useSystemFonts: true, disableFontFace: true }).promise;
  let text = "";
  for (let number = 1; number <= document.numPages; number++) text += (await (await document.getPage(number)).getTextContent()).items.map((item: any) => item.str ?? "").join(" ") + " ";
  const pages = document.numPages; await document.destroy(); return { text: text.replace(/\s+/g, " "), pages };
}

test("reviewed employer and employee setup produces a persisted, approved, frozen pay run and branded statement", async ({ page }, testInfo) => {
  page.setDefaultTimeout(30_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/app/payroll/calculator");
  await expect(page.getByRole("heading", { name: "Payroll calculator", exact: true })).toBeVisible();
  const seeded = await page.evaluate(async () => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { setStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    const { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts");
    const created = await client.mutation("society:createWorkspace", { name: "Synthetic payroll browser", jurisdictionCode: "CA-BC", seedDocumentPackets: false, isCharity: false, isMemberFunded: false });
    const societyId = created.societyId;
    const owners = await client.query("users:list", { societyId });
    setStoredSocietyId(societyId); setStoredUserId(owners.find((row: any) => row.role === "Owner")._id);
    const employeeId = await client.mutation("employees:create", { societyId, firstName: "Avery", lastName: "Payroll browser", role: "Student assistant", startDate: "2025-01-01", birthDate: "2000-02-03", province: "ON", employmentType: "PartTime", cppExempt: false, eiExempt: false });
    const accounts: Record<string, string> = {};
    for (const [key, name, accountType] of [["wages", "Browser wages", "Expense"], ["employer", "Browser employer costs", "Expense"], ["net", "Browser net payable", "Liability"], ["deductions", "Browser deductions", "Liability"], ["benefits", "Browser benefits", "Liability"], ["bank", "Browser CAD bank", "Bank"]]) accounts[key] = await client.mutation("accounting:upsertChartAccount", { societyId, name, accountType, currency: "CAD", code: `PB${key.toUpperCase()}` });
    const { freshDocumentTemplatePreset } = await import("/shared/documentTemplatePresets.ts");
    const config = freshDocumentTemplatePreset("ddcnorth-signature"); config.name = "Payroll branded sample"; config.footer = "Payroll browser branded statement";
    if (config.design) config.design.footer = { ...config.design.footer, text: config.footer, continuationText: config.footer };
    await client.mutation("invoices:upsertTemplate", { societyId, config, makeDefault: true });
    return { societyId, employeeId, accounts };
  });
  await page.reload();
  const tab = (name: string) => page.getByRole("navigation", { name: "Payroll calculator sections", exact: true }).getByRole("button", { name, exact: true });
  await tab("Employer setup").click();
  await page.getByRole("button", { name: "Configure employer year", exact: true }).click();
  let form = page.getByRole("form", { name: "Employer setup", exact: true });
  await form.getByLabel("Pay frequency", { exact: true }).selectOption("semimonthly");
  await form.getByLabel("Actual pay dates", { exact: true }).fill(Array.from({ length: 12 }, (_, month) => [7, 22].map(day => `2026-${String(month + 1).padStart(2, "0")}-${day.toString().padStart(2, "0")}`)).flat().join("\n"));
  for (const [label, value] of [["EI employer multiplier", "1.4"], ["Permanent establishment days in year", "365"], ["EHT opening covered through", "2025-12-31"], ["EHT opening source reference", "Reviewed synthetic opening; no earlier pay"], ["WorkSafe rate per $100", "1"], ["Annual WorkSafe assessable earnings limit", "127500.00"], ["WorkSafe classification code", "Reviewed synthetic class"], ["WorkSafe rate evidence", "Actual synthetic net-rate evidence"], ["Employer benefits per pay", "10.00"]]) await form.getByLabel(label, { exact: true }).fill(value);
  await checked(form, "EHT opening remuneration is complete and confirmed");
  await checked(form, "Default employer EI, benefits and pension assumptions reviewed for employees without overrides");
  for (const [label, key] of [["Wages expense account", "wages"], ["Employer cost expense account", "employer"], ["Net pay liability account", "net"], ["Deductions liability account", "deductions"], ["Benefits liability account", "benefits"]]) {
    const selector = form.getByLabel(label, { exact: true });
    if (!await selector.isVisible()) await form.getByText("Optional accrual ledger mappings", { exact: true }).click();
    await selector.selectOption(seeded.accounts[key]);
  }
  await form.getByRole("button", { name: "Save employer setup", exact: true }).click(); await expect(form).toBeHidden();
  await expect(page.getByRole("region", { name: "Employer setup", exact: true })).toContainText("24 actual pay dates");

  await tab("Employee profiles").click(); await page.getByRole("button", { name: "New employee profile", exact: true }).click();
  form = page.getByRole("form", { name: "Employee profile", exact: true });
  await form.getByLabel("Employee", { exact: true }).selectOption(seeded.employeeId);
  for (const [label, value] of [["Profile effective from", "2025-01-01"], ["Hourly rate or salary for selected basis", "25.00"], ["Normal weekly hours", "40"], ["Average weekly hours", "40"], ["Complete work history from", "2026-04-01"], ["Complete work history through", "2026-05-16"], ["TD1 declaration reference", "Reviewed synthetic paper TD1"]]) await form.getByLabel(label, { exact: true }).fill(value);
  for (const label of ["Daily and weekly rest periods reviewed", "Year-to-date history is complete for this legal employer", "Current TD1 declaration reviewed and confirmed"]) await checked(form, label);
  await form.getByRole("button", { name: "Add funding allocation", exact: true }).click();
  await form.getByLabel("Allocation 1 label", { exact: true }).fill("Student support");
  await form.getByLabel("Allocation 1 program code", { exact: true }).fill("STUDENT");
  await form.getByRole("button", { name: "Save employee profile", exact: true }).click(); await expect(form).toBeHidden();
  await expect(page.getByRole("region", { name: "Employee profiles", exact: true })).toContainText("BC employment");

  await tab("Opening balances").click(); await page.getByRole("button", { name: "Add opening balance", exact: true }).click();
  form = page.getByRole("form", { name: "Opening balance", exact: true });
  await form.getByLabel("Employee", { exact: true }).selectOption(seeded.employeeId);
  await form.getByLabel("Opening covered through", { exact: true }).fill("2026-04-30");
  await form.getByLabel("Opening source reference", { exact: true }).fill("Confirmed zero same-employer opening");
  await checked(form, "Opening is complete for this legal employer and year");
  await form.getByRole("button", { name: "Save opening balance", exact: true }).click(); await expect(form).toBeHidden();
  await page.evaluate(async ({ societyId, employeeId }) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    for (const day of [1, 4, 5, 6, 7, 8, 11, 12, 13, 14]) await client.mutation("payrollCalculation:saveWorkDay", { societyId, employeeId, fields: { date: `2026-05-${String(day).padStart(2, "0")}`, minutes: 480 } });
  }, seeded);
  await tab("Work & leave").click(); await page.getByRole("button", { name: "Add work day", exact: true }).click();
  form = page.getByRole("form", { name: "Work day", exact: true });
  await form.getByLabel("Employee", { exact: true }).selectOption(seeded.employeeId);
  await form.getByLabel("Work date", { exact: true }).fill("2026-05-15");
  await form.getByLabel("Hours worked", { exact: true }).fill("8");
  await form.getByRole("button", { name: "Save work day", exact: true }).click(); await expect(form).toBeHidden();

  await tab("Calculate").click();
  form = page.getByRole("form", { name: "Payroll run inputs", exact: true });
  await form.getByLabel("Pay period start", { exact: true }).fill("2026-05-01");
  await form.getByLabel("Pay period end", { exact: true }).fill("2026-05-15");
  await form.getByLabel("Payment date", { exact: true }).fill("2026-05-22");
  await checked(form, /Avery Payroll browser/);
  await form.getByRole("button", { name: "Preview calculation", exact: true }).click();
  const live = page.getByRole("region", { name: "Live payroll preview", exact: true });
  await expect(live.getByRole("region", { name: "Payroll calculation result", exact: true })).toContainText("$2,200.00");
  await expect(live).toContainText("$2,492.42");
  await expect(live).toContainText("Province of employment: BC");
  await expect(live.getByRole("alert")).toHaveCount(0);
  await live.getByRole("button", { name: "Save payroll draft", exact: true }).click();
  const saved = page.getByRole("region", { name: "Saved payroll calculation", exact: true });
  await expect(saved).toContainText("draft · version");
  await saved.getByRole("button", { name: "Approve calculation", exact: true }).click();
  await expect(saved).toContainText("approved · version");
  await checked(saved, "Post balanced accrual journal");
  await saved.getByRole("button", { name: "Finalize calculation", exact: true }).click();
  await expect(saved).toContainText("finalized · version");
  await expect(saved.getByRole("button", { name: "Edit draft inputs", exact: true })).toHaveCount(0);
  const downloading = page.waitForEvent("download");
  await saved.getByRole("button", { name: "Download pay statement PDF", exact: true }).click();
  const download = await downloading; await download.saveAs(testInfo.outputPath("finalized-pay-statement.pdf"));
  const pdf = await inspectPdf(download); expect(pdf.pages).toBeGreaterThan(0);
  for (const text of ["Pay statement", "Avery Payroll browser", "Payroll browser branded statement", "$2,200.00", "$2,492.42", "Employee CPP2", "finalized"]) expect(pdf.text).toContain(text);
  await page.reload(); await expect(saved).toContainText("finalized · version");
  const stored = await page.evaluate(async ({ societyId }) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    return { runs: (await client.query("payroll:workspace", { societyId })).runs, records: (await client.query("payrollCalculation:workspace", { societyId, collection: "calculations", year: 2026 })).page };
  }, seeded);
  expect(stored.runs).toHaveLength(1); expect(stored.runs[0].lines).toHaveLength(1); expect(stored.runs[0].lines[0].employeeId).toBe(seeded.employeeId);
  expect(stored.records).toHaveLength(1); expect(stored.records[0].status).toBe("finalized");
  expect(errors).toEqual([]);
});

test("supporting payroll tools preserve current-year mileage, exact allocated cents and actual-period disclosure", async ({ page }) => {
  page.setDefaultTimeout(30_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await tools(page);
  const mileage = page.getByRole("region", { name: "Mileage reimbursement calculator", exact: true });
  await mileage.getByLabel("Travel date", { exact: true }).fill("2026-08-15");
  await mileage.getByLabel("Business kilometres", { exact: true }).fill("200");
  await mileage.getByLabel("Earlier business kilometres this calendar year", { exact: true }).fill("4900");
  await mileage.getByLabel("Business purpose", { exact: true }).fill("Student event supplies");
  for (const label of ["The employee owns the vehicle", "The allowance is based only on documented business kilometres", "No duplicate reimbursement or combined fixed allowance covers this vehicle use"]) await checked(mileage, label);
  await mileage.getByRole("button", { name: "Calculate mileage allowance", exact: true }).click();
  await expect(mileage.getByRole("heading", { name: /Reasonable-rate benchmark:/ })).toContainText("$140.00");
  let downloading = page.waitForEvent("download");
  await mileage.getByRole("button", { name: "Download mileage support CSV", exact: true }).click();
  expect(await csv(await downloading)).toContain('"140.00"');
  await mileage.getByLabel("Business kilometres", { exact: true }).fill("100");
  await expect(mileage.getByRole("button", { name: "Download mileage support CSV", exact: true })).toHaveCount(0);
  await mileage.getByLabel("Travel date", { exact: true }).fill("2027-01-01");
  await mileage.getByRole("button", { name: "Calculate mileage allowance", exact: true }).click();
  await expect(mileage.getByRole("alert")).toContainText("2026 only");

  const classification = page.getByRole("region", { name: "Payment classification review", exact: true });
  await classification.getByLabel("Payment description", { exact: true }).fill("Director honorarium");
  await classification.getByRole("button", { name: "Review payment classification", exact: true }).click();
  await expect(classification).toContainText("Classification remains unresolved");
  await classification.getByLabel("Reviewed relationship", { exact: true }).selectOption("office_holder");
  await classification.getByLabel("Classification evidence", { exact: true }).fill("Reviewed appointment and office-holder relationship");
  await classification.getByRole("button", { name: "Review payment classification", exact: true }).click();
  await expect(classification).toContainText("Employment / office income — T4 path");

  const allocation = page.getByRole("region", { name: "Employer cost allocation calculator", exact: true });
  const fields = ["Cash remuneration (CAD)", "Unpaid vacation accrual (CAD)", "Employer CPP (CAD)", "Employer CPP2 (CAD)", "Employer EI (CAD)", "WorkSafeBC cost (CAD)", "Employer health tax cost (CAD)", "Additional benefits cost (CAD)", "Additional pension cost (CAD)", "Less: previously expensed vacation now paid (CAD)"];
  for (const label of fields) await allocation.getByLabel(label, { exact: true }).fill(label === fields[0] ? "100.01" : "0.00");
  await allocation.getByLabel("Allocation 1 label", { exact: true }).fill("Student program");
  await allocation.getByLabel("Allocation 1 percent", { exact: true }).fill("50");
  await allocation.getByRole("button", { name: "Add cost allocation", exact: true }).click();
  await allocation.getByLabel("Allocation 2 label", { exact: true }).fill("General fund");
  await allocation.getByLabel("Allocation 2 percent", { exact: true }).fill("50");
  await allocation.getByRole("button", { name: "Calculate allocated employer costs", exact: true }).click();
  const allocated = allocation.getByRole("table", { name: "Allocated employer cost components", exact: true });
  await expect(allocated.getByRole("row").filter({ hasText: "Student program" })).toContainText("$50.01");
  await expect(allocated.getByRole("row").filter({ hasText: "General fund" })).toContainText("$50.00");
  downloading = page.waitForEvent("download");
  await allocation.getByRole("button", { name: "Download cost allocation CSV", exact: true }).click();
  const allocationCsv = await csv(await downloading); expect(allocationCsv).toContain('"50.01"'); expect(allocationCsv).toContain('"50.00"');

  const disclosure = page.getByRole("region", { name: "Society remuneration disclosure calculator", exact: true });
  await disclosure.getByLabel("Disclosure period start", { exact: true }).fill("2026-01-01");
  await disclosure.getByLabel("Disclosure period end", { exact: true }).fill("2026-12-31");
  await disclosure.getByLabel("Actual payment CSV", { exact: true }).fill([
    "recipient_key,paid_date,amount_cad,kind,position_or_service,director_capacity,remuneration,name",
    "worker,2026-03-01,40000,employee,Coordinator,,true,Private worker",
    "worker,2026-09-01,36000,contractor,Services,,true,Private worker",
    "director,2026-02-01,500,director,Board service,director,true,Private director",
    "director,2026-06-01,1000,director,Event work,other,true,Private director",
    "outside,2025-12-31,90000,employee,Prior year,,true,Prior person",
    "reimbursement,2026-07-01,90000,employee,Travel,,false,Expense person",
  ].join("\n"));
  await checked(disclosure, "I confirmed actual paid dates and amounts, complete recipient payments and reimbursement exclusions");
  await disclosure.getByRole("button", { name: "Calculate remuneration disclosure", exact: true }).click();
  await expect(disclosure).toContainText("Employees/contractors meeting the threshold: 1");
  await expect(disclosure).toContainText("$76,000.00");
  const disclosureTable = disclosure.getByRole("table", { name: "Remuneration disclosure results", exact: true });
  await expect(disclosureTable).toContainText("$1,500.00"); await expect(disclosureTable).toContainText("$500.00"); await expect(disclosureTable).toContainText("$1,000.00");
  await expect(disclosureTable).not.toContainText("Private"); await expect(disclosureTable).not.toContainText("outside"); await expect(disclosureTable).not.toContainText("reimbursement");
  downloading = page.waitForEvent("download");
  await disclosure.getByRole("button", { name: "Download permitted worker aggregate CSV", exact: true }).click();
  const aggregate = await csv(await downloading); expect(aggregate).toContain('"76000.00"'); expect(aggregate).not.toContain("Private");
  expect(errors).toEqual([]);
});
