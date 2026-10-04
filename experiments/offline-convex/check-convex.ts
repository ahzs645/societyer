import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createFixture } from "./fixture";

const fixture = await createFixture();
const { ids, apply, list, actor, native } = fixture;
const owner = actor("owner-a");
const id = randomUUID();
const batch = { societyId: ids.societyA, batchId: randomUUID(), operations: [{ id, baseRevision: 0, title: "Incorporation preparation", content: "Proposed company name" }] };
let checks = 0;
async function check(name: string, fn: () => Promise<void>) { await fn(); checks++; console.log(`PASS ${name}`); }
await check("Owner draft upload with server-derived audit actor", async () => {
  await owner.mutation(apply, batch);
  const rows = await owner.query(list, { societyId: ids.societyA }) as any[];
  assert.equal(rows.length, 1); assert.equal(rows[0].revision, 1); assert.equal(rows[0].updatedByUserId, ids.users["owner-a"]);
});
await check("Lost acknowledgement retry is idempotent", async () => {
  assert.equal((await owner.mutation(apply, batch)).replay, true);
  const rows = await owner.query(list, { societyId: ids.societyA }) as any[]; assert.equal(rows.length, 1); assert.equal(rows[0].revision, 1);
});
await check("Changed replay payload rejected", async () => {
  await assert.rejects(() => owner.mutation(apply, { ...batch, operations: [{ ...batch.operations[0], title: "Different payload" }] }), /REPLAY_MISMATCH/);
});
await check("Stale offline edit rejected without overwriting server", async () => {
  await assert.rejects(() => owner.mutation(apply, { ...batch, batchId: randomUUID() }), /REVISION_CONFLICT/);
});
await check("Multi-operation batch rolls back on later conflict", async () => {
  const newId = randomUUID();
  await assert.rejects(() => owner.mutation(apply, { ...batch, batchId: randomUUID(), operations: [{ ...batch.operations[0], id: newId }, batch.operations[0]] }), /REVISION_CONFLICT/);
  const rows = await owner.query(list, { societyId: ids.societyA }) as any[]; assert.equal(rows.some(row => row.uuid === newId), false);
});
await check("Viewer upload denied and permitted draft read retained", async () => {
  await assert.rejects(() => actor("viewer-a").mutation(apply, batch), /Permission documents:write required/);
  assert.equal((await actor("viewer-a").query(list, { societyId: ids.societyA }) as any[]).length, 1);
});
await check("Foreign workspace read and upload denied", async () => {
  await assert.rejects(() => actor("owner-b").mutation(apply, batch), /membership not found/);
  await assert.rejects(() => actor("owner-b").query(list, { societyId: ids.societyA }), /membership not found/);
});
await check("Anonymous and same-subject foreign issuer denied", async () => {
  await assert.rejects(() => native.mutation(apply, batch), /membership not found/);
  await assert.rejects(() => actor("owner-a", "https://foreign.clerk.accounts.dev").mutation(apply, batch), /membership not found/);
});
await check("Role changed while offline blocks even an already accepted replay", async () => {
  await native.run(ctx => ctx.db.patch(ids.users["owner-a"] as any, { role: "Member" }));
  await assert.rejects(() => owner.mutation(apply, batch), /Permission documents:write required/);
});
await check("Disabled membership denied", async () => {
  await native.run(ctx => ctx.db.patch(ids.users["owner-a"] as any, { role: "Owner", status: "Disabled" }));
  await assert.rejects(() => owner.mutation(apply, batch), /disabled/);
});
console.log(`${checks} Convex sandbox checks passed; no live replication claimed.`);
