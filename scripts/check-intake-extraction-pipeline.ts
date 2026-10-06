import assert from "node:assert/strict";
import { mergeTransposition, planTransposition, type Manifest, type Result } from "./intake-extraction-pipeline";
const manifest: Manifest = { schemaVersion: 1, rootFolderId: "folder", completeness: "unverified-public-html", entries: [
  { id: "a", name: "Minutes.pdf", mimeType: "application/pdf", path: "Minutes.pdf", kind: "file", excluded: false, sha256: "abcd", sizeBytes: 42 },
  { id: "b", name: "Notes.pdf", mimeType: "application/pdf", path: "Notes.pdf", kind: "file", excluded: false },
] };
const plan = planTransposition(manifest, 1);
assert.equal(plan.batches.length, 2);
const results: Result[] = plan.tasks.map((task) => ({ planId: plan.planId, taskId: task.taskId, sourceId: task.sourceId, coverage: { outcome: "unreadable", notes: "Download failed; no content asserted." }, bundle: {} }));
const merged = mergeTransposition(plan, results);
assert.equal(merged.bundle?.sources.length, 2);
assert.equal(merged.bundle?.documentMap.length, 2);
assert.equal(merged.bundle?.sources[0].sha256, "abcd");
assert.equal(merged.bundle?.sources[0].fileSizeBytes, 42);
assert.equal(merged.report.inventoryCompleteness, "unverified-public-html");
assert.throws(() => mergeTransposition(plan, results.slice(1)), /Incomplete/);
assert.throws(() => mergeTransposition(plan, [results[0], results[0]]), /Duplicate/);
assert.throws(() => mergeTransposition(plan, [{ ...results[0], sourceId: "wrong" }, results[1]]), /Identity/);
assert.throws(() => mergeTransposition(plan, [{ ...results[0], coverage: { outcome: "extracted", notes: "Fake extraction" } }, results[1]]), /lacks native/);
assert.throws(() => mergeTransposition(plan, [{ ...results[0], coverage: { outcome: "unsupported", notes: "Missing detail" } }, results[1]]), /lacks details/);
type EvidenceResult = Result & { bundle: { sourceEvidence: { externalId: string; title: string; sourceExternalIds: string[]; notes: string; sensitivity?: string }[] } };
const evidence: EvidenceResult[] = results.map((result) => ({ ...result, coverage: { outcome: "evidence-only" as const, notes: "Read page 1." }, bundle: { sourceEvidence: [{ externalId: "same", title: "Evidence", sourceExternalIds: [result.sourceId], notes: result.sourceId }] } }));
const conflict = mergeTransposition(plan, evidence);
assert.equal(conflict.bundle, null);
assert.equal(conflict.report.conflicts.length, 1);
const foreign = structuredClone(evidence);
foreign[0].bundle.sourceEvidence[0].sourceExternalIds = ["google-drive:other"];
assert.throws(() => mergeTransposition(plan, foreign), /foreign citation/);
const unique = structuredClone(evidence);
unique.forEach((item, index) => { item.bundle.sourceEvidence[0].externalId = `evidence-${index}`; });
assert.equal(mergeTransposition(plan, unique).bundle?.sourceEvidence?.length, 2);
console.log("Transposition pipeline checks passed: coverage, provenance, identity, omissions, conflicts.");

const excludedManifest = structuredClone(manifest);
excludedManifest.entries[0].excluded = true;
const excludedPlan = planTransposition(excludedManifest);
const excludedResults: Result[] = excludedPlan.tasks.map((task) => ({ planId: excludedPlan.planId, taskId: task.taskId, sourceId: task.sourceId, coverage: { outcome: task.entry.excluded ? "excluded" : "unreadable", notes: "Explicit coverage." }, bundle: {} }));
const excludedMerge = mergeTransposition(excludedPlan, excludedResults);
assert.equal(excludedMerge.bundle?.sources.length, 1);
assert.equal(excludedMerge.report.coverage.length, 2);

const restrictedResults = structuredClone(unique);
restrictedResults[0].bundle.sourceEvidence[0].sensitivity = "restricted";
restrictedResults[0].coverage.notes = "Restricted review detail retained only in the coverage report.";
const restrictedMerge = mergeTransposition(plan, restrictedResults);
assert.equal(restrictedMerge.bundle?.sources[0].sensitivity, "restricted");
assert.equal(restrictedMerge.bundle?.documentMap[0].sensitivity, "restricted");
assert.ok(!String(restrictedMerge.bundle?.sources[0].notes).includes(restrictedResults[0].coverage.notes));
assert.equal(restrictedMerge.bundle?.sources[1].sensitivity, "standard");
const restrictedManifest = structuredClone(manifest);
restrictedManifest.entries[0].sensitivity = "restricted";
const restrictedPlan = planTransposition(restrictedManifest);
const restrictedUnreadable: Result[] = restrictedPlan.tasks.map((task) => ({ planId: restrictedPlan.planId, taskId: task.taskId, sourceId: task.sourceId, coverage: { outcome: "unreadable", notes: "Unavailable." }, bundle: {} }));
assert.equal(mergeTransposition(restrictedPlan, restrictedUnreadable).bundle?.sources[0].sensitivity, "restricted");

// Consolidated candidates may cite explicitly reviewed variants in this plan,
// while retaining the task's own source and the complete provenance list.
const corroborated: EvidenceResult[] = structuredClone(unique);
corroborated[0].corroboratingSourceIds = [plan.tasks[1].sourceId];
corroborated[0].bundle.sourceEvidence[0].sourceExternalIds = [plan.tasks[0].sourceId, plan.tasks[1].sourceId];
const corroboratedMerge = mergeTransposition(plan, corroborated);
assert.deepEqual(corroboratedMerge.bundle?.sourceEvidence?.[0].sourceExternalIds, [plan.tasks[0].sourceId, plan.tasks[1].sourceId]);
assert.deepEqual((corroboratedMerge.report.coverage[0] as Record<string, unknown>).corroboratingSourceIds, [plan.tasks[1].sourceId]);
const undeclared = structuredClone(corroborated);
delete undeclared[0].corroboratingSourceIds;
assert.throws(() => mergeTransposition(plan, undeclared), /Missing\/foreign citation/);
const unknownCorroboration = structuredClone(corroborated);
unknownCorroboration[0].corroboratingSourceIds = ["google-drive:not-in-plan"];
assert.throws(() => mergeTransposition(plan, unknownCorroboration), /Invalid corroborating sources/);
const missingOwnCitation = structuredClone(corroborated);
missingOwnCitation[0].bundle.sourceEvidence[0].sourceExternalIds = [plan.tasks[1].sourceId];
assert.throws(() => mergeTransposition(plan, missingOwnCitation), /Missing\/foreign citation/);
for (const invalid of [[plan.tasks[0].sourceId], [plan.tasks[1].sourceId, plan.tasks[1].sourceId], "google-drive:b", null]) {
  const malformed = structuredClone(corroborated);
  (malformed[0] as Record<string, unknown>).corroboratingSourceIds = invalid;
  assert.throws(() => mergeTransposition(plan, malformed), /Invalid corroborating sources/);
}
console.log("Corroborating-source checks passed: explicit planned variants retained; undeclared, unknown, self, duplicate, malformed and missing-own citations rejected.");
