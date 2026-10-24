import React from "react";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { renderDocumentWithLayout } from "@formepdf/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PayrollStatementPdfDocument } from "../src/features/payrollCalculation/PayrollStatementPdfDocument";
import { decorateDocumentPdf } from "../src/features/invoicing/documentPdfDecoration";
import { DEFAULT_INVOICE_TEMPLATE, resolveDocumentDesign } from "../shared/invoiceCommerce";
import { payrollStatementReport, type PayrollStatement } from "../shared/payrollReporting";

const directory = "/workspace/scratch/payroll-statement-layout";
await mkdir(directory, { recursive: true });
const earnings = Array.from({ length: 11 }, (_, index) => ({ key: `earning-${index}`, code: "REGULAR", label: "Regular earnings", date: `2026-05-${String(index + 1).padStart(2, "0")}`, hours: 8, rateCents: 2500, amountCents: 20000, cashCents: 20000, taxableCents: 20000, pensionableCents: 20000, insurableCents: 20000, vacationableCents: 20000, ehtCents: 20000, workSafeCents: 20000 }));
const statement: PayrollStatement = { schemaVersion: 1, calculationId: "sample-finalized-calculation-with-retained-source", calculationVersion: 1, statementNumber: "PAY-LAYOUT-001", status: "finalized", employer: { name: "Sample payroll organization" }, employee: { employeeId: "sample-employee", name: "Sample employee", provinceOfEmployment: "BC" }, currency: "CAD", periodStart: "2026-05-01", periodEnd: "2026-05-15", payDate: "2026-05-22", runType: "regular", earnings, totals: { grossCents: 220000, taxableCents: 220000, cashCents: 220000, nonCashTaxableCents: 0, nonTaxableCashCents: 0, cppEmployeeCents: 0, cpp2EmployeeCents: 0, eiEmployeeCents: 0, federalTaxCents: 0, provincialTaxCents: 0, additionalIncomeTaxCents: 0, incomeTaxCents: 0, otherDeductionsCents: 0, netCents: 220000, cppEmployerCents: 0, cpp2EmployerCents: 0, eiEmployerCents: 0, employerCostCents: 220000 }, otherDeductions: [], employerCosts: [], yearToDate: { year: 2026, grossCents: 220000, taxableCents: 220000, cashCents: 220000, cppEmployeeCents: 0, cpp2EmployeeCents: 0, eiEmployeeCents: 0, incomeTaxCents: 0, netCents: 220000, pensionableCents: 220000, insurableCents: 220000, insurableHours: 88 }, rules: { edition: "2026-01-BC-option1", method: "option1", explanations: Array.from({ length: 20 }, (_, index) => `Factor ${index + 1}: Employee contribution and income tax calculation retained from the reviewed payment-year rule set (min(423045 - 0, 0.0595 × (220000 - 14583)); eligibility applied).`), sources: ["https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/t4032-payroll-deductions-tables.html", "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/t4127-payroll-deductions-formulas/t4127-jan-119th-edition-effective-january-1-2026.html"], inputFingerprint: "abc123".repeat(10), resultFingerprint: "def456".repeat(10) }, finalizedAtISO: "2026-10-23T12:00:00Z", warnings: [] };
const fonts = [{ family: "Invoice", src: new Uint8Array(await readFile("src/assets/invoice-branding/Inter-Regular.ttf")) }, { family: "Invoice", src: new Uint8Array(await readFile("src/assets/invoice-branding/Inter-SemiBold.ttf")), fontWeight: "bold" as const }];
const template = { ...DEFAULT_INVOICE_TEMPLATE, design: resolveDocumentDesign(DEFAULT_INVOICE_TEMPLATE) };
template.design.footer.pageNumbers = true;
const raw = await renderDocumentWithLayout(<PayrollStatementPdfDocument statement={statement} template={template} fonts={fonts} organization={{ name: statement.employer.name }} />);
const pdf = await decorateDocumentPdf(raw.pdf, { config: template, fonts, layout: raw.layout, organizationName: statement.employer.name });
await writeFile(`${directory}/pay-statement.pdf`, pdf);
const parsed = await getDocument({ data: pdf.slice(), disableFontFace: true }).promise;
let text = "", calculationPages: number[] = [];
for (let number = 1; number <= parsed.numPages; number++) {
  const page = await parsed.getPage(number), items = (await page.getTextContent()).items as Array<{ str: string; width: number; transform: number[] }>;
  const content = items.map(item => item.str).join(" "); text += content + "\n";
  if (content.includes("Calculation record")) calculationPages.push(number);
  for (const item of items) assert.ok(item.transform[4] >= 0 && item.transform[4] + item.width <= page.getViewport({ scale: 1 }).width + 1, "all statement text remains inside the physical page");
}
await writeFile(`${directory}/pay-statement.txt`, text);
assert.ok(text.replace(/\s+/g, " ").includes("Calculation explanation"), "calculation labels remain complete words rather than narrow character fragments");
assert.ok(text.replace(/\s+/g, " ").includes("Calculation detail"), "the calculation table heading stays legible");
assert.ok(text.includes("Factor 20:")); assert.ok(text.includes("abc123")); assert.ok(calculationPages.length > 0);
assert.ok(parsed.numPages <= 6, "the canonical eleven-earning statement must not regain pages caused by a collapsed calculation-label column");
const record = payrollStatementReport(statement).sections!.find(section => section.title === "Calculation record")!;
assert.equal(record.rows.filter(row => row.cells[0].startsWith("Calculation explanation:")).length, 20, "all calculation provenance remains present");
console.log(JSON.stringify({ pages: parsed.numPages, calculationPages, output: `${directory}/pay-statement.pdf` }));
await parsed.destroy();
