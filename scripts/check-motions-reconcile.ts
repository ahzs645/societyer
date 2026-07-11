// Write-side conformance for the reconcile-by-identity materialization, POST-4C
// (docs/motions-migration-finish-scope.md). Since Phase 4C the embedded
// minutes.motions[] is NO LONGER written — the motions table + minutes.motionIds
// are the record. The editor reads RESOLVED motions (resolveMinutesMotions, each
// carrying its table motionId) and submits those; syncMotionsForMinutes keeps
// motion-row ids STABLE across saves (edit in place, insert new, delete removed)
// and is idempotent. Runs on a MemoryDb; no live backend.

import assert from "node:assert/strict";
import {
  MemoryDb,
  PortableRuntime,
  definePortableQuery,
  definePortableMutation,
  makeCapabilities,
} from "../shared/portable/index";
import { runPortable } from "../shared/functions/seed";
import { syncMotionsForMinutes, resolveMinutesMotions } from "../shared/functions/minutes";
import { syncForMeetingPortable as agendaSyncForMeeting } from "../shared/functions/agendas";

const db = new MemoryDb({ seed: {} });
const caps = makeCapabilities({});
const rt = () => new PortableRuntime({ db, capabilities: caps });
const query = (name: string, handler: any) => rt().register(definePortableQuery({ name, handler })).runQuery(name, {});
const mutate = (name: string, handler: any) => rt().register(definePortableMutation({ name, handler })).runMutation(name, {});

await mutate("seed", (ctx: any) => runPortable(ctx));

// A seeded DRAFT minutes with >= 2 motions resolved from the table (motionIds
// present, not an approved/snapshotted record). The resolved motions carry a
// motionId; minutes.motions[] is no longer maintained (4C).
const pick: any = await query("pick", async (ctx: any) => {
  const all = await ctx.db.query("minutes").collect();
  for (const m of all) {
    if ((m.motionIds ?? []).length >= 2 && !(m.motionSnapshots?.length)) {
      const resolved = await resolveMinutesMotions(ctx, m);
      return {
        minutesId: m._id, societyId: m.societyId, meetingId: m.meetingId,
        motions: resolved, rawBefore: m.motions ?? null,
      };
    }
  }
  return null;
});
assert.ok(pick, "found a seeded draft minutes with >= 2 table-resolved motions");
assert.ok(pick.motions.every((mm: any) => mm.motionId), "resolved motions carry a motionId from the table");
const idsBefore: string[] = pick.motions.map((mm: any) => String(mm.motionId));

const rowsBefore: any = await query("rowsBefore", async (ctx: any) => {
  const rows = await ctx.db.query("motions").withIndex("by_minutes", (q: any) => q.eq("minutesId", pick.minutesId)).collect();
  return rows.map((r: any) => ({ id: String(r._id), outcome: r.outcome }));
});
assert.equal(rowsBefore.length, pick.motions.length, "one row per motion before edit");

// Simulate an editor save on the RESOLVED motions: flip motion[0]'s outcome,
// remove the last motion, append a brand-new motion (no motionId).
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
  const resolved = await resolveMinutesMotions(ctx, minutes);
  const rows = await ctx.db.query("motions").withIndex("by_minutes", (q: any) => q.eq("minutesId", pick.minutesId)).collect();
  return {
    motions: resolved,
    motionIds: (minutes.motionIds ?? []).map(String),
    rawMotions: minutes.motions ?? null,
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

// 4) The new motion got a fresh id, materialized into the table, resolvable.
const newMotion = after.motions[after.motions.length - 1];
assert.ok(newMotion.motionId && !idsBefore.includes(String(newMotion.motionId)), "new motion got a fresh row id");
assert.ok(
  after.rows.some((r: any) => r.id === String(newMotion.motionId) && String(r.text).includes("Newly added")),
  "new motion row was inserted",
);

// 5) motionIds order matches the resolved order; one row per motion (no orphans).
assert.deepEqual(after.motionIds, after.motions.map((mm: any) => String(mm.motionId)), "motionIds order matches resolved order");
assert.equal(after.rows.length, after.motions.length, "one row per motion after reconcile (no orphans/dupes)");

// 6) Phase 4C: the sync did NOT write minutes.motions[] — the raw array is left
// exactly as it was (reads come from motionIds, not the embedded array).
assert.deepEqual(after.rawMotions, pick.rawBefore, "minutes.motions[] is not rewritten by the sync (Phase 4C)");

// 7) Idempotence: re-saving the same (resolved) array churns no ids or rows.
const idsAfterFirst: string[] = after.motions.map((mm: any) => String(mm.motionId));
await mutate("save2", async (ctx: any) => {
  await syncMotionsForMinutes(ctx, { societyId: pick.societyId, minutesId: pick.minutesId, meetingId: pick.meetingId, motions: after.motions });
});
const after2: any = await query("after2", async (ctx: any) => {
  const minutes: any = await ctx.db.get(pick.minutesId);
  const resolved = await resolveMinutesMotions(ctx, minutes);
  const rows = await ctx.db.query("motions").withIndex("by_minutes", (q: any) => q.eq("minutesId", pick.minutesId)).collect();
  return { ids: resolved.map((mm: any) => String(mm.motionId)), rowCount: rows.length };
});
assert.deepEqual(after2.ids, idsAfterFirst, "re-saving the same array keeps every row id stable (idempotent)");
assert.equal(after2.rowCount, idsAfterFirst.length, "no row churn on an idempotent save");

console.log(`✓ reconcile-by-identity (4C): stable ids across edit/add/remove + idempotent, resolved from the table (${idsAfterFirst.length} motions)`);

// The agenda-sync path (agendas.ts) also sources existing motions from the
// resolver now, so re-syncing an agenda must keep motion-row ids stable (reading
// the retired minutes.motions[] would have lost the motionId thread and churned).
const meetingPick: any = await query("meetingPick", async (ctx: any) => {
  const minutes = (await ctx.db.query("minutes").collect()).find(
    (m: any) => (m.motionIds ?? []).length >= 1 && !(m.motionSnapshots?.length),
  );
  return minutes ? { societyId: minutes.societyId, meetingId: minutes.meetingId, minutesId: minutes._id } : null;
});
assert.ok(meetingPick, "found a draft minutes + meeting for the agenda-sync test");

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
