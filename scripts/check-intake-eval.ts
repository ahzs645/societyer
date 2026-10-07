/** Intake extraction evaluation gate (design §4.5).
 *
 * Always grades the committed SYNTHETIC golden fixture (tests/fixtures/intake)
 * and fails when quality regresses. Optionally grades a private golden set:
 *
 *   SOCIETYER_GOLDEN_SET=/path/golden-set.json \
 *   SOCIETYER_GOLDEN_FILES=/path/files            # <shaDir>/<original file>
 *   SOCIETYER_GOLDEN_HOLDOUT=G03,G07,G11,G14       # documents never used for tuning
 *   npx tsx scripts/check-intake-eval.ts [--verbose] [--json out.json] [--engine deterministic|llm]
 *
 * The private golden set names real people; it is read from outside the
 * repository and never copied into it. Metrics: motion recall/precision,
 * mover/seconder/outcome accuracy, attendance precision/recall and category
 * accuracy, header-field accuracy, action items, and the hallucination rate
 * (share of quoted locators that fail span re-verification).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { aggregate, calibrationItems, predictedFromRecord, scoreDocument, summarizeCalibration, type Aggregate, type CalibrationItem, type DocScore, type GoldenSet } from "../shared/intake/eval";
import { thresholdFor } from "../shared/intake/review";
import { extractFile } from "../shared/intake/node/extractFile";
import { extractMeetingMinutes } from "../shared/intake/minutes/extractMinutes";
import { validateExtraction } from "../shared/intake/schemas";
import { verifyRecord } from "../shared/intake/verify";
import { writeSyntheticFixtures } from "./lib/intake-synthetic-fixtures";

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;

async function gradeSet(label: string, golden: GoldenSet, fileFor: (doc: GoldenSet["documents"][number]) => string | undefined): Promise<{ scores: DocScore[]; dev: Aggregate; holdout: Aggregate; all: Aggregate; calibration: CalibrationItem[] }> {
  const scores: DocScore[] = [];
  const calibration: CalibrationItem[] = [];
  for (const doc of golden.documents) {
    if (!doc.meeting) continue; // packages/agendas are graded elsewhere
    const file = fileFor(doc);
    if (!file || !fs.existsSync(file)) {
      console.warn(`[${label}] ${doc.id}: source file not found; skipped.`);
      continue;
    }
    const extract = await extractFile(file);
    const envelope = extractMeetingMinutes({ fileId: `golden:${doc.id}`, fileName: doc.source.fileName, extract });
    const validation = validateExtraction(envelope);
    assert.ok(validation.ok, `${doc.id}: extraction does not satisfy the schema: ${validation.issues.slice(0, 5).join("; ")}`);
    const verification = verifyRecord(envelope.record, extract);
    const score = scoreDocument(doc, predictedFromRecord(envelope.record), verification);
    scores.push(score);
    calibration.push(...calibrationItems(doc, envelope.record, (pattern) => thresholdFor("meetingMinutes", pattern)));
    if (verbose) printDoc(score);
  }
  const all = aggregate(scores);
  return { scores, all, dev: aggregate(scores.filter((score) => !score.holdout)), holdout: aggregate(scores.filter((score) => score.holdout)), calibration };
}

/** Bulk-accept calibration: how many values of each field would be bulk-accepted, and how many of those are wrong. */
function printCalibration(label: string, items: CalibrationItem[]) {
  const summary = summarizeCalibration(items);
  console.log(`${label} bulk-accept calibration: ${Object.entries(summary).map(([field, row]) => `${field} ${row.eligibleCorrect}/${row.expected} bulk-correct, ${row.eligibleWrong} bulk-wrong, ${row.correctBelowThreshold} correct below τ`).join(" | ")}`);
  if (verbose) for (const item of items) console.log(`    ${item.docId} ${item.field}: expected ${JSON.stringify(item.expected)} got ${JSON.stringify(item.predicted)} conf ${item.confidence ?? "-"} ${item.eligible ? "BULK" : "below"} ${item.correct ? "ok" : "WRONG"}${item.note ? ` (${item.note.slice(0, 60)})` : ""}`);
  return summary;
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
function printDoc(score: DocScore) {
  const m = score.motions, a = score.attendance;
  console.log(`  ${score.id}${score.holdout ? " (holdout)" : ""}: motions ${m.tp}/${m.tp + m.fn} (+${m.fp} extra) mover ${m.moverCorrect}/${m.moverChecked} seconder ${m.seconderCorrect}/${m.seconderChecked} outcome ${m.outcomeCorrect}/${m.outcomeChecked} | attendance ${a.tp}/${a.tp + a.fn} (+${a.fp}) cat ${a.categoryCorrect}/${a.categoryChecked} | header ${score.header.correct}/${score.header.checked} | tasks ${score.tasks.tp}/${score.tasks.tp + score.tasks.fn} (+${score.tasks.fp}) | hallucination ${score.verification ? `${score.verification.mismatched + score.verification.invalid}/${score.verification.quoted}` : "-"}`);
  for (const miss of m.misses) console.log(`      motion miss: ${miss.slice(0, 110)}`);
  for (const extra of m.extras) console.log(`      motion extra: ${extra.slice(0, 110)}`);
  for (const miss of a.misses) console.log(`      attendance miss: ${miss}`);
  for (const extra of a.extras) console.log(`      attendance extra: ${extra}`);
  for (const [field, result] of Object.entries(score.header.fields)) if (!result.ok) console.log(`      header ${field}: expected ${JSON.stringify(result.expected)} got ${JSON.stringify(result.predicted)}`);
  for (const mismatch of score.verification?.mismatches ?? []) console.log(`      span mismatch at ${mismatch.path}: ${JSON.stringify(mismatch.quote?.slice(0, 80))}`);
}
function printAggregate(label: string, value: Aggregate) {
  if (!value.documents) return;
  console.log(`${label} (${value.documents} docs): motion recall ${pct(value.motionRecall)} precision ${pct(value.motionPrecision)} | mover ${pct(value.moverAccuracy)} seconder ${pct(value.seconderAccuracy)} outcome ${pct(value.outcomeAccuracy)} | attendance recall ${pct(value.attendanceRecall)} precision ${pct(value.attendancePrecision)} category ${pct(value.attendanceCategoryAccuracy)} attended ${pct(value.attendedAccuracy)} | header ${pct(value.headerAccuracy)} | tasks recall ${pct(value.taskRecall)} precision ${pct(value.taskPrecision)} assignee ${pct(value.taskAssigneeAccuracy)} | hallucination ${pct(value.hallucinationRate)} of ${value.quotedLocators} quotes`);
  console.log(`  header by field: ${Object.entries(value.headerByField).map(([field, rate]) => `${field} ${pct(rate)}`).join(", ")}`);
}

// 1. Synthetic fixture (committed; CI gate).
const keepDir = args.includes("--keep-fixtures") ? args[args.indexOf("--keep-fixtures") + 1] : undefined;
if (keepDir) fs.mkdirSync(keepDir, { recursive: true });
const fixtureDir = keepDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "societyer-intake-eval-"));
const synthetic = await writeSyntheticFixtures(fixtureDir);
const syntheticResult = await gradeSet("synthetic", synthetic.golden, (doc) => synthetic.files[doc.id]);
printAggregate("synthetic", syntheticResult.all);
const syntheticCalibration = printCalibration("synthetic", syntheticResult.calibration);
for (const [field, row] of Object.entries(syntheticCalibration)) assert.equal(row.eligibleWrong, 0, `synthetic: a wrong ${field} would be bulk-accepted`);
const s = syntheticResult.all;
assert.ok(s.documents >= 4, "synthetic fixture documents were graded");
assert.ok(s.motionRecall >= 0.95, `synthetic motion recall ${pct(s.motionRecall)} < 95%`);
assert.ok(s.motionPrecision >= 0.9, `synthetic motion precision ${pct(s.motionPrecision)} < 90%`);
assert.ok(s.moverAccuracy >= 0.9 && s.seconderAccuracy >= 0.9 && s.outcomeAccuracy >= 0.9, "synthetic mover/seconder/outcome accuracy < 90%");
assert.ok(s.attendanceRecall >= 0.9 && s.attendancePrecision >= 0.9, "synthetic attendance precision/recall < 90%");
assert.ok(s.headerAccuracy >= 0.85, `synthetic header accuracy ${pct(s.headerAccuracy)} < 85%`);
assert.ok(s.taskRecall >= 0.8, `synthetic action-item recall ${pct(s.taskRecall)} < 80%`);
assert.equal(s.hallucinationRate, 0, "deterministic extraction quotes must all re-verify");
if (!keepDir) fs.rmSync(fixtureDir, { recursive: true, force: true });

// 2. Private golden set (optional; never committed).
const goldenPath = process.env.SOCIETYER_GOLDEN_SET;
let privateResult: Awaited<ReturnType<typeof gradeSet>> | undefined;
if (goldenPath) {
  const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8")) as GoldenSet;
  const filesDir = process.env.SOCIETYER_GOLDEN_FILES ?? path.resolve(path.dirname(goldenPath), "../drive/ws/files");
  const holdout = new Set((process.env.SOCIETYER_GOLDEN_HOLDOUT ?? "G03,G07,G11,G14").split(",").map((id) => id.trim()).filter(Boolean));
  for (const doc of golden.documents) doc.holdout = holdout.has(doc.id);
  privateResult = await gradeSet("golden", golden, (doc) => {
    const dir = doc.source.shaDir ? path.join(filesDir, String(doc.source.shaDir)) : undefined;
    if (!dir || !fs.existsSync(dir)) return undefined;
    const entries = fs.readdirSync(dir);
    return entries.length ? path.join(dir, entries[0]) : undefined;
  });
  printAggregate("golden (all)", privateResult.all);
  printAggregate("golden (dev)", privateResult.dev);
  printAggregate("golden (holdout)", privateResult.holdout);
  const goldenCalibration = printCalibration("golden", privateResult.calibration);
  // Calibration never trades precision for coverage: no wrong value may be bulk-eligible.
  for (const [field, row] of Object.entries(goldenCalibration)) assert.equal(row.eligibleWrong, 0, `golden: ${row.eligibleWrong} wrong ${field} value(s) would be bulk-accepted`);
  const minRecall = Number(process.env.SOCIETYER_EVAL_MIN_MOTION_RECALL ?? 0);
  if (minRecall) assert.ok(privateResult.all.motionRecall >= minRecall, `golden motion recall ${pct(privateResult.all.motionRecall)} < ${pct(minRecall)}`);
} else {
  console.log("SOCIETYER_GOLDEN_SET not set: private golden set skipped (synthetic fixture graded).");
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ synthetic: syntheticResult, golden: privateResult ? { all: privateResult.all, dev: privateResult.dev, holdout: privateResult.holdout, documents: privateResult.scores.map((score) => ({ ...score, header: { checked: score.header.checked, correct: score.header.correct, fields: Object.fromEntries(Object.entries(score.header.fields).map(([field, result]) => [field, result.ok])) }, verification: score.verification ? { ...score.verification, mismatches: score.verification.mismatches.length } : undefined, motions: { ...score.motions, misses: score.motions.misses.length, extras: score.motions.extras.length }, attendance: { ...score.attendance, misses: score.attendance.misses.length, extras: score.attendance.extras.length } })) } : null }, null, 2));
console.log("PASS intake eval: synthetic golden fixture meets the extraction quality gate" + (privateResult ? "; private golden set graded" : ""));
