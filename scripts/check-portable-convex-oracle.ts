// Phase 2 conformance: convex-test as a third engine in the differential harness.
//
// Runs legalOperations:votingPower through the REAL Convex stack — the actual
// schema (validators + indexes) and the delegating handler over a genuine Convex
// DatabaseReader (convex/lib/portable.ts) — using convex-test, then diffs the
// result against the local MemoryDb engine. This validates that the Convex
// adapter (toPortableQueryCtx / ConvexPortableDb) faithfully bridges a real
// Convex ctx, not just our hand-written assumptions.
//
// convex-test is an ORACLE here, not a production engine (it depends on
// node:async_hooks). See docs/portable-functions-architecture.md.

import assert from "node:assert/strict";
import { convexTest } from "convex-test";

import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import {
  MemoryDb,
  LocalStoreDb,
  MemoryRowStore,
  PortableRuntime,
  definePortableQuery,
  definePortableMutation,
  makeCapabilities,
  type PortableDoc,
  type TransactionalDb,
} from "../shared/portable/index";
import { votingPowerPortable } from "../shared/functions/votingPower";
import { upsertRightsClassPortable } from "../shared/functions/rightsClasses";
import { memberCreate, memberUpdate, memberRemove, membersList } from "../shared/functions/members";
import { buildConvexCapabilities } from "../convex/providers/capabilities";

// convex-test resolves api.legalOperations.* from this module map (we only invoke
// votingPower, which makes no nested calls, so the one module suffices).
const modules = {
  // convex-test locates the modules root via the _generated entries.
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./legalOperations.js": () => import("../convex/legalOperations"),
  "./members.js": () => import("../convex/members"),
};

const t = convexTest(schema, modules as any);

// --- seed the real schema (validated inserts), capturing generated ids --------
const seeded = await t.run(async (ctx: any) => {
  const iso = "2026-01-01T00:00:00.000Z";
  const societyId = await ctx.db.insert("societies", {
    name: "Riverside", isCharity: false, isMemberFunded: false, updatedAt: 0,
  });
  const person = (fullName: string, extra: Record<string, unknown>) =>
    ctx.db.insert("peopleDirectory", { fullName, searchName: fullName.toLowerCase(), createdAtISO: iso, updatedAtISO: iso, ...extra });
  const pAlice = await person("Alice Stone", { isIndividual: true, atAgeOfMajority: true });
  const pVane = await person("Vane Holdings Ltd.", { isIndividual: false });
  const pTim = await person("Tim Young", { isIndividual: true, atAgeOfMajority: false });
  const pCarol = await person("Carol Reed", { isIndividual: true, atAgeOfMajority: true });

  const role = (fullName: string, directoryPersonId: string) =>
    ctx.db.insert("roleHolders", {
      societyId, roleType: "member", status: "current", fullName, directoryPersonId,
      citizenshipCountries: [], taxResidenceCountries: [], relatedShareholderIds: [], controllingIndividualIds: [],
      sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: iso, updatedAtISO: iso,
    });
  const rhAlice = await role("Alice Stone", pAlice);
  const rhVane = await role("Vane Holdings Ltd.", pVane);
  const rhTim = await role("Tim Young", pTim);
  const rhCarol = await role("Carol Reed", pCarol);

  const classA = await ctx.db.insert("rightsClasses", {
    societyId, className: "Class A", classType: "share", status: "active", votesPerShare: 10,
    sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: iso, updatedAtISO: iso,
  });
  const classB = await ctx.db.insert("rightsClasses", {
    societyId, className: "Class B", classType: "non_voting", status: "active", votingRights: "Non-Voting",
    sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: iso, updatedAtISO: iso,
  });

  const hold = (rightsClassId: string, holderRoleHolderId: string, holderKey: string, quantity: number) =>
    ctx.db.insert("rightsHoldings", {
      societyId, rightsClassId, holderRoleHolderId, holderKey, quantity, status: "current",
      sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: iso, updatedAtISO: iso,
    });
  await hold(classA, rhAlice, "alice", 100);
  await hold(classA, rhVane, "vane", 50);
  await hold(classA, rhTim, "tim", 10);
  await hold(classB, rhCarol, "carol", 300);
  return { societyId };
});

// --- run the SAME handler via the real Convex stack ---------------------------
const convexResult: any = await t.query(api.legalOperations.votingPower, { societyId: seeded.societyId });

// --- run it on the local oracle with the matching logical fixture -------------
const societyId = "soc_local";
const localFixture: Record<string, PortableDoc[]> = {
  rightsClasses: [
    { _id: "classA", societyId, className: "Class A", votesPerShare: 10 },
    { _id: "classB", societyId, className: "Class B", votingRights: "Non-Voting" },
  ],
  roleHolders: [
    { _id: "rh_alice", societyId, fullName: "Alice Stone", directoryPersonId: "p_alice" },
    { _id: "rh_vane", societyId, fullName: "Vane Holdings Ltd.", directoryPersonId: "p_vane" },
    { _id: "rh_tim", societyId, fullName: "Tim Young", directoryPersonId: "p_tim" },
    { _id: "rh_carol", societyId, fullName: "Carol Reed", directoryPersonId: "p_carol" },
  ],
  peopleDirectory: [
    { _id: "p_alice", isIndividual: true, atAgeOfMajority: true },
    { _id: "p_vane", isIndividual: false },
    { _id: "p_tim", isIndividual: true, atAgeOfMajority: false },
    { _id: "p_carol", isIndividual: true, atAgeOfMajority: true },
  ],
  rightsHoldings: [
    { _id: "h1", societyId, holderKey: "alice", holderRoleHolderId: "rh_alice", rightsClassId: "classA", quantity: 100, status: "current" },
    { _id: "h2", societyId, holderKey: "vane", holderRoleHolderId: "rh_vane", rightsClassId: "classA", quantity: 50, status: "current" },
    { _id: "h3", societyId, holderKey: "tim", holderRoleHolderId: "rh_tim", rightsClassId: "classA", quantity: 10, status: "current" },
    { _id: "h4", societyId, holderKey: "carol", holderRoleHolderId: "rh_carol", rightsClassId: "classB", quantity: 300, status: "current" },
  ],
};
const runtime = new PortableRuntime({ db: new MemoryDb({ seed: localFixture }), capabilities: makeCapabilities({}) })
  .register(definePortableQuery({ name: "legalOperations:votingPower", handler: votingPowerPortable }));
const localResult: any = await runtime.runQuery("legalOperations:votingPower", { societyId });

// --- the real Convex stack and the local engine must agree --------------------
assert.equal(convexResult.totalVotes, 1600, "convex-test totalVotes");
assert.deepEqual(convexResult.voting.map((h: any) => h.holderKey), ["alice", "vane", "tim"]);
assert.deepEqual(convexResult.eligibleSigners.map((h: any) => h.holderKey), ["alice"]);
assert.deepEqual(convexResult, localResult, "real Convex stack diverged from the local oracle");

console.log("✓ convex-test (real Convex ctx.db + schema) == local MemoryDb oracle for votingPower");

// === MUTATION: upsertRightsClass create + update across all three engines =====
const COMPARABLE = ["className", "classType", "status", "votesPerShare", "sourceDocumentIds", "sourceExternalIds"] as const;
const normalizeClass = (row: any) => Object.fromEntries(COMPARABLE.map((k) => [k, row?.[k]]));

// Real Convex stack: create, then update by id.
const convexCreatedId = await t.mutation(api.legalOperations.upsertRightsClass, {
  societyId: seeded.societyId, className: "Class C", classType: "share", status: "active", votesPerShare: 5,
});
const convexCreated = await t.run(async (ctx: any) => ctx.db.get(convexCreatedId));
assert.equal(convexCreated.className, "Class C");
assert.equal(convexCreated.votesPerShare, 5);
assert.ok(convexCreated.createdAtISO && convexCreated.updatedAtISO, "timestamps stamped");

await t.mutation(api.legalOperations.upsertRightsClass, {
  id: convexCreatedId, societyId: seeded.societyId, className: "Class C2", classType: "share", status: "inactive",
});
const convexUpdated = await t.run(async (ctx: any) => ctx.db.get(convexCreatedId));
assert.equal(convexUpdated.className, "Class C2");
assert.equal(convexUpdated.status, "inactive");
assert.equal(convexUpdated._id, convexCreatedId, "update patches in place (same id)");

// Local engines: the same portable mutation produces the same normalized row.
const upsertDef = definePortableMutation({ name: "legalOperations:upsertRightsClass", handler: upsertRightsClassPortable });
async function localCreate(db: TransactionalDb) {
  const rt = new PortableRuntime({ db, capabilities: makeCapabilities({}) }).register(upsertDef);
  const id = await rt.runMutation<string>("legalOperations:upsertRightsClass", {
    societyId: "soc_local", className: "Class C", classType: "share", status: "active", votesPerShare: 5,
  });
  return db.get(id);
}
const memCreated = await localCreate(new MemoryDb());
const locCreated = await localCreate(new LocalStoreDb(new MemoryRowStore()));
assert.deepEqual(normalizeClass(memCreated), normalizeClass(convexCreated), "MemoryDb != Convex for upsertRightsClass");
assert.deepEqual(normalizeClass(locCreated), normalizeClass(convexCreated), "LocalStoreDb != Convex for upsertRightsClass");

// Option validation is enforced identically (real Convex + local).
await assert.rejects(
  () => t.mutation(api.legalOperations.upsertRightsClass, { societyId: seeded.societyId, className: "X", classType: "not_a_real_type", status: "active" }),
  /must be one of the configured/,
  "Convex should reject an invalid classType",
);
await assert.rejects(
  () => localCreate(new MemoryDb()).then(() =>
    new PortableRuntime({ db: new MemoryDb(), capabilities: makeCapabilities({}) }).register(upsertDef)
      .runMutation("legalOperations:upsertRightsClass", { societyId: "s", className: "X", classType: "not_a_real_type", status: "active" })),
  /must be one of the configured/,
  "local runtime should reject the same invalid classType",
);
console.log("✓ upsertRightsClass mutation: real Convex == MemoryDb == LocalStoreDb (create, update, validation)");

// === MEMBERS CRUD across all three engines (create / list / update / remove) ==
const memberArgs = { firstName: "Dana", lastName: "Lee", membershipClass: "Regular", status: "Active", joinedAt: "2026-01-01", votingRights: true };

// Real Convex stack.
const cMemberId = await t.mutation(api.members.create, { societyId: seeded.societyId, ...memberArgs });
let cList: any[] = await t.query(api.members.list, { societyId: seeded.societyId });
assert.equal(cList.length, 1, "Convex member created");
assert.equal(cList[0].firstName, "Dana");
await t.mutation(api.members.update, { id: cMemberId, patch: { status: "Lapsed" } });
const cMember = await t.run(async (ctx: any) => ctx.db.get(cMemberId));
assert.equal(cMember.status, "Lapsed", "Convex member patched");
await t.mutation(api.members.remove, { id: cMemberId });
cList = await t.query(api.members.list, { societyId: seeded.societyId });
assert.equal(cList.length, 0, "Convex member removed");

// Local engines: the same CRUD sequence, identical observable behavior.
async function localMembersCrud(db: TransactionalDb) {
  const rt = new PortableRuntime({ db, capabilities: makeCapabilities({}) })
    .register(definePortableMutation({ name: "members:create", handler: memberCreate }))
    .register(definePortableMutation({ name: "members:update", handler: memberUpdate }))
    .register(definePortableMutation({ name: "members:remove", handler: memberRemove }))
    .register(definePortableQuery({ name: "members:list", handler: membersList }));
  const id = await rt.runMutation<string>("members:create", { societyId: "soc_local", ...memberArgs });
  assert.equal((await rt.runQuery<any[]>("members:list", { societyId: "soc_local" })).length, 1);
  await rt.runMutation("members:update", { id, patch: { status: "Lapsed" } });
  assert.equal((await db.get(id))?.status, "Lapsed");
  await rt.runMutation("members:remove", { id });
  assert.equal((await rt.runQuery<any[]>("members:list", { societyId: "soc_local" })).length, 0);
}
await localMembersCrud(new MemoryDb());
await localMembersCrud(new LocalStoreDb(new MemoryRowStore()));
console.log("✓ members CRUD: real Convex == MemoryDb == LocalStoreDb (create/list/update/remove)");

// === CAPABILITY bag: the converted notifications.sendDigest call-site ==========
{
  const caps = buildConvexCapabilities();
  assert.equal(caps.has("email"), true, "email capability is wired on Convex");
  assert.equal(caps.has("sms"), true, "sms capability is wired on Convex");
  const email = await caps.email.sendEmail({ to: "board@example.org", subject: "Digest", text: "hi" });
  assert.ok(email.id && email.accepted, "email routes through the injected bag");
  const sms = await caps.sms.sendSms({ to: "+15551234567", body: "hi", tag: "digest" });
  assert.ok(sms.id, "sms routes through the injected bag");
  console.log("✓ buildConvexCapabilities() routes email/sms through the injected capability surface");
}

console.log("\nPortable convex-oracle conformance passed.");
