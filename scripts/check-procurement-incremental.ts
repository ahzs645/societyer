import assert from "node:assert/strict";
import { procurementSearchMatches } from "../shared/procurementSearchText";
assert.equal(procurementSearchMatches("Ministry of Forêts IS27-NRI-014", "forets ministry"), true);
assert.equal(procurementSearchMatches("Ministry of Forêts IS27-NRI-014", "is27nri014"), true);
assert.equal(procurementSearchMatches("Ministry of Forêts", "ministry timber"), false);
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { defaultIntegrationSettings } from "../shared/integrationSettings";
for (const key of [
  "TENANT_ID",
  "CLIENT_ID",
  "CLIENT_SECRET",
  "SITE_ID",
  "DRIVE_ID",
  "TRANSFER_HOSTS",
])
  process.env[`PROCUREMENT_SHAREPOINT_${key}`] = "synthetic";
const t = convexTest(schema, {
    "./_generated/api.js": () => import("../convex/_generated/api.js"),
    "./_generated/server.js": () => import("../convex/_generated/server.js"),
    "./procurementReview.js": () => import("../convex/procurementReview"),
    "./procurementSync.js": () => import("../convex/procurementSync"),
    "./procurementImport.js": () => import("../convex/procurementImport"),
    "./procurementMaintenance.js": () => import("../convex/procurementMaintenance"),
    "./procurementStatus.js": () => import("../convex/procurementStatus"),
    "./procurementAnalytics.js": () => import("../convex/procurementAnalytics"),
    "./procurementAnalyticsJobs.js": () => import("../convex/procurementAnalyticsJobs"),
  } as any),
  api: any = anyApi;
const issuer = betterAuthIssuer(),
  generation = "base",
  a = "a".repeat(64),
  b = "b".repeat(64),
  c = "c".repeat(64);
const fixture = await t.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", {
      name: "Incremental test",
      isCharity: false,
      isMemberFunded: false,
      updatedAt: 0,
      disabledModules: ["+procurementReview"],
    }),
    folder = `Zoer/bc-bid-monitor/${societyId}`;
  await ctx.db.patch(societyId, {
    integrationSettings: {
      ...defaultIntegrationSettings(),
      procurementReviewFolder: folder,
    },
  });
  await ctx.db.insert("users", {
    societyId,
    email: "test@example.invalid",
    displayName: "test",
    role: "Viewer",
    status: "Active",
    authSubject: "test",
    authIssuer: issuer,
    authProvider: "better-auth",
    createdAtISO: "2026-10-18",
  });
  const rows = [];
  for (let i = 0; i < 120; i++) {
    const row = {
      societyId,
      generation,
      recordKey: `opportunity:${String(i).padStart(3, "0")}`,
      kind: "opportunity",
      title: `Bridge ${i}`,
      organization: "City",
      status: "Open",
      date: "2099-01-01",
      updatedAt: "2026-10-18",
      searchText: `Bridge ${i} City`,
      documents: i,
    };
    await ctx.db.insert("procurementRecords", row);
    await ctx.db.insert("procurementDetails", {
      societyId,
      generation,
      recordKey: row.recordKey,
      dataJson: JSON.stringify({ body: `Original ${i}` }),
    });
    rows.push(row);
  }
  await ctx.db.insert("procurementCatalogs", {
    societyId,
    generation,
    folder,
    publishedAt: "2026-10-18",
    counts: { opportunity: 120 },
    contentHash: a,
    profileVersion: 2,
  });
  return { societyId, folder, rows };
});
const reader = t.withIdentity({ subject: "test", issuer });
const pageArgs = {
  societyId: fixture.societyId,
  generation,
  kind: "opportunity",
  request: JSON.stringify({ columns: [], filters: [], sorts: [] }),
  asOf: Date.UTC(2026, 9, 18),
  paginationOpts: { numItems: 1000, cursor: null },
};
const first = await reader.query(api.procurementReview.page, pageArgs);
assert.equal(first.page.length, 50);
assert.equal(first.isDone, false);
assert.equal(first.scanned, 50);
const second = await reader.query(api.procurementReview.page, {
  ...pageArgs,
  paginationOpts: { numItems: 50, cursor: first.continueCursor },
});
assert.equal(second.page.length, 50);
assert.equal(
  new Set([...first.page, ...second.page].map((r: any) => r.recordKey)).size,
  100,
);
const oldCursorPage = await reader.query(api.procurementReview.page, { ...pageArgs, paginationOpts: { numItems: 50, cursor: "old-native-cursor" } });
assert.equal(oldCursorPage.restart, true);
assert.equal(oldCursorPage.page.length, 50, "Old deployment cursors restart without an InvalidCursor page crash");
const changedOrdering = await reader.query(api.procurementReview.page, { ...pageArgs,
  request: JSON.stringify({ columns: [{ fieldMetadataId: "title", field: { name: "title" } }], sorts: [{ fieldMetadataId: "title", direction: "asc" }] }),
  paginationOpts: { numItems: 50, cursor: first.continueCursor },
});
assert.equal(changedOrdering.restart, true, "A cursor from another indexed ordering cannot be reused");

await assert.rejects(
  t.query(api.procurementReview.page, pageArgs),
  /auth|identity|sign|access/i,
);
// A chosen numeric ordering applies across cursor pages, including search.
const numericRequest = (direction: string, searchTerm = "") => JSON.stringify({
  columns: [{ fieldMetadataId: "docs", field: { _id: "docs", name: "documents", fieldType: "NUMBER", config: {} } }],
  filters: [], sorts: [{ fieldMetadataId: "docs", direction }], searchTerm,
});
for (const searchTerm of ["", "bridge city"]) {
  for (const direction of ["asc", "desc"]) {
    const request = numericRequest(direction, searchTerm);
    const head = await reader.query(api.procurementReview.page, { ...pageArgs, request });
    const tail = await reader.query(api.procurementReview.page, { ...pageArgs, request, paginationOpts: { numItems: 50, cursor: head.continueCursor } });
    const values = [...head.page, ...tail.page].map((row: any) => row.documents);
    assert.equal(values.length, 100);
    assert.ok(values.every((value: number, i: number) => !i || (direction === "asc" ? values[i - 1] <= value : values[i - 1] >= value)), "Sort remains global across pages and searches");
    assert.equal(head.relevance, false);
  }
}
const numericFilter = await reader.query(api.procurementReview.page, { ...pageArgs,
  request: JSON.stringify({ ...JSON.parse(numericRequest("desc")), filters: [{ id: "min-docs", fieldMetadataId: "docs", operator: "gte", value: 100 }] }),
});
assert.equal(numericFilter.page.length, 20);
assert.ok(numericFilter.page.every((row: any) => row.documents >= 100));

const ascendingThreshold = await reader.query(api.procurementReview.page, { ...pageArgs,
  request: JSON.stringify({ ...JSON.parse(numericRequest("asc")), filters: [{ id: "min-docs", fieldMetadataId: "docs", operator: "gte", value: 100 }] }),
});
assert.equal(ascendingThreshold.page.length, 20, "Numeric bounds skip nonmatching index entries before pagination in ascending order");
assert.equal(ascendingThreshold.scanned, 20);

// Header filters wrap flat saved-view constraints into an AND group. Their
// date narrowing must still skip earlier historical records before paging.
const groupedColumns = [{ fieldMetadataId: "date", field: { _id: "date", name: "when", fieldType: "DATE_TIME", config: {} } }];
const groupedRequest = JSON.stringify({ columns: groupedColumns, filters: [{ id: "date-filter", fieldMetadataId: "date", operator: "between", value: { preset: "custom", start: "2099-01-01" }, viewFilterGroupId: "root" }], filterGroups: [{ id: "root", logicalOperator: "and" }], sorts: [{ fieldMetadataId: "date", direction: "asc" }] });
await t.run(async ctx => {
  for (let i = 0; i < 260; i++) await ctx.db.insert("procurementRecords", { ...fixture.rows[0], recordKey: `historical:${i}`, date: "2000-01-01" });
});
const narrowed = await reader.query(api.procurementReview.page, { ...pageArgs, request: groupedRequest });
assert.equal(narrowed.page.length, 50, "Grouped date constraints retain the indexed lower bound rather than stopping on empty historical batches");
await t.run(async ctx => {
  const historical = await ctx.db.query("procurementRecords").withIndex("by_key", q => q.eq("societyId", fixture.societyId).eq("generation", generation)).take(1000);
  for (const row of historical) if (row.recordKey.startsWith("historical:")) await ctx.db.delete(row._id);
});

const old = fixture.rows[0],
  newRow = { ...old, title: "Updated bridge" },
  detail = {
    societyId: fixture.societyId,
    generation,
    recordKey: old.recordKey,
    dataJson: JSON.stringify({ body: "Original 0" }),
  };
const begin = {
  societyId: fixture.societyId,
  folder: fixture.folder,
  baseHash: a,
  targetHash: c,
  planHash: b,
  operations: 4,
  baseInventoryHash: a, targetInventoryHash: c,
  baseExpected: {procurementRecords:120,procurementDetails:120,procurementDocuments:0,procurementEvidence:0},
  expected: {procurementRecords:119,procurementDetails:119,procurementDocuments:0,procurementEvidence:0},
  targetGeneration: "publication-2", publishedAt: "2026-10-19", allowArchives:true,
};
await assert.rejects(
  t.mutation(api.procurementSync.begin, { ...begin, baseHash: "d".repeat(64) }),
  /baseline/i,
);
const run = await t.mutation(api.procurementSync.begin, begin);
assert.equal((await reader.query(api.procurementStatus.get,{societyId:fixture.societyId})).state,"importing");
await assert.rejects(t.query(api.procurementStatus.get,{societyId:fixture.societyId}),/auth|identity|sign|access/i);
await t.mutation(api.procurementSync.fail,{runId:run.runId,planHash:b,error:"Synthetic interruption"});
const failed=await reader.query(api.procurementStatus.get,{societyId:fixture.societyId});
assert.equal(failed.state,"failed");assert.equal(failed.run.error,"Synthetic interruption");
assert.equal(failed.lastSuccessful.generation,generation);assert.match(failed.recovery,/exact verified export/);
await t.mutation(api.procurementSync.begin,begin);
await t.run(async ctx=>{await ctx.db.patch(run.runId,{heartbeatAt:Date.now()-6*60_000})});
assert.equal((await reader.query(api.procurementStatus.get,{societyId:fixture.societyId})).state,"stalled");
await t.mutation(api.procurementSync.begin,begin);
assert.equal(
  await reader.query(api.procurementReview.catalog, {
    societyId: fixture.societyId,
  }),
  null,
  "Incomplete publication is hidden",
);
const op = (table: string, row: any, before: any) => ({
  table,
  key: (row ?? before).recordKey,
  recordKey: (row ?? before).recordKey,
  row: row ? JSON.stringify(row) : null,
  before: before ? JSON.stringify(before) : null,
});
const batch = {
  runId: run.runId,
  planHash: b,
  batch: 0,
  operations: [
    op("procurementRecords", newRow, old),
    op(
      "procurementDetails",
      { ...detail, dataJson: '{"body":"Updated"}' },
      detail,
    ),
  ],
};
const untouched = await t.run((ctx) =>
  ctx.db
    .query("procurementRecords")
    .withIndex("by_key", (q) =>
      q
        .eq("societyId", fixture.societyId)
        .eq("generation", generation)
        .eq("recordKey", fixture.rows[50].recordKey),
    )
    .unique(),
);
await assert.rejects(
  t.mutation(api.procurementSync.applyBatch, {
    ...batch,
    operations: [
      op("procurementRecords", newRow, { ...old, title: "Wrong baseline" }),
    ],
  }),
  /conflict/i,
);
await t.mutation(api.procurementSync.applyBatch, batch);
assert.equal(
  (await t.mutation(api.procurementSync.applyBatch, batch)).applied,
  2,
  "Retry does not reapply a batch",
);
await assert.rejects(
  t.mutation(api.procurementSync.begin, { ...begin, planHash: "e".repeat(64) }),
  /in progress/,
);
const finish = {
  runId: run.runId,
  planHash: b,
  generation: "publication-2",
  publishedAt: "2026-10-19",
  counts: { opportunity: 119 },
  sourceCounts: { opportunity: 119 },
  sourceSnapshotId: "archive-2",
  sourceCatalogSha256: a,
  taxonomyIndexes: [],
};
await assert.rejects(
  t.mutation(api.procurementSync.finish, finish),
  /incomplete/,
);
await assert.rejects(t.mutation(api.procurementSync.applyBatch,{...batch,operations:[op("procurementRecords",{...newRow,title:"Different replay"},old)]}),/Replayed batch differs/);
const removed = fixture.rows[1],
  removedDetail = {
    ...detail,
    recordKey: removed.recordKey,
    dataJson: JSON.stringify({ body: "Original 1" }),
  };
await t.mutation(api.procurementSync.applyBatch, {
  ...batch,
  batch: 1,
  operations: [
    op("procurementRecords", null, removed),
    op("procurementDetails", null, removedDetail),
  ],
});
await assert.rejects(
  t.mutation(api.procurementSync.finish, {
    ...finish,
    counts: { opportunity: 120 },
  }),
  /counts/,
);
await t.mutation(api.procurementSync.finish, finish);
await t.mutation(api.procurementSync.finish, finish);
const activated = await reader.query(api.procurementReview.catalog, {
  societyId: fixture.societyId,
});
assert.equal(activated.generation, "publication-2");
assert.equal((await reader.query(api.procurementStatus.get,{societyId:fixture.societyId})).state,"ready");
const rows = await reader.query(api.procurementReview.page, {
  ...pageArgs,
  generation: "publication-2",
});
assert.ok(rows.page.every((r: any) => r.recordKey !== removed.recordKey));
assert.equal(
  (
    await reader.query(api.procurementReview.record, {
      societyId: fixture.societyId,
      generation: "publication-2",
      recordKey: old.recordKey,
    })
  ).summary.title,
  "Updated bridge",
);
const preserved = await t.run((ctx) => ctx.db.get(untouched!._id));
assert.deepEqual(preserved, untouched, "Unchanged row is not rewritten");
const tombstone = await t.run((ctx) =>
  ctx.db
    .query("procurementRecords")
    .withIndex("by_key", (q) =>
      q
        .eq("societyId", fixture.societyId)
        .eq("generation", generation)
        .eq("recordKey", removed.recordKey),
    )
    .unique(),
);
assert.equal(tombstone?.archived, true);
assert.equal(tombstone?.title, removed.title);
await assert.rejects(
  t.mutation(api.procurementImport.purgePage, {
    societyId: fixture.societyId,
    generation,
    table: "procurementRecords",
  }),
  /active/,
);

// An uploaded publication may fail before activation while the last completed catalog stays readable.
const jobArgs={societyId:fixture.societyId,folder:fixture.folder,generation:"publication-3",inventoryHash:a,contentHash:b,publishedAt:"2026-10-20",complete:true};
const jobId=await t.mutation(api.procurementImport.beginJob,jobArgs);
assert.equal(await t.mutation(api.procurementImport.beginJob,jobArgs),jobId,"Exact publication registration is idempotent");
await assert.rejects(t.mutation(api.procurementImport.beginJob,{...jobArgs,generation:"publication-4"}),/Another publication is pending/);
await t.mutation(api.procurementImport.jobProgress,{jobId,phase:"failed",error:"Source uploaded; import stopped"});
const publicationFailure=await reader.query(api.procurementStatus.get,{societyId:fixture.societyId});
assert.equal(publicationFailure.state,"failed");assert.equal(publicationFailure.source.generation,"publication-3");
assert.equal(publicationFailure.lastSuccessful.generation,"publication-2");
assert.equal((await reader.query(api.procurementReview.catalog,{societyId:fixture.societyId})).generation,"publication-2");

// Materialize the same candidate index used in production, then exercise exact search.
let searchCursor:string|null=null;
for(;;){const indexed=await t.mutation(api.procurementSync.indexSearchPage,{societyId:fixture.societyId,cursor:searchCursor});if(indexed.done)break;searchCursor=indexed.cursor;}
const searchable=await reader.query(api.procurementReview.page,{...pageArgs,generation:"publication-2",request:JSON.stringify({columns:[],filters:[],sorts:[],searchTerm:"CITY updated"})});
assert.equal(searchable.page.length,1);assert.equal(searchable.page[0].recordKey,old.recordKey,"Search is case-insensitive, any order and every word must match");

console.log(
  "OK: bounded cursor pages, authentication, baseline conflicts, resumable checkpoint/retry, concurrent-plan refusal, incomplete-publication gate, count verification, unchanged row preservation, archived removals, storage-generation guards.",
);
