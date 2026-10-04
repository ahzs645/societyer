import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { RECORD_TABLE_OBJECTS } from "../convex/recordTableMetadataDefinitions";

const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./authorization.js": () => import("../convex/authorization"),
  "./objectMetadata.js": () => import("../convex/objectMetadata"),
  "./fieldMetadata.js": () => import("../convex/fieldMetadata"),
  "./views.js": () => import("../convex/views"),
});
const issuer = betterAuthIssuer();
const at = new Date().toISOString();
const fixture = await t.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Scoped metadata", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const foreignId = await ctx.db.insert("societies", { name: "Other workspace", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const memberId = await ctx.db.insert("users", { societyId, displayName: "Reader", email: "member@metadata.test", role: "Member", status: "Active", authIssuer: issuer, authSubject: "member", createdAtISO: at });
  const ownerId = await ctx.db.insert("users", { societyId, displayName: "Owner", email: "owner@metadata.test", role: "Owner", status: "Active", authIssuer: issuer, authSubject: "owner", createdAtISO: at });
  const objects: Record<string, any> = {};
  for (const [singular, plural] of [["member", "members"], ["meeting", "meetings"], ["task", "tasks"], ["financial", "financials"], ["setting", "corporationSettings"], ["unknown", "unclassifiedRegister"]]) {
    objects[singular] = await ctx.db.insert("objectMetadata", { societyId, nameSingular: singular, namePlural: plural, labelSingular: singular, labelPlural: plural, isSystem: true, isActive: true, createdAtISO: at, updatedAtISO: at });
  }
  for (const definition of RECORD_TABLE_OBJECTS) {
    if (objects[definition.nameSingular]) continue;
    objects[definition.nameSingular] = await ctx.db.insert("objectMetadata", { societyId, nameSingular: definition.nameSingular, namePlural: definition.namePlural, labelSingular: definition.labelSingular, labelPlural: definition.labelPlural, isSystem: true, isActive: true, createdAtISO: at, updatedAtISO: at });
  }
  const foreignObjectId = await ctx.db.insert("objectMetadata", { societyId: foreignId, nameSingular: "member", namePlural: "members", labelSingular: "Member", labelPlural: "Members", isSystem: true, isActive: true, createdAtISO: at, updatedAtISO: at });
  const fieldId = await ctx.db.insert("fieldMetadata", { societyId, objectMetadataId: objects.member, name: "email", label: "Email", fieldType: "EMAIL", isSystem: true, isHidden: false, isNullable: true, position: 0, createdAtISO: at, updatedAtISO: at });
  const privateView = await ctx.db.insert("views", { societyId, objectMetadataId: objects.member, name: "Owner private marker", visibility: "personal", createdByUserId: ownerId, type: "table", position: 0, isSystem: false, isShared: false, createdAtISO: at, updatedAtISO: at });
  const sharedView = await ctx.db.insert("views", { societyId, objectMetadataId: objects.member, name: "All members", visibility: "system", type: "table", position: 1, isSystem: true, isShared: true, createdAtISO: at, updatedAtISO: at });
  const foreignViewId = await ctx.db.insert("views", { societyId: foreignId, objectMetadataId: foreignObjectId, name: "Foreign members", visibility: "system", type: "table", position: 0, isSystem: true, isShared: true, createdAtISO: at, updatedAtISO: at });
  return { societyId, foreignId, foreignObjectId, foreignViewId, objects, fieldId, privateView, sharedView, memberId };
});
const member = t.withIdentity({ issuer, subject: "member" });
for (const nameSingular of ["member", "meeting", "task"]) {
  const setup = await member.query(api.objectMetadata.getFullTableSetup, { societyId: fixture.societyId, nameSingular });
  assert.equal(setup.object._id, fixture.objects[nameSingular]);
}
const setup = await member.query(api.objectMetadata.getFullTableSetup, { societyId: fixture.societyId, nameSingular: "member" });
assert.equal(setup.activeView.view._id, fixture.sharedView);
assert.ok(!JSON.stringify(setup).includes("Owner private marker"));
assert.equal((await member.query(api.objectMetadata.get, { id: fixture.objects.member })).namePlural, "members");
assert.equal((await member.query(api.objectMetadata.getByNamePlural, { societyId: fixture.societyId, namePlural: "members" }))._id, fixture.objects.member);
assert.equal((await member.query(api.objectMetadata.getWithFields, { objectMetadataId: fixture.objects.member })).fields.length, 1);
assert.equal((await member.query(api.fieldMetadata.get, { id: fixture.fieldId })).name, "email");
assert.equal((await member.query(api.fieldMetadata.listForObject, { objectMetadataId: fixture.objects.member })).length, 1);
assert.equal((await member.query(api.fieldMetadata.getByName, { objectMetadataId: fixture.objects.member, name: "email" }))._id, fixture.fieldId);
assert.deepEqual((await member.query(api.views.listForObject, { objectMetadataId: fixture.objects.member })).map((v: any) => v._id), [fixture.sharedView]);
assert.deepEqual((await member.query(api.views.listSharedForDataTable, { societyId: fixture.societyId, nameSingular: "member" })).map((v: any) => v._id), [fixture.sharedView]);
assert.equal((await member.query(api.views.getHydrated, { id: fixture.sharedView })).view._id, fixture.sharedView);
assert.deepEqual(await member.query(api.views.listFieldsForView, { viewId: fixture.sharedView }), []);
for (const action of [
  () => member.query(api.views.get, { id: fixture.privateView }),
  () => member.query(api.objectMetadata.getFullTableSetup, { societyId: fixture.societyId, nameSingular: "member", viewId: fixture.privateView }),
]) await assert.rejects(action, /views not found/);
for (const nameSingular of ["financial", "setting", "unknown", "missing"]) await assert.rejects(() => member.query(api.objectMetadata.getFullTableSetup, { societyId: fixture.societyId, nameSingular }), /Permission/);
for (const action of [
  () => member.query(api.objectMetadata.list, { societyId: fixture.societyId }),
  () => member.query(api.fieldMetadata.listForSociety, { societyId: fixture.societyId }),
  () => member.mutation(api.views.update, { id: fixture.sharedView, patch: { name: "Unauthorized rename" } }),
  () => member.mutation(api.objectMetadata.update, { id: fixture.objects.member, patch: { labelPlural: "Changed" } }),
]) await assert.rejects(action, /Permission settings/);
for (const action of [
  () => member.query(api.objectMetadata.get, { id: fixture.foreignObjectId }),
  () => member.query(api.objectMetadata.getFullTableSetup, { societyId: fixture.foreignId, nameSingular: "member" }),
  () => member.query(api.objectMetadata.getFullTableSetup, { societyId: fixture.societyId, nameSingular: "member", viewId: fixture.foreignViewId }),
]) await assert.rejects(action, /membership|Record not found/i);
// Exercise the real built-in definitions. Domain names and table names differ;
// settings access must not be accidentally required for a legitimate register.
const readableBuiltIns = new Set([
  "members", "roleHolders", "workflowRuns", "outboxMessages", "workflows",
  "retentionRows", "profileFacts", "memberProposals", "inspections",
  "writtenResolutions", "minuteBookItems", "minutes", "meetings", "meetingTemplates",
  "volunteerApplications", "volunteers", "volunteerScreenings", "documents",
  "communicationTemplates", "communicationSegments", "communicationCampaigns", "communicationDeliveries",
  "grantApplications", "grants", "grantTransactions", "grantReports", "motions", "tasks",
]);
const financialBuiltIns = new Set([
  "reconciliationTransactions", "counterpartyTransactions", "accountTransactions", "donationReceipts",
  "insurancePolicies", "assets", "financialTransactions",
]);
for (const definition of RECORD_TABLE_OBJECTS) {
  const read = () => member.query(api.objectMetadata.getFullTableSetup, { societyId: fixture.societyId, nameSingular: definition.nameSingular });
  if (readableBuiltIns.has(definition.namePlural)) {
    assert.equal((await read()).object.namePlural, definition.namePlural, `Member must load ${definition.namePlural} metadata using its register permission`);
  } else {
    await assert.rejects(read, financialBuiltIns.has(definition.namePlural) ? /Permission financials:read/ : /Permission/, `${definition.namePlural} must retain its domain or settings read gate`);
  }
}
console.log("Record metadata permissions passed: Member reads all authorized built-in table metadata (including aliases); private views, foreign rows, financial/settings/unknown catalogs and all settings writes stay denied.");
