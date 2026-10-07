/** Per-class intake evaluation gate (WP-L).
 *
 * Always grades the committed SYNTHETIC per-class fixture
 * (tests/fixtures/intake/synthetic-classes.json): classification of every file,
 * field checks per class, span re-verification (hallucination) and PII leaks,
 * then runs the whole fixture folder through the pipeline and asserts the
 * import bundle passes preflight with every native collection populated and
 * the review rules held (expired insurance is Lapsed, resolutions in notices
 * stay proposed, consent items are received, policies are Draft, meetings with
 * only an agenda are "held, minutes missing").
 *
 * Optionally grades a private, hand-labelled golden set of real originals
 * (never committed):
 *
 *   SOCIETYER_GOLDEN_SET_CLASSES=/path/golden-set-classes.json \
 *   SOCIETYER_GOLDEN_CLASS_FILES=/path/files     # base for relative source.path
 *   npx tsx scripts/check-intake-class-eval.ts [--verbose] [--json out.json]
 *
 * The private file may also carry `classification` labels for a whole sample
 * folder; classification accuracy is reported for them.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildImportBundle, coverageReport } from "../shared/intake/bundle";
import { fiscalYearLabel } from "../shared/intake/bundleClasses";
import { splitPackage } from "../shared/intake/extractors/packageSplit";
import { CLASS_GUIDANCE, extractWithLlm } from "../shared/intake/llm";
import { classifyPrior } from "../shared/intake/classify";
import { aggregateByClass, aggregateClassScores, classificationReport, scoreClassDocument, type ClassDocScore, type ClassGoldenDoc, type ClassGoldenSet } from "../shared/intake/evalClasses";
import { extractBytes } from "../shared/intake/extract";
import { extractForClass } from "../shared/intake/extractors";
import { extractFile, libreOfficeConverter, sha256Hex } from "../shared/intake/node/extractFile";
import { runIntakePipeline, type PipelineSourceFile } from "../shared/intake/pipeline";
import { validateExtraction } from "../shared/intake/schemas";
import { verifyRecord } from "../shared/intake/verify";
import { writeClassFixtures } from "./lib/intake-synthetic-fixtures";

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

async function gradeDocs(label: string, docs: ClassGoldenDoc[], fileFor: (doc: ClassGoldenDoc) => string | undefined, context: { asOfISO?: string; organizationName?: string }): Promise<ClassDocScore[]> {
  const scores: ClassDocScore[] = [];
  for (const doc of docs) {
    const file = fileFor(doc);
    if (!file || !fs.existsSync(file)) {
      console.warn(`[${label}] ${doc.id}: source file not found; skipped.`);
      continue;
    }
    const extract = await extractFile(file);
    const predicted = classifyPrior({ name: doc.source.fileName, path: doc.source.path, headText: extract.text.slice(0, 3000) }).docClass;
    // Fields are graded with the labelled class so a classification miss does not hide extractor quality.
    const envelope = extractForClass(doc.docClass, { fileId: `${label}:${doc.id}`, fileName: doc.source.fileName, path: doc.source.path, extract, asOfISO: context.asOfISO, organizationName: context.organizationName });
    const validation = envelope ? validateExtraction(envelope) : { ok: false, issues: ["no extractor"] };
    const verification = envelope ? verifyRecord(envelope.record, extract) : undefined;
    const score = scoreClassDocument(doc, envelope, { schemaValid: validation.ok, verification, predictedClass: predicted });
    scores.push(score);
    if (verbose || score.failures.length || score.piiLeaks.length || score.badQuotes || !score.classificationOk) {
      const flags = [score.classificationOk ? "" : `classified ${predicted}`, validation.ok ? "" : `schema: ${validation.issues.slice(0, 3).join("; ")}`, score.badQuotes ? `${score.badQuotes} bad quote(s)` : "", score.piiLeaks.length ? `PII leak: ${score.piiLeaks.join(", ")}` : ""].filter(Boolean).join(" | ");
      if (verbose || flags || score.failures.length) console.log(`  ${score.id} ${doc.docClass}${score.holdout ? " (holdout)" : ""}: ${score.passed}/${score.checks} checks${flags ? ` | ${flags}` : ""}`);
      for (const failure of score.failures) console.log(`      ${failure.path}: expected ${JSON.stringify(failure.expected)} got ${JSON.stringify(failure.actual)?.slice(0, 160)}${failure.why ? ` (${failure.why})` : ""}`);
    }
  }
  return scores;
}

function printTable(label: string, scores: ClassDocScore[]) {
  const byClass = aggregateByClass(scores);
  console.log(`${label}: per-class extraction`);
  for (const [docClass, value] of Object.entries(byClass)) {
    console.log(`  ${docClass.padEnd(18)} docs ${String(value.documents).padStart(2)} | fields ${String(value.passed).padStart(3)}/${String(value.checks).padEnd(3)} ${pct(value.fieldAccuracy).padStart(6)} | classified ${pct(value.classificationAccuracy).padStart(6)} | hallucination ${pct(value.hallucinationRate)} of ${value.quoted} | PII leaks ${value.piiLeaks}`);
  }
  const all = aggregateClassScores(scores);
  console.log(`  ${"ALL".padEnd(18)} docs ${String(all.documents).padStart(2)} | fields ${all.passed}/${all.checks} ${pct(all.fieldAccuracy)} | classified ${pct(all.classificationAccuracy)} | hallucination ${pct(all.hallucinationRate)} of ${all.quoted} | PII leaks ${all.piiLeaks}`);
  return { byClass, all };
}

// 0. Unit checks: classification rules, fiscal-year labels, provider exclusion, package splitting.
assert.equal(classifyPrior({ name: "Re Consent to Act as a Director - Updated.msg" }).docClass, "correspondence", "a saved reply is correspondence, not a consent");
assert.equal(classifyPrior({ name: "CAFF Funding Agreement 2025.docx" }).docClass, "grant");
assert.equal(classifyPrior({ name: "Board Transition Briefing Note.docx", headText: "the statement of directors and registered office of the society" }).docClass, "report", "prose mentioning a registry form is not a filing");
assert.equal(classifyPrior({ name: "2016Confirmation of filing Annual Report.PDF" }).docClass, "registryFiling");
assert.equal(fiscalYearLabel("Budget2014_15.xlsx"), "2014-15");
assert.equal(fiscalYearLabel("2024 Budget.xlsx"), "2024");
for (const docClass of ["directorConsent", "proxy", "roster", "invoice", "correspondence"] as const) {
  let called = false;
  const result = await extractWithLlm({ fileId: "x", fileName: "x.docx", docClass, extract: { method: "plain-text", methodVersion: "1", blocks: [], text: "", warnings: [] }, restricted: false, generate: async () => { called = true; return { object: {} }; }, provider: "test", model: "test" });
  assert.equal(called, false, `${docClass} is never sent to a model provider`);
  assert.equal(result.skippedReason, "restricted");
}
assert.ok(CLASS_GUIDANCE.agenda && CLASS_GUIDANCE.insurance && /never 'adopted'/.test(CLASS_GUIDANCE.agenda!), "per-class LLM guidance");
{
  const pdfText = ["Board Meeting Package", "\f", "Agenda", "Date: May 4, 2025", "1. Call to Order", "2. Adoption of Minutes", "\f", "Business Arising and Current", "Agenda Item\tResponsibility", "3. Report\tChair"];
  const extract = await extractBytes("pkg.txt", new TextEncoder().encode(pdfText.join("\n\n")));
  const titles = splitPackage(extract).map((segment) => segment.title);
  assert.ok(!titles.some((title) => /Agenda Item/.test(title)), `an agenda table header is not a new document: ${titles.join(" | ")}`);
}

// 1. Synthetic per-class fixture (committed; CI gate).
const keepDir = args.includes("--keep-fixtures") ? args[args.indexOf("--keep-fixtures") + 1] : undefined;
if (keepDir) fs.mkdirSync(keepDir, { recursive: true });
const fixtureDir = keepDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "societyer-intake-class-eval-"));
const synthetic = await writeClassFixtures(fixtureDir);
const syntheticScores = await gradeDocs("synthetic", synthetic.golden.documents, (doc) => synthetic.files[doc.id], synthetic.golden);
const syntheticSummary = printTable("synthetic", syntheticScores);
const classesCovered = new Set(syntheticScores.map((score) => score.docClass));
for (const docClass of ["agenda", "meetingPackage", "agmMaterial", "bylaws", "policy", "directorConsent", "proxy", "roster", "financialStatement", "budget", "insurance", "agreement", "grant", "registryFiling", "correspondence", "invoice"]) assert.ok(classesCovered.has(docClass as any), `synthetic fixture covers ${docClass}`);
for (const [docClass, value] of Object.entries(syntheticSummary.byClass)) {
  assert.ok(value.fieldAccuracy >= 0.9, `synthetic ${docClass} field accuracy ${pct(value.fieldAccuracy)} < 90%`);
  assert.equal(value.schemaValid, value.documents, `synthetic ${docClass}: every extraction satisfies the schema`);
}
assert.equal(syntheticSummary.all.classificationAccuracy, 1, "synthetic fixture: every file is classified as labelled");
assert.equal(syntheticSummary.all.hallucinationRate, 0, "deterministic class extraction quotes must all re-verify");
assert.equal(syntheticSummary.all.piiLeaks, 0, "no home address, email or contact detail reaches an extraction");

// 2. End to end: the whole fixture folder → pipeline → import bundle (preflight) → review rules.
const sourceFiles: PipelineSourceFile[] = Object.values(synthetic.files).map((file) => ({ fileKey: `local:${path.basename(file)}`, name: path.basename(file), path: path.basename(file), sizeBytes: fs.statSync(file).size, acquisitionStatus: "local", read: async () => new Uint8Array(fs.readFileSync(file)) }));
const run = await runIntakePipeline(sourceFiles, { name: "synthetic-classes", sourceKind: "local_folder", sourceRoot: fixtureDir, extract: (file, bytes) => extractBytes(file.name, bytes, { convertLegacy: libreOfficeConverter }), hash: sha256Hex, asOfISO: synthetic.golden.asOfISO });
const build = buildImportBundle(run);
assert.deepEqual(build.issues, [], `bundle preflight: ${build.issues.join("; ")}`);
const bundle = build.bundle as Record<string, any[]>;
const counts = Object.fromEntries(Object.entries(bundle).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length]));
console.log(`end-to-end bundle: ${Object.entries(counts).map(([key, value]) => `${key} ${value}`).join(", ")}`);
for (const collection of ["meetingMinutes", "meetingMaterials", "policies", "bylawRuleSets", "committees", "directors", "organizationSeats", "proxies", "financialStatementImports", "budgetSnapshots", "insurancePolicies", "grants", "deadlines", "filings", "sourceEvidence", "transactionCandidates", "representationGaps"]) {
  assert.ok((counts[collection] ?? 0) > 0, `bundle has ${collection}`);
}
// Meetings shown only by an agenda are staged as held with minutes missing.
const june = bundle.meetingMinutes.find((row) => row.meetingDate === "2025-06-10");
assert.ok(june, "the June 10 agenda evidences a meeting");
assert.equal(june.meetingStatus, "Held");
assert.match(june.discussion, /No minutes were found/);
assert.ok(june.consentItems?.length === 3 && june.consentItems.every((item: any) => item.outcome === "received"), "consent items are received, never adopted");
assert.ok(june.agendaItems?.some((item: any) => item.requestedAction === "approve"), "agenda items carry the requested action");
// Minutes embedded in a package become the record of their own meeting.
const august = bundle.meetingMinutes.find((row) => row.meetingDate === "2025-08-12");
assert.ok(august && august.motions.length >= 1, "minutes embedded in the September package are bundled for August 12");
// Policies are Draft and linked to the adopting motion; bylaws produce a Draft rule set.
const signing = bundle.policies.find((row) => /Signing Authority/.test(row.policyName));
assert.equal(signing.status, "Draft");
assert.equal(signing.adoptedAtMeeting?.meetingDate, "2025-03-11", "policy linked to the minutes motion adopting it");
assert.ok(bundle.bylawRuleSets.some((row) => row.generalNoticeMinDays === 14 && row.allowProxyVoting === false), "bylaw rules staged");
assert.ok(bundle.committees.some((row) => /Operations/.test(row.name) && row.quorumRule), "terms of reference give the committee quorum");
// Insurance: never Active by default.
assert.ok(bundle.insurancePolicies.every((row) => row.status !== "Active"));
assert.equal(bundle.insurancePolicies.find((row) => row.policyNumber === "DO-445120")?.status, "Lapsed");
assert.equal(bundle.insurancePolicies.find((row) => row.policyNumber === "CGL-778201")?.status, "NeedsReview");
// Grants with reporting deadlines; filings Filed only with evidence.
assert.ok(bundle.grants.some((row) => /Coastal Air Futures Fund/.test(row.funder)));
assert.ok(bundle.deadlines.some((row) => row.dueDate === "2026-01-31"));
assert.ok(bundle.filings.every((row) => row.status !== "Filed" || (row.filedAt && row.submissionMethod)), "a Filed filing carries filedAt and submission method");
// Restricted classes: evidence-only rows; no contact details anywhere in the bundle.
const leakPaths = (node: unknown, needle: string, at = "bundle"): string[] => {
  if (typeof node === "string") return node.includes(needle) ? [at] : [];
  if (Array.isArray(node)) return node.flatMap((item, index) => leakPaths(item, needle, `${at}[${index}]`));
  if (node && typeof node === "object") return Object.entries(node).flatMap(([key, value]) => leakPaths(value, needle, `${at}.${key}`));
  return [];
};
for (const leak of ["1428 Fernhill", "casey.lark@example.org", "robin.vale@example.org", "morgan.ashby@lakeside-air.example"]) {
  const paths = leakPaths(bundle, leak);
  assert.deepEqual(paths, [], `bundle contains ${leak} at ${paths.slice(0, 3).join(", ")}`);
}
assert.ok(run.processingLog.every((entry) => !entry.sentToProvider), "deterministic run sends nothing to a provider");
const coverage = coverageReport(run, build);
console.log(`end-to-end coverage: ${coverage.headline.transposed}/${coverage.headline.files} files transposed, native facts ${coverage.headline.nativeFacts}, gap facts ${coverage.headline.gapFacts}, unresolved ${coverage.headline.unresolvedFacts} (${pct(coverage.headline.coverage)}); hallucination ${pct(coverage.hallucinationRate)}`);
assert.equal(coverage.hallucinationRate, 0);
if (!keepDir) fs.rmSync(fixtureDir, { recursive: true, force: true });

// 3. Private golden set (optional; never committed).
const goldenPath = process.env.SOCIETYER_GOLDEN_SET_CLASSES;
let privateReport: Record<string, unknown> | undefined;
if (goldenPath) {
  const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8")) as ClassGoldenSet & { asOfISO?: string; organizationName?: string };
  const filesDir = process.env.SOCIETYER_GOLDEN_CLASS_FILES ?? path.dirname(goldenPath);
  const locate = (source: { localPath?: string; path?: string; fileName: string }) => source.localPath ?? (source.path ? path.join(filesDir, source.path) : path.join(filesDir, source.fileName));
  const scores = await gradeDocs("golden", golden.documents, (doc) => locate(doc.source), golden);
  const summary = printTable("golden (real originals)", scores);
  const dev = aggregateClassScores(scores.filter((score) => !score.holdout));
  const holdout = aggregateClassScores(scores.filter((score) => score.holdout));
  console.log(`  dev (tuned on) ${dev.passed}/${dev.checks} ${pct(dev.fieldAccuracy)} over ${dev.documents} docs | holdout (never tuned on) ${holdout.passed}/${holdout.checks} ${pct(holdout.fieldAccuracy)} over ${holdout.documents} docs`);
  privateReport = { byClass: summary.byClass, all: summary.all, dev, holdout, documents: scores.map((score) => ({ ...score, failures: score.failures.map((failure) => failure.path) })) };
  if (golden.classification?.length) {
    const labels = [] as Array<{ id: string; expected: any; predicted: any }>;
    for (const label of golden.classification) {
      const file = locate(label);
      const head = fs.existsSync(file) ? (await extractFile(file).catch(() => undefined))?.text.slice(0, 3000) : undefined;
      labels.push({ id: label.path ?? label.fileName, expected: label.docClass, predicted: classifyPrior({ name: label.fileName, path: label.path, headText: head }).docClass });
    }
    const report = classificationReport(labels);
    console.log(`golden classification: ${report.correct}/${report.total} ${pct(report.accuracy)}`);
    for (const [docClass, value] of Object.entries(report.byClass)) console.log(`  ${docClass.padEnd(18)} recall ${value.correct}/${value.total} ${pct(value.recall)} precision ${pct(value.precision)}`);
    if (verbose) for (const confusion of report.confusions) console.log(`    ${confusion.expected} -> ${confusion.predicted}: ${confusion.id}`);
    privateReport.classification = { ...report, confusions: report.confusions.length };
  }
  const minAccuracy = Number(process.env.SOCIETYER_EVAL_MIN_CLASS_FIELD_ACCURACY ?? 0);
  if (minAccuracy) assert.ok(summary.all.fieldAccuracy >= minAccuracy, `golden class field accuracy ${pct(summary.all.fieldAccuracy)} < ${pct(minAccuracy)}`);
} else {
  console.log("SOCIETYER_GOLDEN_SET_CLASSES not set: private per-class golden set skipped (synthetic fixture graded).");
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ synthetic: { byClass: syntheticSummary.byClass, all: syntheticSummary.all, bundle: counts }, golden: privateReport ?? null }, null, 2));
console.log("PASS intake class eval: every document class extracts, classifies and stages into native records on the synthetic fixture" + (privateReport ? "; private golden set graded" : ""));
