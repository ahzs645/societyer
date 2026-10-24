import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

type Activate = (locator: Locator) => Promise<void>;
const sourceUrl = "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/set-up-new-employee/filing-form-td1.html";
const ruleName = "Synthetic propagation EI edition";

async function seed(page: Page) {
  await page.goto("/app/payroll/calculator?tab=rules");
  await expect(page.getByRole("heading", { name: "Payroll calculator", exact: true })).toBeVisible();
  const result = await page.evaluate(async () => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { setStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    const { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts");
    const { emptyPayrollYtd } = await import("/shared/payrollDeductions.ts");
    const created = await client.mutation("society:createWorkspace", { name: "Synthetic cross-module payroll QA", jurisdictionCode: "CA-BC", seedDocumentPackets: false, isCharity: false, isMemberFunded: false });
    const societyId = created.societyId;
    const users = await client.query("users:list", { societyId });
    setStoredSocietyId(societyId);
    setStoredUserId(users.find((row: any) => row.role === "Owner")._id);
    const employeeId = await client.mutation("employees:create", { societyId, firstName: "Taylor", lastName: "Propagation QA", role: "Synthetic assistant", startDate: "2025-01-01", birthDate: "1990-01-01", province: "ON", employmentType: "PartTime", cppExempt: false, eiExempt: false });
    const accounts: Record<string, string> = {};
    for (const [key, accountType] of [["wages", "Expense"], ["employer", "Expense"], ["net", "Liability"], ["deductions", "Liability"], ["benefits", "Liability"], ["bank", "Bank"]]) accounts[key] = await client.mutation("accounting:upsertChartAccount", { societyId, name: `Propagation ${key}`, accountType, currency: "CAD", code: `QA${key.toUpperCase()}` });
    await client.mutation("payrollCalculation:saveEmployerSettings", { societyId, fields: {
      year: 2026, payFrequency: "semimonthly", payDates: Array.from({ length: 12 }, (_, month) => [15, new Date(Date.UTC(2026, month + 1, 0)).getUTCDate()].map(day => `2026-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`)).flat(),
      eiEmployerMultiplier: 1.4, uniformEmployerAssumptionsConfirmed: true,
      ehtEmployerClass: "ordinary", ehtOpeningRemunerationCents: 0, ehtOpeningThroughDate: "2025-12-31", ehtOpeningConfirmed: true, ehtOpeningSourceReference: "Reviewed complete synthetic zero employer opening", ehtOpeningRepresentedPayRunIds: [], ehtAssociated: false, ehtPermanentEstablishmentDays: 365,
      workSafeRatePer100Dollars: 0, workSafeAssessableLimitCents: 12750000, workSafeClassificationCode: "Reviewed synthetic class", workSafeRateEvidence: "Reviewed synthetic zero net rate", employerBenefitsCentsPerPay: 0, employerPensionPercent: 0,
      ledger: { wagesExpenseAccountId: accounts.wages, employerExpenseAccountId: accounts.employer, netPayLiabilityAccountId: accounts.net, deductionsLiabilityAccountId: accounts.deductions, benefitsLiabilityAccountId: accounts.benefits },
    } });
    await client.mutation("payrollCalculation:saveProfile", { societyId, employeeId, fields: {
      effectiveFrom: "2025-01-01", provinceOfEmployment: "BC", employmentKind: "ordinary", compensation: "hourly", rateCents: 2500, normalWeeklyMinutes: 2400, averageWeeklyMinutes: 2400, policy: "ordinary_bc", restPeriodsConfirmed: true, historyCompleteFrom: "2026-04-01", historyCompleteThrough: "2026-05-16", ytdConfirmed: true, vacationMode: "accrue", td1: { confirmed: true, declarationReference: "Original synthetic employer-reviewed declaration" }, cpp: { exempt: false }, eiExempt: false,
      fundingAllocations: [{ label: "Student support", programCode: "STUDENT", shareBps: 10000 }],
    } });
    await client.mutation("payrollCalculation:saveOpeningBalance", { societyId, employeeId, fields: { year: 2026, coveredThroughDate: "2026-04-30", sameEmployerConfirmed: true, sourceReference: "Reviewed complete synthetic zero opening", ytd: emptyPayrollYtd(), insurableHours: 0, cashPaidCents: 0, netPaidCents: 0, vacationBalanceCents: 0, workSafeAssessableCents: 0, sickPaidDaysUsed: 0, sickUnpaidDaysUsed: 0, representedPayRunIds: [] } });
    await client.mutation("payrollCalculation:saveWorkDay", { societyId, employeeId, fields: { date: "2026-05-05", minutes: 480 } });
    const { freshDocumentTemplatePreset } = await import("/shared/documentTemplatePresets.ts");
    const config = freshDocumentTemplatePreset("ddcnorth-signature");
    config.name = "Propagation branded statement";
    config.footer = "Synthetic propagation branded statement";
    if (config.design) config.design.footer = { ...config.design.footer, text: config.footer, continuationText: config.footer };
    await client.mutation("invoices:upsertTemplate", { societyId, config, makeDefault: true });
    return { societyId, employeeId, accounts };
  });
  await page.reload();
  return result;
}

async function publishRule(page: Page, activate: Activate) {
  const library = page.getByRole("region", { name: "Payroll rules library", exact: true });
  await activate(library.getByRole("button", { name: "Clone 2026-01-BC-option1", exact: true }));
  const editor = page.getByRole("region", { name: "Payroll rule editor", exact: true });
  await editor.getByLabel("Rule edition name", { exact: true }).fill(ruleName);
  await activate(editor.getByText("EI employee rate and annual caps", { exact: true }));
  await editor.getByLabel("EI Rate (%)", { exact: true }).fill("2");
  await editor.getByLabel("EI Maximum (CAD)", { exact: true }).fill("1378.00");
  await editor.getByLabel("EI Employer Maximum (CAD)", { exact: true }).fill("1929.20");
  await editor.getByLabel("Rule source 1 url", { exact: true }).fill(sourceUrl);
  await editor.getByLabel("Rule source 1 notes", { exact: true }).fill("Synthetic QA only: altered2percent EI, internally consistent caps, ordinary BC2026 Option1; this is not an official CRA rate publication.");
  await activate(editor.getByRole("button", { name: "Save working draft", exact: true }));
  await expect(editor).toBeHidden();
  const card = library.getByRole("article", { name: `Rule edition ${ruleName}`, exact: true });
  await card.getByLabel("Rule review evidence", { exact: true }).fill("Synthetic QA: reviewed exact parameter changes, correct annual caps, supported payment dates and explicitly hypothetical source evidence.");
  await card.getByRole("checkbox", { name: "I reviewed the exact rates, caps, brackets, effective dates and official source evidence", exact: true }).check();
  await activate(card.getByRole("button", { name: "Review exact edition", exact: true }));
  await expect(card).toContainText("reviewed");
  await activate(card.getByRole("button", { name: "Publish reviewed edition", exact: true }));
  await expect(card).toContainText("published");
}

async function applyTd1(page: Page, employeeId: string, amount: string, effective: string, both: boolean, activate: Activate) {
  await page.goto("/app/payroll/calculator?tab=td1");
  const panel = page.getByRole("region", { name: "TD1 import", exact: true });
  await panel.getByLabel("TD1 employee", { exact: true }).selectOption(employeeId);
  await expect(panel.getByRole("form", { name: "Reviewed TD1 import", exact: true })).toBeVisible();
  await panel.getByLabel("TD1 received on", { exact: true }).fill(effective);
  await panel.getByLabel("TD1 effective from", { exact: true }).fill(effective);
  if (!both) await panel.getByLabel("Apply BC TD1", { exact: true }).uncheck();
  for (const title of both ? ["Federal TD1", "BC TD1"] : ["Federal TD1"]) {
    const group = panel.getByRole("group", { name: `${title} review`, exact: true });
    await group.getByLabel(`${title} review source`, { exact: true }).selectOption("manual");
    await group.getByLabel(`${title} annual total claim amount`, { exact: true }).fill(title === "Federal TD1" ? "16452.00" : "13216.00");
    await group.getByLabel(`${title} concurrent employer/payer declaration`, { exact: true }).selectOption("no");
    await group.getByLabel(`${title} total income below total claims declaration`, { exact: true }).selectOption("no");
    if (title === "Federal TD1") {
      await group.getByLabel("Federal TD1 additional withholding per payment", { exact: true }).fill(amount);
      await group.getByLabel("Federal TD1 annual prescribed-zone deduction", { exact: true }).fill("0");
    }
    await group.getByLabel(`${title} actual source page count`, { exact: true }).fill("2");
    await group.getByLabel(`${title} review reference`, { exact: true }).fill(`Restricted synthetic signed and dated ${title} reviewed for ${effective}`);
    for (const label of [`I confirmed ordinary Canadian resident treatment for this ${title}`, `I reviewed the employee’s signed and dated ${title} declaration`, `I reviewed every claim and declaration flag against the ${title}`]) await group.getByLabel(label, { exact: true }).check();
  }
  await activate(panel.getByRole("button", { name: "Apply reviewed TD1 declarations", exact: true }));
  await expect(panel).toContainText("Reviewed declarations saved");
}

async function inspectPdf(path: string) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await getDocument({ data: new Uint8Array(await readFile(path)), useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
  let text = "";
  for (let page = 1; page <= document.numPages; page++) text += (await (await document.getPage(page)).getTextContent()).items.map((item: any) => item.str ?? "").join(" ") + " ";
  const pages = document.numPages;
  await document.destroy();
  return { pages, text: text.replace(/\s+/g, " ") };
}

test("reviewed settings propagate through native money, freshness guard, frozen register, ledger and branded PDF", async ({ page, baseURL }, info) => {
  const phone = info.project.name === "touch-phone";
  const activate: Activate = locator => phone ? locator.tap() : locator.click();
  const errors: string[] = [], outside: string[] = [], externalAssets: string[] = [];
  const allowedOrigin = new URL(baseURL ?? "http://127.0.0.1:4213").origin;
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    const url = new URL(request.url());
    if (["blob:", "data:"].includes(url.protocol) || url.origin === allowedOrigin) return;
    if (["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname) && request.method() === "GET" && !request.postData()) externalAssets.push(request.url());
    else outside.push(request.url());
  });
  const data = await seed(page);
  await publishRule(page, activate);
  const edition = await page.evaluate(async ({ societyId }) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    return (await client.query("payrollRules:workspace", { societyId, status: "published", year: 2026 })).page[0];
  }, data);
  expect(edition.rateSet.ei.rate).toBe("0.02");
  expect(edition.sourceEvidence[0].url).toBe(sourceUrl);
  await applyTd1(page, data.employeeId, "25.50", "2026-05-01", true, activate);
  const declarations = await page.evaluate(async ({ societyId, employeeId }) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    return (await client.query("payrollTd1:workspace", { societyId, employeeId })).page;
  }, data);
  expect(declarations).toHaveLength(2);
  expect(declarations.find((row: any) => row.form === "federal").additionalTaxCents).toBe(2550);
  await page.screenshot({ path: info.outputPath("reviewed-td1.png"), fullPage: true });
  await page.goto("/app/payroll/calculator?tab=calculate");
  const form = page.getByRole("form", { name: "Payroll run inputs", exact: true });
  await form.getByLabel("Pay period start", { exact: true }).fill("2026-05-01");
  await form.getByLabel("Pay period end", { exact: true }).fill("2026-05-15");
  await form.getByLabel("Payment date", { exact: true }).fill("2026-05-15");
  await form.getByLabel("Payroll rule edition", { exact: true }).selectOption(edition._id);
  await form.getByRole("checkbox", { name: /Taylor Propagation QA/ }).check();
  await activate(form.getByRole("button", { name: "Preview calculation", exact: true }));
  const preview = page.getByRole("region", { name: "Live payroll preview", exact: true });
  await expect(preview.getByRole("alert")).toHaveCount(0);
  await expect(preview).toContainText("$167.28");
  await expect(preview).toContainText("$216.82");
  await expect(preview).toContainText(ruleName);
  await activate(preview.getByRole("button", { name: "Save payroll draft", exact: true }));
  const saved = page.getByRole("region", { name: "Saved payroll calculation", exact: true });
  await expect(saved).toContainText("draft · version");
  const id = new URL(page.url()).searchParams.get("calculation")!;
  expect(id).toBeTruthy();
  const readRecord = () => page.evaluate(async ({ societyId, id }) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    return (await client.query("payrollCalculation:workspace", { societyId, collection: "calculation", id })).detail;
  }, { societyId: data.societyId, id });
  const draft = await readRecord();
  expect(draft.result.totals.netCents).toBe(16728);
  expect(draft.result.employees[0].deductions.cppEmployeeCents).toBe(322);
  expect(draft.result.employees[0].deductions.eiEmployeeCents).toBe(400);
  expect(draft.result.ruleEdition.contentHash).toBe(edition.contentHash);
  expect(draft.result.rules.sources).toContain(sourceUrl);
  // Change a real saved upstream source through the interface, then prove the
  // old concrete draft cannot be approved or silently rewritten.
  await applyTd1(page, data.employeeId, "50.00", "2026-05-10", false, activate);
  await page.goto(`/app/payroll/calculator?tab=records&calculation=${id}`);
  await activate(saved.getByRole("button", { name: "Approve calculation", exact: true }));
  await expect(saved.getByRole("alert")).toContainText("source data changed");
  const stale = await readRecord();
  expect(stale.status).toBe("draft");
  expect(stale.result.totals.netCents).toBe(16728);
  expect(stale.sourceFingerprint).toBe(draft.sourceFingerprint);
  await activate(saved.getByRole("button", { name: "Edit draft inputs", exact: true }));
  await activate(form.getByRole("button", { name: "Preview calculation", exact: true }));
  await expect(preview.getByRole("alert")).toHaveCount(0);
  await expect(preview).toContainText("$142.78");
  await activate(preview.getByRole("button", { name: "Save payroll draft", exact: true }));
  await expect(saved).toContainText("draft · version 2");
  const fresh = await readRecord();
  expect(fresh._id).toBe(id);
  expect(fresh.sourceFingerprint).not.toBe(draft.sourceFingerprint);
  expect(fresh.result.employees[0].deductions.additionalIncomeTaxCents).toBe(5000);
  await activate(saved.getByRole("button", { name: "Approve calculation", exact: true }));
  await expect(saved).toContainText("approved · version");
  await saved.getByRole("checkbox", { name: "Post balanced accrual journal", exact: true }).check();
  await activate(saved.getByRole("button", { name: "Finalize calculation", exact: true }));
  await expect(saved).toContainText("finalized · version");
  const finalized = await readRecord();
  expect(finalized.result.totals.netCents).toBe(14278);
  expect(finalized.journalEntryIds).toHaveLength(1);
  const sinks = await page.evaluate(async ({ societyId, journalId }) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    return { register: await client.query("payroll:workspace", { societyId }), journal: await client.query("accounting:journalEntry", { id: journalId }) };
  }, { societyId: data.societyId, journalId: finalized.journalEntryIds[0] });
  expect(sinks.register.runs).toHaveLength(1);
  expect(sinks.register.runs[0].calculationId).toBe(id);
  expect(sinks.register.runs[0].netCents).toBe(14278);
  expect(sinks.register.runs[0].lines[0].employeeId).toBe(data.employeeId);
  expect(sinks.register.runs[0].lines[0].additionalIncomeTaxCents).toBe(5000);
  const debit = sinks.journal.lines.filter((row: any) => row.side === "debit").reduce((sum: number, row: any) => sum + row.amountCents, 0);
  const credit = sinks.journal.lines.filter((row: any) => row.side === "credit").reduce((sum: number, row: any) => sum + row.amountCents, 0);
  expect(debit).toBe(21682); expect(credit).toBe(debit);
  expect(sinks.journal.lines.find((row: any) => row.accountId === data.accounts.net).amountCents).toBe(14278);
  expect(sinks.journal.lines.some((row: any) => row.programCode === "STUDENT")).toBe(true);
  // A subsequent current declaration must never rewrite a finalized record or
  // make its downloaded statement use today's mutable profile values.
  await applyTd1(page, data.employeeId, "75.00", "2026-05-14", false, activate);
  const currentDeclarations = await page.evaluate(async ({ societyId, employeeId }) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    return (await client.query("payrollTd1:workspace", { societyId, employeeId })).page;
  }, data);
  expect(currentDeclarations.find((row: any) => row.effectiveFrom === "2026-05-14").additionalTaxCents).toBe(7500);
  await page.goto(`/app/payroll/calculator?tab=records&calculation=${id}`);
  await page.reload();
  await expect(saved).toContainText("finalized · version");
  await expect(saved).toContainText("$142.78");
  await expect(saved.getByRole("button", { name: "Edit draft inputs", exact: true })).toHaveCount(0);
  const frozen = await readRecord();
  expect(frozen.resultFingerprint).toBe(finalized.resultFingerprint);
  expect(frozen.result.employees[0].deductions.additionalIncomeTaxCents).toBe(5000);
  expect(frozen.result.ruleEdition.contentHash).toBe(edition.contentHash);
  const statement = frozen.result.employees[0].statement;
  expect(statement.rules.sources).toContain(sourceUrl);
  expect(statement.rules.edition).toBe(edition.rateSet.id);
  expect(JSON.stringify(frozen.result)).not.toContain("1990-01-01");
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, touch: navigator.maxTouchPoints }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 2);
  if (phone) expect(dimensions.touch).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath("finalized-payroll.png"), fullPage: true });
  const downloading = page.waitForEvent("download");
  await activate(saved.getByRole("button", { name: "Download pay statement PDF", exact: true }));
  const downloaded = await downloading;
  const pdfPath = info.outputPath("propagated-frozen-pay-statement.pdf");
  await downloaded.saveAs(pdfPath);
  const pdf = await inspectPdf(pdfPath);
  expect(pdf.pages).toBeGreaterThan(0);
  for (const value of ["Pay statement", "Taylor Propagation QA", "$200.00", "$142.78", "$50.00", "$216.82", "Synthetic propagation branded statement", "finalized"]) expect(pdf.text).toContain(value);
  expect(pdf.text.replace(/\s/g, "")).toContain(sourceUrl);
  expect(pdf.text.replace(/\s/g, "")).toContain(edition.rateSet.id);
  expect(outside).toEqual([]);
  expect(errors).toEqual([]);
  await writeFile(info.outputPath("data-flow-evidence.json"), JSON.stringify({ viewport: dimensions, edition: { id: edition._id, contentHash: edition.contentHash, eiRate: edition.rateSet.ei.rate, sourceUrl }, declarations, currentDeclarations, draft: { id, netCents: draft.result.totals.netCents, sourceFingerprint: draft.sourceFingerprint }, staleApproval: { status: stale.status, netCents: stale.result.totals.netCents }, fresh: { version: fresh.version, netCents: fresh.result.totals.netCents, sourceFingerprint: fresh.sourceFingerprint }, frozen, register: sinks.register.runs, journal: sinks.journal, pdf, errors, outside, externalAssets: [...new Set(externalAssets)] }, null, 2));
});
