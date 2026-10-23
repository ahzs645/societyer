import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { defaultIntegrationSettings } from "../shared/integrationSettings";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { DEFAULT_ANALYTICS_VIEWS, analyticsValidUntil, buildDefaultSummaries, canonicalSummary, nextAnalyticsDay, summaryVersions, type SummaryManifest } from "../shared/procurementAnalyticsArtifacts";
import { buildAnalysis } from "../shared/procurementAnalytics";
import { validateExport } from "./procurement/verify-export";
import { summarySha, writeAnalyticsArtifacts } from "./procurement/analytics-artifacts";
import type { ListRow } from "../shared/procurementListRow";
import { zoneToday } from "../src/features/procurementReview/lib/notice";
const now = Math.floor(Date.now() / 60000) * 60000, asOf = now - 60_000;
const award: ListRow = { recordKey: "award:one", kind: "award", title: "Award", organization: "City", issuedFor: "", status: "Awarded", date: zoneToday(now), dateText: "", reference: "", documents: 0, listedDocuments: 0, supplier: "Supplier", value: 123.45, currency: "CAD", procurementType: "Goods" };
const boundary = asOf + 180_000;
const opportunity: ListRow = { ...award, recordKey: "opportunity:one", kind: "opportunity", status: "Open", value: null, analyticsJson: JSON.stringify({ closingAt: new Date(boundary).toISOString(), datePrecision: "instant", dateTimezone: "UTC" }) };
const evidence = [{ recordKey: opportunity.recordKey, source: "reviews", dataJson: JSON.stringify({ id: "review", status: "succeeded", result: JSON.stringify({ summary: "Current review" }) }) }];
const entries = buildDefaultSummaries([award, opportunity], evidence, asOf, true);
assert.equal(entries.length, 10);
for (const view of DEFAULT_ANALYTICS_VIEWS) {
  const entry = entries.find(entry => JSON.parse(entry.request).view === view)!;
  const input = view === "decisions" ? [award, opportunity] : view === "opportunities" ? [opportunity] : [award];
  const expected = buildAnalysis(input, view === "decisions" ? evidence : [], { view }, asOf);
  if (expected.type === "decisions") expected.data.coverage.complete = true;
  assert.deepEqual(JSON.parse(entry.resultJson), expected, "Producer uses the exact existing engine and current review projection");
}
const closing = entries.find(entry => JSON.parse(entry.request).view === "opportunities")!;
assert.equal(closing.validUntil, boundary + 1);
for (const [date, hours] of [["2026-11-01T07:00:00Z", 25], ["2026-03-08T08:00:00Z", 23]] as const) assert.equal(nextAnalyticsDay(Date.parse(date)) - Date.parse(date), hours * 3600000, "Vancouver midnight respects DST");
assert.equal(analyticsValidUntil(JSON.parse(entries[0].resultJson), asOf), nextAnalyticsDay(asOf));

const directory = mkdtempSync(join(tmpdir(), "procurement-precompute-"));
try {
  const python = `import sys,pathlib,importlib.util\nsys.path.insert(0,sys.argv[1]);spec=importlib.util.spec_from_file_location('fixtures',pathlib.Path(sys.argv[1])/'test-integrity.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.fixture(pathlib.Path(sys.argv[2])/'target')`;
  const fixture = spawnSync("python3", ["-c", python, resolve("scripts/procurement"), directory], { encoding: "utf8" }); assert.equal(fixture.status, 0, fixture.stderr);
  const target = join(directory, "target"), base = await validateExport(target);
  writeAnalyticsArtifacts(target, base, asOf, now);
  const verified = await validateExport(target); assert.equal(verified.analytics!.entries.length, 10);
  const manifestPath = join(target, "analytics-manifest.json"), rowsPath = join(target, "analytics.jsonl"), activationPath = join(target, "activation.json");
  const originalManifest = readFileSync(manifestPath), originalRows = readFileSync(rowsPath), originalActivation = readFileSync(activationPath);
  const restore = () => { writeFileSync(manifestPath, originalManifest); writeFileSync(rowsPath, originalRows); writeFileSync(activationPath, originalActivation); };
  unlinkSync(rowsPath); await assert.rejects(validateExport(target), /ENOENT/); restore();
  writeFileSync(rowsPath, originalRows.toString().replace('"asOf":', '"badAsOf":')); await assert.rejects(validateExport(target), /integrity mismatch/); restore();
  const sealManifest = (manifest: any) => { const raw = canonicalSummary(manifest) + "\n"; writeFileSync(manifestPath, raw); writeFileSync(activationPath, JSON.stringify({ ...JSON.parse(originalActivation.toString()), analytics: { path: "analytics-manifest.json", bytes: Buffer.byteLength(raw), sha256: summarySha(raw) } })); };
  for (const descriptor of [null, false, 0]) {
    writeFileSync(activationPath, JSON.stringify({ ...JSON.parse(originalActivation.toString()), analytics: descriptor }));
    await assert.rejects(validateExport(target), /Invalid analytical artifact descriptor/, "A declared invalid descriptor cannot masquerade as an absent optional bundle"); restore();
  }
  sealManifest({ ...JSON.parse(originalManifest.toString()), metricVersion: "future-version" }); await assert.rejects(validateExport(target), /Unsupported/); restore();
  sealManifest({ ...JSON.parse(originalManifest.toString()), generation: "foreign-publication" }); await assert.rejects(validateExport(target), /lineage/); restore();
  const tampered = verified.analytics!.entries.map(entry => ({ ...entry })); const result = JSON.parse(tampered[0].resultJson); result.data.overview.value += 1; tampered[0].resultJson = JSON.stringify(result);
  const tamperedRows = tampered.map(entry => canonicalSummary(entry) + "\n").join(""); writeFileSync(rowsPath, tamperedRows);
  sealManifest({ ...JSON.parse(originalManifest.toString()), rows: { path: "analytics.jsonl", rowCount: 10, bytes: Buffer.byteLength(tamperedRows), sha256: summarySha(tamperedRows) } });
  await assert.rejects(validateExport(target), /differ from verified publication semantics/, "Even a fully rehashed wrong aggregate is rejected locally");
  const corruptApply = spawnSync(process.execPath, ["--import", "tsx", "scripts/procurement/apply-convex.ts", "--deployment", "invalid-no-network-target", "--input", target, "--persistent-operator"], { encoding: "utf8", env: { ...process.env, CONVEX_DEPLOY_KEY: "must-not-be-read" } });
  assert.notEqual(corruptApply.status, 0); assert.match(corruptApply.stderr, /differ from verified publication semantics/, "Actual apply rejects corrupt summaries before operator authorization"); restore();
  const omittedRows = verified.analytics!.entries.slice(1).map(entry => canonicalSummary(entry) + "\n").join(""); writeFileSync(rowsPath, omittedRows);
  sealManifest({ ...JSON.parse(originalManifest.toString()), rows: { path: "analytics.jsonl", rowCount: 10, bytes: Buffer.byteLength(omittedRows), sha256: summarySha(omittedRows) } });
  await assert.rejects(validateExport(target), /Unsupported or malformed/, "A rehashed bundle cannot omit one default"); restore();
  const sourceContract = { schemaVersion: 1, publicationId: base.activation.publicationId, sourceSnapshotId: base.activation.sourceSnapshotId, sourceManifestSha256: "d".repeat(64), journal: { epoch: "test", through: "position" } };
  writeAnalyticsArtifacts(target, base, asOf, now, sourceContract);
  const sourceVerified = await validateExport(target); assert.deepEqual(sourceVerified.analytics!.manifest.sourceContract, sourceContract);
  unlinkSync(join(target, "publication-source.json")); await assert.rejects(validateExport(target), /ENOENT/, "Declared source lineage file is mandatory");
  writeFileSync(join(target, "publication-source.json"), canonicalSummary(sourceContract) + "\n");
  writeFileSync(join(target, "publication-source.json"), canonicalSummary({ ...sourceContract, sourceSnapshotId: "other" }) + "\n"); await assert.rejects(validateExport(target), /integrity mismatch/);
  restore();
  const cli = spawnSync(process.execPath, ["--import", "tsx", "scripts/procurement/precompute-analytics.ts", "--input", target], { encoding: "utf8" }); assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).reused, true, "A valid prior-minute bundle is independently verified and reused without rebuilding it");
  assert.equal(readFileSync(manifestPath, "utf8"), originalManifest.toString(), "Reuse preserves original asOf, computedAt, bytes and digest");
  const fresh = spawnSync(process.execPath, ["--import", "tsx", "scripts/procurement/precompute-analytics.ts", "--input", target, "--as-of", new Date(now).toISOString()], { encoding: "utf8" }); assert.equal(fresh.status, 0, fresh.stderr);
  assert.equal(JSON.parse(fresh.stdout).reused, false, "An explicit new clock is preserved");
  assert.equal(JSON.parse(readFileSync(manifestPath, "utf8")).asOf, now, "Default producer clock matches minute-start browser requests");
  const dry = spawnSync(process.execPath, ["--import", "tsx", "scripts/procurement/apply-convex.ts", "--deployment", "invalid-no-network-target", "--input", target, "--persistent-operator", "--dry-run"], { encoding: "utf8", env: { ...process.env, CONVEX_DEPLOY_KEY: "must-not-be-read" } });
  assert.equal(dry.status, 0, dry.stderr); assert.match(dry.stdout, /no network requests/, "A valid summary dry-run does not initialize credentials or a transport");
} finally { rmSync(directory, { recursive: true, force: true }); }

for (const key of ["TENANT_ID", "CLIENT_ID", "CLIENT_SECRET", "SITE_ID", "DRIVE_ID", "TRANSFER_HOSTS"]) process.env[`PROCUREMENT_SHAREPOINT_${key}`] = "synthetic";
const t = convexTest(schema, { "./_generated/api.js": () => import("../convex/_generated/api.js"), "./_generated/server.js": () => import("../convex/_generated/server.js"), "./procurementReview.js": () => import("../convex/procurementReview"), "./procurementSync.js": () => import("../convex/procurementSync"), "./procurementImport.js": () => import("../convex/procurementImport"), "./procurementAnalytics.js": () => import("../convex/procurementAnalytics"), "./procurementAnalyticsJobs.js": () => import("../convex/procurementAnalyticsJobs") } as any);
const api: any = anyApi, issuer = betterAuthIssuer();
const ids = await t.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Prepared analytics", isCharity: false, isMemberFunded: false, updatedAt: 0, disabledModules: ["+procurementReview"] });
  const folder = `Zoer/bc-bid-monitor/${societyId}`;
  await ctx.db.patch(societyId, { integrationSettings: { ...defaultIntegrationSettings(), procurementReviewFolder: folder } as any });
  await ctx.db.insert("users", { societyId, email: "viewer@example.invalid", displayName: "Viewer", role: "Viewer", status: "Active", authSubject: "viewer", authIssuer: issuer, authProvider: "better-auth", createdAtISO: zoneToday(now) });
  const catalog = await ctx.db.insert("procurementCatalogs", { societyId, generation: "previous", folder, publishedAt: new Date(now).toISOString(), counts: { award: 1, opportunity: 1 } });
  return { societyId, folder, catalog };
});
const lineage = { societyId: ids.societyId, folder: ids.folder, generation: "precomputed-publication", publicationId: "publication", sourceSnapshotId: "snapshot", sourceCatalogSha256: "a".repeat(64), contentHash: "b".repeat(64), inventoryHash: "c".repeat(64) };
const makeSeed = (input = entries, changes: Partial<SummaryManifest> = {}) => {
  const rowsJson = input.map(entry => canonicalSummary(entry) + "\n").join("");
  const manifest: SummaryManifest = { schemaVersion: 1, ...lineage, ...summaryVersions, asOf, computedAt: now, rows: { path: "analytics.jsonl", rowCount: 10, bytes: Buffer.byteLength(rowsJson), sha256: summarySha(rowsJson) }, ...changes };
  const manifestJson = canonicalSummary(manifest) + "\n";
  return { societyId: ids.societyId, generation: lineage.generation, folder: ids.folder, contentHash: lineage.contentHash, inventoryHash: lineage.inventoryHash, bundleSha256: summarySha(manifestJson), manifestJson, rowsJson };
};
await assert.rejects(t.mutation(api.procurementAnalytics.seed, makeSeed()), /matching verified publication job/);
await t.run(ctx => ctx.db.insert("procurementImportJobs", { ...Object.fromEntries(Object.entries(lineage).filter(([key]) => ["societyId", "folder", "generation", "contentHash", "inventoryHash"].includes(key))), publishedAt: new Date(now).toISOString(), complete: true, phase: "validated", startedAt: now, heartbeatAt: now } as any));
assert.deepEqual(await t.mutation(api.procurementAnalytics.seed, makeSeed()), { written: 10, state: "seeded" });
const reader = t.withIdentity({ subject: "viewer", issuer });
const args = (view: string, at = now) => ({ societyId: ids.societyId, generation: lineage.generation, request: JSON.stringify({ view }), asOf: at });
await assert.rejects(reader.query(api.procurementAnalytics.get, args("overview")), /publication changed/i, "Staged output cannot be read before activation");
await t.mutation(api.procurementAnalytics.prepareDefaults, { societyId: ids.societyId, generation: lineage.generation });
assert.equal(await t.run(async ctx => (await ctx.db.query("procurementAnalytics").take(1)).length), 0);
await t.run(ctx => ctx.db.patch(ids.catalog, lineage));
await t.mutation(api.procurementAnalytics.prepareDefaults, { societyId: ids.societyId, generation: lineage.generation });
for (const view of DEFAULT_ANALYTICS_VIEWS) {
  const a = args(view), response = await reader.query(api.procurementAnalytics.get, a);
  assert.equal(response.state, "ready", view); assert.equal(response.asOf, asOf, "Original artifact clock is reported honestly");
  assert.deepEqual(JSON.parse(response.resultJson), JSON.parse(entries.find(entry => JSON.parse(entry.request).view === view)!.resultJson));
  await reader.mutation(api.procurementAnalytics.request, a);
}
assert.equal(await t.run(async ctx => (await ctx.db.query("procurementAnalytics").take(1)).length), 0, "Activation and minute-start requests seed no whole-catalog cold jobs");
assert.deepEqual(await t.mutation(api.procurementAnalytics.seed, makeSeed()), { written: 0, state: "reused" });
const older = buildDefaultSummaries([award, opportunity], evidence, asOf - 60000, true);
assert.deepEqual(await t.mutation(api.procurementAnalytics.seed, makeSeed(older, { asOf: asOf - 60000 })), { written: 0, state: "stale" });
await assert.rejects(t.mutation(api.procurementAnalytics.seed, { ...makeSeed(), rowsJson: "{}\n" }), /integrity/);
await assert.rejects(t.mutation(api.procurementAnalytics.seed, makeSeed(entries, { metricVersion: "wrong" })), /Unsupported/);
const conflict = entries.map(entry => ({ ...entry })); conflict[0].resultJson = conflict[0].resultJson.replace('"count":1', '"count":2');
await assert.rejects(t.mutation(api.procurementAnalytics.seed, makeSeed(conflict)), /Conflicting/);
await assert.rejects(t.query(api.procurementAnalytics.get, args("overview")), /Authentication/);
const expired = await reader.query(api.procurementAnalytics.get, args("opportunities", boundary + 1)); assert.equal(expired.state, "preparing", "Precise deadline invalidates an upstream result");
await reader.mutation(api.procurementAnalytics.request, args("opportunities", boundary + 1));
const filtered = { ...args("overview"), request: JSON.stringify({ view: "overview", filters: { buyer: "City" } }) };
await reader.mutation(api.procurementAnalytics.request, filtered);
assert.equal(await t.run(async ctx => (await ctx.db.query("procurementAnalytics").take(10)).length), 2, "Expired windows and arbitrary filters retain normal backend fallback");
const midnight = await reader.query(api.procurementAnalytics.get, args("overview", nextAnalyticsDay(asOf))); assert.equal(midnight.state, "preparing", "Vancouver midnight invalidates date-based defaults");
await t.run(async ctx => {
  const row = await ctx.db.query("procurementAnalyticsArtifacts").withIndex("by_society_generation_request", q => q.eq("societyId", ids.societyId).eq("generation", lineage.generation).eq("request", entries[0].request)).unique();
  await ctx.db.patch(row!._id, { engineVersion: "obsolete" });
});
assert.equal((await reader.query(api.procurementAnalytics.get, args("overview"))).state, "preparing", "An incompatible stored version retains normal fallback");

// A sidecar can expire while an exact delta is paused. Refresh only the sidecar,
// retain the committed operation boundary, then atomically activate its new hash.
const paused = await t.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Paused import", isCharity: false, isMemberFunded: false, updatedAt: 0, disabledModules: ["+procurementReview"] });
  const folder = `Zoer/bc-bid-monitor/${societyId}`;
  await ctx.db.patch(societyId, { integrationSettings: { ...defaultIntegrationSettings(), procurementReviewFolder: folder } as any });
  const old = { ...award, value: 123.45, societyId, generation: "physical-base", updatedAt: "2026-10-23" };
  await ctx.db.insert("procurementRecords", old);
  await ctx.db.insert("procurementDetails", { societyId, generation: old.generation, recordKey: old.recordKey, dataJson: "{}" });
  const expected = { procurementRecords: 1, procurementDetails: 1, procurementDocuments: 0, procurementEvidence: 0 };
  const catalog = await ctx.db.insert("procurementCatalogs", { societyId, generation: old.generation, folder, publishedAt: new Date(now).toISOString(), contentHash: "d".repeat(64), inventoryHash: "d".repeat(64), expected, counts: { award: 1 } });
  return { societyId, folder, old, expected, catalog };
});
const targetLineage = { ...lineage, societyId: paused.societyId, folder: paused.folder, generation: "paused-target" };
await t.run(ctx => ctx.db.insert("procurementImportJobs", { societyId: paused.societyId, folder: paused.folder, generation: targetLineage.generation, inventoryHash: targetLineage.inventoryHash, contentHash: targetLineage.contentHash, publishedAt: new Date(now).toISOString(), complete: true, phase: "validated", startedAt: now, heartbeatAt: now }));
const makePausedSeed = (at: number) => {
  const prepared = buildDefaultSummaries([{ ...award, title: "Changed" }], [], at, true), rowsJson = prepared.map(entry => canonicalSummary(entry) + "\n").join("");
  const manifest: SummaryManifest = { schemaVersion: 1, ...targetLineage, ...summaryVersions, asOf: at, computedAt: at, rows: { path: "analytics.jsonl", rowCount: 10, bytes: Buffer.byteLength(rowsJson), sha256: summarySha(rowsJson) } };
  const manifestJson = canonicalSummary(manifest) + "\n";
  return { societyId: paused.societyId, generation: targetLineage.generation, folder: paused.folder, contentHash: targetLineage.contentHash, inventoryHash: targetLineage.inventoryHash, bundleSha256: summarySha(manifestJson), manifestJson, rowsJson };
};
const oldSeed = makePausedSeed(asOf); await t.mutation(api.procurementAnalytics.seed, oldSeed);
const exact = { societyId: paused.societyId, folder: paused.folder, baseHash: "d".repeat(64), targetHash: targetLineage.contentHash, planHash: "e".repeat(64), operations: 1, baseInventoryHash: "d".repeat(64), targetInventoryHash: targetLineage.inventoryHash, baseExpected: paused.expected, expected: paused.expected, allowArchives: false, targetGeneration: targetLineage.generation, publishedAt: new Date(now).toISOString() };
const run = await t.mutation(api.procurementSync.begin, exact);
await t.mutation(api.procurementSync.applyBatch, { runId: run.runId, planHash: exact.planHash, batch: 0, operations: [{ table: "procurementRecords", key: award.recordKey, recordKey: award.recordKey, row: JSON.stringify({ ...paused.old, generation: targetLineage.generation, title: "Changed" }), before: JSON.stringify(paused.old) }] });
const descriptor = (seed: ReturnType<typeof makePausedSeed>) => ({ path: "analytics-manifest.json", bytes: Buffer.byteLength(seed.manifestJson), sha256: seed.bundleSha256 });
const finish = { runId: run.runId, planHash: exact.planHash, generation: targetLineage.generation, publishedAt: exact.publishedAt, counts: { award: 1 }, sourceCounts: { award: 1 }, sourceSnapshotId: targetLineage.sourceSnapshotId, sourceCatalogSha256: targetLineage.sourceCatalogSha256, publicationId: targetLineage.publicationId, inventoryHash: targetLineage.inventoryHash, taxonomyIndexes: [], analytics: descriptor(oldSeed) };
const realNow = Date.now, resumedAt = nextAnalyticsDay(asOf) + 60_000;
try {
  Date.now = () => resumedAt;
  await assert.rejects(t.mutation(api.procurementAnalytics.seed, oldSeed), /expired/, "Expired staging cannot trigger fallback warm-up at activation");
  await assert.rejects(t.mutation(api.procurementSync.finish, finish), /expired/, "The backend independently prevents stale sidecar activation");
  const freshSeed = makePausedSeed(resumedAt); assert.equal((await t.mutation(api.procurementAnalytics.seed, freshSeed)).written, 10);
  const resume = await t.mutation(api.procurementSync.begin, exact); assert.equal(resume.runId, run.runId); assert.equal(resume.nextBatch, 1); assert.equal(resume.applied, 1);
  await assert.rejects(t.mutation(api.procurementSync.finish, finish), /must be staged/, "An old frozen descriptor cannot activate after refresh");
  await t.mutation(api.procurementSync.finish, { ...finish, analytics: descriptor(freshSeed) });
  await t.mutation(api.procurementAnalytics.prepareDefaults, { societyId: paused.societyId, generation: targetLineage.generation });
  await t.run(async ctx => {
    const active = await ctx.db.get(paused.catalog); assert.deepEqual(active!.analytics, descriptor(freshSeed)); assert.equal(active!.syncRunId, undefined);
    assert.equal((await ctx.db.query("procurementSyncBatches").withIndex("by_run_batch", q => q.eq("runId", run.runId)).take(10)).length, 1, "Refresh never replays a committed row batch");
    assert.equal((await ctx.db.query("procurementAnalytics").withIndex("by_society_generation_key", q => q.eq("societyId", paused.societyId).eq("generation", targetLineage.generation)).take(10)).length, 0, "Exact resume activates refreshed defaults without cold jobs");
  });
} finally { Date.now = realNow; }
console.log("OK: exact model parity, SHA/lineage/omission/version/corrupt aggregate preflight, atomic preactivation seeding, idempotent/stale/conflict guards, authorization, minute reuse, precise deadline/DST midnight expiry, filtered/expired fallback, and paused exact-run sidecar refresh without batch replay or default cold scans.");
