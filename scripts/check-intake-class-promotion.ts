/** Gate for promoting reviewed extractions of every class beyond minutes (retest of the
 * in-app intake: a fresh workspace must end with native policies, directors, statements,
 * insurance, filings … with field provenance, not only meetings). Runs the synthetic
 * per-class fixture through the pipeline, stages it in a workspace, accepts each
 * document's fields and promotes it through `intake:promoteExtraction`. Also covers
 * class-aware readiness, the queue summary, version-cluster copies ("covered") and a
 * second promotion of a copy (stable importedSourceVersions). Synthetic data only. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { PortableRuntime } from "../shared/portable/define";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { buildImportBundle, coverageReport } from "../shared/intake/bundle";
import { extractBytes } from "../shared/intake/extract";
import { sha256Hex } from "../shared/intake/node/extractFile";
import { runIntakePipeline } from "../shared/intake/pipeline";
import { stageRunInWorkspace } from "../shared/intake/stageRun";
import { orderedVersionFiles } from "../shared/intake/promotion";
import { CLASS_PROMOTION } from "../shared/intake/promotionClasses";
import { promotionReadiness, latestDecisions, requiredFieldsFor, reviewFieldsForRecord, thresholdFor } from "../shared/intake/review";
import { writeClassFixtures, writeSyntheticFixtures } from "./lib/intake-synthetic-fixtures";

// ------------------------------------------------------------ pure model
assert.deepEqual(requiredFieldsFor("policy", { title: {} }).map((field) => field.path), ["title"]);
assert.deepEqual(requiredFieldsFor("invoice", {}).map((field) => field.label), ["Invoice date", "Amount"]);
assert.deepEqual(requiredFieldsFor("insurance", { policyNumber: {} }).map((field) => field.path), ["policyNumber"]);
assert.deepEqual(requiredFieldsFor("agenda", { body: {}, date: {} }).map((field) => field.path), ["body", "date"]);
assert.deepEqual(requiredFieldsFor("meetingMinutes", {}).map((field) => field.path), ["body", "date"]);
assert.equal(thresholdFor("policy", "title"), 0.8, "class extractors' stated values bulk-accept at 0.8");
assert.equal(thresholdFor("insurance", "termStart"), 0.85);
assert.equal(thresholdFor("unknownClass", "anything"), 0.85);
const ordered = orderedVersionFiles([{ fileKey: "b.pdf", recordStatus: "approved" }, { fileKey: "a.docx", recordStatus: "draft" }, { fileKey: "c.docx" }]).map((file) => file.fileKey);
assert.deepEqual(ordered, ["a.docx", "c.docx", "b.pdf"]);
assert.deepEqual(orderedVersionFiles([{ fileKey: "b.pdf", recordStatus: "approved" }, { fileKey: "c.docx" }, { fileKey: "a.docx", recordStatus: "draft" }]).map((file) => file.fileKey), ordered, "the same order whichever copy is promoted");

// ------------------------------------------------------------ workspace
const society = "society_classes";
const db = new MemoryDb({ seed: {
  societies: [{ _id: society, name: "Lakeside Clean Air Society" }],
  users: [{ _id: "user_owner", societyId: society, role: "Owner", status: "Active", displayName: "Owner" }],
} });
const runtime = new PortableRuntime({
  db, capabilities: makeCapabilities({}),
  principalProvider: () => ({ kind: "user", runtime: "test", assurance: "trusted-workspace", subject: "user_owner", userId: "user_owner", societyId: society }),
}).registerAll(PORTABLE_FUNCTIONS);
const mutate = (name: string, args: Record<string, unknown>) => runtime.runMutation(name, args) as Promise<any>;
const query = (name: string, args: Record<string, unknown>) => runtime.runQuery(name, args) as Promise<any>;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "societyer-intake-classes-"));
await writeClassFixtures(dir);
const run = await runIntakePipeline(fs.readdirSync(dir).map((name) => ({ fileKey: `local:${name}`, name, path: name, acquisitionStatus: "local" as const, read: async () => new Uint8Array(fs.readFileSync(path.join(dir, name))) })), {
  name: "Synthetic class run", sourceKind: "upload", sourceRoot: "browser upload", extract: (file, bytes) => extractBytes(file.name, bytes), hash: sha256Hex,
});
const staged = await stageRunInWorkspace(mutate, society, run, run.extracts, coverageReport(run, buildImportBundle(run)));
const queue = await query("intake:listExtractions", { societyId: society, runId: staged.runId }) as any[];
const classRows = queue.filter((row) => row.docClass !== "meetingMinutes");
assert.ok(classRows.length >= 15, `the fixture yields extractions of every class (${classRows.length})`);
assert.ok(classRows.every((row) => typeof row.summary === "string" && row.summary.length > 3), "queue rows describe non-minutes records");
assert.ok(classRows.find((row) => row.docClass === "insurance")?.date, "a class record's queue row carries its identifying date");

/** Accept every field that has a value (a reviewer working through the document). */
async function acceptAll(row: any) {
  const detail = await query("intake:getExtraction", { societyId: society, extractionId: row._id });
  const fields = reviewFieldsForRecord(detail.extraction.record, row.docClass).filter((field) => field.field.value !== undefined && field.field.value !== null && field.field.status !== "not_stated");
  for (let offset = 0; offset < fields.length; offset += 500) {
    await mutate("intake:reviewFields", { societyId: society, items: fields.slice(offset, offset + 500).map((field) => ({ extractionId: row._id, fieldPath: field.path, decision: "accept" })) });
  }
  const after = await query("intake:getExtraction", { societyId: society, extractionId: row._id });
  return promotionReadiness(reviewFieldsForRecord(after.extraction.record, row.docClass), latestDecisions(after.reviews), row.docClass);
}

const results: Record<string, { tables: string[]; provenance: number }> = {};
const failures: string[] = [];
// Minutes first (so agendas of the same meeting become materials), then everything else.
for (const row of [...queue].sort((a, b) => Number(a.docClass !== "meetingMinutes") - Number(b.docClass !== "meetingMinutes"))) {
  const current = (await query("intake:listExtractions", { societyId: society, runId: staged.runId }) as any[]).find((candidate) => candidate._id === row._id);
  if (current?.status !== "pending_review" && current?.status !== "in_review") continue;
  const readiness = await acceptAll(row);
  if (!readiness.ready) { failures.push(`${row.fileKey}: not ready (${[...readiness.missing, ...readiness.problems].join(", ")})`); continue; }
  try {
    const promoted = await mutate("intake:promoteExtraction", { societyId: society, extractionId: row._id });
    const tables = [...new Set((promoted.targets ?? []).map((target: any) => target.table as string))];
    results[`${row.docClass} ${row.fileKey.replace(/^local:/, "")}`] = { tables, provenance: promoted.provenance };
    for (const target of promoted.targets ?? []) assert.ok(db.dump(target.table).some((record: any) => String(record._id) === String(target.id)), `${target.table} ${target.id} exists`);
    if (row.docClass !== "meetingMinutes" && row.docClass !== "agreement" && row.docClass !== "correspondence") assert.ok(promoted.provenance > 0, `${row.fileKey} wrote provenance`);
  } catch (error) {
    failures.push(`${row.docClass} ${row.fileKey}: ${error instanceof Error ? error.message : error}`);
  }
}
assert.deepEqual(failures, [], `every class promotes:\n${failures.join("\n")}`);

const promotedClasses = new Set(Object.keys(results).map((key) => key.split(" ")[0]));
for (const docClass of ["agenda", "policy", "bylaws", "roster", "directorConsent", "registryFiling", "financialStatement", "budget", "insurance", "grant", "invoice"]) {
  assert.ok(promotedClasses.has(docClass), `${docClass} was promoted (classes: ${[...promotedClasses].join(", ")})`);
}
const tablesFor = (docClass: string) => new Set(Object.entries(results).filter(([key]) => key.startsWith(`${docClass} `)).flatMap(([, value]) => value.tables));
assert.ok(tablesFor("policy").has("policies") || tablesFor("policy").has("committees"));
assert.ok(tablesFor("bylaws").has("policies"));
assert.ok(tablesFor("insurance").has("insurancePolicies"));
assert.ok(tablesFor("financialStatement").has("financialStatementImports"));
assert.ok(tablesFor("budget").has("budgetSnapshots"));
assert.ok(tablesFor("registryFiling").has("filings"));
assert.ok(tablesFor("roster").has("directors") || tablesFor("directorConsent").has("directors"));
assert.ok(tablesFor("invoice").has("transactionCandidates"));
assert.ok(tablesFor("agenda").has("meetings"), "an agenda creates (or links) its meeting");

// Native shapes: insurance never Active, policies Draft/Superseded, directors not duplicated.
assert.ok(db.dump("insurancePolicies").every((row: any) => row.status !== "Active"));
assert.ok(db.dump("policies").every((row: any) => ["Draft", "Superseded"].includes(row.status)));
const directorNames = db.dump("directors").map((row: any) => `${row.firstName} ${row.lastName}`.toLowerCase());
assert.equal(new Set(directorNames).size, directorNames.length, "a person listed by several documents is one director");
assert.ok(db.dump("boardRoleAssignments").length >= directorNames.length, "every observed term is a role assignment");

// Provenance on class records (View source).
const policy = db.dump("policies")[0] as any;
const policyProvenance = await query("intake:provenanceForRecords", { societyId: society, targets: [{ targetTable: "policies", targetId: policy._id }] });
assert.ok(policyProvenance.some((row: any) => row.fieldPath === "policyName" && row.locator.quote), "a promoted policy shows its source quote");
const insurance = db.dump("insurancePolicies")[0] as any;
const insuranceProvenance = await query("intake:provenanceForRecords", { societyId: society, targets: [{ targetTable: "insurancePolicies", targetId: insurance._id }] });
assert.ok(insuranceProvenance.some((row: any) => row.fieldPath === "insurer" || row.fieldPath === "startDate"));
const director = db.dump("directors")[0] as any;
assert.ok((await query("intake:provenanceForRecords", { societyId: society, targets: [{ targetTable: "directors", targetId: director._id }] })).some((row: any) => row.fieldPath === "fullName"), "a director links to the line that names them");
// Each promoted class document is linked to a source document of its register's category.
const promotedRows = (await query("intake:listExtractions", { societyId: society, runId: staged.runId }) as any[]).filter((row) => row.status === "promoted");
assert.ok(promotedRows.every((row) => Array.isArray(row.promotion?.targets)), "promoted rows list the records they created");
const insuranceDoc = db.dump("documents").find((row: any) => row.category === "Insurance" && (row.tags ?? []).includes("insurance"));
assert.ok(insuranceDoc, "an insurance source document is filed under Insurance");
// Restricted classes (consents, invoices, correspondence) never carry contact data or text into documents.
for (const row of db.dump("documents") as any[]) {
  if (!(row.tags ?? []).includes("intake")) continue;
  const leak = [...String(row.content ?? "").replace(/\\[tnr]/g, " ").matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)].find((match) => !/^[x.@+_-]+$/i.test(match[0]));
  assert.ok(!leak, `no e-mail address in ${row.title}: ${leak?.[0]} … ${String(row.content ?? "").slice(Math.max(0, (leak?.index ?? 0) - 200), (leak?.index ?? 0) + 60)}`);
}
// System gaps recorded for facts without a native field (e.g. an agreement).
assert.ok(db.dump("representationGaps").some((row: any) => String(row.dedupeKey ?? "").includes(":class:") || String(row.dedupeKey ?? "").includes(":unsupported:")));
assert.ok(Object.keys(CLASS_PROMOTION).length >= 16);
fs.rmSync(dir, { recursive: true, force: true });

// ------------------------------------------------------------ version clusters: copies are covered; a copy promotes cleanly
{
  const minutesDb = new MemoryDb({ seed: { societies: [{ _id: society, name: "Lakeside Clean Air Society" }], users: [{ _id: "user_owner", societyId: society, role: "Owner", status: "Active", displayName: "Owner" }] } });
  const rt = new PortableRuntime({ db: minutesDb, capabilities: makeCapabilities({}), principalProvider: () => ({ kind: "user", runtime: "test", assurance: "trusted-workspace", subject: "user_owner", userId: "user_owner", societyId: society }) }).registerAll(PORTABLE_FUNCTIONS);
  const m = (name: string, args: Record<string, unknown>) => rt.runMutation(name, args) as Promise<any>;
  const q = (name: string, args: Record<string, unknown>) => rt.runQuery(name, args) as Promise<any>;
  const minutesDir = fs.mkdtempSync(path.join(os.tmpdir(), "societyer-intake-copies-"));
  await writeSyntheticFixtures(minutesDir);
  // A draft of the same minutes: a near-duplicate text with one changed line (copies with identical bytes are not re-extracted).
  const textFile = fs.readdirSync(minutesDir).find((name) => name.endsWith(".txt"))!;
  const text = fs.readFileSync(path.join(minutesDir, textFile), "utf8");
  fs.writeFileSync(path.join(minutesDir, textFile.replace(/\.txt$/, " DRAFT.txt")), `${text}\nDraft circulated for comment.\n`);
  const copyRun = await runIntakePipeline(fs.readdirSync(minutesDir).map((name) => ({ fileKey: `local:${name}`, name, path: name, acquisitionStatus: "local" as const, read: async () => new Uint8Array(fs.readFileSync(path.join(minutesDir, name))) })), {
    name: "Copies", sourceKind: "upload", sourceRoot: "browser upload", extract: (file, bytes) => extractBytes(file.name, bytes), hash: sha256Hex,
  });
  const copyStaged = await stageRunInWorkspace(m, society, copyRun, copyRun.extracts, coverageReport(copyRun, buildImportBundle(copyRun)));
  const files = await q("intake:listFiles", { societyId: society, runId: copyStaged.runId }) as any[];
  const clustered = files.filter((file) => file.clusterKey && file.docClass === "meetingMinutes");
  const clusterKey = clustered.map((file) => file.clusterKey).find((key, index, keys) => keys.indexOf(key) !== index);
  if (!clusterKey) console.log(files.map((file) => [file.name, file.docClass, file.clusterKey, file.disposition]));
  const copyQueue = await q("intake:listExtractions", { societyId: society, runId: copyStaged.runId }) as any[];
  const inCluster = copyQueue.filter((row) => files.find((file) => file._id === row.fileId)?.clusterKey === clusterKey);
  if (clusterKey && inCluster.length >= 2) {
    const [first, second] = inCluster;
    for (const row of [first, second]) {
      const detail = await q("intake:getExtraction", { societyId: society, extractionId: row._id });
      await m("intake:reviewFields", { societyId: society, items: reviewFieldsForRecord(detail.extraction.record).filter((field) => field.field.status === "stated").map((field) => ({ extractionId: row._id, fieldPath: field.path, decision: "accept" })) });
    }
    const promoted = await m("intake:promoteExtraction", { societyId: society, extractionId: first._id });
    assert.ok(promoted.covered >= 1, "promoting one copy covers the other copies of its cluster");
    const secondRow = (await q("intake:listExtractions", { societyId: society, runId: copyStaged.runId }) as any[]).find((row) => row._id === second._id);
    assert.equal(secondRow.status, "covered");
    assert.equal(secondRow.promotion.coveredByExtractionId, first._id);
    // Reopening a covered copy and promoting it merges into the same meeting without a history conflict.
    await m("intake:setExtractionStatus", { societyId: society, extractionId: second._id, status: "in_review" });
    const again = await m("intake:promoteExtraction", { societyId: society, extractionId: second._id });
    assert.equal(again.meetingId, promoted.meetingId, "the copy merges into the meeting its cluster already created");
  } else {
    console.warn("WARN: the synthetic copy did not cluster; covered-copy checks skipped");
    assert.fail("a byte-identical copy must cluster with its original");
  }
  fs.rmSync(minutesDir, { recursive: true, force: true });
}

console.log(`PASS intake class promotion: ${Object.keys(results).length} documents promoted across ${promotedClasses.size} classes into ${new Set(Object.values(results).flatMap((value) => value.tables)).size} native tables; ${db.dump("fieldProvenance").length} provenance rows; version-cluster copies covered and re-promotable`);
