import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { makeFunctionReference } from "convex/server";
import { createFixture, fixtureIssuer } from "../experiments/offline-convex/fixture";
import { withMeetingDownloadInvalidation } from "../convex/lib/offlineMeetingInvalidation";
import { uuidPattern } from "../shared/offline/meetingProtocol";
import { writeTrackedReport } from "./lib/writeTrackedReport.mjs";

const f = await createFixture({
  "./documents.js": () => import("../convex/documents"),
  "./meetingMaterials.js": () => import("../convex/meetingMaterials"),
  "./meetings.js": () => import("../convex/meetings"),
  "./agendas.js": () => import("../convex/agendas"),
  "./committees.js": () => import("../convex/committees"),
  "./apiPlatform.js": () => import("../convex/apiPlatform"),
});
const owner = f.actor("owner-a"), viewer = f.actor("viewer-a");
const ref = (name: string) => makeFunctionReference<"mutation">(name);
const queryRef = (name: string) => makeFunctionReference<"query">(name);
const keys = Object.fromEntries(["meeting", "minutes", "agenda", "item", "document", "material"].map(name => [name, randomUUID()]));
await owner.mutation(f.meetingApply, { societyId: f.ids.societyA, command: { version: 1, kind: "create-meeting", operationId: randomUUID(), meetingUuid: keys.meeting, baseRevision: 0, keys,
  title: "Production materialization", notes: "Original notes", agendaTitle: "Review", scheduledAt: "2026-11-15T10:00:00Z", file: { name: "brief.txt", mime: "text/plain", size: 5, sha256: createHash("sha256").update("brief").digest("hex") } } });
const aggregate = await f.native.run(ctx => ctx.db.query("offlineMeetingAggregates").first());
const mappings = JSON.parse(aggregate!.mappings), id = (table: string) => mappings.find((row: any) => row.table === table).nativeId;
const materialArgs = { id: id("meetingMaterials"), societyId: f.ids.societyA, meetingId: id("meetings"), documentId: id("documents"), accessLevel: "public", availabilityStatus: "available", accessGrants: [] };
const snapshot = async (actor = viewer) => (await actor.query(f.meetingSnapshot, { societyId: f.ids.societyA }))[0];
const projected = async (subject = "viewer-a") => f.native.run(ctx => ctx.db.query("offlineMeetingDownloads").withIndex("by_actor", q => q.eq("actor_key", `${fixtureIssuer}|${subject}`).eq("society_id", f.ids.societyA)).collect());
const fileCount = async () => JSON.parse((await projected())[0].payload).files.length;
const results: Array<{ name: string; passed: boolean }> = [];
async function check(name: string, body: () => Promise<void>) { await body(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
await check("Original document/material grants independently gate replication; unauthorized and foreign mutations are denied", async () => {
  assert.equal(await fileCount(), 0);
  await assert.rejects(() => viewer.mutation(ref("meetingMaterials:attach"), materialArgs), /Permission meetings:write/);
  await assert.rejects(() => f.actor("owner-b").mutation(ref("meetingMaterials:attach"), materialArgs));
  await owner.mutation(ref("meetingMaterials:attach"), materialArgs); assert.equal(await fileCount(), 1);
  await owner.mutation(ref("meetingMaterials:attach"), { ...materialArgs, accessLevel: "restricted" }); assert.equal(await fileCount(), 0);
  await owner.mutation(ref("meetingMaterials:attach"), { ...materialArgs, accessLevel: "restricted", accessGrants: [{ subjectType: "user", subjectId: f.ids.users["viewer-a"], subjectLabel: "Viewer", access: "view" }] }); assert.equal(await fileCount(), 1);
});
await check("Availability, document archive and deletion flags atomically invalidate cached file descriptors", async () => {
  await owner.mutation(ref("meetingMaterials:setAvailability"), { id: id("meetingMaterials"), availabilityStatus: "withdrawn" }); assert.equal(await fileCount(), 0);
  await owner.mutation(ref("meetingMaterials:attach"), materialArgs); assert.equal(await fileCount(), 1);
  await owner.mutation(ref("documents:flagForDeletion"), { id: id("documents"), flagged: true }); assert.equal(await fileCount(), 0);
  await owner.mutation(ref("documents:flagForDeletion"), { id: id("documents"), flagged: false }); assert.equal(await fileCount(), 1);
  await owner.mutation(ref("documents:archive"), { id: id("documents"), reason: "Native ACL regression" }); assert.equal(await fileCount(), 0);
  await f.native.run(ctx => withMeetingDownloadInvalidation(ctx, next => next.db.patch(id("documents"), { archivedAtISO: undefined, archivedReason: undefined }))); assert.equal(await fileCount(), 1);
});
await check("File attachment sink rechecks document/material ACL and drops replaced versions for all actors", async () => {
  const storageId = await f.native.run(ctx => ctx.storage.store(new Blob(["brief"])));
  await owner.mutation(ref("users:setRole"), { id: f.ids.users["viewer-a"], role: "Director" });
  await owner.mutation(ref("meetingMaterials:attach"), { ...materialArgs, accessLevel: "restricted" });
  await assert.rejects(() => viewer.mutation(f.commitFile, { societyId: f.ids.societyA, meetingUuid: keys.meeting, storageId }), /not found|FILE_WRITE_DENIED/);
  await owner.mutation(f.commitFile, { societyId: f.ids.societyA, meetingUuid: keys.meeting, storageId });
  await assert.rejects(() => viewer.mutation(f.commitFile, { societyId: f.ids.societyA, meetingUuid: keys.meeting, storageId }), /not found|FILE_WRITE_DENIED/);
  await owner.mutation(ref("users:setRole"), { id: f.ids.users["viewer-a"], role: "Viewer" });
  await owner.mutation(ref("meetingMaterials:attach"), materialArgs); assert.equal((await snapshot()).files[0].available, true);
  const replacementId = await f.native.run(ctx => ctx.storage.store(new Blob(["newer"])));
  await f.native.run(ctx => withMeetingDownloadInvalidation(ctx, next => next.db.patch(id("documents"), { storageId: replacementId })));
  assert.equal(await fileCount(), 0); assert.equal((await snapshot(owner)).files.length, 0);
  await assert.rejects(() => owner.query(f.downloadFile, { societyId: f.ids.societyA, meetingUuid: keys.meeting }), /FILE_NOT_AVAILABLE/);
  await f.native.run(ctx => withMeetingDownloadInvalidation(ctx, next => next.db.patch(id("documents"), { storageId })));
  assert.equal(await fileCount(), 1);
});
await check("Temporal material expiry runs through the real durable scheduled native function without a client rebuild", async () => {
  const expiresAt = Date.now() + 150;
  await owner.mutation(ref("meetingMaterials:setAvailability"), { id: id("meetingMaterials"), availabilityStatus: "available", expiresAtISO: new Date(expiresAt).toISOString() });
  assert.equal(await fileCount(), 1);
  const scope = await f.native.run(ctx => ctx.db.query("offlineMeetingScopes").first());
  assert.equal(scope?.nextRefreshAt, expiresAt + 1); assert.ok(scope?.scheduledJobId);
  await new Promise(resolve => setTimeout(resolve, 200)); await f.native.finishInProgressScheduledFunctions();
  assert.equal(await fileCount(), 0);
  await owner.mutation(ref("meetingMaterials:attach"), { ...materialArgs, expiresAtISO: "" }); assert.equal(await fileCount(), 1);
});
await check("Committee appointment add/remove and temporal end revoke the actual document and material access context", async () => {
  const memberId = await f.native.run(ctx => ctx.db.insert("members", { societyId: f.ids.societyA, firstName: "Native", lastName: "Member", membershipClass: "Regular", status: "Active", joinedAt: "2020-01-01", votingRights: false } as any));
  await owner.mutation(ref("users:upsert"), { id: f.ids.users["viewer-a"], societyId: f.ids.societyA, email: "viewer-a@example.test", displayName: "Viewer", role: "Viewer", status: "Active", memberId });
  const committeeId = await owner.mutation(ref("committees:create"), { societyId: f.ids.societyA, name: "Native committee", cadence: "monthly", color: "blue" });
  await f.native.run(ctx => withMeetingDownloadInvalidation(ctx, next => next.db.patch(id("documents"), { committeeId })));
  await owner.mutation(ref("meetingMaterials:attach"), { ...materialArgs, accessLevel: "committee" }); assert.equal(await fileCount(), 0);
  const appointment = await owner.mutation(ref("committees:addMember"), { societyId: f.ids.societyA, committeeId, name: "Viewer", role: "Member", memberId }); assert.equal(await fileCount(), 1);
  await owner.mutation(ref("committees:removeMember"), { id: appointment }); assert.equal(await fileCount(), 0);
  const renewed = await owner.mutation(ref("committees:addMember"), { societyId: f.ids.societyA, committeeId, name: "Viewer", role: "Member", memberId }); assert.equal(await fileCount(), 1);
  await f.native.run(ctx => withMeetingDownloadInvalidation(ctx, next => next.db.patch(renewed, { leftAt: new Date(Date.now() + 150).toISOString() })));
  await new Promise(resolve => setTimeout(resolve, 200)); await f.native.finishInProgressScheduledFunctions(); assert.equal(await fileCount(), 0);
  await owner.mutation(ref("meetingMaterials:attach"), materialArgs);
});
await check("Online content writes advance the offline revision; pending old commands cannot overwrite newer notes", async () => {
  const prior = await snapshot();
  await owner.mutation(ref("meetings:update"), { id: id("meetings"), patch: { title: "Online authority", notes: "New online notes" } });
  const next = await snapshot(); assert.equal(next.title, "Online authority"); assert.equal(next.notes, "New online notes"); assert.equal(next.revision, prior.revision + 1);
  await assert.rejects(() => owner.mutation(f.meetingApply, { societyId: f.ids.societyA, command: { version: 1, kind: "edit-meeting", operationId: randomUUID(), meetingUuid: keys.meeting, baseRevision: prior.revision, title: "Stale", notes: "Stale overwrite" } }), /REVISION_CONFLICT/);
  const item = await owner.mutation(ref("agendas:addItem"), { agendaId: id("agendas"), type: "discussion", title: "New online agenda item" });
  const projectedSnapshot = await snapshot(); assert.equal(projectedSnapshot.agenda.length, 2); assert.ok(projectedSnapshot.ids.items.every((value: string) => uuidPattern.test(value)));
  const projectedIds = projectedSnapshot.ids.items;
  await owner.mutation(ref("agendas:updateItem"), { itemId: item, title: "Renamed online agenda item" }); assert.deepEqual((await snapshot()).ids.items, projectedIds);
});
await check("Native identity disable/rebind clears old actor projections and grants only the authoritative replacement binding", async () => {
  const identityId = await f.native.run(ctx => withMeetingDownloadInvalidation(ctx, async next => {
    const identityId = await next.db.insert("externalIdentities", { issuer: fixtureIssuer, subject: "viewer-a", status: "Active", createdAtISO: new Date().toISOString() });
    await next.db.patch(f.ids.users["viewer-a"], { externalIdentityId: identityId }); return identityId;
  }));
  await f.native.run(ctx => withMeetingDownloadInvalidation(ctx, next => next.db.patch(identityId, { status: "Disabled" }))); assert.equal((await projected()).length, 0);
  await assert.rejects(() => snapshot(), /External identity is disabled/);
  await f.native.run(ctx => withMeetingDownloadInvalidation(ctx, next => next.db.patch(identityId, { status: "Active" }))); assert.equal((await projected()).length, 1);
  const serviceToken = randomUUID(); process.env.SOCIETYER_API_PLATFORM_TOKEN = serviceToken;
  await assert.rejects(() => owner.mutation(ref("apiPlatform:migrateUserToClerk"), { userId: f.ids.users["viewer-a"], expectedAuthSubject: "viewer-a", expectedAuthProvider: "clerk", expectedAuthIssuer: fixtureIssuer, authSubject: "viewer-rebound", mappingEvidenceRef: "native-test-mapping", identityPolicyEvidenceRef: "native-test-policy", serviceToken: "invalid" }));
  await owner.mutation(ref("apiPlatform:migrateUserToClerk"), { userId: f.ids.users["viewer-a"], expectedAuthSubject: "viewer-a", expectedAuthProvider: "clerk", expectedAuthIssuer: fixtureIssuer, authSubject: "viewer-rebound", mappingEvidenceRef: "native-test-mapping", identityPolicyEvidenceRef: "native-test-policy", serviceToken });
  delete process.env.SOCIETYER_API_PLATFORM_TOKEN;
  assert.equal((await projected()).length, 0); assert.equal((await projected("viewer-rebound")).length, 1);
  await assert.rejects(() => viewer.query(queryRef("offlineMeetings:syncIdentity"), { societyId: f.ids.societyA }), /OFFLINE_ACCESS_DENIED/);
  assert.deepEqual(await f.actor("viewer-rebound").query(queryRef("offlineMeetings:syncIdentity"), { societyId: f.ids.societyA }), { actorKey: `${fixtureIssuer}|viewer-rebound`, societyId: f.ids.societyA });
});
await check("One-minute repair removes stale operator-written identity authority without granting its expired view", async () => {
  await f.native.run(async ctx => {
    await ctx.db.patch(f.ids.users["viewer-a"] as any, { status: "Disabled" });
    const scope = await ctx.db.query("offlineMeetingScopes").first();
    await ctx.db.patch(scope!._id, { nextRefreshAt: Date.now() - 1 });
  });
  assert.equal((await projected("viewer-rebound")).length, 1);
  await assert.rejects(() => f.actor("viewer-rebound").query(queryRef("offlineMeetings:syncIdentity"), { societyId: f.ids.societyA }), /OFFLINE_ACCESS_DENIED/);
  assert.deepEqual(await f.native.mutation(ref("offlineMeetings:repairDownloads"), {}), { refreshed: 1 });
  assert.equal((await projected("viewer-rebound")).length, 0);
});
await check("Ordinary workspaces remain unaffected; deleted selected meetings remove projections and recurring scope", async () => {
  const ordinaryOwner = f.actor("owner-b");
  await ordinaryOwner.mutation(ref("users:upsert"), { societyId: f.ids.societyB, email: "new@example.test", displayName: "No pilot", role: "Viewer", status: "Invited" });
  await f.native.run(async ctx => assert.equal((await ctx.db.query("offlineMeetingScopes").withIndex("by_society", q => q.eq("societyId", f.ids.societyB)).collect()).length, 0));
  await owner.mutation(ref("meetings:remove"), { id: id("meetings") });
  await f.native.run(async ctx => { assert.equal((await ctx.db.query("offlineMeetingDownloads").collect()).length, 0); assert.equal((await ctx.db.query("offlineMeetingScopes").collect()).length, 0); assert.equal((await ctx.db.query("offlineMeetingAggregates").collect()).length, 0); });
});
await check("Oversized imported membership or meeting sets cannot roll back role and security revocations", async () => {
  for (const oversized of ["memberships", "meetings"] as const) {
    const oversizedFixture = await createFixture(), actor = oversizedFixture.actor("owner-a");
    const newKeys = Object.fromEntries(["meeting", "minutes", "agenda", "item", "document", "material"].map(name => [name, randomUUID()]));
    await actor.mutation(oversizedFixture.meetingApply, { societyId: oversizedFixture.ids.societyA, command: { version: 1, kind: "create-meeting", operationId: randomUUID(), meetingUuid: newKeys.meeting, baseRevision: 0, keys: newKeys, title: "Oversized import", scheduledAt: "2026-12-01", notes: "", agendaTitle: "Review" } });
    const extraIds = await oversizedFixture.native.run(async ctx => {
      const inserted = [];
      if (oversized === "memberships") {
        for (let i = 0; i < 49; i++) inserted.push(await ctx.db.insert("users", { societyId: oversizedFixture.ids.societyA, role: "Viewer", status: "Invited", email: `oversized-${i}@example.test`, displayName: "Imported membership", createdAtISO: "2026-01-01" }));
      } else {
        const source = (await ctx.db.query("offlineMeetingAggregates").first())!;
        for (let i = 0; i < 100; i++) inserted.push(await ctx.db.insert("offlineMeetingAggregates", { societyId: source.societyId, uuid: randomUUID(), revision: source.revision, mappings: source.mappings, updatedByUserId: source.updatedByUserId }));
      }
      return inserted;
    });
    await actor.mutation(ref("users:setRole"), { id: oversizedFixture.ids.users["viewer-a"], role: "Member" });
    await actor.mutation(ref("users:securityDisable"), { id: oversizedFixture.ids.users["viewer-a"], reason: "Oversized-set security regression" });
    await oversizedFixture.native.run(async ctx => {
      assert.equal((await ctx.db.get(oversizedFixture.ids.users["viewer-a"] as any))?.status, "Disabled");
      assert.equal((await ctx.db.query("offlineMeetingDownloads").collect()).length, 0);
      assert.equal((await ctx.db.query("offlineMeetingScopes").first())?.blockedReason, "MATERIALIZATION_FAILED");
    });
    await assert.rejects(() => actor.query(queryRef("offlineMeetings:syncIdentity"), { societyId: oversizedFixture.ids.societyA }), /OFFLINE_ACCESS_DENIED/);
    await oversizedFixture.native.run(async ctx => { for (const rowId of extraIds) await ctx.db.delete(rowId); });
    await actor.mutation(ref("users:recordLogin"), { id: oversizedFixture.ids.users["owner-a"] });
    await oversizedFixture.native.run(async ctx => {
      assert.equal((await ctx.db.query("offlineMeetingScopes").first())?.blockedReason, undefined);
      assert.equal((await ctx.db.query("offlineMeetingDownloads").collect()).length, 1);
    });
  }
});
await check("Retired and foreign issuer memberships cannot block current actors or receive replicated snapshots", async () => {
  const isolated = await createFixture(), actor = isolated.actor("owner-a");
  const newKeys = Object.fromEntries(["meeting", "minutes", "agenda", "item", "document", "material"].map(name => [name, randomUUID()]));
  await actor.mutation(isolated.meetingApply, { societyId: isolated.ids.societyA, command: { version: 1, kind: "create-meeting", operationId: randomUUID(), meetingUuid: newKeys.meeting, baseRevision: 0, keys: newKeys, title: "Issuer isolation", scheduledAt: "2026-12-01", notes: "", agendaTitle: "Review" } });
  await isolated.native.run(ctx => withMeetingDownloadInvalidation(ctx, next => next.db.insert("users", { societyId: isolated.ids.societyA, role: "Viewer", status: "Active", email: "retired@example.test", displayName: "Retired issuer", authIssuer: "https://foreign.example.test", authSubject: "owner-a", authProvider: "clerk", createdAtISO: "2026-01-01" })));
  await isolated.native.run(async ctx => {
    assert.equal((await ctx.db.query("offlineMeetingDownloads").collect()).length, 2);
    assert.equal((await ctx.db.query("offlineMeetingScopes").first())?.blockedReason, undefined);
  });
  await assert.rejects(() => isolated.actor("owner-a", "https://foreign.example.test").query(queryRef("offlineMeetings:syncIdentity"), { societyId: isolated.ids.societyA }), /OFFLINE_ACCESS_DENIED/);
});
await check("Feature-disabled deployments cannot issue download authority or accept offline commands", async () => {
  delete process.env.OFFLINE_MEETING_PREPARATION_ENABLED;
  try {
    await assert.rejects(() => owner.query(queryRef("offlineMeetings:syncIdentity"), { societyId: f.ids.societyA }), /DISABLED/);
    await assert.rejects(() => owner.query(f.meetingDownloads, { societyId: f.ids.societyA }), /DISABLED/);
  } finally { process.env.OFFLINE_MEETING_PREPARATION_ENABLED = "1"; }
});
writeTrackedReport("artifacts/offline/production-invalidation-results.json", JSON.stringify({ completedAt: new Date().toISOString(), passed: results.length, results,
  runtime: "Native Convex transaction oracle using production exports and actual scheduled mutations", limits: ["Identity transport injected by convex-test; live production broker replication tested separately", "Trusted internal identity disable/end-date writes exercise the same native writer hook without exposing an operator API", "Workspace limits remain 50 memberships and 100 selected meeting aggregates", "Direct admin-key database changes are repaired by the one-minute cron, not intercepted"] }, null, 2) + "\n");
console.log(`${results.length} production meeting invalidation groups passed.`);
