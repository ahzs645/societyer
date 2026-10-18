import assert from "node:assert/strict";
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
  "./procurementImport.js": () => import("../convex/procurementImport"),
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
  for (let i = 0; i < 61; i++) {
    const recordKey = `opportunity:${i}`;
    await ctx.db.insert("procurementRecords", { societyId, generation, recordKey, kind: "opportunity", title: `Bridge ${i}`, organization: "Test City", status: i % 2 ? "Open" : "Closed", date: `2026-${String(i).padStart(3, "0")}`, updatedAt: "2026-10-18", searchText: `Bridge ${i} Test City` });
    await ctx.db.insert("procurementDetails", { societyId, generation, recordKey, dataJson: JSON.stringify({ descriptionText: "Notice body only fetched on demand" }) });
  }
  // Another workspace deliberately reuses the same generation and source key.
  await ctx.db.insert("procurementRecords", { societyId: foreign, generation, recordKey: "opportunity:0", kind: "opportunity", title: "Private foreign record", organization: "Secret", status: "Open", date: "2099", updatedAt: "", searchText: "Secret" });
  await ctx.db.insert("procurementDocuments", { societyId, generation, recordKey: "opportunity:0", documentKey: "doc", name: "test.pdf", mediaType: "application/pdf", sha256: "a".repeat(64), sourceUrl: "https://example.invalid", status: "ready", bytes: 10, parts: 0, available: true });
  return { societyId, foreign, generation, folder };
});
const reader = t.withIdentity({ subject: "reader", issuer });
const args = { societyId: ids.societyId, generation: ids.generation, kind: "opportunity", paginationOpts: { numItems: 25, cursor: null } };
assert.equal(await reader.query(api.procurementReview.catalog, { societyId: ids.societyId }), null, "Unactivated imports are invisible");
const activation = { societyId: ids.societyId, generation: ids.generation, folder: ids.folder, publishedAt: "2026-10-18T17:02:58Z", counts: { opportunity: 61 }, expected: { procurementRecords: 61, procurementDetails: 61, procurementDocuments: 1 } };
await assert.rejects(t.action(api.procurementImport.activate, { ...activation, counts: { opportunity: 62 }, expected: { ...activation.expected, procurementRecords: 62, procurementDetails: 62 } }), /incomplete/);
assert.equal(await reader.query(api.procurementReview.catalog, { societyId: ids.societyId }), null);
await t.action(api.procurementImport.activate, activation);
await assert.rejects(t.action(api.procurementImport.purgeGeneration, { societyId: ids.societyId, generation: ids.generation }), /active generation/);
let cursor: string | null = null; const seen = new Set<string>(); let calls = 0;
for (;;) {
  const result = await reader.query(api.procurementReview.records, { ...args, paginationOpts: { numItems: 25, cursor } });
  assert.ok(result.page.length <= 25);
  for (const row of result.page) { assert.ok(!seen.has(row.recordKey)); seen.add(row.recordKey); assert.ok(!("dataJson" in row)); assert.ok(!row.title.includes("foreign")); }
  calls++;
  if (result.isDone) break;
  cursor = result.continueCursor;
}
assert.equal(seen.size, 61); assert.equal(calls, 3);
const filtered = await reader.query(api.procurementReview.records, { ...args, status: "Open", search: "Bridge" });
assert.ok(filtered.page.length); assert.ok(filtered.page.every((row: any) => row.status === "Open"));
assert.ok(JSON.stringify(filtered).length < 25000, "List results remain small");
assert.equal((await reader.query(api.procurementReview.record, { societyId: ids.societyId, generation: ids.generation, recordKey: "opportunity:0" })).summary.title, "Bridge 0");
assert.equal((await reader.query(api.procurementReview.documents, { societyId: ids.societyId, generation: ids.generation, recordKey: "opportunity:0", paginationOpts: { numItems: 10, cursor: null } })).page[0].name, "test.pdf");
await assert.rejects(t.query(api.procurementReview.records, args), /auth|sign|identity|access/i);
await assert.rejects(t.withIdentity({ subject: "foreign", issuer }).query(api.procurementReview.records, args), /membership|access|workspace|bound/i);
await assert.rejects(reader.mutation(api.procurementReview.setFolder, { societyId: ids.societyId, folder: ids.folder }), /Permission/);
await t.run(async ctx => { await ctx.db.patch(ids.societyId, { integrationSettings: { ...defaultIntegrationSettings(), procurementReviewFolder: `${ids.folder}/new` } as any }); });
assert.equal(await reader.query(api.procurementReview.catalog, { societyId: ids.societyId }), null, "Folder changes immediately hide the previous import");
assert.equal((await reader.query(api.procurementReview.records, args)).page.length, 0);
await t.run(async ctx => { await ctx.db.patch(ids.societyId, { disabledModules: [] }); });
await assert.rejects(reader.query(api.procurementReview.catalog, { societyId: ids.societyId }), /module|enabled|disabled/i);
console.log("OK: authenticated indexed pages, full-text search, bounded payload, workspace isolation, read-only permissions, incomplete-import refusal, atomic activation, folder and module gates.");
