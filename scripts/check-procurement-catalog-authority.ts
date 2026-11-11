import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { defaultIntegrationSettings } from "../shared/integrationSettings";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { grantVerifier } from "../server/procurement-catalog/grants";

for (const key of ["TENANT_ID", "CLIENT_ID", "CLIENT_SECRET", "SITE_ID", "DRIVE_ID", "TRANSFER_HOSTS"]) process.env[`PROCUREMENT_SHAREPOINT_${key}`] = "synthetic";
const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"), "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./authorization.js": () => import("../convex/authorization"), "./procurementCatalog.js": () => import("../convex/procurementCatalog"),
  "./procurementCatalogActions.js": () => import("../convex/procurementCatalogActions"), "./procurementCatalogOperator.js": () => import("../convex/procurementCatalogOperator"),
  "./procurementStatus.js": () => import("../convex/procurementStatus"), "./procurementReview.js": () => import("../convex/procurementReview"),
  "./procurementImport.js": () => import("../convex/procurementImport"),
} as any), api: any = anyApi;
const issuer = betterAuthIssuer(), pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" }), now = Date.now();
process.env.PROCUREMENT_CATALOG_SIGNING_KEY = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
process.env.PROCUREMENT_CATALOG_SIGNING_KEY_ID = "fixture"; process.env.CONVEX_SITE_URL = "https://fixture.convex.site"; process.env.PROCUREMENT_CATALOG_URL = "https://catalog.fixture.test";
const fixture = await t.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Fixture DDC", isCharity: false, isMemberFunded: false, disabledModules: ["+procurementReview"], updatedAt: now });
  const other = await ctx.db.insert("societies", { name: "No catalog", isCharity: false, isMemberFunded: false, updatedAt: now });
  const folder = "Zoer/bc-bid-monitor/" + societyId;
  await ctx.db.patch(societyId, { integrationSettings: { ...defaultIntegrationSettings(), procurementReviewFolder: folder } });
  for (const [subject, role] of [["reader", "Viewer"], ["owner", "Owner"]]) await ctx.db.insert("users", { societyId, email: subject + "@example.invalid", displayName: subject, role, status: "Active", authSubject: subject, authIssuer: issuer, authProvider: "better-auth", createdAtISO: "2026-11-10" });
  const catalogId = await ctx.db.insert("procurementCatalogs", { societyId, folder, generation: "before", publishedAt: new Date(now).toISOString(), counts: { opportunity: 1 } });
  return { societyId, folder, other, catalogId };
});
process.env.PROCUREMENT_CATALOG_ALLOWED_WORKSPACES = fixture.societyId;
const reader = t.withIdentity({ subject: "reader", issuer }), owner = t.withIdentity({ subject: "owner", issuer }), args = { societyId: fixture.societyId };
assert.deepEqual(await reader.query(api.procurementCatalog.configuration, args), { source: "convex", baseUrl: null });
await assert.rejects(reader.query(api.procurementCatalog.configuration, { ...args, preview: true }), /permission|settings|access/i);
await assert.rejects(reader.query(api.procurementCatalog.configuration, { ...args, controls: true }), /permission|settings|access/i);
assert.equal((await owner.query(api.procurementCatalog.configuration, { ...args, controls: true })).qualifiedPublications, 0);
assert.equal((await owner.query(api.procurementCatalog.configuration, { ...args, preview: true })).baseUrl, "https://catalog.fixture.test");
await assert.rejects(t.action(api.procurementCatalogActions.grant, args), /auth|sign|identity/i);
await assert.rejects(t.withIdentity({ subject: "foreign", issuer }).action(api.procurementCatalogActions.grant, args), /auth|access|bound|membership/i);
await assert.rejects(owner.action(api.procurementCatalogActions.grant, { societyId: fixture.other }), /auth|access|membership|enabled|bound/i);
const issued = await reader.action(api.procurementCatalogActions.grant, args);
const verify = grantVerifier(process.env.CONVEX_SITE_URL!, { fixture: pair.publicKey.export({ type: "spki", format: "pem" }).toString() }, [{ societyId: fixture.societyId, folder: fixture.folder }]);
assert.equal(verify("Bearer " + issued.token, fixture.societyId).folder, fixture.folder);
await assert.rejects(owner.mutation(api.procurementCatalog.setSource, { ...args, source: "service" }), /Three distinct/);
await assert.rejects(reader.mutation(api.procurementCatalog.setSource, { ...args, source: "convex" }), /permission|settings|access/i);
for (let n = 1; n <= 3; n++) {
  const publicationId = "publication-" + n, generation = publicationId + "-reader-v2", inventoryHash = String(n).repeat(64), publishedAt = new Date(now - 10_000 + n * 1000).toISOString();
  const receiptJson = JSON.stringify({ schemaVersion: 1, societyId: fixture.societyId, folder: fixture.folder, publicationId, generation, inventoryHash, contentHash: "a".repeat(64), sourceSnapshotId: publicationId, publishedAt, activatedAt: new Date(now).toISOString(), counts: { opportunity: 1, award: 0 } });
  await t.mutation(api.procurementCatalog.recordPublication, { ...args, receiptJson });
  assert.equal((await owner.query(api.procurementCatalog.configuration, { ...args, controls: true })).qualifiedPublications, 0, "A new unverified publication breaks the consecutive qualification count");
  await t.mutation(api.procurementCatalog.recordPublication, { ...args, receiptJson });
  await assert.rejects(t.mutation(api.procurementCatalog.recordPublication, { ...args, receiptJson: receiptJson.replace('"opportunity":1', '"opportunity":2') }), /immutable/);
  const parity = { ...args, folder: fixture.folder, publicationId, inventoryHash, reportHash: "f".repeat(64) };
  await assert.rejects(t.mutation(api.procurementCatalogOperator.verifyParity, parity), /currently serving/);
  await t.run(ctx => ctx.db.patch(fixture.catalogId, { generation, publicationId, publishedAt, inventoryHash }));
  await t.mutation(api.procurementCatalogOperator.verifyParity, parity);
  assert.equal((await owner.query(api.procurementCatalog.configuration, { ...args, controls: true })).qualifiedPublications, n);
}
await owner.mutation(api.procurementCatalog.setSource, { ...args, source: "service" });
assert.equal((await reader.query(api.procurementCatalog.configuration, args)).source, "service");
const rollout = await t.run(ctx => ctx.db.query("procurementServiceRollouts").withIndex("by_society", q => q.eq("societyId", fixture.societyId)).unique());
assert(rollout && rollout.fallbackUntil - rollout.cutoverAt >= 14 * 86400_000);
assert.equal((await t.query(api.procurementCatalogOperator.publicationPolicy, args)).serviceOnlyAllowed, false, "Parallel publication remains required during fallback");
await t.run(ctx => ctx.db.patch(rollout!._id, { fallbackUntil: Date.now() - 1 }));
assert.equal((await t.query(api.procurementCatalogOperator.publicationPolicy, args)).serviceOnlyAllowed, true);
assert.equal((await reader.query(api.procurementStatus.get, args)).lastSuccessful.generation, "publication-3-reader-v2");
await owner.mutation(api.procurementCatalog.setSource, { ...args, source: "convex" });
assert.equal((await reader.query(api.procurementCatalog.configuration, args)).source, "convex");
await owner.mutation(api.procurementCatalog.setSource, { ...args, source: "service" });
const retirement = { ...args, backupSha256: "b".repeat(64), generation: "publication-3-reader-v2", inventoryHash: "3".repeat(64) };
const detach = { ...args, backupSha256: retirement.backupSha256, servicePublicationId: "publication-3" };
const retirePage = { ...args, backupSha256: retirement.backupSha256, table: "procurementTaxonomyTerms", cursor: null };
await assert.rejects(t.mutation(api.procurementCatalogOperator.approveRetirement, { ...retirement, inventoryHash: "4".repeat(64) }), /must match exactly/);
await assert.rejects(t.mutation(api.procurementCatalogOperator.retirePage, retirePage), /detached catalog/);
await t.mutation(api.procurementCatalogOperator.approveRetirement, retirement);
await t.mutation(api.procurementCatalogOperator.approveRetirement, retirement);
assert.equal((await t.query(api.procurementCatalogOperator.publicationPolicy, args)).serviceOnlyAllowed, true);
assert.equal((await owner.query(api.procurementCatalog.configuration, { ...args, controls: true })).convexFallbackAvailable, false);
await assert.rejects(owner.mutation(api.procurementCatalog.setSource, { ...args, source: "convex" }), /fallback was retired/);
await assert.rejects(t.mutation(api.procurementImport.beginJob, {
  ...args, folder: fixture.folder, generation: "publication-4-reader-v2", inventoryHash: "4".repeat(64), contentHash: "a".repeat(64),
  publishedAt: new Date(now).toISOString(), complete: true,
}), /publishes to the catalog service only/);
await assert.rejects(t.mutation(api.procurementCatalogOperator.detachRetiredCatalog, { ...detach, servicePublicationId: "stale" }), /live service receipt/);
await t.mutation(api.procurementCatalogOperator.detachRetiredCatalog, detach);
const otherTerm = await t.run(async ctx => {
  const term = { releaseId: "fixture", key: "fixture:1", scheme: "fixture", version: "1", code: "1", title: "Fixture term", parentKey: null };
  for (let i = 0; i < 202; i++) {
    await ctx.db.insert("procurementTaxonomyTerms", { societyId: fixture.societyId, ...term, key: `fixture:${i}` });
  }
  return ctx.db.insert("procurementTaxonomyTerms", { societyId: fixture.other, ...term });
});
await assert.rejects(t.mutation(api.procurementCatalogOperator.retirePage, { ...retirePage, table: "procurementServicePublications" }), /mirrored data table/);
const first = await t.mutation(api.procurementCatalogOperator.retirePage, retirePage);
assert.equal(first.removed, 200);
assert.equal(first.done, false);
const second = await t.mutation(api.procurementCatalogOperator.retirePage, { ...retirePage, cursor: first.cursor });
assert.equal(second.removed, 2);
assert.equal(second.done, true);
assert.equal((await t.query(api.procurementCatalogOperator.retirementStatus, args)).verified, false);
await t.mutation(api.procurementCatalogOperator.confirmRetirement, { ...args, backupSha256: retirement.backupSha256, snapshotSha256: "c".repeat(64) });
assert.equal((await t.query(api.procurementCatalogOperator.retirementStatus, args)).verified, true);
await assert.rejects(t.mutation(api.procurementCatalogOperator.retirePage, retirePage), /already been verified/);
assert(await t.run(ctx => ctx.db.get(otherTerm)));
assert.equal((await reader.query(api.procurementStatus.get, args)).lastSuccessful.generation, "publication-3-reader-v2");
await owner.mutation(api.procurementReview.setFolder, { ...args, folder: "" });
await owner.mutation(api.procurementReview.setFolder, { ...args, folder: fixture.folder });
assert.equal((await reader.query(api.procurementCatalog.configuration, args)).source, "service");
await t.run(ctx => ctx.db.patch(fixture.societyId, { disabledModules: [] }));
await assert.rejects(reader.action(api.procurementCatalogActions.grant, args), /disabled/);
console.log("Catalog authority checks passed: scoped grants, settings permissions, immutable receipts, parity qualification, fallback and workspace-scoped retirement.");
