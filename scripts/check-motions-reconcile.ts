// Write-side conformance for the reconcile-by-identity dual-write
// (docs/motions-migration-finish-scope.md). Proves syncMotionsForMinutes keeps
// motion-row ids STABLE across editor saves (edit in place, insert new, delete
// removed) and is idempotent - the prerequisite for the table being a real
// source of truth. Runs on a MemoryDb; no live backend.

import assert from "node:assert/strict";
import {
  MemoryDb,
  PortableRuntime,
  definePortableQuery,
  definePortableMutation,
  makeCapabilities,
} from "../shared/portable/index";
import { runPortable } from "../shared/functions/seed";
import { syncMotionsForMinutes } from "../shared/functions/minutes";
import { syncForMeetingPortable as agendaSyncForMeeting } from "../shared/functions/agendas";

const db = new MemoryDb({ seed: {} });
const caps = makeCapabilities({});
const rt = () => new PortableRuntime({ db, capabilities: caps });
const query = (name: string, handler: any) => rt().register(definePortableQuery({ name, handler })).runQuery(name, {});
const mutate = (name: string, handler: any) => rt().register(definePortableMutation({ name, handler })).runMutation(name, {});

await mutate("seed", (ctx: any) => runPortable(ctx));

// A seeded minutes with >= 2 motions. After seed, its embedded motions must
// already carry a back-linked motionId (the reconcile write's back-link).
const pick: any = await query("pick", async (ctx: any) => {
  const all = await ctx.db.query("minutes").collect();
  const m = all.find((x: any) => (x.motions ?? []).length >= 2);
  return m ? { minutesId: m._id, societyId: m.societyId, meetingId: m.meetingId, motions: m.motions } : null;
});
assert.ok(pick, "found a seeded minutes with >= 2 motions");
assert.ok(pick.motions.every((mm: any) => mm.motionId), "seed back-linked motionId into every minutes.motions entry");
const idsBefore: string[] = pick.motions.map((mm: any) => String(mm.motionId));

const rowsBefore: any = await query("rowsBefore", async (ctx: any) => {
  const rows = await ctx.db.query("motions").withIndex("by_minutes", (q: any) => q.eq("minutesId", pick.minutesId)).collect();
  return rows.map((r: any) => ({ id: String(r._id), outcome: r.outcome }));
});
assert.equal(rowsBefore.length, pick.motions.length, "one row per motion before edit");

// Simulate an editor save: flip motion[0]'s outcome (edit in place), remove the
// last motion, append a brand-new motion (no motionId).
const removedId = String(pick.motions[pick.motions.length - 1].motionId);
const nextMotions = [
  ...pick.motions
    .slice(0, pick.motions.length - 1)
    .map((mm: any, i: number) => (i === 0 ? { ...mm, outcome: mm.outcome === "Carried" ? "Defeated" : "Carried" } : mm)),
  { text: "Newly added motion to reconcile.", outcome: "Carried" },
];

await mutate("save", async (ctx: any) => {
  await syncMotionsForMinutes(ctx, { societyId: pick.societyId, minutesId: pick.minutesId, meetingId: pick.meetingId, motions: nextMotions });
});

const after: any = await query("after", async (ctx: any) => {
  const minutes: any = await ctx.db.get(pick.minutesId);
  const rows = await ctx.db.query("motions").withIndex("by_minutes", (q: any) => q.eq("minutesId", pick.minutesId)).collect();
  return {
    motions: minutes.motions,
    motionIds: (minutes.motionIds ?? []).map(String),
    rows: rows.map((r: any) => ({ id: String(r._id), text: r.text, outcome: r.outcome })),
  };
});

// 1) Edited motion[0] kept its row id; the row was updated in place.
assert.equal(String(after.motions[0].motionId), idsBefore[0], "edited motion[0] kept its stable row id");
const row0Before = rowsBefore.find((r: any) => r.id === idsBefore[0]);
const row0After = after.rows.find((r: any) => r.id === idsBefore[0]);
assert.ok(row0After, "motion[0] row still exists under the same id");
assert.notEqual(row0After.outcome, row0Before.outcome, "motion[0] outcome was updated in place");

// 2) Untouched middle motions kept their ids.
for (let i = 1; i < pick.motions.length - 1; i += 1) {
  assert.equal(String(after.motions[i].motionId), idsBefore[i], `untouched motion[${i}] kept its stable row id`);
}

// 3) The removed motion's row is gone.
assert.ok(!after.rows.some((r: any) => r.id === removedId), "removed motion's row was deleted");

// 4) The new motion got a fresh id, back-linked, with its row inserted.
const newMotion = after.motions[after.motions.length - 1];
assert.ok(newMotion.motionId && !idsBefore.includes(String(newMotion.motionId)), "new motion got a fresh back-linked id");
assert.ok(
  after.rows.some((r: any) => r.id === String(newMotion.motionId) && String(r.text).includes("Newly added")),
  "new motion row was inserted",
);

// 5) motionIds order matches the embedded order; one row per motion (no orphans).
assert.deepEqual(after.motionIds, after.motions.map((mm: any) => String(mm.motionId)), "motionIds order matches embedded order");
assert.equal(after.rows.length, after.motions.length, "one row per motion after reconcile (no orphans/dupes)");

// 6) Idempotence: re-saving the same (back-linked) array churns no ids or rows.
const idsAfterFirst: string[] = after.motions.map((mm: any) => String(mm.motionId));
await mutate("save2", async (ctx: any) => {
  await syncMotionsForMinutes(ctx, { societyId: pick.societyId, minutesId: pick.minutesId, meetingId: pick.meetingId, motions: after.motions });
});
const after2: any = await query("after2", async (ctx: any) => {
  const minutes: any = await ctx.db.get(pick.minutesId);
  const rows = await ctx.db.query("motions").withIndex("by_minutes", (q: any) => q.eq("minutesId", pick.minutesId)).collect();
  return { ids: minutes.motions.map((mm: any) => String(mm.motionId)), rowCount: rows.length };
});
assert.deepEqual(after2.ids, idsAfterFirst, "re-saving the same array keeps every row id stable (idempotent)");
assert.equal(after2.rowCount, idsAfterFirst.length, "no row churn on an idempotent save");

console.log(`✓ reconcile-by-identity: stable ids across edit/add/remove + idempotent re-save (${idsAfterFirst.length} motions)`);

// The agenda-sync path (agendas.ts) now routes through the same shared reconcile
// dual-write, so re-syncing an agenda must keep motion-row ids stable (a
// delete-and-reinsert copy would regenerate them all).
const meetingPick: any = await query("meetingPick", async (ctx: any) => {
  const minutes = (await ctx.db.query("minutes").collect()).find((m: any) => (m.motions ?? []).length >= 1);
  return minutes ? { societyId: minutes.societyId, meetingId: minutes.meetingId, minutesId: minutes._id } : null;
});
assert.ok(meetingPick, "found a minutes + meeting for the agenda-sync test");

const agendaItems = [{ title: "Reconcile probe motion", type: "motion", motionText: "BE IT RESOLVED THAT reconcile is stable." }];
const idsForMinutes = (name: string) =>
  query(name, async (ctx: any) => {
    const rows = await ctx.db.query("motions").withIndex("by_minutes", (q: any) => q.eq("minutesId", meetingPick.minutesId)).collect();
    return rows.map((r: any) => String(r._id)).sort();
  });

await mutate("agendaSync1", async (ctx: any) => {
  await agendaSyncForMeeting(ctx, { societyId: meetingPick.societyId, meetingId: meetingPick.meetingId, items: agendaItems });
});
const idsAfterSync1: any = await idsForMinutes("afterSync1");
await mutate("agendaSync2", async (ctx: any) => {
  await agendaSyncForMeeting(ctx, { societyId: meetingPick.societyId, meetingId: meetingPick.meetingId, items: agendaItems });
});
const idsAfterSync2: any = await idsForMinutes("afterSync2");
assert.ok(idsAfterSync1.length > 0, "agenda sync produced motion rows");
assert.deepEqual(idsAfterSync2, idsAfterSync1, "agenda re-sync reconciles in place (motion-row ids stable)");
console.log(`✓ agenda-sync path keeps motion-row ids stable across re-sync (${idsAfterSync1.length} rows)`);

console.log("\nmotions reconcile checks passed.");
