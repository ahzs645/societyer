import React from "react";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { renderDocument } from "@formepdf/core";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DEFAULT_INVOICE_TEMPLATE, resolveDocumentDesign } from "../shared/invoiceCommerce";
import { importInvoiceBrand } from "../shared/invoiceBranding";
import ddcnorth from "../shared/brandKits/ddcnorth.json";
import { financialOverviewDocument } from "../src/features/financials/insights/financialOverviewDocument";
import { sankeyReportDocument } from "../src/features/financials/insights/sankeyReportDocument";
import { buildCashFlowSankey } from "../src/features/financials/insights/cashFlowSankey";
import { balanceRows, flowTotals, monthlyFlowRows } from "../src/features/financials/insights/series";
import { annualReportDocument, organizationReportDocument, programReportDocument, readinessReportDocument, restrictedReportDocument } from "../src/features/financials/reports/yearEndReportDocuments";
import { BrandedReportPdfDocument } from "../src/features/financials/reports/BrandedReportPdfDocument";
import type { BrandedReportData } from "../src/features/financials/reports/brandedReportTypes";
import { decorateDocumentPdf } from "../src/features/invoicing/documentPdfDecoration";
import { currencyFixtures } from "./check-year-end-report-scope";
import { renderAnnualStatementHtml, renderOrgStatementHtml, renderRestrictedFundsHtml, renderProgramStatementHtml } from "../src/features/financials/lib/yearEndRenderers";

const range = { start: "2026-01-01", end: "2026-02-28" }, focus = { start: "2026-02-01", end: "2026-02-28" };
const txns = [{ date: "2026-01-04", amountCents: 75000, category: "January only", accountId: "bank" }, { date: "2026-02-05", amountCents: 100000, category: "Donations", accountId: "bank" }, { date: "2026-02-07", amountCents: -30000, category: "Supplies", accountId: "bank", counterparty: "Repair supplier" }, { date: "2026-02-08", amountCents: 5000, category: "Supplies", accountId: "bank" }];
const overview = financialOverviewDocument({ txns, currentBalance: 250000, range, focus, compareMode: "off", previousCovered: false, closing: 250000, cashRows: balanceRows(txns, 250000, range, false), flowRows: monthlyFlowRows(txns, range), budgetRows: [{ category: "Workshop", fiscalYear: "2025-2026", plannedCents: 50000, actualCents: 30000, kind: "expense" }], truncated: true });
assert.equal(overview.charts?.[0].labels?.length, 1, "drag selection limits chart dates");
assert.ok(!JSON.stringify(overview.sections).includes("January only"), "selection excludes out-of-range categories");
assert.equal(overview.charts?.[1].series?.[0].values[0], flowTotals(txns, focus).inflow, "graph amounts agree with the selected bank range");
assert.ok(overview.sections?.find((section) => section.title.includes("Budget"))?.description?.includes("independently"), "different budget scope is disclosed");
assert.ok(overview.warnings?.some((line) => line.includes("5,000")));
const uncovered = financialOverviewDocument({ txns: [], currentBalance: 0, range, focus: range, compareMode: "off", previousCovered: false, closing: null, cashRows: [{ date: "2026-01-31", balance: null }], flowRows: [], budgetRows: [], truncated: false });
assert.equal(uncovered.charts?.[0].series?.[0].values[0], null, "uncovered cash must stay unknown");
const model = buildCashFlowSankey(txns, focus);
assert.equal(model.totalOut, 25000, "refund reduces category spending");
const diagram = sankeyReportDocument(model, focus);
assert.ok(diagram.charts?.[0].svg?.content.includes("<path"));
assert.ok(!/NaN|Infinity/.test(diagram.charts?.[0].svg?.content ?? ""));
assert.equal(diagram.sections?.[1].rows.find((row) => row.cells[0] === "Supplies")?.cells.at(-1), "$50.00");
assert.ok(!/NaN|Infinity/.test(sankeyReportDocument(buildCashFlowSankey([], focus), focus).charts?.[0].svg?.content ?? ""), "empty diagram has finite geometry");

const annual = annualReportDocument({ revenueCents: 100000, expensesCents: 25000, surplusCents: 75000, netAssetsCents: 250000, restrictedFundsCents: 20000, incomeByCategory: [{ category: "Repair fees", cents: 100000 }], expenseByCategory: [{ category: "Replacement parts", cents: 25000 }], budgets: [{ category: "Parts plan", plannedCents: 30000, actualCents: 25000, varianceCents: 5000 }], byCounterparty: [{ name: "Customer collective", incomeCents: 100000, expenseCents: 0 }], byGrant: [{ title: "Repair grant", incomeCents: 20000, expenseCents: 0 }], remunerationDisclosures: [{ role: "Treasurer", amountCents: 15000 }], auditStatus: "Reviewed" }, "2025-2026");
const restricted = restrictedReportDocument({ funds: [{ title: "Repair fund", funder: "Community foundation", openingCents: 10000, receiptsCents: 50000, disbursementsCents: 25000, closingCents: 35000 }], totals: { openingCents: 10000, receiptsCents: 50000, disbursementsCents: 25000, closingCents: 35000 } });
const readiness = readinessReportDocument({ completed: 1, total: 2, items: [{ key: "approved", label: "Statement approval", detail: "Approved by the board", ok: true }, { key: "filing", label: "Annual filing", detail: "Filing due next month", ok: false, status: "upcoming" }] }, "2025-2026");
const organization = organizationReportDocument({ organizationName: "North Workshop", fiscalYearLabel: "2025-2026", empty: false, revenues: [{ label: "Repair revenue", generalCents: 100000, restrictedCents: 20000 }], expenses: [{ label: "Repair costs", generalCents: 20000, restrictedCents: 5000 }], revenueTotals: { generalCents: 100000, restrictedCents: 20000, totalCents: 120000 }, expenseTotals: { generalCents: 20000, restrictedCents: 5000, totalCents: 25000 }, excess: { generalCents: 80000, restrictedCents: 15000, totalCents: 95000 } });
const program = programReportDocument({ programName: "Community repair", funderName: "Repair foundation", priorFiscalYearLabel: "2025", currentFiscalYearLabel: "2026", status: "Draft", revenues: [{ key: "r", label: "Repair sales", actualCents: 50000, budgetCents: 70000 }], expenses: [{ key: "e", label: "Repair parts", actualCents: 15000, budgetCents: 25000, notes: "Reusable components" }], narrative: "Program delivery notes" });
const euros = annualReportDocument({ revenueCents: 100000, expensesCents: 25000, surplusCents: 75000 }, "2025-2026", "EUR");
assert.equal(euros.currency, "EUR");
assert.ok(euros.sections?.[0].rows[0].cells[1].includes("€"), "year-end amounts use the supplied display currency");
assert.ok(annual.sections?.find((section) => section.title === "By grant")?.description?.includes("posted journal"), "mixed report sources are identified per section");
const usdAnnual = annualReportDocument(currencyFixtures.annual as any, "2026");
const usdOrganization = organizationReportDocument(currencyFixtures.organization);
const usdRestricted = restrictedReportDocument(currencyFixtures.restricted as any);
assert.equal(usdAnnual.currency, "USD", "document currency comes from the exact source-filtered response");
assert.equal(usdAnnual.charts?.[0].series?.[0].values[0], currencyFixtures.annual.revenueCents);
assert.equal(usdOrganization.charts?.[0].series?.[0].values[1], currencyFixtures.organization.revenueTotals.restrictedCents);
assert.equal(usdRestricted.charts?.[0].series?.[0].values.reduce((sum, value) => sum + (value ?? 0), 0), currencyFixtures.restricted.totals.receiptsCents);
for (const html of [renderAnnualStatementHtml(currencyFixtures.annual, { name: "Currency scope" }, "2026"), renderOrgStatementHtml(currencyFixtures.organization), renderRestrictedFundsHtml(currencyFixtures.restricted, { name: "Currency scope" })]) {
  assert.ok(html.includes("Currency: USD"), "Word/print templates retain actual source currency");
  assert.ok(html.includes("US$"), "foreign money retains its currency marker");
  assert.ok(!html.includes("CAD only"), "CAD source-only rows are absent from USD HTML output");
}
assert.ok(renderProgramStatementHtml({ programName: "Euro program", priorFiscalYearLabel: "2025", currentFiscalYearLabel: "2026", revenues: [{ key: "r", label: "Fees", actualCents: 10000, budgetCents: 10000 }], expenses: [] }, undefined, "EUR").includes("€100.00"), "base-currency program forms format their configured currency");

const fonts = await Promise.all([{ family: "Invoice", file: "Inter-Regular.ttf" }, { family: "Invoice", file: "Inter-SemiBold.ttf", fontWeight: "bold" as const }].map(async ({ file, ...font }) => ({ ...font, src: new Uint8Array(await readFile(`src/assets/invoice-branding/${file}`)) })));
const template = { ...DEFAULT_INVOICE_TEMPLATE, brand: importInvoiceBrand(ddcnorth), design: resolveDocumentDesign(DEFAULT_INVOICE_TEMPLATE) };
template.design.footer.pageNumbers = true;
await mkdir("/workspace/scratch/financial-report-documents", { recursive: true });
for (const [name, report, expected] of [
  ["overview", overview, ["Financial overview", "2026-02-01", "Repair supplier", "Budget vs actuals", "5,000"]],
  ["cash-flow-diagram", diagram, ["Cash-flow diagram", "Supplies", "Refunds netted", "$50.00"]],
  ["annual", annual, ["Annual Financial Statement", "Repair fees", "Replacement parts", "Parts plan", "Customer collective", "Repair grant", "Treasurer", "Reviewed"]],
  ["restricted", restricted, ["Community foundation", "Repair fund", "$350.00", "Opening"]],
  ["readiness", readiness, ["Statement approval", "Annual filing", "Upcoming", "Readiness progress"]],
  ["organization", organization, ["Repair revenue", "Repair costs", "General Fund", "Restricted Funds", "$950.00"]],
  ["program", program, ["Community repair", "Repair sales", "Repair parts", "Reusable components", "Program delivery notes", "Repair foundation"]],
  ["annual-usd-filtered", usdAnnual, ["Source currency: USD", "USD Services", "USD Supplies", "US$100.00", "US$25.00", "US$75.00"]],
  ["organization-usd-filtered", usdOrganization, ["Source currency: USD", "USD Services", "USD Supplies", "US$100.00", "US$25.00"]],
  ["restricted-usd-filtered", usdRestricted, ["Source currency: USD", "USD restricted grant", "US$215.00", "US$50.00", "US$165.00"]],
] as Array<[string, BrandedReportData, string[]]>) {
  const raw = await renderDocument(<BrandedReportPdfDocument report={report} template={template} organization={{ name: "North Workshop" }} fonts={fonts} />);
  const bytes = await decorateDocumentPdf(raw, { config: template, fonts });
  const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true }).promise;
  let text = "", paths = 0;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const pageText = (await page.getTextContent()).items.map((item: any) => item.str ?? "").join(" ");
    assert.ok(pageText.includes(`Page ${i} of ${pdf.numPages}`), `${name} shares real page numbering`);
    text += ` ${pageText}`;
    paths += (await page.getOperatorList()).fnArray.filter((op) => op === OPS.constructPath).length;
  }
  for (const label of expected) assert.ok(text.includes(label), `${name} PDF retains ${label}`);
  if (name.includes("usd-filtered")) assert.ok(!text.includes("CAD only"), `${name} excludes foreign source rows instead of relabelling them`);
  assert.ok(paths > 0, `${name} retains vector graphs/branding`);
  await pdf.destroy();
  await writeFile(`/workspace/scratch/financial-report-documents/${name}.pdf`, bytes);
}
console.log("Financial overview, Sankey and all five year-end PDFs passed: selected ranges, refund netting, complete source sections, provenance, graphs, searchable text and shared page numbers.");
