import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";

const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./authorization.js": () => import("../convex/authorization"),
  "./views.js": () => import("../convex/views"),
  "./objectMetadata.js": () => import("../convex/objectMetadata"),
});
const issuer = betterAuthIssuer();
const at = new Date().toISOString();
const rows = await test.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "View privacy", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const ids: Record<string, any> = {};
  for (const subject of ["A", "B", "Member"]) ids[subject] = await ctx.db.insert("users", { societyId, displayName: subject, email: `${subject}@view.test`, role: subject === "Member" ? "Member" : "Owner", status: "Active", authIssuer: issuer, authSubject: subject, createdAtISO: at });
  const objectMetadataId = await ctx.db.insert("objectMetadata", { societyId, nameSingular: "member", namePlural: "members", labelSingular: "Member", labelPlural: "Members", isSystem: true, isActive: true, createdAtISO: at, updatedAtISO: at });
  const fieldMetadataId = await ctx.db.insert("fieldMetadata", { societyId, objectMetadataId, name: "email", label: "Email", fieldType: "EMAIL", isSystem: true, isHidden: false, isNullable: true, position: 0, createdAtISO: at, updatedAtISO: at });
  const privateId = await ctx.db.insert("views", { societyId, objectMetadataId, name: "A private investigation", type: "table", filtersJson: '[{"value":"private-complaint@example.test"}]', searchTerm: "sensitive-search", visibility: "personal", isShared: false, isSystem: false, createdByUserId: ids.A, position: 0, createdAtISO: at, updatedAtISO: at });
  const fieldId = await ctx.db.insert("viewFields", { societyId, viewId: privateId, fieldMetadataId, isVisible: true, position: 0, size: 180, createdAtISO: at, updatedAtISO: at });
  const sharedId = await ctx.db.insert("views", { societyId, objectMetadataId, name: "Shared members", type: "table", visibility: "shared", isShared: true, isSystem: false, createdByUserId: ids.A, position: 1, createdAtISO: at, updatedAtISO: at });
  const systemId = await ctx.db.insert("views", { societyId, objectMetadataId, name: "System members", type: "table", isShared: true, isSystem: true, position: 2, createdAtISO: at, updatedAtISO: at });
  const financialObjectId = await ctx.db.insert("objectMetadata", { societyId, nameSingular: "financialTransaction", namePlural: "financialTransactions", labelSingular: "Transaction", labelPlural: "Transactions", isSystem: true, isActive: true, createdAtISO: at, updatedAtISO: at });
  const financialFieldId = await ctx.db.insert("fieldMetadata", { societyId, objectMetadataId: financialObjectId, name: "confidentialBalance", label: "Confidential balance metadata", fieldType: "NUMBER", isSystem: true, isHidden: false, isNullable: true, position: 0, createdAtISO: at, updatedAtISO: at });
  return { societyId, objectMetadataId, fieldMetadataId, financialFieldId, privateId, fieldId, sharedId, systemId };
});
const a = test.withIdentity({ issuer, subject: "A" });
const b = test.withIdentity({ issuer, subject: "B" });
assert.equal((await a.query(api.views.get, { id: rows.privateId })).searchTerm, "sensitive-search");
assert.equal((await a.query(api.views.getHydrated, { id: rows.privateId })).columns.length, 1);
const visible = await b.query(api.views.listForObject, { objectMetadataId: rows.objectMetadataId });
assert.deepEqual(visible.map((view: any) => view._id), [rows.sharedId, rows.systemId]);
const setup = await b.query(api.objectMetadata.getFullTableSetup, { societyId: rows.societyId, nameSingular: "member" });
assert.equal(setup.activeView.view._id, rows.sharedId, "default selection must ignore another actor's earlier private view");
assert.ok(!JSON.stringify(setup).includes("private-complaint"));
assert.ok(!JSON.stringify(setup).includes("sensitive-search"));
assert.ok(!JSON.stringify(setup).includes("A private investigation"));
for (const action of [
  () => b.query(api.views.get, { id: rows.privateId }),
  () => b.query(api.views.getHydrated, { id: rows.privateId }),
  () => b.query(api.views.listFieldsForView, { viewId: rows.privateId }),
  () => b.query(api.objectMetadata.getFullTableSetup, { societyId: rows.societyId, nameSingular: "member", viewId: rows.privateId }),
  () => b.mutation(api.views.update, { id: rows.privateId, patch: { visibility: "shared" } }),
  () => b.mutation(api.views.remove, { id: rows.privateId }),
  () => b.mutation(api.views.updateField, { id: rows.fieldId, patch: { size: 400 } }),
  () => b.mutation(api.views.removeField, { id: rows.fieldId }),
  () => b.mutation(api.views.reorderFields, { viewId: rows.privateId, orderedIds: [rows.fieldId] }),
  () => b.mutation(api.views.addField, { societyId: rows.societyId, viewId: rows.privateId, fieldMetadataId: rows.fieldMetadataId }),
  () => b.mutation(api.views.deleteSharedDataTableView, { societyId: rows.societyId, id: rows.privateId }),
]) await assert.rejects(action, /views not found/);
assert.equal((await a.query(api.views.get, { id: rows.privateId })).visibility, "personal");
assert.equal((await a.query(api.views.listFieldsForView, { viewId: rows.privateId }))[0].size, 180);
await a.mutation(api.views.update, { id: rows.privateId, patch: { visibility: "shared" } });
assert.equal((await b.query(api.views.get, { id: rows.privateId })).searchTerm, "sensitive-search", "creator can deliberately share their saved view");
console.log("Personal view access passed: private names/search/filters/columns and mutations remain creator-only, shared/system views stay available, and default hydration excludes another actor's private view.");

await assert.rejects(() => a.mutation(api.views.addField, { societyId: rows.societyId, viewId: rows.sharedId, fieldMetadataId: rows.financialFieldId }), /fieldMetadata not found/);
await test.run(ctx => ctx.db.insert("viewFields", { societyId: rows.societyId, viewId: rows.sharedId, fieldMetadataId: rows.financialFieldId, isVisible: true, position: 0, size: 180, createdAtISO: at, updatedAtISO: at }));
const member = test.withIdentity({ issuer, subject: "Member" });
const hydrated = await member.query(api.views.getHydrated, { id: rows.sharedId });
assert.equal(hydrated.columns.length, 0, "a corrupt imported cross-object column must never disclose financial field metadata through a readable Member view");
assert.ok(!JSON.stringify(hydrated).includes("Confidential balance"));
assert.deepEqual(await member.query(api.views.listFieldsForView, { viewId: rows.sharedId }), []);
console.log("Cross-object view fields are rejected on creation and quarantined from scoped view reads, including Member reads.");
