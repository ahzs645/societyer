import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";

async function syntheticCompletedFederal() {
  const document = await pdfjs.getDocument({ data: new Uint8Array(await readFile("scripts/fixtures/payroll-td1/td1-fill-26e.pdf")), enableXfa: false, isEvalSupported: false, verbosity: 0 }).promise;
  const fields = Object.values(await document.getFieldObjects() ?? {}).flat() as any[];
  for (const field of fields) {
    let value: string | boolean | undefined;
    if (/number13_subform/.test(field.name)) value = "20,000.00";
    else if (/\.MoreThan_chk\[0\]$/.test(field.name)) value = false;
    else if (/\.TotalIncome_chk\[0\]$/.test(field.name)) value = true;
    else if (/\.Subform2\[0\]\.Amount2\[0\]$/.test(field.name)) value = "25.50";
    else if (/Last_name/.test(field.name)) value = "PRIVATE-SYNTHETIC-NAME";
    else if (/SIN_Comb\[0\]$/.test(field.name)) value = "046454286";
    if (value !== undefined) document.annotationStorage.setValue(field.id, { value });
  }
  const bytes = await document.saveDocument(); await document.destroy(); return Array.from(bytes);
}

test("TD1 browser worker reads official fields, redacts identity and requires review", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", error => failures.push(error.message));
  await page.route("**/td1-parser-qualification", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Local TD1 parser qualification</title>" }));
  await page.goto("/td1-parser-qualification");
  const result = await page.evaluate(async bytes => {
    const { parseTd1File } = await import("/src/features/payrollCalculation/td1FileParser.ts");
    const progress: string[] = [];
    const file = new File([new Uint8Array(bytes)], "never-retain-this-filename.pdf", { type: "application/pdf" });
    const result = await parseTd1File(file, { expectedYear: 2026, expectedForm: "federal", onProgress: value => progress.push(value.stage) });
    const wrongSlot = await parseTd1File(file, { expectedYear: 2026, expectedForm: "BC" });
    const controller = new AbortController(); controller.abort();
    let cancelled = false;
    try { await parseTd1File(file, { expectedYear: 2026, expectedForm: "federal", signal: controller.signal }); } catch (error) { cancelled = error instanceof DOMException && error.name === "AbortError"; }
    return { result, wrongSlot, progress, cancelled };
  }, await syntheticCompletedFederal());
  expect(result.result.status).toBe("review_required");
  expect(result.result.fields.totalClaimCents.value).toBe(2_000_000);
  expect(result.result.fields.additionalTaxCents.value).toBe(2550);
  expect(result.result.fields.multipleEmployers.value).toBe(false);
  expect(result.result.fields.totalIncomeLessThanClaims.value).toBe(true);
  expect(result.result.fields.totalClaimCents.confidence).toBe("high");
  expect(result.result.requiresManualReview).toBe(true);
  expect(result.result.signatureVerified).toBe(false);
  expect(result.result.source.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(result.result)).not.toMatch(/PRIVATE-SYNTHETIC-NAME|046454286|never-retain-this-filename|rawText/);
  expect(result.wrongSlot.status).toBe("blocked");
  expect(result.cancelled).toBe(true);
  expect(result.progress).toContain("complete");
  expect(failures).toEqual([]);
});

test("scanned TD1 image and PDF use bundled local OCR without uploading forms", async ({ page }) => {
  test.setTimeout(180_000);
  const canvas = createCanvas(1224, 1584), context = canvas.getContext("2d");
  context.fillStyle = "white"; context.fillRect(0, 0, 1224, 1584); context.fillStyle = "black"; context.font = "36px Arial";
  context.fillText("2026 Personal Tax Credits Return TD1", 48, 100);
  context.fillText("13. TOTAL CLAIM AMOUNT: $20,000.00", 48, 500);
  context.fillText("Synthetic scan. Review the completed declaration.", 48, 650);
  const png = canvas.toBuffer("image/png"), pdf = await PDFDocument.create(), pdfPage = pdf.addPage([612, 792]);
  pdfPage.drawImage(await pdf.embedPng(png), { x: 0, y: 0, width: 612, height: 792 });
  const requests: Array<{ url: string; method: string }> = [];
  page.on("request", request => requests.push({ url: request.url(), method: request.method() }));
  await page.route("**/td1-parser-qualification", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Offline TD1 OCR qualification</title>" }));
  await page.goto("/td1-parser-qualification");
  const results = await page.evaluate(async ({ image, pdfBytes }) => {
    const { parseTd1File } = await import("/src/features/payrollCalculation/td1FileParser.ts");
    const results = [];
    for (const [bytes, type] of [[image, "image/png"], [pdfBytes, "application/pdf"]] as const) {
      results.push(await parseTd1File(new File([new Uint8Array(bytes)], "synthetic-only", { type }), { expectedForm: "federal", expectedYear: 2026 }));
    }
    return results;
  }, { image: Array.from(png), pdfBytes: Array.from(await pdf.save()) });
  for (const result of results) {
    expect(result.source.method).toBe("local_ocr");
    expect(result.fields.totalClaimCents.value).toBe(2_000_000);
    expect(result.fields.totalClaimCents.confidence).toBe("low");
    expect(result.fields.multipleEmployers.value).toBeNull();
    expect(result.requiresManualReview).toBe(true);
    expect(result.signatureVerified).toBe(false);
  }
  expect(requests.some(request => request.url.includes("intake-ocr/") && request.url.includes("eng.traineddata"))).toBe(true);
  expect(requests.filter(request => request.method !== "GET")).toEqual([]);
  expect(requests.filter(request => new URL(request.url).protocol.startsWith("http") && new URL(request.url).origin !== new URL(page.url()).origin)).toEqual([]);
});
