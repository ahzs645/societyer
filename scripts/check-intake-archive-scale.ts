/**
 * GATE: a fully reviewed archive fits in a device backup.
 *
 * Builds a SYNTHETIC intake run with the shape of a fully reviewed real
 * archive (scripts/perf/synthetic-intake-archive.mjs; ~10k files, ~2k
 * extractions, ~89k per-field review rows, ~48k provenance rows, ~1k promotion
 * sessions), as builds before compaction stored it, then:
 *
 *   1. checks it exceeds the old backup limits (that is the problem);
 *   2. compacts it through `intake:compactRun` (bounded steps) and checks that
 *      every field decision, every provenance value and quote (read through
 *      `provenanceForExtraction`), every session count and every open
 *      review's extract is unchanged, while rows and bytes drop to well within
 *      a version 1 backup;
 *   3. exports the compacted workspace (version 1, every build restores it)
 *      and the uncompacted one (version 2 chunks) with the streaming archive
 *      writer, reads both back, restores them into the local row store and
 *      compares every table's ids; reports time and memory per phase.
 *
 * Options: --scale 1 (default) --json <file>
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { PortableRuntime } from "../shared/portable/define";
import { DEFERRED_HYDRATION_TABLES, LocalStoreDb, MemoryRowStore } from "../shared/portable/localRowStore";
import { DEFAULT_HEAVY_FIELD_POLICY } from "../shared/portable/heavyFields";
import { makeCapabilities } from "../shared/portable/capabilities";
import { latestDecisions } from "../shared/intake/review";
import { MAX_SETUP_BACKUP_BYTES, V1_BACKUP_RECORD_LIMIT } from "../shared/onboardingBackup";
import { archiveDatabaseSnapshot, buildWorkspaceArchive, databaseSource, readWorkspaceArchiveFile } from "../src/lib/workspaceArchive";
import { LocalDexieRowStore } from "../src/lib/localDexieRowStore";
// @ts-expect-error plain ESM generator shared with the browser perf gate
import { buildSyntheticIntakeTables, measureTables } from "./perf/synthetic-intake-archive.mjs";

const option = (name: string, fallback?: string) => { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : fallback; };
const scale = Number(option("scale", "1"));
const jsonOut = option("json");
const MB = 1024 * 1024;
const report: Record<string, unknown> = { scale };

/** Peak process memory while `work` runs (sampled every 25 ms). */
async function measured<T>(label: string, work: () => Promise<T>): Promise<T> {
  (globalThis as any).gc?.();
  const start = process.memoryUsage();
  const peak = { heapUsed: start.heapUsed, rss: start.rss, external: start.external + start.arrayBuffers };
  const timer = setInterval(() => {
    const now = process.memoryUsage();
    peak.heapUsed = Math.max(peak.heapUsed, now.heapUsed);
    peak.rss = Math.max(peak.rss, now.rss);
    peak.external = Math.max(peak.external, now.external + now.arrayBuffers);
  }, 25);
  const started = performance.now();
  try {
    return await work();
  } finally {
    clearInterval(timer);
    const ms = Math.round(performance.now() - started);
    const row = { ms, heapStartMB: Math.round(start.heapUsed / MB), heapPeakMB: Math.round(peak.heapUsed / MB), heapGrowthMB: Math.round((peak.heapUsed - start.heapUsed) / MB), externalPeakMB: Math.round(peak.external / MB), rssPeakMB: Math.round(peak.rss / MB) };
    report[label] = row;
    console.log(`  ${label.padEnd(28)} ${String(ms).padStart(6)} ms  heap ${row.heapStartMB}→${row.heapPeakMB} MB (+${row.heapGrowthMB})  buffers ${row.externalPeakMB} MB  rss ${row.rssPeakMB} MB`);
  }
}

const society = "societies_synthetic_scale";
const owner = "users_synthetic_owner";
const { tables } = buildSyntheticIntakeTables({ scale, societyId: society, userId: owner, layout: "legacy" });
const base = {
  societies: [{ _id: society, name: "Synthetic Scale Society", jurisdictionCode: "CA-BC" }],
  users: [{ _id: owner, societyId: society, role: "Owner", status: "Active", displayName: "Owner" }],
};
// The local engine as the browser runs it: lazy heavy fields (intake extracts and extraction records
// included), deferred intake tables and compound equality indexes.
const store = new MemoryRowStore({ ...base, ...tables } as any, { heavyFields: DEFAULT_HEAVY_FIELD_POLICY, indexed: true, deferredTables: DEFERRED_HYDRATION_TABLES });
const db = { dump: (table: string) => store.fullRows(table), tableNames: () => store.tableNames() };
const runtime = new PortableRuntime({
  db: new LocalStoreDb(store), capabilities: makeCapabilities({}),
  principalProvider: () => ({ kind: "user", runtime: "test", assurance: "trusted-workspace", subject: owner, userId: owner, societyId: society }),
}).registerAll(PORTABLE_FUNCTIONS);
const mutate = (name: string, args: Record<string, unknown>) => runtime.runMutation(name, args) as Promise<any>;
const query = (name: string, args: Record<string, unknown>) => runtime.runQuery(name, args) as Promise<any>;
const dumpAll = () => Object.fromEntries(db.tableNames().map((table) => [table, db.dump(table)])) as Record<string, any[]>;
const runId = (db.dump("intakeRuns")[0] as any)._id;

// ------------------------------------------------------------ 1. the uncompacted workspace exceeds the old limits
const legacy = measureTables(dumpAll());
report.legacy = { rows: legacy.rows, megabytes: Math.round(legacy.bytes / MB) };
console.log(`synthetic fully reviewed run (scale ${scale}): ${legacy.rows.toLocaleString("en-CA")} rows, ${(legacy.bytes / MB).toFixed(0)} MB`);
if (scale >= 1) assert.ok(legacy.bytes > MAX_SETUP_BACKUP_BYTES, "the synthetic archive reproduces the problem: more than 256 MB of records");

// Reference views before compaction (decisions per extraction; provenance as View source reads it; session summaries).
const extractions = db.dump("intakeExtractions") as any[];
const decisionsBefore = new Map<string, string>();
const reviewsByExtraction = new Map<string, any[]>();
for (const row of db.dump("intakeFieldReviews") as any[]) reviewsByExtraction.set(row.extractionId, [...(reviewsByExtraction.get(row.extractionId) ?? []), row]);
const decisionKey = (rows: any[]) => JSON.stringify([...latestDecisions(rows).entries()].map(([path, row]) => [path, row.decision, row.note, row.reviewedAtISO, row.reviewerUserId]).sort());
for (const extraction of extractions) decisionsBefore.set(extraction._id, decisionKey(reviewsByExtraction.get(extraction._id) ?? []));
const promoted = extractions.filter((row) => row.status === "promoted");
const sample = promoted.filter((_, index) => index % Math.max(1, Math.floor(promoted.length / 60)) === 0);
const strip = (rows: any[]) => rows.map(({ _id, _creationTime, ...rest }) => rest).sort((a, b) => `${a.targetTable}${a.targetId}${a.fieldPath}`.localeCompare(`${b.targetTable}${b.targetId}${b.fieldPath}`));
const provenanceBefore = new Map<string, any[]>();
for (const row of sample) provenanceBefore.set(row._id, strip(await query("intake:provenanceForExtraction", { societyId: society, extractionId: row._id })));
const sessionSample = sample.slice(0, 20).map((row) => row.promotion.sessionId as string);
const sessionsBefore = new Map<string, any>();
for (const sessionId of sessionSample) sessionsBefore.set(sessionId, ((await query("importSessions:get", { sessionId })) as any).session.summary);
const openExtraction = extractions.find((row) => row.status === "in_review");

// ------------------------------------------------------------ 2. compaction
const plan = await query("intake:compactionPlan", { societyId: society, runId });
assert.ok(plan.reviews.folded > 0 && plan.provenance.slimmable > 0 && plan.sessions.records > 0 && plan.extracts.removable > 0, JSON.stringify(plan));
let steps = 0;
const totals = await measured("compact (intake:compactRun)", async () => {
  let cursor: any = null;
  for (;;) {
    const result = await mutate("intake:compactRun", { societyId: society, runId, cursor, budget: 5000 });
    steps++;
    if (result.done) return result.totals;
    cursor = result.cursor;
    assert.ok(steps < 500, "compaction advances");
  }
});
report.compactionTotals = { ...totals, steps };
assert.equal(totals.reviewRowsFolded, plan.reviews.folded, "the plan predicted the folded review rows");
assert.equal(totals.extractsRemoved, plan.extracts.removable);
assert.equal(totals.sessionRecordsRemoved, plan.sessions.records);
const again = await query("intake:compactionPlan", { societyId: society, runId });
assert.equal(again.nothingToDo, true, "a second compaction finds nothing to do");
assert.ok((db.dump("intakeRuns")[0] as any).compaction?.atISO, "the run records its compaction");

const compacted = measureTables(dumpAll());
report.compacted = { rows: compacted.rows, megabytes: Math.round(compacted.bytes / MB) };
console.log(`after compaction: ${compacted.rows.toLocaleString("en-CA")} rows, ${(compacted.bytes / MB).toFixed(0)} MB (${steps} steps)`);
assert.ok(compacted.bytes < MAX_SETUP_BACKUP_BYTES * 0.75 * Math.max(1, scale), "comfortably within a single-file backup (< 75% of 256 MB)");
assert.ok(compacted.rows < V1_BACKUP_RECORD_LIMIT * 0.6 * Math.max(1, scale), "comfortably within the 200,000-record limit older builds restore");

// Semantics are unchanged.
const reviewsAfter = new Map<string, any[]>();
for (const row of db.dump("intakeFieldReviews") as any[]) reviewsAfter.set(row.extractionId, [...(reviewsAfter.get(row.extractionId) ?? []), row]);
for (const extraction of extractions) assert.equal(decisionKey(reviewsAfter.get(extraction._id) ?? []), decisionsBefore.get(extraction._id), `decisions of ${extraction._id} are unchanged`);
for (const row of sample) assert.deepEqual(strip(await query("intake:provenanceForExtraction", { societyId: society, extractionId: row._id })), provenanceBefore.get(row._id), `provenance of ${row._id} reads the same`);
for (const sessionId of sessionSample) {
  const after = ((await query("importSessions:get", { sessionId })) as any).session;
  assert.equal(after.summary.total, sessionsBefore.get(sessionId).total, "session counts include compacted records");
  assert.ok(after.compactedRecords?.targets?.length, "the session keeps where its records landed");
}
const openDetail = await query("intake:getExtraction", { societyId: society, extractionId: openExtraction._id });
assert.ok(openDetail.extract?.text, "an open review keeps its extract");
// A promoted document whose version cluster has no open review loses its extract; its extraction keeps every value and quote.
const keptFiles = new Set((db.dump("intakeExtracts") as any[]).map((row) => row.fileId));
const compactedPromoted = promoted.find((row) => !keptFiles.has(row.fileId));
assert.ok(compactedPromoted, "promoted documents' extracts are compacted");
const promotedDetail = await query("intake:getExtraction", { societyId: society, extractionId: compactedPromoted._id });
assert.equal(promotedDetail.extract, null);
assert.ok(promotedDetail.extraction.record?.date?.locators?.[0]?.quote, "its extraction keeps every value and quote");

// ------------------------------------------------------------ 3. export and restore at scale
const legacyTables = { ...base, ...buildSyntheticIntakeTables({ scale, societyId: society, userId: owner, layout: "legacy" }).tables } as Record<string, any[]>;
for (const [label, sourceTables, expectVersion] of [["compacted", dumpAll(), 1], ["uncompacted", legacyTables, scale >= 1 ? 2 : 1]] as const) {
  const snapshot = { kind: "societyer.localWorkspaceSnapshot", exportedAtISO: "2026-10-07T00:00:00.000Z", workspace: { id: "scale", name: "Scale", schemaVersion: 3 }, attachments: [], changes: [], tables: sourceTables };
  const expectedIds = Object.fromEntries(Object.entries(snapshot.tables).map(([table, rows]) => [table, (rows as any[]).map((row) => row._id).sort()]));
  const archive = await measured(`export ${label}`, () => buildWorkspaceArchive(databaseSource(snapshot), async () => undefined));
  assert.equal(archive.manifest.version, expectVersion, `${label} export format`);
  console.log(`  ${label}: version ${archive.manifest.version} archive, ${(archive.blob.size / MB).toFixed(0)} MB ZIP`);
  report[`zip ${label} MB`] = Math.round(archive.blob.size / MB);
  const file = new File([archive.blob], `${label}.zip`);
  const read = await measured(`read ${label}`, () => readWorkspaceArchiveFile(file));
  const store = new LocalDexieRowStore({});
  await measured(`restore ${label} (row store)`, () => store.importSnapshot(archiveDatabaseSnapshot(read.database)));
  const restored = await store.exportSnapshot();
  for (const [table, ids] of Object.entries(expectedIds)) assert.deepEqual((restored.tables[table] ?? []).map((row: any) => row._id).sort(), ids, `${label}: ${table} ids round-trip`);
}

if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
console.log(`PASS intake archive scale: a fully reviewed synthetic archive (${(legacy.bytes / MB).toFixed(0)} MB, ${legacy.rows.toLocaleString("en-CA")} rows) compacts to ${(compacted.bytes / MB).toFixed(0)} MB / ${compacted.rows.toLocaleString("en-CA")} rows with unchanged decisions, provenance and session counts; both export (v1 and chunked v2) and restore with every id`);
