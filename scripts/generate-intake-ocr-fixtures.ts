/** Writes the committed synthetic OCR and legacy-Office fixtures to tests/fixtures/intake/ocr/.
 * Needs @napi-rs/canvas (DejaVu Sans) and LibreOffice for the .xls/.ppt conversions.
 *
 *   npx tsx scripts/generate-intake-ocr-fixtures.ts
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildConsentScanPng, buildPptx, buildScannedMinutesPdf, buildXps } from "./lib/intake-ocr-fixtures";

const out = path.resolve("tests/fixtures/intake/ocr");
fs.mkdirSync(out, { recursive: true });
const write = (name: string, bytes: Uint8Array) => {
  fs.writeFileSync(path.join(out, name), bytes);
  console.log(`${name}: ${bytes.byteLength} bytes`);
};

write("2025-03-18 Board Minutes (scan).pdf", await buildScannedMinutesPdf());
write("2025 Consent to Act - Robin Vale (scan).png", await buildConsentScanPng());
const pptx = await buildPptx([
  { title: "Board Orientation 2025", body: ["Lakeside Clean Air Society", "Prepared for new directors"], notes: "Welcome new directors and introduce the officers." },
  { title: "Officers", body: ["The board elects its officers each year."], table: [["Office", "Holder"], ["Chair", "Avery Quill"], ["Treasurer", "Morgan Reyes"]] },
]);
write("Board Orientation 2025.pptx", pptx);
write("2025-02-11 Executive Committee Minutes.xps", await buildXps([[
  { x: 96, y: 96, text: "Lakeside Clean Air Society", size: 20 },
  { x: 96, y: 130, text: "Executive Committee Minutes", size: 18 },
  { x: 96, y: 170, text: "Date:" }, { x: 240, y: 170, text: "February 11, 2025" },
  { x: 96, y: 195, text: "Present:" }, { x: 240, y: 195, text: "Avery Quill, Morgan Reyes, Robin Vale" },
  { x: 96, y: 240, text: "MOTION: To accept the January financial report." },
  { x: 96, y: 262, text: "Moved by Morgan Reyes, seconded by Robin Vale. CARRIED." },
  { x: 96, y: 300, text: "The meeting adjourned at 1:05 PM." },
]]));

// Legacy binaries through LibreOffice (a CSV gives a date-formatted cell and shared strings).
const work = fs.mkdtempSync(path.join(os.tmpdir(), "societyer-ocr-fixtures-"));
try {
  const csv = path.join(work, "2024-2025 Budget.csv");
  fs.writeFileSync(csv, [
    "Lakeside Clean Air Society,,",
    "Budget 2024-2025,,",
    "Line,Budget,Actual",
    "Grants received,45000,47250.5",
    "Memberships,3200,2980",
    "Coordinator – part time,-21000,-20500",
    "Monitoring equipment,-18500,-17325.75",
    "Total,8700,12404.75",
    "Approved,2024-03-12,",
  ].join("\n"));
  const profile = `-env:UserInstallation=file://${path.join(work, "profile")}`;
  execFileSync("soffice", [profile, "--headless", "--infilter=CSV:44,34,76,1", "--convert-to", "xls", "--outdir", work, csv], { stdio: "ignore", timeout: 120000 });
  write("2024-2025 Budget.xls", new Uint8Array(fs.readFileSync(path.join(work, "2024-2025 Budget.xls"))));
  const pptxPath = path.join(work, "Board Orientation 2025.pptx");
  fs.writeFileSync(pptxPath, pptx);
  execFileSync("soffice", [profile, "--headless", "--convert-to", "ppt", "--outdir", work, pptxPath], { stdio: "ignore", timeout: 120000 });
  write("Board Orientation 2025.ppt", new Uint8Array(fs.readFileSync(path.join(work, "Board Orientation 2025.ppt"))));
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
