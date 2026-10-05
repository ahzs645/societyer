import assert from "node:assert/strict";
import { makeFunctionReference } from "convex/server";
import { createFixture, fixtureIssuer } from "../experiments/offline-convex/fixture";
import { MemoryDb, LocalStoreDb, MemoryRowStore, PortableRuntime, makeCapabilities, definePortableMutation, definePortableQuery, type PortablePrincipal } from "../shared/portable/index";
import * as chat from "../shared/functions/aiChat";
import * as agents from "../shared/functions/aiAgents";

const fixture = await createFixture({ "./aiChat.js": () => import("../convex/aiChat"), "./aiAgents.js": () => import("../convex/aiAgents") });
const refs = {
  create: makeFunctionReference<"mutation">("aiChat:createThread"), list: makeFunctionReference<"query">("aiChat:listThreads"),
  get: makeFunctionReference<"query">("aiChat:getThread"), messages: makeFunctionReference<"query">("aiChat:messagesForThread"),
  append: makeFunctionReference<"mutation">("aiChat:_appendMessage"), rename: makeFunctionReference<"mutation">("aiChat:renameThread"),
  archive: makeFunctionReference<"mutation">("aiChat:archiveThread"), remove: makeFunctionReference<"mutation">("aiChat:deleteThread"),
};
await fixture.native.run(async ctx => {
  for (const [subject, role] of [["admin-a", "Admin"], ["director-a", "Director"], ["member-a", "Member"]]) await ctx.db.insert("users", { societyId: fixture.ids.societyA, role, status: "Active", authSubject: subject, authIssuer: fixtureIssuer, email: `${subject}@example.test`, displayName: subject, createdAtISO: "2026-01-01T00:00:00Z" });
});
const owner = fixture.actor("owner-a");
const admin = fixture.actor("admin-a");
const runAgent = makeFunctionReference<"mutation">("aiAgents:runAgent");
const listRuns = makeFunctionReference<"query">("aiAgents:listRuns");
const audit = makeFunctionReference<"query">("aiAgents:auditForRun");
const recordRun = makeFunctionReference<"mutation">("aiAgents:_recordAgentRun");
const run = await owner.mutation(runAgent, { societyId: fixture.ids.societyA, agentKey: "compliance_analyst", input: "Synthetic private source input" });
assert.equal((await owner.query(listRuns, { societyId: fixture.ids.societyA }))[0].runId ?? (await owner.query(listRuns, { societyId: fixture.ids.societyA }))[0]._id, run.runId);
assert.ok((await owner.query(audit, { runId: run.runId })).length > 0);
for (const subject of ["admin-a", "director-a", "member-a", "viewer-a", "owner-b"]) {
  const actor = fixture.actor(subject);
  await assert.rejects(actor.query(audit, { runId: run.runId }));
  if (subject !== "owner-b") assert.deepEqual(await actor.query(listRuns, { societyId: fixture.ids.societyA }), []);
}
console.log("PASS native private AI run lists/audits exclude other creators and all lower roles");
const ownId = await owner.mutation(refs.create, { societyId: fixture.ids.societyA, title: "Confidential creator chat" });
await owner.mutation(refs.append, { societyId: fixture.ids.societyA, threadId: ownId, role: "user", content: "Synthetic confidential attachment contents" });
assert.equal((await owner.query(refs.messages, { threadId: ownId }))[0].createdByUserId, fixture.ids.users["owner-a"]);
assert.equal((await owner.query(refs.list, { societyId: fixture.ids.societyA })).length, 1);
const adminId = await admin.mutation(refs.create, { societyId: fixture.ids.societyA, title: "Admin private chat" });
assert.deepEqual((await admin.query(refs.list, { societyId: fixture.ids.societyA })).map((row: any) => row._id), [adminId]);
await assert.rejects(owner.query(refs.get, { threadId: adminId }));
for (const subject of ["admin-a", "director-a", "member-a", "viewer-a", "owner-b"]) {
  const actor = fixture.actor(subject);
  await assert.rejects(actor.query(refs.get, { threadId: ownId }));
  await assert.rejects(actor.query(refs.messages, { threadId: ownId }));
  await assert.rejects(actor.mutation(refs.rename, { threadId: ownId, title: "Denied edit" }));
  await assert.rejects(actor.mutation(refs.archive, { threadId: ownId }));
  await assert.rejects(actor.mutation(refs.remove, { threadId: ownId }));
  if (["director-a", "member-a", "viewer-a"].includes(subject)) assert.deepEqual(await actor.query(refs.list, { societyId: fixture.ids.societyA }), []);
}
const legacyId = await fixture.native.run(ctx => ctx.db.insert("aiChatThreads", { societyId: fixture.ids.societyA, title: "Missing creator", status: "active", createdAtISO: "2026-01-01T00:00:00Z", updatedAtISO: "2026-01-01T00:00:00Z" }));
await assert.rejects(owner.query(refs.messages, { threadId: legacyId }));
await assert.rejects(owner.mutation(refs.append, { societyId: fixture.ids.societyA, threadId: legacyId, role: "assistant", content: "Denied" }));
console.log("PASS native five-role creator privacy: no other Admin/Owner, lower-role or foreign-tenant reads/mutations; creatorless legacy chats fail closed");
await fixture.native.run(ctx => ctx.db.patch(fixture.ids.users["owner-a"] as any, { role: "Member" }));
assert.deepEqual(await owner.query(refs.list, { societyId: fixture.ids.societyA }), []);
await assert.rejects(owner.query(refs.get, { threadId: ownId }));
await assert.rejects(owner.query(refs.messages, { threadId: ownId }));
const count = await fixture.native.run(async ctx => (await ctx.db.query("aiMessages").collect()).length);
await assert.rejects(owner.mutation(refs.append, { societyId: fixture.ids.societyA, threadId: ownId, role: "assistant", content: "Late completion after downgrade" }), /tasks:write/);
assert.equal(await fixture.native.run(async ctx => (await ctx.db.query("aiMessages").collect()).length), count);
assert.deepEqual(await owner.query(listRuns, { societyId: fixture.ids.societyA }), []);
await assert.rejects(owner.query(audit, { runId: run.runId }));
const runCount = await fixture.native.run(async ctx => (await ctx.db.query("aiAgentRuns").collect()).length);
await assert.rejects(owner.mutation(recordRun, { societyId: fixture.ids.societyA, agentKey: "compliance_analyst", input: "Private", output: "Late output", provider: "local-fixture" }), /tasks:write/);
assert.equal(await fixture.native.run(async ctx => (await ctx.db.query("aiAgentRuns").collect()).length), runCount);
console.log("PASS native current-role downgrade invalidates creator reads and blocks late provider completion before persistence");

for (const label of ["MemoryDb", "LocalStoreDb"]) {
  const issuer = "https://portable-ai-privacy.test";
  const seed = { societies: [{ _id: "a", name: "A" }, { _id: "b", name: "B" }], users: ["Owner", "Admin", "Director", "Member", "Viewer"].map(role => ({ _id: role, societyId: "a", role, status: "Active", authSubject: role, authIssuer: issuer })), aiChatThreads: [{ _id: "legacy", societyId: "a", title: "Missing creator", status: "active", createdAtISO: "2026-01-01T00:00:00Z", updatedAtISO: "2026-01-01T00:00:00Z" }] };
  const db = label === "MemoryDb" ? new MemoryDb({ seed }) : new LocalStoreDb(new MemoryRowStore(seed));
  const runtime = (principal: PortablePrincipal) => {
    const value = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: () => principal });
    value.registerAll([
      ...["createThread", "renameThread", "archiveThread", "deleteThread"].map(name => definePortableMutation({ name: `aiChat:${name}`, applicationPolicy: true, handler: (chat as any)[`${name}Portable`] })),
      ...["listThreads", "getThread", "messagesForThread"].map(name => definePortableQuery({ name: `aiChat:${name}`, applicationPolicy: true, handler: (chat as any)[`${name}Portable`] })),
      definePortableQuery({ name: "aiAgents:listRuns", applicationPolicy: true, handler: agents.listRunsPortable }),
      definePortableQuery({ name: "aiAgents:auditForRun", applicationPolicy: true, handler: agents.auditForRunPortable }),
    ]);
    return value;
  };
  const actor = (subject: string) => runtime({ kind: "user", runtime: "test", assurance: "verified-jwt", subject, issuer });
  const id = await actor("Owner").runMutation("aiChat:createThread", { societyId: "a", title: "Private portable thread" });
  await db.transaction(() => db.insert("aiMessages", { societyId: "a", threadId: id, role: "user", content: "Synthetic private source", createdByUserId: "Owner" }));
  assert.equal((await actor("Owner").runQuery("aiChat:messagesForThread", { threadId: id })).length, 1);
  await db.transaction(async () => {
    await db.insert("aiAgentRuns", { _id: "private-run", societyId: "a", triggeredByUserId: "Owner", agentKey: "compliance_analyst", input: "Synthetic private input", output: "Private output" });
    await db.insert("aiAgentRuns", { _id: "legacy-run", societyId: "a", agentKey: "compliance_analyst", input: "Legacy input", output: "Legacy output" });
    await db.insert("aiAgentAuditEvents", { societyId: "a", runId: "private-run", metadata: { input: "Synthetic private source" } });
  });
  assert.equal((await actor("Owner").runQuery("aiAgents:listRuns", { societyId: "a", agentKey: "compliance_analyst" })).length, 1);
  assert.equal((await actor("Owner").runQuery("aiAgents:auditForRun", { runId: "private-run" })).length, 1);
  await assert.rejects(actor("Owner").runQuery("aiAgents:auditForRun", { runId: "legacy-run" }));
  for (const role of ["Admin", "Director", "Member", "Viewer"]) {
    assert.deepEqual(await actor(role).runQuery("aiChat:listThreads", { societyId: "a" }), []);
    await assert.rejects(actor(role).runQuery("aiChat:messagesForThread", { threadId: id }));
    await assert.rejects(actor(role).runMutation("aiChat:renameThread", { threadId: id, title: "Denied" }));
    assert.deepEqual(await actor(role).runQuery("aiAgents:listRuns", { societyId: "a" }), []);
    await assert.rejects(actor(role).runQuery("aiAgents:auditForRun", { runId: "private-run" }));
  }
  await assert.rejects(actor("Owner").runQuery("aiChat:getThread", { threadId: "legacy" }));
  const service = (scopes: string[]) => runtime({ kind: "service", runtime: "test", assurance: "trusted-internal", subject: "fixture-service", actorUserId: "Owner", societyId: "a", scopes });
  await assert.rejects(service(["tasks:read"]).runQuery("aiChat:messagesForThread", { threadId: id }), /Service scope tasks:write/);
  assert.equal((await service(["tasks:*"]).runQuery("aiChat:messagesForThread", { threadId: id })).length, 1);
  await assert.rejects(service(["tasks:*"]).runMutation("aiChat:createThread", { societyId: "b" }));
  await db.transaction(() => db.patch("Owner", { role: "Member" }));
  assert.deepEqual(await actor("Owner").runQuery("aiChat:listThreads", { societyId: "a" }), []);
  await assert.rejects(actor("Owner").runQuery("aiChat:messagesForThread", { threadId: id }));
  await assert.rejects(service(["tasks:*"]).runQuery("aiChat:messagesForThread", { threadId: id }));
  await assert.rejects(actor("Owner").runQuery("aiAgents:auditForRun", { runId: "private-run" }));
  assert.deepEqual(await actor("Owner").runQuery("aiAgents:listRuns", { societyId: "a" }), []);
  console.log(`PASS ${label}: five-role privacy, missing creator, scoped service actor/tenant and current-role downgrade checks`);
}
console.log("Private AI chat qualification passed.");
