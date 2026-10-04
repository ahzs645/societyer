import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createFixture, fixtureIssuer } from "./fixture";
import { toPortableQueryCtx } from "../../convex/lib/portable";
import { listPortable } from "../../shared/functions/meetings";
import { listForMeetingPortable } from "../../shared/functions/meetingMaterials";
import { getPortable as getDocument } from "../../shared/functions/documents";
import type { MeetingCommand, Mapping, Snapshot } from "./src/meetingProtocol";
import { issueMeetingSyncCredential } from "./server/syncCredential";
import type { ConvexHttpClient } from "convex/browser";
const f = await createFixture(); const owner = f.actor("owner-a");
const keys = { meeting: randomUUID(), minutes: randomUUID(), agenda: randomUUID(), item: randomUUID(), document: randomUUID(), material: randomUUID() };
const bytes = Buffer.from("Meeting preparation attachment\n");
const command: MeetingCommand = { version: 1, operationId: randomUUID(), meetingUuid: keys.meeting, baseRevision: 0, kind: "create-meeting", keys,
  title: "Board preparation", scheduledAt: "2026-11-15T10:00:00Z", notes: "Prepare offline", agendaTitle: "Review preparation",
  file: { name: "preparation.txt", mime: "text/plain", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } };
const args = { societyId: f.ids.societyA, command }; let mappings: Mapping[] = []; let checks = 0;
async function check(name: string, body: () => Promise<void>) { await body(); checks++; console.log(`PASS ${name}`); }
async function parity(subject: string) {
  const actor = f.actor(subject); const societyId = subject === "owner-b" ? f.ids.societyB : f.ids.societyA;
  const authoritative = await actor.query(f.meetingSnapshot, { societyId }) as Snapshot[];
  const projected = await actor.query(f.meetingDownloads, { societyId }) as any[];
  assert.deepEqual(projected.map(row => JSON.parse(row.payload)), authoritative);
  for (const row of projected) { assert.equal(row.actor_key, `${fixtureIssuer}|${subject}`); assert.equal(row.society_id, societyId); }
  // Independently exercise actual application readers as well as the materializer.
  await actor.run(async ctx => {
    const portable = await toPortableQueryCtx(ctx); const meetings = await listPortable(portable, { societyId });
    for (const snapshot of authoritative) {
      const meeting = meetings.find(row => row.title === snapshot.title)!; assert.ok(meeting);
      const materials = await listForMeetingPortable(portable, { meetingId: meeting._id });
      for (const file of snapshot.files) {
        const material = materials.find(row => row.document?._id === mappings.find(row => row.uuid === file.uuid)?.nativeId);
        assert.ok(material); assert.ok(await getDocument(portable, { id: material!.document!._id }));
      }
      assert.equal(snapshot.files.length, materials.length);
    }
  }); return authoritative;
}
await check("Existing meeting handler atomically creates meeting, agenda item, minutes and attachment metadata", async () => {
  const result = await owner.mutation(f.meetingApply, args); mappings = result.mappings; assert.equal(mappings.length, 6); assert.equal(result.revision, 1);
  await f.native.run(async ctx => {
    const meetings = await ctx.db.query("meetings").collect(); const minutes = await ctx.db.query("minutes").collect();
    assert.equal(meetings.length, 1); assert.equal(minutes.length, 1); assert.equal(meetings[0].minutesId, minutes[0]._id); assert.equal(minutes[0].meetingId, meetings[0]._id);
    assert.equal((await ctx.db.query("agendaItems").collect()).length, 1);
    assert.equal((await ctx.db.query("offlineMeetingAggregates").collect())[0].updatedByUserId, f.ids.users["owner-a"]);
  });
});
await check("Lost acknowledgement returns durable mapping with one effect", async () => {
  const result = await owner.mutation(f.meetingApply, args); assert.equal(result.replay, true); assert.deepEqual(result.mappings, mappings);
  await f.native.run(async ctx => { assert.equal((await ctx.db.query("meetings").collect()).length, 1); assert.equal((await ctx.db.query("offlineMeetingReceipts").collect()).length, 1); });
});
await check("Replay payload substitution denied", async () => { await assert.rejects(() => owner.mutation(f.meetingApply, { ...args, command: { ...command, title: "Changed" } }), /REPLAY_MISMATCH/); });
await check("Projection matches application readers for Owner, Viewer and foreign workspace", async () => {
  assert.equal((await parity("owner-a"))[0].files.length, 1); assert.equal((await parity("viewer-a"))[0].files.length, 0); assert.equal((await parity("owner-b")).length, 0);
});
await check("Sync token adapter derives identity and workspace through current authenticated policy", async () => {
  let signed: any;
  const signer = { signJWT: async (input: any) => { signed = input; return { token: "test-signature-placeholder" }; } };
  const client = { query: (ref: any, values: any) => owner.query(ref, values) } as ConvexHttpClient;
  const credential = await issueMeetingSyncCredential(client, signer, f.ids.societyA, "https://sync.example.test/");
  assert.equal(credential.endpoint, "https://sync.example.test");
  assert.deepEqual(signed.body.payload, { sub: `${fixtureIssuer}|owner-a`, society_id: f.ids.societyA });
  assert.deepEqual(signed.body.overrideOptions, { audience: "https://sync.example.test", expirationTime: "5m" });
  await assert.rejects(() => issueMeetingSyncCredential(client, signer, f.ids.societyB, "https://sync.example.test"), /membership not found/);
  await assert.rejects(() => issueMeetingSyncCredential(client, signer, f.ids.societyA, "http://sync.example.test"), /HTTPS/);
});
await check("Metadata acceptance is separate from file availability", async () => {
  assert.equal((await parity("owner-a"))[0].files[0].available, false);
  await assert.rejects(() => owner.query(f.downloadFile, { societyId: f.ids.societyA, meetingUuid: keys.meeting }), /FILE_NOT_AVAILABLE/);
});
await check("Attachment hash verified and transfer idempotent", async () => {
  const bad = await f.native.run(ctx => ctx.storage.store(new Blob(["incorrect"])));
  await assert.rejects(() => owner.mutation(f.commitFile, { societyId: f.ids.societyA, meetingUuid: keys.meeting, storageId: bad }), /FILE_HASH_MISMATCH/);
  const storageId = await f.native.run(ctx => ctx.storage.store(new Blob([bytes])));
  await owner.mutation(f.commitFile, { societyId: f.ids.societyA, meetingUuid: keys.meeting, storageId });
  await owner.mutation(f.commitFile, { societyId: f.ids.societyA, meetingUuid: keys.meeting, storageId });
  assert.equal((await parity("owner-a"))[0].files[0].available, true);
  assert.equal(await owner.query(f.downloadFile, { societyId: f.ids.societyA, meetingUuid: keys.meeting }), storageId);
});
const materialId = mappings.find(row => row.table === "meetingMaterials")!.nativeId;
await check("Restricted grants, withdrawal and expiry preserve material and document ACL parity", async () => {
  await f.native.run(ctx => ctx.db.patch(materialId as any, { accessLevel: "restricted", accessGrants: [{ subjectType: "user", subjectId: f.ids.users["viewer-a"], subjectLabel: "viewer-a", access: "view" }] }));
  await f.native.mutation(f.rebuild, { societyId: f.ids.societyA }); assert.equal((await parity("viewer-a"))[0].files.length, 1);
  await f.native.run(ctx => ctx.db.patch(materialId as any, { availabilityStatus: "withdrawn" }));
  await f.native.mutation(f.rebuild, { societyId: f.ids.societyA }); assert.equal((await parity("viewer-a"))[0].files.length, 0);
  await f.native.run(ctx => ctx.db.patch(materialId as any, { availabilityStatus: "available", expiresAtISO: "2000-01-01" }));
  await f.native.mutation(f.rebuild, { societyId: f.ids.societyA }); assert.equal((await parity("viewer-a"))[0].files.length, 0);
  await f.native.run(ctx => ctx.db.patch(materialId as any, { expiresAtISO: undefined, accessGrants: [] }));
  await f.native.mutation(f.rebuild, { societyId: f.ids.societyA }); assert.equal((await parity("viewer-a"))[0].files.length, 0);
});
await check("Dependent child command reruns the minutes handler using persistent mapping", async () => {
  const child: MeetingCommand = { version: 1, operationId: randomUUID(), meetingUuid: keys.meeting, baseRevision: 1, kind: "edit-minutes", discussion: "Offline child discussion" };
  await owner.mutation(f.meetingApply, { societyId: f.ids.societyA, command: child });
  const [snapshot] = await parity("owner-a"); assert.equal(snapshot.revision, 2); assert.equal(snapshot.discussion, child.discussion);
  await assert.rejects(() => owner.mutation(f.meetingApply, { societyId: f.ids.societyA, command: { ...child, operationId: randomUUID(), meetingUuid: randomUUID() } }), /PARENT_NOT_ACCEPTED/);
});
await check("Two-client revision conflict preserves authoritative server version", async () => {
  await assert.rejects(() => owner.mutation(f.meetingApply, { societyId: f.ids.societyA, command: { version: 1, operationId: randomUUID(), meetingUuid: keys.meeting, baseRevision: 1, kind: "edit-minutes", discussion: "Stale client" } }), /REVISION_CONFLICT/);
  assert.equal((await parity("owner-a"))[0].discussion, "Offline child discussion");
});
await check("Unknown command version and approval fields rejected", async () => {
  await assert.rejects(() => owner.mutation(f.meetingApply, { ...args, command: { ...command, version: 2 } }), /UNSUPPORTED_COMMAND_VERSION/);
  await assert.rejects(() => owner.mutation(f.meetingApply, { ...args, command: { ...command, approvedAt: "2026-10-04" } }), /Validator error/);
});
await check("Late validation failure rolls back graph, mapping, receipt and projections", async () => {
  await f.native.run(async ctx => { for (let i = 0; i < 49; i++) await ctx.db.insert("users", { societyId: f.ids.societyA, role: "Viewer", status: "Active", displayName: `limit-${i}`, email: `limit-${i}@example.test`, createdAtISO: "2026-10-04" }); });
  const before = await f.native.run(async ctx => ({ meetings: (await ctx.db.query("meetings").collect()).length, receipts: (await ctx.db.query("offlineMeetingReceipts").collect()).length }));
  const nextKeys = Object.fromEntries(Object.keys(keys).map(key => [key, randomUUID()])) as typeof keys;
  await assert.rejects(() => owner.mutation(f.meetingApply, { societyId: f.ids.societyA, command: { ...command, keys: nextKeys, meetingUuid: nextKeys.meeting, operationId: randomUUID() } }), /PILOT_MEMBERSHIP_LIMIT/);
  await f.native.run(async ctx => {
    assert.equal((await ctx.db.query("meetings").collect()).length, before.meetings); assert.equal((await ctx.db.query("offlineMeetingReceipts").collect()).length, before.receipts);
    for (const user of await ctx.db.query("users").collect()) if (user.displayName?.startsWith("limit-")) await ctx.db.delete(user._id);
  });
});
await check("Viewer, foreign workspace, anonymous and foreign issuer cannot upload", async () => {
  await assert.rejects(() => f.actor("viewer-a").mutation(f.meetingApply, args), /Permission meetings:write/);
  await assert.rejects(() => f.actor("owner-b").mutation(f.meetingApply, args), /membership not found/);
  await assert.rejects(() => f.native.mutation(f.meetingApply, args), /membership not found/);
  await assert.rejects(() => f.actor("owner-a", "https://foreign.clerk.accounts.dev").mutation(f.meetingApply, args), /membership not found/);
  await assert.rejects(() => f.actor("owner-b").query(f.meetingDownloads, { societyId: f.ids.societyA }), /membership not found/);
});
await check("Adopted minutes require an online action", async () => {
  const minutesId = mappings.find(row => row.table === "minutes")!.nativeId;
  await f.native.run(ctx => ctx.db.patch(minutesId as any, { approvedAt: "2026-10-04" }));
  await assert.rejects(() => owner.mutation(f.meetingApply, { societyId: f.ids.societyA, command: { version: 1, operationId: randomUUID(), meetingUuid: keys.meeting, baseRevision: 2, kind: "edit-minutes", discussion: "Overwrite adopted minutes" } }), /ONLINE_ACTION_REQUIRED/);
  await f.native.run(ctx => ctx.db.patch(minutesId as any, { approvedAt: undefined }));
});
await check("Current role revocation blocks receipt replay and file uploads", async () => {
  await f.native.run(ctx => ctx.db.patch(f.ids.users["owner-a"] as any, { role: "Member" }));
  await assert.rejects(() => owner.mutation(f.meetingApply, args), /Permission meetings:write/);
  const storageId = await f.native.run(ctx => ctx.storage.store(new Blob([bytes])));
  await assert.rejects(() => owner.mutation(f.commitFile, { societyId: f.ids.societyA, meetingUuid: keys.meeting, storageId }), /Permission meetings:write/);
  await f.native.mutation(f.rebuild, { societyId: f.ids.societyA }); assert.equal((await parity("owner-a"))[0].files.length, 0);
});
await check("Disabled membership removes all projected rows", async () => {
  await f.native.run(ctx => ctx.db.patch(f.ids.users["owner-a"] as any, { role: "Owner", status: "Disabled" }));
  await f.native.mutation(f.rebuild, { societyId: f.ids.societyA });
  await assert.rejects(() => owner.query(f.meetingDownloads, { societyId: f.ids.societyA }), /disabled/);
  await f.native.run(async ctx => { assert.equal((await ctx.db.query("offlineMeetingDownloads").collect()).filter(row => row.actor_key.endsWith("|owner-a")).length, 0); });
});
await check("Disabled external identity removes projections and denies command", async () => {
  await f.native.run(async ctx => {
    const externalIdentityId = await ctx.db.insert("externalIdentities", { issuer: fixtureIssuer, subject: "owner-a", status: "Disabled", createdAtISO: "2026-10-04" });
    await ctx.db.patch(f.ids.users["owner-a"] as any, { role: "Owner", status: "Active", externalIdentityId });
  });
  await f.native.mutation(f.rebuild, { societyId: f.ids.societyA }); await assert.rejects(() => owner.mutation(f.meetingApply, args), /External identity is disabled/);
  await f.native.run(async ctx => { assert.equal((await ctx.db.query("offlineMeetingDownloads").collect()).filter(row => row.actor_key.endsWith("|owner-a")).length, 0); });
});
console.log(`${checks} meeting sandbox checks passed; live replication not exercised.`);
