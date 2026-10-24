import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { parsePayrollTd1Evidence, type PayrollTd1EvidenceInput } from "../shared/payrollTd1";
import { parseTd1Bytes, td1OcrItems } from "../src/features/payrollCalculation/td1FileParser";
import { createNodeOcrHost } from "../shared/intake/node/ocr";
import { createCanvas } from "@napi-rs/canvas";

async function completedOfficial(form: "td1" | "td1bc", amounts: Record<number, string>, settings: { more?: boolean; below?: boolean; extra?: string; zone?: string; nonresident?: string } = {}) {
  const document = await pdfjs.getDocument({ data: new Uint8Array(await readFile(`scripts/fixtures/payroll-td1/${form}-fill-26e.pdf`)), enableXfa: false, isEvalSupported: false, verbosity: 0 }).promise;
  const fields = Object.values(await document.getFieldObjects() ?? {}).flat() as any[];
  for (const [line, value] of Object.entries(amounts)) {
    const found = fields.find(field => field.type === "text" && new RegExp(`number${line}_subform`).test(field.name)); assert.ok(found, `official ${form} line ${line}`); document.annotationStorage.setValue(found.id, { value });
  }
  for (const field of fields) {
    if (/\.MoreThan_chk\[0\]$|\.More_than\[0\]$/.test(field.name)) document.annotationStorage.setValue(field.id, { value: Boolean(settings.more) });
    if (/\.TotalIncome_chk\[0\]$/.test(field.name)) document.annotationStorage.setValue(field.id, { value: Boolean(settings.below) });
    if (/\.Subform2\[0\]\.Amount2\[0\]$/.test(field.name) && settings.extra !== undefined) document.annotationStorage.setValue(field.id, { value: settings.extra });
    if (/\.Subform2\[0\]\.Amount1\[0\]$/.test(field.name) && settings.zone !== undefined) document.annotationStorage.setValue(field.id, { value: settings.zone });
    if (/Last_name/.test(field.name) && field.type === "text") document.annotationStorage.setValue(field.id, { value: "PRIVATE-SYNTHETIC-NAME" });
    if (/SIN_Comb\[0\]$/.test(field.name)) document.annotationStorage.setValue(field.id, { value: "046454286" });
  }
  const result = await document.saveDocument(); await document.destroy(); return result;
}
const options = { expectedYear: 2026, expectedForm: "federal" as const, pdfjs };
const federalBytes = await completedOfficial("td1", { 1: "16,452", 5: "3,548.00", 13: "20,000.00" }, { below: true, extra: "25.50", zone: "0" });
const federal = await parseTd1Bytes(federalBytes, options);
assert.equal(federal.form, "federal"); assert.equal(federal.year, 2026); assert.equal(federal.status, "review_required");
assert.equal(federal.fields.totalClaimCents.value, 2_000_000); assert.equal(federal.fields.additionalTaxCents.value, 2550); assert.equal(federal.fields.annualZoneDeductionCents.value, 0);
assert.equal(federal.fields.multipleEmployers.value, false); assert.equal(federal.fields.totalIncomeLessThanClaims.value, true);
assert.equal(federal.claimLines[0].amountCents.value, 1_645_200); assert.equal(federal.claimLines[4].amountCents.value, 354800); assert.equal(federal.claimLines[1].amountCents.value, null, "blank individual claims remain unknown, never invented zero");
assert.equal(federal.fields.totalClaimCents.confidence, "high"); assert.equal(federal.signatureVerified, false); assert.equal(federal.requiresManualReview, true);
assert.ok(/^[a-f0-9]{64}$/.test(federal.source.sha256));
assert.ok(!JSON.stringify(federal).includes("046454286")); assert.ok(!JSON.stringify(federal).includes("PRIVATE-SYNTHETIC-NAME"));
assert.ok(!JSON.stringify(federal).includes("Identification")); assert.ok(!("rawText" in federal)); assert.equal(federal.source.originalStored, false);
const province = await parseTd1Bytes(await completedOfficial("td1bc", { 11: "0" }, { more: true, below: false }), { ...options, expectedForm: "BC" });
assert.equal(province.form, "BC"); assert.equal(province.fields.totalClaimCents.value, 0); assert.equal(province.fields.multipleEmployers.value, true); assert.equal(province.fields.totalIncomeLessThanClaims.value, false);
assert.equal(province.fields.additionalTaxCents.value, null); assert.equal(province.fields.additionalTaxCents.needsReview, false, "BC form never supplies federal per-payment withholding");
assert.equal(province.claimLines[0].amountCents.value, 1321600, "preprinted provincial line one is separate from actual total zero under the concurrent-employer declaration");
assert.equal(province.status, "review_required");
assert.equal((await parseTd1Bytes(await completedOfficial("td1", { 13: "20,000" }, { more: true }), options)).status, "blocked", "contradictory entered claim/concurrent-employer declaration blocks application");
assert.equal((await parseTd1Bytes(federalBytes, { ...options, expectedForm: "BC" })).status, "blocked");
for (const form of ["td1", "td1bc"] as const) {
  const blank = await parseTd1Bytes(new Uint8Array(await readFile(`scripts/fixtures/payroll-td1/${form}-fill-26e.pdf`)), { ...options, expectedForm: form === "td1" ? "federal" : "BC" });
  assert.equal(blank.fields.totalClaimCents.value, null, "blank official form does not import printed BPA examples as a total claim");
}

async function flattened(year = 2026, code = "TD1", secondCode = code) {
  const document = await PDFDocument.create(), font = await document.embedFont(StandardFonts.Helvetica);
  const first = document.addPage([612, 792]), second = document.addPage([612, 792]);
  const draw = (page: typeof first, text: string, x: number, y: number, size = 10) => page.drawText(text, { x, y, size, font });
  draw(first, `${year} ${code === "TD1ON" ? "Ontario " : ""}Personal Tax Credits Return ${code}`, 24, 750, 14);
  draw(first, "PRIVATE-SYNTHETIC-NAME  Social insurance number 046454286", 24, 650);
  draw(first, "1. Basic personal amount - Every resident can enter $16,452; example only.", 24, 612);
  draw(first, "$16,452.00", 520, 612); draw(first, "$3,548.00", 520, 483); draw(first, "$20,000.00", 520, 123);
  draw(second, `Filling out Form ${secondCode}`, 24, 750, 14);
  draw(second, "[ ]", 27, 646); draw(second, "More than one employer or payer at the same time", 47, 646);
  draw(second, "[x]", 27, 601); draw(second, "Total income is less than the total claim amount", 47, 601);
  draw(second, "$0", 520, 374); draw(second, "$25.50", 520, 302);
  draw(second, "Reduction in tax deductions requires T1213 CRA authority; this is printed guidance.", 24, 250);
  return document.save();
}
const flat = await parseTd1Bytes(await flattened(), options);
assert.equal(flat.source.method, "pdf_text"); assert.equal(flat.fields.totalClaimCents.value, 2_000_000); assert.equal(flat.fields.additionalTaxCents.value, 2550); assert.equal(flat.fields.totalIncomeLessThanClaims.value, true); assert.equal(flat.fields.multipleEmployers.value, false);
assert.equal(flat.fields.totalClaimCents.confidence, "medium"); assert.ok(!JSON.stringify(flat).includes("046454286"));
assert.equal((await parseTd1Bytes(await flattened(2025), options)).status, "blocked");
assert.equal((await parseTd1Bytes(await flattened(2026, "TD1ON"), options)).status, "blocked");
assert.equal((await parseTd1Bytes(await flattened(2026, "TD1", "TD1BC"), options)).status, "blocked", "mixed federal/provincial pages cannot silently share declarations");
const evidence: PayrollTd1EvidenceInput = { expectedYear: 2026, expectedForm: "federal", sha256: "a".repeat(64), mediaType: "application/pdf", pageCount: 2, method: "pdf_text", fields: [], textItems: [{ page: 1, text: "2026 Personal Tax Credits Return TD1" }, { page: 1, text: "13. TOTAL CLAIM AMOUNT: $20,000.00" }, { page: 2, text: "[x] Total income is less than the total claim amount" }] };
assert.equal(parsePayrollTd1Evidence(evidence).fields.totalClaimCents.value, 2_000_000, "strict labelled transcription is accepted");
assert.equal(parsePayrollTd1Evidence({ ...evidence, textItems: [{ page: 1, text: "2026 Personal Tax Credits Return TD1" }, { page: 1, text: "Enter the basic personal amount $16,452. Add lines 1 to 12." }] }).fields.totalClaimCents.value, null, "instructional dollar examples are never claim values");
assert.equal(parsePayrollTd1Evidence({ ...evidence, fields: [{ name: "form1[0].Page1[0].Subform1[0].number13_subform[0].Amount_fld[0]", type: "text", value: "20,000" }, { name: "form1[0].Page1[0].Subform1[0].number13_subform[0].Amount_fld[0]", type: "text", value: "21,000" }] }).status, "blocked");
assert.equal(parsePayrollTd1Evidence({ ...evidence, fields: [{ name: "form1[0].Page1[0].Subform1[0].number13_subform[0].Amount_fld[0]", type: "text", value: "046454286" }], textItems: [{ page: 1, text: "2026 Personal Tax Credits Return TD1" }] }).fields.totalClaimCents.value, null, "identity-shaped numbers in a claim field are rejected without echoing raw contents");
await assert.rejects(parseTd1Bytes(new Uint8Array([1, 2, 3]), options), /Choose a local/);
await assert.rejects(parseTd1Bytes(new Uint8Array(11 * 1024 * 1024), options), /10 MiB/);
const controller = new AbortController(); controller.abort(); await assert.rejects(parseTd1Bytes(federalBytes, { ...options, signal: controller.signal }), error => error instanceof DOMException && error.name === "AbortError");

const canvas = createCanvas(1224, 1584), context = canvas.getContext("2d");
context.fillStyle = "white"; context.fillRect(0, 0, 1224, 1584); context.fillStyle = "black"; context.font = "36px Arial";
context.fillText("2026 Personal Tax Credits Return TD1", 48, 100);
context.fillText("13. TOTAL CLAIM AMOUNT: $20,000.00", 48, 500);
context.fillText("Synthetic scan. Review the completed declaration.", 48, 650);
const ocr = await createNodeOcrHost({ engine: "auto", concurrency: 1, pageBudget: 2 });
try {
  const scanned = await parseTd1Bytes(new Uint8Array(canvas.toBuffer("image/png")), { ...options, ocrHost: ocr });
  assert.equal(scanned.source.method, "local_ocr"); assert.equal(scanned.form, "federal"); assert.equal(scanned.year, 2026); assert.equal(scanned.fields.totalClaimCents.value, 2_000_000);
  assert.equal(scanned.fields.totalClaimCents.confidence, "low"); assert.equal(scanned.fields.multipleEmployers.value, null, "a missing/unchecked scan declaration is never guessed false");
  assert.equal(scanned.requiresManualReview, true); assert.equal(scanned.signatureVerified, false);
  const scannedPdf = await PDFDocument.create(), scannedPage = scannedPdf.addPage([612, 792]);
  scannedPage.drawImage(await scannedPdf.embedPng(canvas.toBuffer("image/png")), { x: 0, y: 0, width: 612, height: 792 });
  const pdfScan = await parseTd1Bytes(await scannedPdf.save(), { ...options, ocrHost: ocr });
  assert.equal(pdfScan.source.method, "local_ocr"); assert.equal(pdfScan.fields.totalClaimCents.value, 2_000_000, "image-only PDF uses the same local OCR review path as an image upload");
} finally { await ocr.terminate(); }
assert.deepEqual(td1OcrItems({ width: 1224, height: 1584, words: [{ text: "20000", confidence: 55, line: 1, bbox: { x0: 1040, x1: 1140, y0: 1300, y1: 1338 } }] }, 1).map(item => [item.x, Math.round(item.y! * 1000000) / 1000000, item.confidence]), [[520, 123, 55]], "local OCR preserves positioned field confidence without emitting private page text");
console.log("TD1 import checks passed: real completed official 2026 federal/BC AcroForms, flattened positioned text, local OCR scan, separate declarations/additional withholding, unknown-vs-zero, form/year/ambiguity blocks, manual signature review and identity/raw-text redaction.");
