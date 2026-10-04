import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { convexTest } from "convex-test";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { actionPermission } from "../shared/functions/actionPolicy";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { PortableRuntime } from "../shared/portable/define";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { hasPermission } from "../shared/functions/permissions";

let classified = 0;
for (const file of readdirSync("convex").filter((file) => file.endsWith(".ts"))) {
  const source = readFileSync(`convex/${file}`, "utf8");
  for (const match of source.matchAll(/export const (\w+) = authorized(Query|Mutation|Action)\("([^"]+)"/g)) {
    actionPermission(match[3], match[2].toLowerCase() as any);
    classified++;
  }
  assert.ok(!/export const \w+ = (?:query|mutation|action)\(\{/.test(source), `${file} contains an unguarded public entry point`);
}
for (const definition of PORTABLE_FUNCTIONS) actionPermission(definition.name, definition.kind);
assert.equal(hasPermission("toString", "society:read"), false);
assert.equal(hasPermission("Viewer", "members:write"), false);
assert.equal(hasPermission("Member", "financials:read"), false);
for (const name of ["documentVersions:getDownloadTarget", "documentVersions:getDownloadUrl", "workflows:inspectPdfTemplate"]) {
  assert.equal(actionPermission(name, "action"), "documents:read", `${name} reads existing document content`);
}
assert.equal(actionPermission("documentVersions:completeUpload", "action"), "documents:write");

const portableDb = new MemoryDb({ seed: { societies: [{ _id: "local-society", name: "Local" }], users: [
  { _id: "local-member", societyId: "local-society", role: "Member", status: "Active" },
  { _id: "local-owner", societyId: "local-society", role: "Owner", status: "Active" },
] } });
const portable = new PortableRuntime({ db: portableDb, capabilities: makeCapabilities({}), principalProvider: () => ({ kind: "user", runtime: "test", assurance: "trusted-workspace", subject: "local-member", userId: "local-member", societyId: "local-society" }) }).registerAll(PORTABLE_FUNCTIONS);
await assert.rejects(() => portable.runMutation("members:create", { societyId: "local-society", firstName: "Denied", lastName: "Member" }), /Permission members:write/);
assert.equal(portableDb.dump("members").length, 0);
const modules = {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./authorization.js": () => import("../convex/authorization"),
  "./members.js": () => import("../convex/members"),
  "./users.js": () => import("../convex/users"),
  "./invitations.js": () => import("../convex/invitations"),
  "./permissions.js": () => import("../convex/permissions"),
  "./workflows.js": () => import("../convex/workflows"),
  "./apiPlatform.js": () => import("../convex/apiPlatform"),
  "./complianceObligations.js": () => import("../convex/complianceObligations"),
  "./dashboardRemediation.js": () => import("../convex/dashboardRemediation"),
  "./seedRecordTableMetadata.js": () => import("../convex/seedRecordTableMetadata"),
  "./aiSettings.js": () => import("../convex/aiSettings"),
  "./calendarSync.js": () => import("../convex/calendarSync"),
};
const test = convexTest(schema, modules);
const issuer = betterAuthIssuer();
const seeded = await test.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "Authorization test", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const ids: Record<string, any> = {};
  for (const role of ["Owner", "Admin", "Director", "Member", "Viewer"]) {
    ids[role] = await ctx.db.insert("users", { societyId, email: `${role.toLowerCase()}@authorization.test`, displayName: role, role, status: "Active", authSubject: role, authIssuer: issuer, createdAtISO: new Date().toISOString() });
  }
  const disabledOwner = await ctx.db.insert("users", { societyId, email: "disabled@authorization.test", displayName: "Disabled", role: "Owner", status: "Disabled", authSubject: "disabled", authIssuer: issuer, createdAtISO: new Date().toISOString() });
  const clientId = await ctx.db.insert("apiClients", { societyId, name: "Test", kind: "integration", status: "active", createdAtISO: new Date().toISOString(), updatedAtISO: new Date().toISOString() });
  const tokenId = await ctx.db.insert("apiTokens", { societyId, clientId, name: "Test", tokenHash: "test-hash", tokenStart: "soc_test", scopes: ["*"], status: "active", createdByUserId: ids.Admin, createdAtISO: new Date().toISOString() });
  return { societyId, ids, disabledOwner, tokenId };
});
const actor = (subject: string) => test.withIdentity({ issuer, subject });
const owner = actor("Owner"), admin = actor("Admin");
const metadataArgs = { societyId: seeded.societyId };
assert.equal((await admin.mutation(api.seedRecordTableMetadata.ensureForSociety, metadataArgs)).ok, true);
await assert.rejects(() => test.mutation(api.seedRecordTableMetadata.ensureForSociety, metadataArgs), /Authentication/);
await assert.rejects(() => actor("Member").mutation(api.seedRecordTableMetadata.ensureForSociety, metadataArgs), /Permission settings:write/);
const foreignMetadataSociety = await test.run((ctx) => ctx.db.insert("societies", { name: "Foreign metadata", isCharity: false, isMemberFunded: false, updatedAt: 0 }));
await assert.rejects(() => admin.mutation(api.seedRecordTableMetadata.ensureForSociety, { societyId: foreignMetadataSociety }), /membership/);
assert.equal((await test.run((ctx) => ctx.db.query("objectMetadata").withIndex("by_society", q => q.eq("societyId", foreignMetadataSociety)).collect())).length, 0);
assert.ok(await admin.mutation(api.aiSettings.upsert, { societyId: seeded.societyId, scope: "workspace", provider: "openrouter", label: "Provider", modelId: "provider/model-v1" }));
await assert.rejects(() => admin.mutation(api.aiSettings.upsert, { societyId: seeded.societyId, actingUserId: seeded.ids.Owner, scope: "workspace", provider: "openrouter", label: "Forged", modelId: "provider/model-v1" }), /Authenticated actor does not match/);
assert.ok(await admin.mutation(api.calendarSync.recordCalendarWebhook, { societyId: seeded.societyId, provider: "google", channelId: "provider-channel", subscriptionId: "provider-subscription", resourceId: "provider-resource" }));
const writeArgs = { societyId: seeded.societyId, firstName: "Test", lastName: "Member", status: "Active", membershipClass: "Voting", joinedAt: "2026-01-01", votingRights: true };
assert.equal((await actor("Member").query(api.users.get, { id: seeded.ids.Member })).role, "Member");
await assert.rejects(() => actor("Member").query(api.users.get, { id: seeded.ids.Owner }), /Permission users:read/);
const allowedMemberId = await admin.mutation(api.members.create, writeArgs);
assert.ok(allowedMemberId);
const decisionArgs = { societyId: seeded.societyId, ruleId: "home:compliance.annual-return:due", flagLevel: "warning", flagText: "Annual return review", evidenceRequired: [] };
await admin.mutation(api.complianceObligations.markReviewed, { ...decisionArgs, targetTable: "members", targetId: allowedMemberId });
await admin.mutation(api.complianceObligations.dismissDecision, decisionArgs);
await admin.mutation(api.complianceObligations.reopenDecision, decisionArgs);
await admin.mutation(api.dashboardRemediation.createComplianceReviewTask, decisionArgs);
const foreignTarget = await test.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "Foreign review target", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  return ctx.db.insert("members", { ...writeArgs, societyId });
});
await assert.rejects(() => admin.mutation(api.complianceObligations.markReviewed, { ...decisionArgs, targetTable: "members", targetId: foreignTarget }), /Record not found/);
await assert.rejects(() => actor("Member").mutation(api.complianceObligations.markReviewed, decisionArgs), /Permission deadlines:write/);
for (const subject of ["Member", "Viewer", "disabled", "unbound"]) {
  await assert.rejects(() => actor(subject).mutation(api.members.create, writeArgs), /Permission|membership|disabled|Authentication/);
}
await assert.rejects(() => test.mutation(api.members.create, writeArgs), /Authentication/);
await assert.rejects(() => admin.mutation(api.users.setRole, { id: seeded.ids.Admin, role: "Owner" }), /Only an Owner/);
await assert.rejects(() => owner.mutation(api.users.setRole, { id: seeded.ids.Member, role: "Superuser" }), /Invalid workspace role/);
await assert.rejects(() => owner.mutation(api.users.remove, { id: seeded.ids.Owner }), /last Active Owner/);
await assert.rejects(() => owner.mutation(api.users.upsert, { id: seeded.ids.Owner, societyId: seeded.societyId, email: "owner@authorization.test", displayName: "Owner", role: "Owner", status: "Disabled" }), /last Active Owner/);
await assert.rejects(() => admin.mutation(api.invitations.create, { societyId: seeded.societyId, email: "new@authorization.test", role: "Admin" }), /Only an Owner/);
const invitation = await owner.mutation(api.invitations.create, { societyId: seeded.societyId, email: "new@authorization.test", role: "Member", expiresInDays: 1 });
const row = await test.run((ctx) => ctx.db.get(invitation.id));
assert.ok(row?.tokenHash && !row?.token);
const listed = await owner.query(api.invitations.list, { societyId: seeded.societyId });
assert.ok(listed.every((row: any) => !row.token && !row.tokenHash));
const unverified = test.withIdentity({ issuer, subject: "new", email: "new@authorization.test", emailVerified: false });
assert.equal((await unverified.mutation(api.invitations.accept, { token: invitation.token })).status, "invitation-email-unverified");
await test.run((ctx) => ctx.db.patch(invitation.id, { expiresAtISO: "2020-01-01T00:00:00.000Z" }));
assert.equal((await unverified.mutation(api.invitations.accept, { token: invitation.token })).status, "invitation-expired");
await assert.rejects(() => actor("Member").query(api.permissions.myPermissions, { societyId: seeded.societyId, userId: seeded.ids.Owner }), /Role Admin required/);
const runId = await test.run(async (ctx) => {
  const workflowId = await ctx.db.insert("workflows", { societyId: seeded.societyId, name: "Queued workflow", recipe: "test", status: "active", trigger: { kind: "manual" }, createdByUserId: seeded.ids.Admin });
  return ctx.db.insert("workflowRuns", { societyId: seeded.societyId, workflowId, recipe: "test", status: "queued", startedAtISO: new Date().toISOString(), steps: [], demo: true, triggeredBy: "manual", triggeredByUserId: seeded.ids.Admin });
});
await test.run((ctx) => ctx.runQuery(internal.workflows._requireRunAuthority, { id: runId }));
process.env.SOCIETYER_API_PLATFORM_TOKEN = "authorization-test-service-token";
const verify = () => test.mutation(api.apiPlatform.verifyToken, { tokenHash: "test-hash", requiredScope: "members:write", serviceToken: process.env.SOCIETYER_API_PLATFORM_TOKEN });
assert.equal((await verify()).valid, true);
await owner.mutation(api.users.setRole, { id: seeded.ids.Admin, role: "Member" });
assert.equal((await verify()).valid, false, "Existing API keys must lose authority on role downgrade");
await assert.rejects(() => test.run((ctx) => ctx.runQuery(internal.workflows._requireRunAuthority, { id: runId })), /revoked/);
const concurrent = await test.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "Concurrent owners", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const ids: any[] = [];
  for (const subject of ["owner-a", "owner-b"]) ids.push(await ctx.db.insert("users", { societyId, email: `${subject}@authorization.test`, displayName: subject, role: "Owner", status: "Active", authSubject: subject, authIssuer: issuer, createdAtISO: new Date().toISOString() }));
  return { societyId, ids };
});
const outcomes = await Promise.allSettled(concurrent.ids.map((id, index) => actor(index ? "owner-b" : "owner-a").mutation(api.users.setRole, { id, role: "Member" })));
assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
const remaining = await test.run((ctx) => ctx.db.query("users").withIndex("by_society", (q) => q.eq("societyId", concurrent.societyId)).collect());
assert.equal(remaining.filter((user) => user.role === "Owner" && user.status === "Active").length, 1);
await owner.mutation(api.users.securityDisable, { id: seeded.ids.Owner, reason: "Synthetic incident" });
await assert.rejects(() => owner.query(api.members.list, { societyId: seeded.societyId }), /disabled/);
assert.equal((await test.run((ctx) => ctx.db.get(seeded.societyId)))?.accessRecoveryRequired, true);
console.log(`Authorization checks passed: ${classified} hosted and ${PORTABLE_FUNCTIONS.length} portable classifications; native wrappers enforce metadata initialization, opaque citation/provider keys with real target ownership, actor identity, role/status, last-owner preservation, invitations and current API/workflow authority; sole-owner security disabling enters recovery.`);
