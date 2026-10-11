/**
 * SU-15: running the gates must leave `git status` clean. Gates that record
 * evidence in tracked files (artifacts/offline/*.json, stage2-tenancy-report.md)
 * go through writeTrackedReport, which keeps the committed file when only the
 * run timestamp differs.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sameReportContent, writeTrackedReport } from "./lib/writeTrackedReport.mjs";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

assert.equal(sameReportContent(json({ executedAt: "2026-01-01T00:00:00Z", cases: [1, 2] }), json({ executedAt: "2026-02-02T00:00:00Z", cases: [1, 2] })), true);
assert.equal(sameReportContent(json({ completedAt: "a", results: [{ name: "x", durationMs: 3 }] }), json({ completedAt: "b", results: [{ name: "x", durationMs: 9 }] })), true);
assert.equal(sameReportContent(json({ executedAt: "a", cases: [1, 2] }), json({ executedAt: "a", cases: [1, 3] })), false);
assert.equal(sameReportContent("# Report\n\nrow\n", "# Report\n\nrow\n"), true);
assert.equal(sameReportContent("# Report\n\nrow\n", "# Report\n\nother\n"), false);

const dir = mkdtempSync(path.join(tmpdir(), "societyer-report-hygiene-"));
try {
  const file = path.join(dir, "nested", "report.json");
  assert.equal(writeTrackedReport(file, json({ executedAt: "first", count: 1 })), true);
  const firstWrite = statSync(file).mtimeMs;
  assert.equal(writeTrackedReport(file, json({ executedAt: "second", count: 1 })), false, "a timestamp-only change must not rewrite the tracked file");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).executedAt, "first");
  assert.equal(statSync(file).mtimeMs, firstWrite);
  assert.equal(writeTrackedReport(file, json({ executedAt: "third", count: 2 })), true, "a content change is recorded");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).executedAt, "third");
  writeFileSync(path.join(dir, "plain.md"), "same\n");
  assert.equal(writeTrackedReport(path.join(dir, "plain.md"), "same\n"), false);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// Every gate that writes into a tracked report path must use the helper.
const TRACKED_REPORT_WRITERS = [
  "scripts/check-provider-runner-qualification.ts",
  "scripts/check-provider-workspace-gateway.ts",
  "scripts/check-provider-gap-qualification.ts",
  "scripts/check-powersync-invalidation.ts",
  "scripts/check-stage2-tenancy.ts",
  "scripts/record-authorization-surface.ts",
];
for (const script of TRACKED_REPORT_WRITERS) {
  const source = readFileSync(script, "utf8");
  assert.match(source, /writeTrackedReport\(/, `${script} must write its tracked report with writeTrackedReport`);
  assert.doesNotMatch(source, /writeFile(Sync)?\(\s*["'`]artifacts\/offline/, `${script} writes artifacts/offline directly`);
  assert.doesNotMatch(source, /writeFile(Sync)?\(\s*reportPath/, `${script} writes its report directly`);
}

console.log(`Gate report hygiene: helper semantics and ${TRACKED_REPORT_WRITERS.length} tracked-report writers checked.`);
