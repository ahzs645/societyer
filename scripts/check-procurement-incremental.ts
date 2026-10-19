import assert from "node:assert/strict";
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
await assert.rejects(
  t.query(api.procurementReview.page, pageArgs),
  /auth|identity|sign|access/i,
);
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
};
await assert.rejects(
  t.mutation(api.procurementSync.begin, { ...begin, baseHash: "d".repeat(64) }),
  /baseline/i,
);
const run = await t.mutation(api.procurementSync.begin, begin);
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
console.log(
  "OK: bounded cursor pages, authentication, baseline conflicts, resumable checkpoint/retry, concurrent-plan refusal, incomplete-publication gate, count verification, unchanged row preservation, archived removals, storage-generation guards.",
);
