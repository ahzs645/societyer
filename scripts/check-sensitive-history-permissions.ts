import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { toPortableQueryCtx } from "../convex/lib/portable";
import { requireFunctionAction } from "../shared/functions/actionPolicy";
import { listRoleHoldersPortable, rightsLedgerPortable } from "../shared/functions/roleHolders";
import { canReadControllerRegisters } from "../shared/functions/roleHolderReadAccess";

const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./authorization.js": () => import("../convex/authorization"),
  "./registerHistory.js": () => import("../convex/registerHistory"),
  "./legalOperations.js": () => import("../convex/legalOperations"),
  "./roleHolderHistory.js": () => import("../convex/roleHolderHistory"),
  "./orgChartAssignments.js": () => import("../convex/orgChartAssignments"),
});
const issuer = betterAuthIssuer();
const at = new Date().toISOString();
const rows = await t.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "History permission test", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const foreignId = await ctx.db.insert("societies", { name: "Foreign history", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  for (const role of ["Member", "Owner", "Viewer"]) await ctx.db.insert("users", { societyId, role, status: "Active", displayName: role, email: `${role}@history.test`, authIssuer: issuer, authSubject: role, createdAtISO: at });
  const roleIds: Record<string, any> = {};
  for (const [roleType, fullName] of [["member", "Readable member"], ["director", "Restricted director"], ["officer", "Restricted officer"], ["controller", "Restricted controller"], ["shareholder", "Existing shareholder"]]) {
    roleIds[roleType] = await ctx.db.insert("roleHolders", { societyId, roleType, fullName, status: "current", citizenshipCountries: [], taxResidenceCountries: [], relatedShareholderIds: [], controllingIndividualIds: [], sourceDocumentIds: [], sourceExternalIds: [], startDate: "2020-01-01", dateOfBirth: roleType === "controller" ? "1971-03-12" : undefined, createdAtISO: at, updatedAtISO: at });
  }
  await ctx.db.insert("orgChartAssignments", { societyId, subjectType: "director", subjectId: roleIds.director, subjectName: "Restricted reporting subject", managerName: "Restricted manager", updatedAtISO: at });
  return { societyId, foreignId, roleIds };
});
const member = t.withIdentity({ issuer, subject: "Member" });
const memberRoles = await member.query(api.legalOperations.listRoleHolders, { societyId: rows.societyId });
assert.ok(memberRoles.some((row: any) => row.roleType === "member"), "ordinary role rows remain readable");
assert.ok(!memberRoles.some((row: any) => row.roleType === "controller"));
assert.ok(!JSON.stringify(memberRoles).includes("1971-03-12"), "Member must never receive controller DOB through the live register");
const memberLedger = await member.query(api.legalOperations.rightsLedger, { societyId: rows.societyId });
assert.ok(!memberLedger.roleHolders.some((row: any) => row.roleType === "controller"));
assert.ok(!JSON.stringify(memberLedger).includes("1971-03-12"));
await assert.rejects(() => member.query(api.roleHolderHistory.revisionHistory, { roleHolderId: rows.roleIds.controller }), /Permission settings:read/);
const memberAsOf = await member.query(api.roleHolderHistory.registerAsOf, { societyId: rows.societyId, asOfISO: "2099-01-01T00:00:00.000Z" });
assert.ok(!memberAsOf.some((row: any) => row.roleType === "controller"));
const common = { societyId: rows.societyId, asOf: "2026-10-04" };
assert.equal((await member.query(api.registerHistory.roleHoldersAsOfDate, { ...common, roleType: "member" }))[0].fullName, "Readable member");
assert.equal((await member.query(api.registerHistory.roleHoldersAsOfDate, { ...common, roleType: "shareholder" }))[0].fullName, "Existing shareholder", "recognized non-sensitive historical roles retain existing policy");
for (const read of [
  () => member.query(api.registerHistory.directorsAsOf, common),
  () => member.query(api.registerHistory.roleHoldersAsOfDate, { ...common, roleType: "director" }),
  () => member.query(api.registerHistory.roleHoldersAsOfDate, { ...common, roleType: "officer" }),
]) await assert.rejects(read, /Permission directors:read/);
for (const read of [
  () => member.query(api.registerHistory.significantIndividualsAsOf, common),
  () => member.query(api.registerHistory.roleHoldersAsOfDate, { ...common, roleType: "controller" }),
  () => member.query(api.orgChartAssignments.list, { societyId: rows.societyId }),
  () => member.query(api.orgChartAssignments.listAsOf, common),
]) await assert.rejects(read, /Permission settings:read/);
await assert.rejects(() => member.mutation(api.orgChartAssignments.remove, { societyId: rows.societyId, subjectType: "director", subjectId: rows.roleIds.director }), /Permission settings:write/);
for (const role of ["Owner", "Viewer"]) {
  const reader = t.withIdentity({ issuer, subject: role });
  assert.equal((await reader.query(api.registerHistory.directorsAsOf, common))[0].fullName, "Restricted director");
  const readableRoles = await reader.query(api.legalOperations.listRoleHolders, { societyId: rows.societyId });
  assert.equal(readableRoles.find((row: any) => row.roleType === "controller").dateOfBirth, "1971-03-12");
  assert.equal((await reader.query(api.legalOperations.rightsLedger, { societyId: rows.societyId })).roleHolders.find((row: any) => row.roleType === "controller").dateOfBirth, "1971-03-12");
  assert.ok((await reader.query(api.roleHolderHistory.revisionHistory, { roleHolderId: rows.roleIds.controller })).length > 0);

  assert.equal((await reader.query(api.registerHistory.significantIndividualsAsOf, common))[0].dateOfBirth, "1971-03-12");
  assert.equal((await reader.query(api.orgChartAssignments.list, { societyId: rows.societyId }))[0].managerName, "Restricted manager");
  for (const read of [
    () => reader.query(api.legalOperations.listRoleHolders, { societyId: rows.foreignId }),
    () => reader.query(api.registerHistory.directorsAsOf, { ...common, societyId: rows.foreignId }),
    () => reader.query(api.registerHistory.significantIndividualsAsOf, { ...common, societyId: rows.foreignId }),
    () => reader.query(api.orgChartAssignments.list, { societyId: rows.foreignId }),
  ]) await assert.rejects(read, /membership/i);
  await assert.rejects(() => reader.query(api.registerHistory.roleHoldersAsOfDate, { ...common, roleType: "unrecognized_role" }), /Unsupported historical role type/);
}
// Exercise the trusted service principal boundary with actual native DB rows,
// the production action policy and production portable register handlers.
await t.run(async nativeCtx => {
  const portable = await toPortableQueryCtx(nativeCtx);
  const owner = (await nativeCtx.db.query("users").collect()).find(row => row.societyId === rows.societyId && row.role === "Owner")!;
  portable.principal = { kind: "service", runtime: "test", assurance: "trusted-internal", subject: "documents-only-service", societyId: rows.societyId, actorUserId: owner._id, scopes: ["documents:read"] };
  await requireFunctionAction(portable, "legalOperations:listRoleHolders", "query", { societyId: rows.societyId });
  const serviceRows = await listRoleHoldersPortable(portable, { societyId: rows.societyId });
  assert.ok(serviceRows.some(row => row.roleType === "member"), "documents-only service keeps its authorized ordinary register rows");
  assert.ok(!serviceRows.some(row => row.roleType === "controller"));
  assert.ok(!JSON.stringify(serviceRows).includes("1971-03-12"));
  const ledger = await rightsLedgerPortable(portable, { societyId: rows.societyId });
  assert.ok(!ledger.roleHolders.some(row => row.roleType === "controller"));
  await assert.rejects(() => canReadControllerRegisters(portable, rows.foreignId), /membership/i, "scope filtering must not swallow foreign membership failures");
  portable.principal = { ...portable.principal, scopes: [] };
  await assert.rejects(() => requireFunctionAction(portable, "legalOperations:listRoleHolders", "query", { societyId: rows.societyId }), /Service scope documents:read required/);
  portable.principal = { ...portable.principal, scopes: ["documents:read"] };
  await nativeCtx.db.patch(owner._id, { status: "Disabled" });
  await assert.rejects(() => canReadControllerRegisters(portable, rows.societyId), /disabled/i, "scope filtering must preserve actor disable failures");
  await nativeCtx.db.patch(owner._id, { status: "Active" });
});
console.log("Sensitive history permissions passed: Member cannot read directors/officers/controllers or mixed reporting lines; live register/ledger controller DOB is withheld; recognized member/shareholder reads retain policy; Owner/Viewer authorized reads work, unknown roles and foreign workspaces remain denied; docs-only services retain ordinary rows while withholding controllers and preserving membership/disable errors.");
