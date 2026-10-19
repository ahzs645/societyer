import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";

const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./procurementImport.js": () => import("../convex/procurementImport"),
  "./procurementSync.js": () => import("../convex/procurementSync"),
  "./procurementMaintenance.js": () => import("../convex/procurementMaintenance"),
} as any);
const api: any = anyApi;
const fixture = await t.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Synthetic maintenance", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const foreign = await ctx.db.insert("societies", { name: "Independent workspace", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const catalogId = await ctx.db.insert("procurementCatalogs", { societyId, generation: "publication-1", storageGeneration: "physical", folder: "test", publishedAt: "test", counts: { opportunity: 61 } });
  for (let i = 0; i < 61; i++) await ctx.db.insert("procurementRecords", {
    societyId, generation: "physical", recordKey: `opportunity:${String(i).padStart(3, "0")}`, kind: "opportunity", title: `Notice ${i}`, organization: "City", status: "Open", date: "2099-01-01", updatedAt: "test",
  });
  for (let i = 0; i < 205; i++) await ctx.db.insert("procurementDetails", { societyId, generation: "obsolete", recordKey: `opportunity:${String(i).padStart(3, "0")}`, dataJson: "{}" });
  return { societyId, foreign, catalogId };
});
const { societyId } = fixture;
const reservation = { societyId, owner: "one", purpose: "synthetic held reservation" };
await t.mutation(api.procurementMaintenance.acquire, reservation);
await assert.rejects(t.mutation(api.procurementMaintenance.acquire, { ...reservation, owner: "two" }), /already running/);
await assert.rejects(t.action(api.procurementSync.indexSearchSlice, { societyId, cursor: null }), /already running/);
await assert.rejects(t.action(api.procurementImport.purgeGeneration, { societyId, generation: "obsolete" }), /already running/);
const deletion = { societyId, generation: "obsolete", table: "procurementDetails" };
await assert.rejects(t.mutation(api.procurementImport.purgePage, deletion), /reservation unavailable/);
await t.mutation(api.procurementMaintenance.acquire, { ...reservation, societyId: fixture.foreign, owner: "independent" });
await t.mutation(api.procurementMaintenance.release, { societyId, owner: "wrong" });
await assert.rejects(t.mutation(api.procurementImport.purgePage, deletion), /reservation unavailable/);
await t.mutation(api.procurementMaintenance.acquire, reservation); // Owner renewal is idempotent.
await t.run(async ctx => {
  const row = await ctx.db.query("procurementMaintenanceLeases").withIndex("by_society", q => q.eq("societyId", societyId)).unique();
  await ctx.db.patch(row!._id, { expiresAt: 0 });
});
await assert.rejects(t.mutation(api.procurementImport.purgePage, { ...deletion, maintenanceOwner: "one" }), /reservation unavailable/);
await t.mutation(api.procurementMaintenance.acquire, { ...reservation, owner: "two" });
await t.mutation(api.procurementMaintenance.release, { societyId, owner: "one" });
await assert.rejects(t.mutation(api.procurementImport.purgePage, deletion), /reservation unavailable/, "Old owner cannot release a successor's reservation");
await t.mutation(api.procurementMaintenance.release, { societyId, owner: "two" });

// A failing action releases its own reservation, but never deletes the active generation.
await assert.rejects(t.action(api.procurementImport.purgeGeneration, { societyId, generation: "physical" }), /active generation/);
assert.equal(await t.run(ctx => ctx.db.query("procurementMaintenanceLeases").withIndex("by_society", q => q.eq("societyId", societyId)).unique()), null);
assert.equal(await t.mutation(api.procurementImport.purgePage, deletion), 100);
await t.action(api.procurementImport.purgeGeneration, { societyId, generation: "obsolete" });
assert.equal(await t.run(ctx => ctx.db.query("procurementDetails").withIndex("by_key", q => q.eq("societyId", societyId).eq("generation", "obsolete")).first()), null);
assert.equal((await t.run(ctx => ctx.db.query("procurementRecords").collect())).length, 61);

const first = await t.mutation(api.procurementSync.indexSearchPage, { societyId, cursor: null });
assert.equal(first.rows, 25); assert.equal(first.done, false);
const initial = await t.run(ctx => ctx.db.query("procurementSearch").collect());
await t.mutation(api.procurementSync.indexSearchPage, { societyId, cursor: null });
assert.deepEqual(await t.run(ctx => ctx.db.query("procurementSearch").collect()), initial, "Retry reuses unchanged projection rows");
await assert.rejects(t.mutation(api.procurementSync.indexSearchPage, { societyId, cursor: "old-native-cursor" }), /checkpoint/);
await t.run(ctx => ctx.db.patch(fixture.catalogId, { generation: "publication-2" }));
await assert.rejects(t.mutation(api.procurementSync.indexSearchPage, { societyId, cursor: first.cursor }), /publication changed/);
const result = await t.action(api.procurementSync.indexSearchSlice, { societyId, cursor: null });
assert.equal(result.done, true); assert.equal(result.rows, 61);
assert.equal((await t.run(ctx => ctx.db.query("procurementSearch").collect())).length, 61);
assert.equal(await t.run(ctx => ctx.db.query("procurementMaintenanceLeases").withIndex("by_society", q => q.eq("societyId", societyId)).unique()), null);
assert.equal((await t.mutation(api.procurementSync.indexSearchPage, { societyId, cursor: null })).rows, 0, "Ready catalogs never rescan on another bootstrap");
console.log("Procurement maintenance: workspace isolation, overlap refusal, expiry/takeover, stale-owner safety, failure release, bounded deletion/indexing, checkpoint publication binding and idempotent reuse passed.");
