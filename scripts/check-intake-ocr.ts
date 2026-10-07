/** OCR and native legacy-reader gate (test:intake-ai).
 *
 * 1. Unit checks: noise cleanup, word → item layout, TSV parsing (system tesseract), the
 *    tesseract.js block mapping, OCR confidence caps on fields, document-image detection,
 *    the page budget and format sniffing.
 * 2. The committed synthetic scans (tests/fixtures/intake/ocr, made by
 *    scripts/generate-intake-ocr-fixtures.ts; no real records) are read with tesseract.js and the
 *    bundled English model: an image-only two-page minutes PDF whose second sheet was scanned
 *    sideways, and a consent form saved as a PNG. They then run through the whole pipeline.
 * 3. Native legacy readers on synthetic files: Excel 97-2003, PowerPoint 97-2003, PPTX, XPS,
 *    HTML saved as .xls and files without an extension.
 * 4. Optional private OCR golden set (real scans, outside git):
 *      SOCIETYER_GOLDEN_SET_OCR=/path/golden-set-ocr.json \
 *      SOCIETYER_GOLDEN_OCR_RUN=/path/run.json   # a CLI run.json whose files[].localPath point at the originals
 *      npx tsx scripts/check-intake-ocr.ts [--verbose]
 *    Reports printed-text recall, page confidence, rotation, classification, field accuracy, PII
 *    leaks, and how many wrong values would be bulk-accepted (must be 0).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finalizeBlocks, type IntakeExtract } from "../shared/intake/blocks";
import { classifyPrior } from "../shared/intake/classify";
import { extractBytes, sniffExtension } from "../shared/intake/extract";
import { applyOcrConfidence, cleanRecognition, compactOcrSummary, isDocumentImage, itemsFromRecognition, OcrPageBudget, recognitionQuality, type OcrEngine, type OcrHost, type OcrRecognition } from "../shared/intake/extract/ocr";
import { recognitionFromTesseractBlocks } from "../shared/intake/extract/ocrTesseract";
import { linesFromItems } from "../shared/intake/extract/pdf";
import { extractForClass } from "../shared/intake/extractors";
import { extractMeetingMinutes } from "../shared/intake/minutes/extractMinutes";
import { createNodeOcrHost, recognitionFromTsv, type NodeOcrHost } from "../shared/intake/node/ocr";
import { runIntakePipeline, type PipelineSourceFile } from "../shared/intake/pipeline";
import { thresholdFor } from "../shared/intake/review";
import { runCheck, type ClassGoldenDoc } from "../shared/intake/evalClasses";
import { verifyRecord } from "../shared/intake/verify";
import { buildScannedPdf } from "./lib/intake-ocr-fixtures";

const verbose = process.argv.includes("--verbose");
const fixtures = path.resolve("tests/fixtures/intake/ocr");
const read = (name: string) => new Uint8Array(fs.readFileSync(path.join(fixtures, name)));
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

// ---------------------------------------------------------------- 1. unit checks
const word = (text: string, confidence: number, x0: number, line: number, width = 60) => ({ text, confidence, bbox: { x0, y0: 100 + line * 50, x1: x0 + width, y1: 130 + line * 50 }, line });
const noisy: OcrRecognition = { width: 2550, height: 3300, words: [
  word("Present:", 95, 100, 0, 120), word("Avery", 96, 600, 0), word("Quill,", 96, 670, 0), word("Robin", 95, 740, 0), word("Vale", 96, 810, 0), word("|", 70, 2300, 0, 6), word("oo", 2, 2400, 0, 30),
  word("1.", 0, 100, 1, 25), word("Call", 90, 140, 1), word("to", 95, 210, 1, 25), word("Order", 92, 245, 1), word("--Avery", 15, 330, 1, 90),
] };
const cleaned = cleanRecognition(noisy);
assert.deepEqual(cleaned.words.map((entry) => entry.text), ["Present:", "Avery", "Quill,", "Robin", "Vale", "1.", "Call", "to", "Order", "Avery"], "stray marks dropped, item numbers kept, smeared prefix cut");
const lines = linesFromItems(itemsFromRecognition(cleaned, 300 / 72));
assert.equal(lines[0].text, "Present:\tAvery Quill, Robin Vale", "a wide gap between OCR words becomes a TAB column, adjacent words a space");
assert.equal(lines[1].text, "1. Call to Order Avery");
assert.ok(recognitionQuality(cleaned).meanConfidence > 50 && recognitionQuality(cleaned).goodWords >= 6);
// System tesseract TSV and tesseract.js blocks map to the same words.
const tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n1\t1\t0\t0\t0\t0\t0\t0\t2550\t3300\t-1\t\n5\t1\t1\t1\t1\t1\t100\t100\t120\t30\t95.5\tPresent:\n5\t1\t1\t1\t1\t2\t600\t100\t60\t30\t96.1\tAvery\n5\t1\t1\t1\t2\t1\t100\t150\t60\t30\t91\tDate:\n";
const fromTsv = recognitionFromTsv(tsv, { width: 2550, height: 3300 });
assert.deepEqual(fromTsv.words.map((entry) => [entry.text, entry.line]), [["Present:", 0], ["Avery", 0], ["Date:", 1]]);
const fromBlocks = recognitionFromTesseractBlocks([{ paragraphs: [{ lines: [{ words: [{ text: "Present:", confidence: 95, bbox: { x0: 100, y0: 100, x1: 220, y1: 130 } }, { text: "Avery", confidence: 96, bbox: { x0: 600, y0: 100, x1: 660, y1: 130 } }] }, { words: [{ text: "Date:", confidence: 91, bbox: { x0: 100, y0: 150, x1: 160, y1: 180 } }] }] }] }], { width: 0, height: 0 });
assert.deepEqual(fromBlocks.words.map((entry) => [entry.text, entry.line]), [["Present:", 0], ["Avery", 0], ["Date:", 1]]);
assert.ok(fromBlocks.height > 180, "image size falls back to the word extent");
// Field confidence after OCR: an uncertain quoted word or a low-confidence page keeps a value below every threshold.
{
  const { blocks } = finalizeBlocks([
    { kind: "paragraph", text: "Chair: Avery Quill", page: 1, ocr: { confidence: 0.93, lowWords: ["Quill"] } },
    { kind: "paragraph", text: "Location: Northport Civic Centre", page: 1, ocr: { confidence: 0.62 } },
    { kind: "paragraph", text: "Date: March 18, 2025", page: 1, ocr: { confidence: 0.95 } },
  ]);
  const record = {
    chair: { value: { nameAsWritten: "Avery Quill" }, status: "stated", confidence: 0.9, locators: [{ kind: "block", blockIndex: 0, quote: "Avery Quill" }] },
    location: { value: "Northport Civic Centre", status: "stated", confidence: 0.8, locators: [{ kind: "block", blockIndex: 1, quote: "Northport Civic Centre" }] },
    date: { value: { iso: "2025-03-18", precision: "day" }, status: "stated", confidence: 0.95, locators: [{ kind: "block", blockIndex: 2, quote: "March 18, 2025" }] },
  } as any;
  assert.equal(applyOcrConfidence(record, { blocks }), 2);
  assert.equal(record.chair.confidence, 0.5);
  assert.match(record.chair.note, /OCR read "Quill" with low confidence/);
  assert.equal(record.location.confidence, 0.6);
  assert.ok(record.date.confidence >= 0.9 && /OCR \(95% confidence\)/.test(record.date.note), "good OCR keeps the value bulk-eligible and says it was read by OCR");
  assert.equal(applyOcrConfidence({ x: record.date }, { blocks: finalizeBlocks([{ kind: "paragraph", text: "x" }]).blocks }), 0, "text-layer extracts are untouched");
}
assert.ok(isDocumentImage("2025 Consent to Act - Robin Vale (scan).png") && isDocumentImage("Scan_20151117.jpg") && isDocumentImage("IMG_0042.jpg", "Board/Signed forms/IMG_0042.jpg"));
assert.ok(!isDocumentImage("Clean Air Day group photo.jpg") && !isDocumentImage("PGAIR logo.png") && !isDocumentImage("IMG_0042.jpg", "Outreach/Photos/IMG_0042.jpg") && !isDocumentImage("DSC_0193.JPG"));
const budget = new OcrPageBudget(2);
assert.ok(budget.take() && budget.take() && !budget.take() && budget.exhausted);
assert.equal(sniffExtension(new TextEncoder().encode("%PDF-1.4 …")), "pdf");
assert.equal(sniffExtension(read("2024-2025 Budget.xls")), "xls");
assert.equal(sniffExtension(read("Board Orientation 2025.ppt")), "ppt");
assert.equal(sniffExtension(read("Board Orientation 2025.pptx")), "pptx");
assert.equal(sniffExtension(read("2025 Consent to Act - Robin Vale (scan).png")), "png");
assert.equal(sniffExtension(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])), "jpg");
assert.equal(sniffExtension(new TextEncoder().encode("Plain notes\nline two\n")), "txt");

// ---------------------------------------------------------------- 2. OCR on the synthetic scans
const started = Date.now();
const host: NodeOcrHost = await createNodeOcrHost({ engine: "tesseract.js", concurrency: 1 });
try {
  const scan = await extractBytes("2025-03-18 Board Minutes (scan).pdf", read("2025-03-18 Board Minutes (scan).pdf"), { ocr: host });
  assert.equal(scan.method, "ocr", "every page of an image-only PDF is read by OCR");
  assert.equal(scan.ocr?.pages.length, 2);
  assert.equal(scan.ocr?.pages[0].rotation, 0);
  assert.ok(scan.ocr?.pages[1].rotation === 90 || scan.ocr?.pages[1].rotation === 270, "the sideways sheet is turned upright");
  for (const page of scan.ocr!.pages) assert.ok(page.confidence > 0.85 && page.lines!.length > 3 && page.lines![0].words!.length > 0, `page ${page.page} confidence ${page.confidence}`);
  assert.deepEqual(scan.emptyPages, []);
  for (const phrase of ["Board of Directors Meeting Minutes", "Date:\tMarch 18, 2025", "Chair:\tAvery Quill", "MOTION: To adopt the minutes of February 18, 2025 as presented.", "Moved by Morgan Reyes, seconded by Robin Vale. CARRIED.", "ACTION: Jordan Pike to circulate the quarterly data summary.", "The meeting adjourned at 7:45 PM."]) {
    assert.ok(scan.text.includes(phrase), `OCR text has ${JSON.stringify(phrase)}`);
  }
  assert.ok(scan.blocks.filter((block) => block.kind !== "page_break").every((block) => block.ocr && block.ocr.confidence > 0.7), "every OCR block carries its confidence");
  assert.ok(scan.blocks.some((block) => block.page === 2 && /adjourned/.test(block.text)), "page numbers are kept");
  assert.ok(scan.warnings.some((warning) => /OCR read page\(s\) 1, 2/.test(warning)));
  assert.ok(compactOcrSummary(scan.ocr!).pages.every((page) => !page.lines), "workspace rows keep page summaries without line boxes");
  // The minutes extractor reads the OCR text; every quote re-verifies against it.
  const minutes = extractMeetingMinutes({ fileId: "ocr-fixture", fileName: "2025-03-18 Board Minutes (scan).pdf", extract: scan });
  const verification = verifyRecord(minutes.record, scan);
  applyOcrConfidence(minutes.record, scan);
  const record = minutes.record as any;
  assert.equal(verification.mismatched + verification.invalid, 0, "OCR quotes re-verify");
  assert.equal(record.date.value.iso, "2025-03-18");
  assert.equal(record.startTime.value, "18:00");
  assert.equal(record.endTime.value, "19:45");
  assert.equal(record.chair.value.nameAsWritten, "Avery Quill");
  assert.ok(record.chair.confidence >= 0.85, `a clearly read chair stays bulk-eligible: ${JSON.stringify(record.chair)}`);
  assert.equal(record.motions.length, 2);
  assert.equal(record.motions[1].movedBy.value.nameAsWritten, "Morgan Reyes");
  assert.equal(record.motions[1].adoptsMinutesOf.value.date, "2025-02-18");
  assert.ok(record.attendance.some((entry: any) => entry.nameAsWritten.value === "Casey Lund" && entry.category.value === "regrets"));
  assert.equal(record.adjournedAt.value, "19:45");
  assert.equal(record.nextMeeting.value.date, "2025-04-15");
  assert.ok(record.actionItems.some((item: any) => item.assigneeAsWritten?.value === "Jordan Pike"));

  // The page budget stops OCR; unread pages stay listed for OCR.
  const limited = await extractBytes("scan.pdf", read("2025-03-18 Board Minutes (scan).pdf"), { ocr: { ...host, budget: new OcrPageBudget(1) } });
  assert.equal(limited.method, "pdfjs-text+ocr");
  assert.deepEqual(limited.emptyPages, [2]);
  assert.ok(limited.warnings.some((warning) => /OCR skipped page\(s\) 2: the run's OCR page budget \(1 pages\) is used up/.test(warning)));

  // A low-confidence engine result: values read from it are never bulk-eligible.
  const smudged: OcrEngine = { name: "fake-low", recognize: async (image) => ({ width: image.width, height: image.height, words: [
    word("Date:", 52, 300, 0, 110), word("March", 48, 900, 0, 120), word("18,", 55, 1030, 0, 50), word("2025", 50, 1090, 0, 90),
    word("Chair:", 50, 300, 1, 120), word("Avery", 45, 900, 1, 110), word("Quill", 41, 1020, 1, 100),
  ].map((entry) => ({ ...entry, bbox: { ...entry.bbox, y0: entry.bbox.y0 + 400, y1: entry.bbox.y1 + 400 } })) }) };
  const blank = await buildScannedPdf([{ bytes: (await import("@napi-rs/canvas")).createCanvas(850, 1100).toBuffer("image/jpeg"), width: 850, height: 1100 }]);
  const smudgedHost: OcrHost = { ...host, engine: smudged, budget: undefined };
  const lowExtract = await extractBytes("2025-03-18 Board Minutes.pdf", blank, { ocr: smudgedHost });
  assert.ok(lowExtract.ocr!.pages[0].confidence < 0.6);
  const lowMinutes = extractMeetingMinutes({ fileId: "low", fileName: "2025-03-18 Board Minutes.pdf", extract: lowExtract });
  verifyRecord(lowMinutes.record, lowExtract);
  applyOcrConfidence(lowMinutes.record, lowExtract);
  const low = lowMinutes.record as any;
  assert.ok(low.date && low.date.confidence <= 0.6 && low.date.confidence < thresholdFor("meetingMinutes", "date"), "a date from a smudged page stays below the bulk-accept threshold");
  assert.ok(!low.chair || low.chair.confidence <= 0.6);

  // A scanned consent form saved as an image is read and extracted.
  const consent = await extractBytes("2025 Consent to Act - Robin Vale (scan).png", read("2025 Consent to Act - Robin Vale (scan).png"), { ocr: host });
  assert.equal(consent.method, "ocr");
  assert.ok(consent.text.includes("I, Robin Vale, consent to act as a director of"));
  // A picture with no text is catalogued as an image, not a document.
  const { createCanvas } = await import("@napi-rs/canvas");
  const photoCanvas = createCanvas(600, 400);
  const photo = photoCanvas.getContext("2d");
  photo.fillStyle = "#6a8caf";
  photo.fillRect(0, 0, 600, 400);
  photo.fillStyle = "#2e7d32";
  photo.fillRect(0, 260, 600, 140);
  const notDocument = await extractBytes("Scan_0001.png", new Uint8Array(photoCanvas.toBuffer("image/png")), { ocr: host });
  assert.equal(notDocument.method, "unsupported");
  assert.match(notDocument.warnings[0], /Image without readable document text/);
  // Without OCR (no host), scans and images stay catalogued with the reason.
  assert.match((await extractBytes("scan.pdf", read("2025-03-18 Board Minutes (scan).pdf"))).warnings.join(" "), /No text layer on page\(s\) 1, 2; OCR required/);
  assert.match((await extractBytes("form.png", read("2025 Consent to Act - Robin Vale (scan).png"))).warnings[0], /OCR is not enabled/);

  // End to end: the pipeline extracts the scan and the image, classifies the image by its name and text, and stages records.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "societyer-ocr-gate-"));
  try {
    for (const name of fs.readdirSync(fixtures)) fs.copyFileSync(path.join(fixtures, name), path.join(dir, name));
    fs.writeFileSync(path.join(dir, "Clean Air Day group photo.jpg"), photoCanvas.toBuffer("image/jpeg"));
    fs.writeFileSync(path.join(dir, "PM25 station report"), "Report Type : StationReport <table><tr><th>Date</th><th>PM25</th></tr><tr><td>2013-01-01</td><td>12.4</td></tr></table>");
    const files: PipelineSourceFile[] = fs.readdirSync(dir).sort().map((name) => ({ fileKey: `local:${name}`, name, path: name, sizeBytes: fs.statSync(path.join(dir, name)).size, acquisitionStatus: "local", read: async () => new Uint8Array(fs.readFileSync(path.join(dir, name))) }));
    const result = await runIntakePipeline(files, { name: "ocr gate", sourceKind: "local_folder", sourceRoot: dir, ocrImages: true, asOfISO: "2026-01-01", organizationName: "Lakeside Clean Air Society", extract: (file, bytes) => extractBytes(file.name, bytes, { ocr: host }) });
    const byName = new Map(result.files.map((file) => [file.name, file]));
    assert.equal(byName.get("2025-03-18 Board Minutes (scan).pdf")?.extractMethod, "ocr");
    assert.equal(byName.get("2025-03-18 Board Minutes (scan).pdf")?.classification?.docClass, "meetingMinutes");
    assert.equal(byName.get("2025 Consent to Act - Robin Vale (scan).png")?.disposition, "extract");
    assert.equal(byName.get("2025 Consent to Act - Robin Vale (scan).png")?.classification?.docClass, "directorConsent", "an OCR'd image is classified by its name and text");
    assert.equal(byName.get("Clean Air Day group photo.jpg")?.disposition, "catalogue", "photos are not OCR'd");
    assert.equal(byName.get("PM25 station report")?.extractMethod, "plain-text", "a file without an extension is identified from its bytes");
    assert.equal(byName.get("2024-2025 Budget.xls")?.extractMethod === "xls-biff8" || byName.get("2024-2025 Budget.xls")?.extractMethod === "libreoffice-xlsx", true);
    const consentExtraction = result.extractions.find((extraction) => extraction.fileKey === "local:2025 Consent to Act - Robin Vale (scan).png");
    assert.ok(consentExtraction, "the consent image is extracted");
    const entry = (consentExtraction!.record as any).entries?.[0];
    assert.equal(entry?.person?.value?.nameAsWritten, "Robin Vale");
    assert.equal(entry?.signedDate?.value?.iso, "2025-05-20");
    const minutesExtraction = result.extractions.find((extraction) => extraction.fileKey === "local:2025-03-18 Board Minutes (scan).pdf");
    assert.equal((minutesExtraction!.record as any).motions.length, 2);
    assert.equal((minutesExtraction!.verification?.mismatched ?? 0) + (minutesExtraction!.verification?.invalid ?? 0), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
} finally {
  await host.terminate();
}
const ocrSeconds = Math.round((Date.now() - started) / 1000);

// ---------------------------------------------------------------- 3. native legacy readers
const xls = await extractBytes("2024-2025 Budget.xls", read("2024-2025 Budget.xls"));
assert.equal(xls.method, "xls-biff8");
const xlsTable = xls.blocks.find((block) => block.kind === "table")!;
const cell = (ref: string) => xlsTable.rows!.flatMap((row) => row.cells).find((candidate) => candidate.cell === ref)?.text;
assert.equal(cell("A6"), "Coordinator – part time", "shared strings decode 16-bit text");
assert.equal(cell("C4"), "47250.5");
assert.equal(cell("B6"), "-21000");
assert.equal(cell("B9"), "2024-03-12", "a date-formatted cell reads as an ISO date");
const budgetExtraction = extractForClass("budget", { fileId: "xls", fileName: "2024-2025 Budget.xls", extract: xls, asOfISO: "2026-01-01" });
assert.ok(((budgetExtraction?.record as any)?.lines ?? []).length >= 4, "the budget extractor reads the legacy workbook");
const ppt = await extractBytes("Board Orientation 2025.ppt", read("Board Orientation 2025.ppt"));
assert.equal(ppt.method, "ppt-binary");
assert.deepEqual(ppt.blocks.filter((block) => block.kind === "heading" && /^Slide/.test(block.text)).map((block) => block.text), ["Slide 1", "Slide 2"]);
assert.ok(ppt.blocks.some((block) => block.part === "notes" && block.page === 1 && /Welcome new directors/.test(block.text)), "speaker notes belong to their slide");
const pptx = await extractBytes("Board Orientation 2025.pptx", read("Board Orientation 2025.pptx"));
assert.equal(pptx.method, "pptx-ooxml");
assert.ok(pptx.blocks.some((block) => block.kind === "table" && block.text.includes("Treasurer\tMorgan Reyes")));
const xps = await extractBytes("2025-02-11 Executive Committee Minutes.xps", read("2025-02-11 Executive Committee Minutes.xps"));
assert.equal(xps.method, "xps-fixedpage");
assert.ok(xps.text.includes("Present:\tAvery Quill, Morgan Reyes, Robin Vale"));
const xpsMinutes = extractMeetingMinutes({ fileId: "xps", fileName: "2025-02-11 Executive Committee Minutes.xps", extract: xps }).record as any;
assert.equal(xpsMinutes.date.value.iso, "2025-02-11");
assert.equal(xpsMinutes.motions[0].secondedBy.value.nameAsWritten, "Robin Vale");
const htmlXls = await extractBytes("PM2.5 2013.xls", new TextEncoder().encode("Report Type : StationReport  <table><tr><td>Date</td><td>PM25</td></tr><tr><td>2013-01-01</td><td>12.4</td></tr></table>"));
assert.ok(htmlXls.blocks.some((block) => block.kind === "table" && block.text === "Date\tPM25\n2013-01-01\t12.4"), "an HTML table saved as .xls stays a table");
console.log(`PASS intake OCR: synthetic scans read offline (rotation, page budget, confidence caps, ${ocrSeconds} s), images classified as documents or photos, legacy .xls/.ppt/.pptx/.xps and extensionless files read natively`);

// ---------------------------------------------------------------- 4. private OCR golden set
const goldenPath = process.env.SOCIETYER_GOLDEN_SET_OCR;
if (goldenPath) {
  type OcrGoldenDoc = ClassGoldenDoc & { pages?: number; rotatedPages?: number[]; handwritten?: boolean; textChecks?: string[]; source: ClassGoldenDoc["source"] & { sha256?: string } };
  const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8")) as { asOfISO?: string; organizationName?: string; documents: OcrGoldenDoc[] };
  const runPath = process.env.SOCIETYER_GOLDEN_OCR_RUN ?? path.resolve(path.dirname(goldenPath), "../retrans/run8/run.json");
  const run = JSON.parse(fs.readFileSync(runPath, "utf8")) as { files: Array<{ sha256?: string; localPath?: string }> };
  const local = new Map(run.files.filter((file) => file.sha256 && file.localPath).map((file) => [file.sha256!, file.localPath!]));
  const privateHost = await createNodeOcrHost({ concurrency: 2 });
  const normalize = (value: string) => value.toLowerCase().replace(/[‘’`]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9$'".,:/&%-]+/g, " ").replace(/\s+/g, " ").trim();
  const totals = { docs: 0, phrases: 0, phrasesRead: 0, checks: 0, passed: 0, handwrittenChecks: 0, handwrittenPassed: 0, classified: 0, rotations: 0, rotationsFound: 0, bulkWrong: 0, leaks: 0, quotes: 0, badQuotes: 0, pages: 0, confidence: 0, seconds: 0 };
  try {
    for (const doc of golden.documents) {
      const file = doc.source.sha256 ? local.get(doc.source.sha256) : undefined;
      if (!file || !fs.existsSync(file)) {
        console.warn(`  ${doc.id}: original not found; skipped.`);
        continue;
      }
      const t0 = Date.now();
      const extract = await extractBytes(doc.source.fileName, new Uint8Array(fs.readFileSync(file)), { ocr: privateHost }) as IntakeExtract;
      totals.seconds += (Date.now() - t0) / 1000;
      totals.docs += 1;
      const text = normalize(extract.text.replace(/\t/g, " "));
      const missed = (doc.textChecks ?? []).filter((phrase) => !text.includes(normalize(phrase)));
      totals.phrases += doc.textChecks?.length ?? 0;
      totals.phrasesRead += (doc.textChecks?.length ?? 0) - missed.length;
      for (const page of extract.ocr?.pages ?? []) {
        totals.pages += 1;
        totals.confidence += page.confidence;
      }
      for (const pageNumber of doc.rotatedPages ?? []) {
        totals.rotations += 1;
        if ((extract.ocr?.pages.find((page) => page.page === pageNumber)?.rotation ?? 0) !== 0) totals.rotationsFound += 1;
      }
      const predicted = classifyPrior({ name: doc.source.fileName, path: doc.source.path, headText: extract.text.slice(0, 3000) }).docClass;
      if (predicted === doc.docClass) totals.classified += 1;
      const envelope = doc.docClass === "meetingMinutes" ? extractMeetingMinutes({ fileId: doc.id, fileName: doc.source.fileName, extract }) : extractForClass(doc.docClass, { fileId: doc.id, fileName: doc.source.fileName, path: doc.source.path, extract, asOfISO: golden.asOfISO, organizationName: golden.organizationName });
      const verification = envelope ? verifyRecord(envelope.record, extract) : undefined;
      if (envelope) applyOcrConfidence(envelope.record, extract);
      totals.quotes += verification?.quoted ?? 0;
      totals.badQuotes += (verification?.mismatched ?? 0) + (verification?.invalid ?? 0);
      const failures: string[] = [];
      for (const check of doc.expect) {
        const handwritten = check.why === "handwritten";
        const result = envelope ? runCheck({ ...envelope.record, unsupported: envelope.unsupported, references: envelope.references }, check) : { ok: false, actual: undefined };
        totals.checks += 1;
        if (handwritten) totals.handwrittenChecks += 1;
        if (result.ok) {
          totals.passed += 1;
          if (handwritten) totals.handwrittenPassed += 1;
          continue;
        }
        failures.push(`${check.path}: expected ${JSON.stringify(check.equals ?? check.includes ?? check.contains ?? check.minCount)} got ${JSON.stringify(result.actual)?.slice(0, 80)}${handwritten ? " (handwritten)" : ""}`);
        // A wrong value that bulk-accept would take is the failure that matters.
        const field = envelope ? fieldAtPath(envelope.record, check.path) : undefined;
        if (field && result.actual !== undefined && field.status === "stated" && (field.verification === "verified_span" || field.verification === "verified_fuzzy") && field.confidence >= thresholdFor(doc.docClass, field.pattern)) {
          totals.bulkWrong += 1;
          failures.push(`  ^ would be bulk-accepted (confidence ${field.confidence})`);
        }
      }
      const leaks = (doc.forbidText ?? []).filter((value) => envelope && JSON.stringify(envelope).toLowerCase().includes(value.toLowerCase()));
      totals.leaks += leaks.length;
      const pages = extract.ocr?.pages ?? [];
      console.log(`  ${doc.id} ${doc.docClass}${doc.handwritten ? " (handwritten)" : ""}: ${extract.method}, ${pages.length} OCR page(s) at ${pages.map((page) => `${Math.round(page.confidence * 100)}%${page.rotation ? `/${page.rotation}°` : ""}`).join(" ")}; text ${(doc.textChecks?.length ?? 0) - missed.length}/${doc.textChecks?.length ?? 0}; classified ${predicted}${predicted === doc.docClass ? "" : " (expected " + doc.docClass + ")"}; fields ${doc.expect.length - failures.filter((line) => !line.startsWith("  ^")).length}/${doc.expect.length}${leaks.length ? `; PII LEAK ${leaks.join(", ")}` : ""}`);
      if (verbose || failures.length) for (const failure of failures) console.log(`      ${failure}`);
      if (verbose) for (const phrase of missed) console.log(`      text missed: ${JSON.stringify(phrase)}`);
    }
  } finally {
    await privateHost.terminate();
  }
  console.log(`golden OCR (${totals.docs} docs, ${totals.pages} pages, ${Math.round(totals.seconds)} s): printed text ${totals.phrasesRead}/${totals.phrases} ${pct(totals.phrasesRead / Math.max(1, totals.phrases))} | mean page confidence ${pct(totals.confidence / Math.max(1, totals.pages))} | rotation ${totals.rotationsFound}/${totals.rotations} | classification ${totals.classified}/${totals.docs} | fields ${totals.passed}/${totals.checks} ${pct(totals.passed / Math.max(1, totals.checks))} (printed ${totals.passed - totals.handwrittenPassed}/${totals.checks - totals.handwrittenChecks}, handwritten ${totals.handwrittenPassed}/${totals.handwrittenChecks}) | bulk-wrong ${totals.bulkWrong} | PII leaks ${totals.leaks} | hallucination ${pct(totals.badQuotes / Math.max(1, totals.quotes))} of ${totals.quotes}`);
  assert.equal(totals.bulkWrong, 0, "no wrong OCR value may be bulk-accepted");
  assert.equal(totals.leaks, 0, "no contact data from OCR text reaches an extraction");
  assert.equal(totals.badQuotes, 0, "OCR quotes re-verify");
} else {
  console.log("SOCIETYER_GOLDEN_SET_OCR not set: private OCR golden set skipped (synthetic scans graded).");
}

/** The FieldValue a check path ends on (indices dropped for the threshold pattern). */
function fieldAtPath(record: unknown, checkPath: string): { status: string; confidence: number; verification?: string; pattern: string } | undefined {
  let node: any = record;
  const parts: string[] = [];
  let found: any;
  for (const part of checkPath.split(".")) {
    const match = /^([^[\]]+)((?:\[(?:\d+|\*)\])*)$/.exec(part);
    if (!match || node === undefined || node === null) return undefined;
    if (node && typeof node === "object" && "status" in node && "locators" in node) {
      found = { ...node, pattern: parts.join(".") };
      node = node.value;
    }
    node = node?.[match[1]];
    parts.push(match[1]);
    for (const index of match[2].match(/\[(\d+|\*)\]/g) ?? []) node = Array.isArray(node) ? node[index === "[*]" ? 0 : Number(index.slice(1, -1))] : undefined;
  }
  if (node && typeof node === "object" && "status" in node && "locators" in node) return { ...node, pattern: parts.join(".") };
  return found;
}
