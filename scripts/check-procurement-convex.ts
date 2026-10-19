import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { defaultIntegrationSettings } from "../shared/integrationSettings";
import { betterAuthIssuer } from "../convex/lib/authIdentity";

for (const key of ["TENANT_ID", "CLIENT_ID", "CLIENT_SECRET", "SITE_ID", "DRIVE_ID", "TRANSFER_HOSTS"]) process.env[`PROCUREMENT_SHAREPOINT_${key}`] = "synthetic";
const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./procurementReview.js": () => import("../convex/procurementReview"),
  "./procurementTaxonomy.js": () => import("../convex/procurementTaxonomy"),
  "./procurementImport.js": () => import("../convex/procurementImport"),
  "./procurementMaintenance.js": () => import("../convex/procurementMaintenance"),
} as any);
const api: any = anyApi;
const issuer = betterAuthIssuer();
const ids = await t.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Procurement test", isCharity: false, isMemberFunded: false, updatedAt: 0, disabledModules: ["+procurementReview"] });
  const foreign = await ctx.db.insert("societies", { name: "Foreign", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const folder = `Zoer/bc-bid-monitor/${societyId}`;
  await ctx.db.patch(societyId, { integrationSettings: { ...defaultIntegrationSettings(), procurementReviewFolder: folder } as any });
  for (const [subject, sid] of [["reader", societyId], ["foreign", foreign]] as const) await ctx.db.insert("users", { societyId: sid, email: `${subject}@example.invalid`, displayName: subject, role: "Viewer", status: "Active", authSubject: subject, authIssuer: issuer, authProvider: "better-auth", createdAtISO: "2026-10-18" });
  const generation = "20261018T170258Z-1138c2082de4";
  // 1,300 opportunities: more than one list page. Half are an older import's rows with a 16 KB search corpus and none of the list columns.
  const corpus = "x".repeat(16_000);
  for (let i = 0; i < 1300; i++) {
    const recordKey = `opportunity:${String(i).padStart(4, "0")}`;
    const columns = i % 2 ? { searchText: corpus } : { issuedFor: "Health Authority", reference: `REF-${i}`, documents: i % 3, listedDocuments: 1, supplier: "", currency: "", procurementType: "" };
    await ctx.db.insert("procurementRecords", { societyId, generation, recordKey, kind: "opportunity", title: `Bridge ${i}`, organization: "Test City", status: i % 2 ? "Open" : "Closed", date: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}`, updatedAt: "2026-10-18", ...columns });
    await ctx.db.insert("procurementDetails", { societyId, generation, recordKey, dataJson: JSON.stringify({ descriptionText: "Notice body only fetched on demand" }) });
  }
  for (const [key, date, value] of [["award:a", "2026-10-01", 148500], ["award:b", "2026-10-20T14:00", undefined], ["award:c", "2026-11-05", 0]] as const) {
    await ctx.db.insert("procurementRecords", { societyId, generation, recordKey: key, kind: "award", title: `Award ${key}`, organization: "Test City", status: "Awarded", date, dateText: date, updatedAt: "2026-10-18", supplier: "Cedar & Main", currency: "CAD", procurementType: "Request for Proposals", ...(value === undefined ? {} : { value }) });
    await ctx.db.insert("procurementDetails", { societyId, generation, recordKey: key, dataJson: "{}" });
  }
  for (const [recordKey, source] of [["opportunity:0000", "procurement_decisions"], ["opportunity:0000", "procurement_requirements"], ["opportunity:0001", "procurement_decisions"]]) {
    await ctx.db.insert("procurementEvidence", { societyId, generation, recordKey, source, dataJson: JSON.stringify({ record_id: recordKey, source }) });
  }
  await ctx.db.insert("procurementEvidence", { societyId: foreign, generation, recordKey: "opportunity:0000", source: "procurement_decisions", dataJson: "{\"secret\":true}" });
  // Another workspace deliberately reuses the same generation and source key.
  await ctx.db.insert("procurementRecords", { societyId: foreign, generation, recordKey: "opportunity:0000", kind: "opportunity", title: "Private foreign record", organization: "Secret", status: "Open", date: "2099", updatedAt: "" });
  await ctx.db.insert("procurementDocuments", { societyId, generation, recordKey: "opportunity:0000", documentKey: "doc", name: "test.pdf", mediaType: "application/pdf", sha256: "a".repeat(64), sourceUrl: "https://example.invalid", status: "ready", bytes: 10, parts: 0, available: true });
  return { societyId, foreign, generation, folder };
});
const reader = t.withIdentity({ subject: "reader", issuer });
const args = { societyId: ids.societyId, generation: ids.generation, kind: "opportunity", paginationOpts: { numItems: 1000, cursor: null } };
assert.equal(await reader.query(api.procurementReview.catalog, { societyId: ids.societyId }), null, "Unactivated imports are invisible");
const activation = { societyId: ids.societyId, generation: ids.generation, folder: ids.folder, publishedAt: "2026-10-18T17:02:58Z", counts: { opportunity: 1300, award: 3 }, expected: { procurementRecords: 1303, procurementDetails: 1303, procurementDocuments: 1, procurementEvidence: 3 } };
await assert.rejects(t.action(api.procurementImport.activate, { ...activation, counts: { opportunity: 1301, award: 3 }, expected: { ...activation.expected, procurementRecords: 1304, procurementDetails: 1304 } }), /incomplete/);
assert.equal(await reader.query(api.procurementReview.catalog, { societyId: ids.societyId }), null);
await t.action(api.procurementImport.activate, activation);
const term = { key: "taxonomy-term:UNSPSC:1:100", releaseId: "taxonomy-release:UNSPSC:1", scheme: "UNSPSC", version: "1", code: "100", title: "Construction", parentKey: null };
const termBatch = { societyId: ids.societyId, folder: ids.folder, terms: [term] };
assert.deepEqual(await t.mutation(api.procurementImport.importTerms, termBatch), { inserted: 1, reused: 0 });
assert.deepEqual(await t.mutation(api.procurementImport.importTerms, termBatch), { inserted: 0, reused: 1 }, "Unchanged taxonomy is reused, not copied for every generation");
await assert.rejects(t.mutation(api.procurementImport.importTerms, { ...termBatch, terms: [{ ...term, title: "Changed in place" }] }), /release changed/i);
await assert.rejects(t.mutation(api.procurementImport.importTerms, { ...termBatch, terms: [term, term] }), /Duplicate/);
await assert.rejects(t.mutation(api.procurementImport.importTerms, { ...termBatch, folder: `Zoer/bc-bid-monitor/${ids.foreign}` }), /folder|workspace/i);
const termHash = createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(term).sort(([a], [b]) => a.localeCompare(b)))) + "\n").digest("hex");
const release = { societyId: ids.societyId, releaseId: term.releaseId, contentHash: termHash, count: 1 };
assert.equal(await t.mutation(api.procurementImport.beginTaxonomy, { ...release, folder: ids.folder }), "resume", "Existing rows are verified without appending them again");
await assert.rejects(t.action(api.procurementTaxonomy.finishTaxonomy, { ...release, contentHash: "b".repeat(64) }), /reservation/);
await t.action(api.procurementTaxonomy.finishTaxonomy, release);
assert.equal(await t.mutation(api.procurementImport.beginTaxonomy, { ...release, folder: ids.folder }), "reuse", "Ready releases skip full row scans on future publications");
await assert.rejects(t.mutation(api.procurementImport.beginTaxonomy, { ...release, count: 2, folder: ids.folder }), /release changed/);
const incomplete = { ...release, releaseId: "missing", contentHash: "b".repeat(64) };
assert.equal(await t.mutation(api.procurementImport.beginTaxonomy, { ...incomplete, folder: ids.folder }), "import");
assert.equal(await t.mutation(api.procurementImport.beginTaxonomy, { ...incomplete, folder: ids.folder }), "resume", "Reservation blocks concurrent append imports");
await assert.rejects(t.action(api.procurementTaxonomy.finishTaxonomy, incomplete), /incomplete/);
assert.deepEqual((await t.query(api.procurementImport.generations, { societyId: ids.societyId })).generations, [ids.generation]);
await t.action(api.procurementImport.activate, { ...activation, profileVersion: 2, sourceSnapshotId: ids.generation, sourceCatalogSha256: "c".repeat(64), taxonomyIndexes: [{ releaseId: term.releaseId, contentHash: termHash, count: 1 }], taxonomyCount: 1 });
await assert.rejects(t.action(api.procurementImport.activate, { ...activation, profileVersion: 2, sourceSnapshotId: ids.generation, sourceCatalogSha256: "c".repeat(64), taxonomyIndexes: [{ releaseId: term.releaseId, contentHash: "d".repeat(64), count: 1 }], taxonomyCount: 1 }), /not verified/);
const state = await t.query(api.procurementImport.state, { societyId: ids.societyId });
assert.equal(state.generation, ids.generation);
await t.mutation(api.procurementImport.commit, { ...activation, profileVersion: 2, contentHash: "a".repeat(64), sourceCounts: { opportunity: 1300, award: 3, "taxonomy-term": 89972 }, taxonomyReleases: [term.releaseId], taxonomyCount: 1 });
assert.equal((await t.query(api.procurementImport.state, { societyId: ids.societyId })).contentHash, "a".repeat(64));
await t.mutation(api.procurementImport.commit, activation);
assert.equal((await t.query(api.procurementImport.state, { societyId: ids.societyId })).profileVersion, undefined, "Legacy rollback clears the compact fingerprint");
await t.run(async ctx => {
  await ctx.db.insert("procurementRecords", { societyId: ids.societyId, generation: "inactive", recordKey: "opportunity:old", kind: "opportunity", title: "Old", organization: "", status: "", date: "", updatedAt: "", searchText: "Old" });
  await ctx.db.insert("procurementDetails", { societyId: ids.societyId, generation: "inactive", recordKey: "opportunity:old", dataJson: "{}" });
});
await t.run(async ctx => { await ctx.db.insert("procurementDetails", { societyId: ids.societyId, generation: "partial-retirement", recordKey: "award:old", dataJson: "{}" }); });
assert.ok((await t.query(api.procurementImport.generations, { societyId: ids.societyId })).generations.includes("partial-retirement"), "Interrupted cleanup remains discoverable after all list rows are gone");
assert.deepEqual(await t.action(api.procurementImport.purgeRanges, { societyId: ids.societyId, generation: "partial-retirement", table: "procurementDetails", ranges: [{ lowerKey: "", upperKey: null }], cursor: null }), { removed: 1, completedRanges: 1, cursor: null });
await t.run(async ctx => {
  for (let i = 0; i < 1010; i++) await ctx.db.insert("procurementDetails", { societyId: ids.societyId, generation: "range-resume", recordKey: `award:${String(i).padStart(4, "0")}`, dataJson: "{}" });
});
const rangeArgs = { societyId: ids.societyId, generation: "range-resume", table: "procurementDetails", lowerKey: "", upperKey: null };
const rangePage = await t.mutation(api.procurementImport.purgeRangePage, { ...rangeArgs, cursor: null });
assert.deepEqual([rangePage.removed, rangePage.done], [100, false]);
let retired = rangePage.removed, retirementCursor = rangePage.cursor;
for (;;) {
  const tail = await t.mutation(api.procurementImport.purgeRangePage, { ...rangeArgs, cursor: retirementCursor });
  assert.ok(tail.removed <= 100, "Delete transactions remain small");
  retired += tail.removed; retirementCursor = tail.cursor;
  if (tail.done) break;
}
assert.equal(retired, 1010, "Continuation cursors survive deleting every previous page");
assert.deepEqual(await t.action(api.procurementImport.purgeRanges, { societyId: ids.societyId, generation: "range-resume", table: "procurementDetails", ranges: [{ lowerKey: "", upperKey: null }], cursor: null }), { removed: 0, completedRanges: 1, cursor: null }, "Already retired backup ranges are idempotent");
await assert.rejects(t.mutation(api.procurementImport.purgeRangePage, { ...rangeArgs, generation: ids.generation, cursor: null }), /active generation/);
await t.action(api.procurementImport.purgeGeneration, { societyId: ids.societyId, generation: "inactive" });
assert.deepEqual((await t.query(api.procurementImport.generations, { societyId: ids.societyId })).generations, [ids.generation]);
assert.deepEqual(await t.mutation(api.procurementImport.importTerms, termBatch), { inserted: 0, reused: 1 }, "Retiring a generation retains shared taxonomy");
await assert.rejects(t.action(api.procurementImport.activate, { ...activation, profileVersion: 2, counts: { opportunity: 61, award: 2, "taxonomy-term": 1 } }), /only opportunities/i);
await assert.rejects(t.action(api.procurementImport.purgeGeneration, { societyId: ids.societyId, generation: ids.generation }), /active generation/);
/** Every page of a paginated query, as the reader loads it. */
async function allPages<Row>(name: unknown, base: Record<string, unknown>, numItems: number) {
  let cursor: string | null = null; const rows: Row[] = []; let calls = 0;
  for (;;) {
    const result: { page: Row[]; isDone: boolean; continueCursor: string } = await reader.query(name as never, { ...base, paginationOpts: { numItems, cursor } } as never);
    assert.ok(result.page.length <= numItems);
    assert.ok(JSON.stringify(result).length < 1_000_000, "A list page stays well under a function's return limit");
    rows.push(...result.page); calls++;
    if (result.isDone) return { rows, calls };
    cursor = result.continueCursor;
  }
}
type ListRow = { recordKey: string; title: string; issuedFor: string; reference: string; documents: number; listedDocuments: number; supplier: string; value: number | null; currency: string; procurementType: string; dateText: string };
const legacy = await reader.query(api.procurementReview.records, { ...args, paginationOpts: { numItems: 25, cursor: null } });
assert.equal(legacy.page.length, 25, "Already-open paged-reader tabs remain compatible");
await assert.rejects(t.query(api.procurementReview.records, args), /auth|sign|identity|access/i);
const { rows: opportunities, calls } = await allPages<ListRow>(api.procurementReview.list, args, 1000);
assert.equal(new Set(opportunities.map((row) => row.recordKey)).size, 1300, "Every opportunity, once");
assert.ok(calls >= 3, `Older rows' search corpus counts toward the bytes bound, so pages stop early (${calls} pages)`);
for (const row of opportunities) { assert.ok(!("searchText" in row) && !("dataJson" in row) && !("societyId" in row)); assert.ok(!row.title.includes("foreign")); }
const old = opportunities.find((row) => row.recordKey === "opportunity:0001")!;
assert.deepEqual([old.issuedFor, old.reference, old.documents, old.listedDocuments, old.value, old.dateText], ["", "", 0, 0, null, ""], "An older import's missing columns read as empty");
const fresh = opportunities.find((row) => row.recordKey === "opportunity:0002")!;
assert.deepEqual([fresh.issuedFor, fresh.reference, fresh.documents, fresh.listedDocuments], ["Health Authority", "REF-2", 2, 1]);
const awards = (await allPages<ListRow>(api.procurementReview.list, { ...args, kind: "award" }, 1000)).rows;
assert.deepEqual(awards.map((row) => [row.recordKey, row.value, row.supplier, row.currency]), [["award:a", 148500, "Cedar & Main", "CAD"], ["award:b", null, "Cedar & Main", "CAD"], ["award:c", 0, "Cedar & Main", "CAD"]], "Awards carry supplier, value (null when unreadable) and currency, in date order");
assert.equal((await reader.query(api.procurementReview.list, { ...args, paginationOpts: { numItems: 50_000, cursor: null } })).page.length <= 1000, true, "A page never exceeds its row bound");
assert.equal((await reader.query(api.procurementReview.record, { societyId: ids.societyId, generation: ids.generation, recordKey: "opportunity:0000" })).summary.title, "Bridge 0");
assert.equal((await reader.query(api.procurementReview.documents, { societyId: ids.societyId, generation: ids.generation, recordKey: "opportunity:0000", paginationOpts: { numItems: 10, cursor: null } })).page[0].name, "test.pdf");
const catalogReviews = (await allPages<{ recordKey: string; source: string }>(api.procurementReview.reviews, { societyId: ids.societyId, generation: ids.generation }, 500)).rows;
assert.deepEqual(catalogReviews.map((row) => `${row.recordKey} ${row.source}`).sort(), ["opportunity:0000 procurement_decisions", "opportunity:0000 procurement_requirements", "opportunity:0001 procurement_decisions"], "Every review row in the workspace's catalog, with its record, and none of another workspace's");
const review = await reader.query(api.procurementReview.review, { societyId: ids.societyId, generation: ids.generation, recordKey: "opportunity:0000" });
assert.deepEqual(review.rows.map((row: { source: string }) => row.source).sort(), ["procurement_decisions", "procurement_requirements"], "One read returns every review row for the record, and only that record's");
assert.equal(review.truncated, false);
assert.deepEqual(await reader.query(api.procurementReview.review, { societyId: ids.societyId, generation: "another", recordKey: "opportunity:0000" }), { rows: [], truncated: false });
await assert.rejects(t.withIdentity({ subject: "foreign", issuer }).query(api.procurementReview.review, { societyId: ids.societyId, generation: ids.generation, recordKey: "opportunity:0000" }), /membership|access|workspace|bound/i);
for (const [name, query] of [[api.procurementReview.list, args], [api.procurementReview.reviews, { societyId: ids.societyId, generation: ids.generation, paginationOpts: args.paginationOpts }]]) {
  await assert.rejects(t.query(name, query), /auth|sign|identity|access/i);
  await assert.rejects(t.withIdentity({ subject: "foreign", issuer }).query(name, query), /membership|access|workspace|bound/i);
}
await assert.rejects(reader.mutation(api.procurementReview.setFolder, { societyId: ids.societyId, folder: ids.folder }), /Permission/);
await t.run(async ctx => { await ctx.db.patch(ids.societyId, { integrationSettings: { ...defaultIntegrationSettings(), procurementReviewFolder: `${ids.folder}/new` } as any }); });
assert.equal(await reader.query(api.procurementReview.catalog, { societyId: ids.societyId }), null, "Folder changes immediately hide the previous import");
assert.equal((await reader.query(api.procurementReview.list, args)).page.length, 0);
assert.equal((await reader.query(api.procurementReview.reviews, { societyId: ids.societyId, generation: ids.generation, paginationOpts: { numItems: 500, cursor: null } })).page.length, 0);
await t.run(async ctx => { await ctx.db.patch(ids.societyId, { disabledModules: [] }); });
await assert.rejects(reader.query(api.procurementReview.catalog, { societyId: ids.societyId }), /module|enabled|disabled/i);
console.log("OK: whole-kind list in bounded pages (rows and bytes), older imports' empty columns, catalog-wide review rows, one-read review rows, compact payload, workspace isolation, read-only permissions, incomplete-import refusal, atomic activation, folder and module gates.");
