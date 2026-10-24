import React from "react";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { renderDocument } from "@formepdf/core";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { BooksReport, GeneralLedgerReport } from "../shared/booksReports";
import { DEFAULT_INVOICE_TEMPLATE, resolveDocumentDesign } from "../shared/invoiceCommerce";
import { importInvoiceBrand } from "../shared/invoiceBranding";
import ddcnorth from "../shared/brandKits/ddcnorth.json";
import { decorateDocumentPdf } from "../src/features/invoicing/documentPdfDecoration";
import { BrandedReportPdfDocument } from "../src/features/financials/reports/BrandedReportPdfDocument";
import { statementPdfData, ledgerPdfData } from "../src/features/financials/reports/brandedReportData";

const regular = new Uint8Array(await readFile("src/assets/invoice-branding/Inter-Regular.ttf"));
const bold = new Uint8Array(await readFile("src/assets/invoice-branding/Inter-SemiBold.ttf"));
const fonts = [{ family: "Invoice", src: regular }, { family: "Invoice", src: bold, fontWeight: "bold" as const }];
const periods = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, label: `Period ${i + 1}`, start: `2026-0${i + 1}-01`, end: `2026-0${i + 1}-28`, clipped: false, toDate: null }));
const report: BooksReport = {
  kind: "operations", basis: "cash", currency: "USD", currencies: ["USD", "CAD"], periods, totalColumn: "total", filtered: true,
  postedLineCount: 80, dimensionValues: { programCode: ["Repair clinic"] }, warnings: ["Filtered funds may not balance independently."],
  rows: [{ id: "income", kind: "section", label: "Revenue", children: Array.from({ length: 50 }, (_, i) => ({ id: `account-${i}`, kind: "row", code: `4${String(i).padStart(3, "0")}`, label: `Workshop revenue account ${i + 1}`, values: Object.fromEntries([...periods.map((p, index) => [p.id, (index + 1) * 12345]), ["total", 444420]]) })) }, { id: "total", kind: "total", label: "Excess (deficiency)", values: { p0: 2500, total: 20000 } }],
  summary: periods.map((p, i) => ({ periodId: p.id, label: p.label, end: p.end, values: { revenue: (i + 1) * 20000, expenses: (i + 1) * 15000, net: (i + 1) * 5000 } })),
};
const filterSummary = ["Cash basis · USD", "Period: 2026-01-01 to 2026-08-28", "Fund: Restricted repairs", "Program: Repair clinic", "Tags: Community / North"];
const template = { ...DEFAULT_INVOICE_TEMPLATE, brand: importInvoiceBrand(ddcnorth), design: resolveDocumentDesign(DEFAULT_INVOICE_TEMPLATE) };
template.design.page.orientation = "landscape";
template.design.titles.report = "Workshop financials";
template.design.table.striped = true;
template.design.header = { text: "Report first-page header", continuationText: "Report continuation header", repeat: true };
template.design.footer = { text: "Prepared for directors", continuationText: "Director report continuation", repeat: true, pageNumbers: true, pageNumberFormat: "page_of_total" };
const data = statementPdfData(report, "Statement of operations", filterSummary);
assert.equal(data.rows?.length, 52, "all nested account rows are included");
assert.equal(data.charts?.[0].series?.[0].values[1], report.summary[1].values.revenue, "chart uses the same source values as the report");
assert.equal(data.charts?.[0].series?.[1].plotSign, -1, "expense bars use the same below-baseline convention as the screen");
const render = async (input = data, includeGraphs = true) => decorateDocumentPdf(await renderDocument(<BrandedReportPdfDocument report={input} template={template} organization={{ name: "North workshop" }} fonts={fonts} includeGraphs={includeGraphs} />), { config: template, fonts, organizationName: "North workshop" });
const inspect = async (bytes: Uint8Array) => {
  const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true }).promise;
  const pages: string[] = []; let paths = 0, images = 0;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    pages.push((await page.getTextContent()).items.map((item: any) => item.str ?? "").join(" "));
    const operators = await page.getOperatorList();
    paths += operators.fnArray.filter((fn) => fn === OPS.constructPath).length;
    images += operators.fnArray.filter((fn) => fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject).length;
  }
  await pdf.destroy(); return { pages, text: pages.join(" "), paths, images };
};
const bytes = await render();
const inspected = await inspect(bytes);
for (const expected of ["Workshop financials", "Statement of operations", "Cash basis", "USD", "Restricted repairs", "Repair clinic", "Community / North", "Revenue and expenses", "Workshop revenue account 50", "Period 8", "Excess (deficiency)", "Filtered funds"]) assert.ok(inspected.text.includes(expected), `report includes ${expected}`);
assert.ok(inspected.pages.length > 2, "long tables paginate");
assert.ok(inspected.pages[0].includes("Report first-page header") && inspected.pages[0].includes("Prepared for directors"));
assert.ok(inspected.pages[1].includes("Report continuation header") && inspected.pages[1].includes("Director report continuation"));
assert.ok(inspected.pages[0].includes(`Page 1 of ${inspected.pages.length}`), "actual page totals decorate the finished report");
assert.ok(inspected.pages.slice(1).some((page) => page.includes("Account")), "column headings repeat");
assert.equal(inspected.images, 0, "logo and graphs remain native vectors");
const ungraphed = await inspect(await render(data, false));
assert.ok(!ungraphed.text.includes("Revenue and expenses"), "include graphs toggle removes graph and its companion data table");
assert.ok(inspected.paths > ungraphed.paths, "graphs contribute native drawing paths");
const parsed = await PDFDocument.load(bytes);
assert.equal(parsed.getPage(0).getWidth(), 792, "landscape respects the shared template");
assert.equal(parsed.getPage(0).getHeight(), 612);
const empty = await inspect(await render({ title: "Empty report", currency: "CAD", filterSummary: ["Accrual basis", "No matching postings"], columns: [{ key: "account", label: "Account" }], rows: [] }));
assert.ok(empty.text.includes("No matching rows"));
const unknown = await inspect(await render({ title: "Unknown cash balance", currency: "CAD", filterSummary: [], charts: [{ title: "Cash history", kind: "lines", labels: ["Before coverage", "Covered"], series: [{ label: "Cash", color: "#245c46", values: [null, 23000] }] }], rows: [], columns: [{ key: "account", label: "Account" }] }));
assert.ok(unknown.text.includes("Unknown"), "uncovered cash is not converted to zero");
const cashData = statementPdfData({ ...report, kind: "cash_flow", summary: [{ periodId: "p0", label: "Period 1", end: "2026-01-28", values: { cashIn: 10000, cashOut: 2500, movement: 7500, ending: 30000 } }] }, "Cash flow", filterSummary);
assert.equal(cashData.charts?.[0].curve, "step", "cash-at-period-end retains the step chart convention");
assert.equal(cashData.charts?.[1].series?.[2].values[0], 7500, "cash graph net uses movement, not an absent key");
const ledger: GeneralLedgerReport = { basis: "cash", currency: "USD", from: "2026-01-01", to: "2026-01-31", warnings: [], truncated: true, dimensionValues: { programCode: [] }, totals: { debitCents: 50000, creditCents: 50000 }, account: { accountId: "a", name: "Cash", code: "1000", accountType: "asset", creditNormal: false, openingBalanceCents: 10000, closingBalanceCents: 15000 }, rows: [{ lineId: "line", entryId: "entry", date: "2026-01-12", memo: "Repair deposit", account: { accountId: "a", code: "1000", name: "Cash" }, contraAccounts: [{ accountId: "b", name: "Repair income" }], debitCents: 5000, creditCents: 0, balanceCents: 15000, counterparty: "Sample customer" }] };
const ledgerData = ledgerPdfData(ledger, filterSummary);
assert.ok(ledgerData.warnings?.some((line) => line.includes("first 1 lines")), "truncation survives PDF export");
const ledgerBytes = await render(ledgerData);
const ledgerPdf = await inspect(ledgerBytes);
for (const expected of ["Opening balance", "Closing balance", "Repair deposit", "Sample customer", "Totals", "limited lines"]) assert.ok(ledgerPdf.text.includes(expected), `ledger includes ${expected}`);
const logoCanvas = createCanvas(120, 30), logoContext = logoCanvas.getContext("2d");
logoContext.fillStyle = "#245c46"; logoContext.fillRect(0, 0, 120, 30);
const organizationLogo = `data:image/png;base64,${logoCanvas.toBuffer("image/png").toString("base64")}`;
const annotatedBytes = await render({ title: "Annotated flow", currency: "CAD", filterSummary: [], charts: [{ title: "Flow graph", kind: "svg", description: "Source → destination", svg: { width: 600, height: 100, content: '<path d="M10 30H590V70H10Z" fill="#c8d7e8"/>', annotations: [{ text: "Repair income", x: 10, y: 5, width: 150 }, { text: "Workshop programs", x: 400, y: 5, width: 180 }] } }] });
const annotated = await inspect(annotatedBytes);
assert.ok(annotated.text.includes("Repair income") && annotated.text.includes("Workshop programs"), "diagram node annotations are native searchable text");
const organizationLogoPdf = await inspect(await renderDocument(<BrandedReportPdfDocument report={{ title: "Organization branding", currency: "CAD", filterSummary: [] }} template={{ ...DEFAULT_INVOICE_TEMPLATE }} organization={{ name: "North workshop", logoUrl: organizationLogo }} fonts={fonts} />));
assert.ok(organizationLogoPdf.images > 0, "organization logo is included when no brand kit is selected");
// A short trailing section must move with its table, rather than leave its caption on the previous page.
let boundaryPageBreak = false;
for (const leadingCount of [11, 12, 13, 14]) {
  const boundary = await inspect(await render({ title: "Section pagination", currency: "CAD", filterSummary: [], sections: [
    { title: "Leading activity", columns: [{ key: "entry", label: "Entry" }, { key: "amount", label: "Amount", align: "right" }], rows: Array.from({ length: leadingCount }, (_, index) => ({ key: `leading-${index}`, cells: [`Activity ${index + 1}`, "$10.00"] })) },
    { title: "Cash-flow totals", description: "Totals for the selected range", columns: [{ key: "label", label: "Measure" }, { key: "value", label: "Value", align: "right" }], rows: [{ key: "net", cells: ["Net cash total", "$120.00"] }] },
  ] }));
  boundaryPageBreak ||= boundary.pages.length > 1;
  for (const page of boundary.pages) if (page.includes("Cash-flow totals")) assert.ok(page.includes("Net cash total") && page.includes("Measure"), "section heading stays with its column headings and first row");
}
assert.ok(boundaryPageBreak, "section caption regression exercises an actual page boundary");
await mkdir("/workspace/scratch/branded-reports", { recursive: true });
await writeFile("/workspace/scratch/branded-reports/operations.pdf", bytes);
await writeFile("/workspace/scratch/branded-reports/annotated-flow.pdf", annotatedBytes);
console.log("Branded report PDF checks passed: filtered data, graph values, native vectors, all periods and nested rows, pagination, repeated headers, shared branding, landscape, empty states, unknown balances and ledger truncation.");
