import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { toPortableMutationCtx } from "../convex/lib/portable";
import { taskCreate, taskUpdate } from "../shared/functions/tasks";

const issuer = betterAuthIssuer();
const backend = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./tasks.js": () => import("../convex/tasks"),
} as any);
const fixture = await backend.run(async ctx => {
  const now = new Date().toISOString();
  const societyId = await ctx.db.insert("societies", { name: "Task module links", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
  const foreignSocietyId = await ctx.db.insert("societies", { name: "Foreign task sources", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
  const users: Record<string, any> = {};
  for (const role of ["Owner", "Viewer"]) users[role] = await ctx.db.insert("users", { societyId, role, status: "Active", displayName: role, email: `${role}@tasks.example.test`, authSubject: role, authIssuer: issuer, authProvider: "better-auth", createdAtISO: now });
  const sources = async (scope: typeof societyId) => {
    const filingId = await ctx.db.insert("filings", { societyId: scope, kind: "AnnualReport", dueDate: "2030-01-01", status: "Draft" });
    const commitmentId = await ctx.db.insert("commitments", { societyId: scope, title: "Source commitment", category: "Other", requirement: "Perform promised work", cadence: "Annual", status: "Active", createdAtISO: now, updatedAtISO: now });
    const eventId = await ctx.db.insert("commitmentEvents", { societyId: scope, commitmentId, title: "Completion", happenedAtISO: now, evidenceDocumentIds: [], createdAtISO: now });
    const policyId = await ctx.db.insert("policies", { societyId: scope, policyName: "Source policy", status: "Draft", requiredSigners: [], signatureRequired: false, jurisdictions: [], entityTypes: [], createdAtISO: now, updatedAtISO: now });
    const packageId = await ctx.db.insert("workflowPackages", { societyId: scope, eventType: "custom.event", status: "draft", packageName: "Source package", parts: [], supportingDocumentIds: [], priceItems: [], signerRoster: [], signerEmails: [], signingPackageIds: [], createdAtISO: now, updatedAtISO: now });
    return { commitmentId, eventId, policyId, packageId, filingId };
  };
  const owned = await sources(societyId);
  const foreign = await sources(foreignSocietyId);
  const inconsistentEventId = await ctx.db.insert("commitmentEvents", { societyId, commitmentId: foreign.commitmentId, title: "Broken imported parent", happenedAtISO: now, evidenceDocumentIds: [], createdAtISO: now });
  return { societyId, users, owned, foreign, inconsistentEventId };
});
const owner = backend.withIdentity({ subject: "Owner", issuer });
const viewer = backend.withIdentity({ subject: "Viewer", issuer });
const markers = (sources: typeof fixture.owned) => [
  `commitment:${sources.commitmentId}`,
  `workflowPackage:${sources.packageId}`,
  `policy:${sources.policyId}`,
  `policy-signatures:${sources.policyId}`,
  `boardPack:${sources.packageId}:prepare-agenda`,
  String(sources.eventId),
];
const base = { societyId: fixture.societyId, title: "Preparation task", status: "Todo", priority: "Medium", tags: [] };
let assertions = 0;
for (const eventId of markers(fixture.owned)) {
  const id = await owner.mutation(api.tasks.create, { ...base, eventId });
  await owner.mutation(api.tasks.update, { id, patch: { title: "Edited linked task", eventId } });
  for (const foreignEventId of markers(fixture.foreign)) {
    await assert.rejects(() => owner.mutation(api.tasks.update, { id, patch: { eventId: foreignEventId } }));
    assertions++;
  }
  await assert.rejects(() => viewer.mutation(api.tasks.update, { id, patch: { title: "Unauthorized edit" } }));
  assertions += 3;
}
for (const eventId of [...markers(fixture.foreign), "unknown:source", "custom.event", "boardPack:bad", String(fixture.inconsistentEventId)]) {
  await assert.rejects(() => owner.mutation(api.tasks.create, { ...base, eventId }));
  assertions++;
}
const filingTask = await owner.mutation(api.tasks.create, { ...base, filingId: fixture.owned.filingId });
await owner.mutation(api.tasks.update, { id: filingTask, patch: { filingId: fixture.owned.filingId } });
await assert.rejects(() => owner.mutation(api.tasks.create, { ...base, filingId: fixture.foreign.filingId }));
await assert.rejects(() => owner.mutation(api.tasks.update, { id: filingTask, patch: { filingId: fixture.foreign.filingId } }));
assertions += 4;
await backend.run(async ctx => {
  const portable = { ...await toPortableMutationCtx(ctx), principal: { kind: "user" as const, runtime: "test" as const, assurance: "trusted-workspace" as const, subject: "Owner", userId: String(fixture.users.Owner), societyId: String(fixture.societyId) } };
  const taskId = await taskCreate(portable, { ...base, filingId: String(fixture.owned.filingId) });
  await taskUpdate(portable, { id: taskId, patch: { filingId: String(fixture.owned.filingId) } });
  await assert.rejects(() => taskCreate(portable, { ...base, filingId: String(fixture.foreign.filingId) }));
  await assert.rejects(() => taskUpdate(portable, { id: taskId, patch: { filingId: String(fixture.foreign.filingId) } }));
  assertions += 4;
  for (const eventId of markers(fixture.owned)) {
    const id = await taskCreate(portable, { ...base, eventId });
    await taskUpdate(portable, { id, patch: { eventId, title: "Portable source edit" } });
    assertions += 2;
  }
  for (const eventId of markers(fixture.foreign)) {
    await assert.rejects(() => taskCreate(portable, { ...base, eventId }));
    assertions++;
  }
});
console.log(`Task source links passed ${assertions} checks: native and portable creation/editing, five owned correlation namespaces, real completion IDs, foreign sources, broken parents, unknown keys, filing links and Viewer writes.`);
