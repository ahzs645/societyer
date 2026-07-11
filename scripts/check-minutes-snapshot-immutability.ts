// Snapshot-immutability conformance for Phase 4C (docs/motions-migration-finish-scope.md).
// Approving a minutes freezes motionSnapshots[] from the resolved motions; after
// that, editing the motions must change the underlying motions TABLE but must NOT
// change what the approved minutes DISPLAY (the frozen legal record). Since 4C the
// snapshot is frozen from resolveMinutesMotions (the table), not the retired
// embedded minutes.motions[]. Runs on a MemoryDb; no live backend.

import assert from "node:assert/strict";
import {
  MemoryDb,
  PortableRuntime,
  definePortableQuery,
  definePortableMutation,
  makeCapabilities,
} from "../shared/portable/index";
import { syncMotionsForMinutes, resolveMinutesMotions, updatePortable } from "../shared/functions/minutes";

const db = new MemoryDb({ seed: {} });
const caps = makeCapabilities({});
const rt = () => new PortableRuntime({ db, capabilities: caps });
const query = (name: string, handler: any) => rt().register(definePortableQuery({ name, handler })).runQuery(name, {});
const mutate = (name: string, handler: any) => rt().register(definePortableMutation({ name, handler })).runMutation(name, {});

// A draft minutes materialized into the table (motionIds set, nothing stored on
// minutes.motions beyond the initial seed value we never touch).
const setup: any = await mutate("setup", async (ctx: any) => {
  const societyId = await ctx.db.insert("societies", { name: "Snapshot Co" });
  const meetingId = await ctx.db.insert("meetings", { societyId, title: "Board Q1", status: "Complete", heldAt: "2026-03-01" });
  const minutesId = await ctx.db.insert("minutes", { societyId, meetingId, status: "Draft", attendees: [], heldAt: "2026-03-01" });
  await syncMotionsForMinutes(ctx, {
    societyId, minutesId, meetingId,
    motions: [
      { name: "M1", text: "First motion", outcome: "Carried" },
      { name: "M2", text: "Second motion", outcome: "Pending" },
    ],
  });
  return { societyId, meetingId, minutesId };
});

// Resolved DRAFT motions (carry motionId) — what the editor would hold.
const draftMotions: any[] = await query("draft", (ctx: any) => ctx.db.get(setup.minutesId).then((m: any) => resolveMinutesMotions(ctx, m)));
assert.equal(draftMotions.length, 2, "draft resolves 2 motions from the table");
assert.ok(draftMotions.every((m) => m.motionId), "resolved draft motions carry motionId");

// Approve with no motion changes — freezes motionSnapshots from the resolver.
await mutate("approve", (ctx: any) => updatePortable(ctx, { id: setup.minutesId, patch: { approvedAt: "2026-03-02T00:00:00.000Z" } }));

const approved: any = await query("approved", async (ctx: any) => {
  const m: any = await ctx.db.get(setup.minutesId);
  return { snapshots: m.motionSnapshots, resolved: await resolveMinutesMotions(ctx, m), rawMotions: m.motions ?? null };
});
assert.equal(approved.snapshots?.length, 2, "approval froze a 2-motion snapshot");
assert.equal(approved.resolved.length, 2, "approved minutes resolve to the frozen snapshot");
assert.equal(approved.rawMotions, null, "no embedded minutes.motions[] was written (Phase 4C)");
const frozenTexts = approved.resolved.map((m: any) => m.text).sort();
assert.deepEqual(frozenTexts, ["First motion", "Second motion"], "snapshot captured the approved motions");

// Edit the motions AFTER approval: change M1, drop M2, add M3. This must hit the
// table rows but leave the approved display frozen.
await mutate("editAfterApproval", (ctx: any) => updatePortable(ctx, {
  id: setup.minutesId,
  patch: {
    motions: [
      { ...draftMotions[0], text: "First motion EDITED after approval", outcome: "Defeated" },
      { name: "M3", text: "Third motion added after approval", outcome: "Carried" },
    ],
  },
}));

const afterEdit: any = await query("afterEdit", async (ctx: any) => {
  const m: any = await ctx.db.get(setup.minutesId);
  const rows = await ctx.db.query("motions").withIndex("by_minutes", (q: any) => q.eq("minutesId", setup.minutesId)).collect();
  return {
    snapshots: m.motionSnapshots,
    resolved: await resolveMinutesMotions(ctx, m),
    rowTexts: rows.map((r: any) => String(r.text)).sort(),
  };
});

// The approved DISPLAY is unchanged — still the frozen snapshot.
assert.deepEqual(afterEdit.resolved.map((m: any) => m.text).sort(), frozenTexts, "approved minutes display is unchanged after editing motions");
assert.deepEqual(afterEdit.snapshots, approved.snapshots, "the frozen motionSnapshots record is immutable");

// But the underlying table DID change — the edit took effect at the row level.
assert.ok(afterEdit.rowTexts.some((t: string) => t.includes("EDITED")), "the edit reached the motions table rows");
assert.ok(afterEdit.rowTexts.some((t: string) => t.includes("Third motion added")), "the added motion reached the table");
assert.ok(!afterEdit.rowTexts.some((t: string) => t === "Second motion"), "the dropped motion was removed from the table");

console.log("✓ approval freezes motionSnapshots from the table; post-approval edits change the rows, not the frozen record");

// Un-approve (the "Clear approval" button → patch { clearApproval: true }). This
// must drop the frozen snapshot so the minutes revert to an editable draft that
// resolves from the LIVE table — otherwise the stale approved set keeps showing.
await mutate("clearApproval", (ctx: any) => updatePortable(ctx, { id: setup.minutesId, patch: { clearApproval: true } }));

const unapproved: any = await query("unapproved", async (ctx: any) => {
  const m: any = await ctx.db.get(setup.minutesId);
  return { approvedAt: m.approvedAt ?? null, snapshots: m.motionSnapshots ?? null, resolved: await resolveMinutesMotions(ctx, m) };
});
assert.equal(unapproved.approvedAt, null, "clearApproval unset approvedAt");
assert.ok(!unapproved.snapshots || unapproved.snapshots.length === 0, "clearApproval dropped the frozen motionSnapshots");
// The display now reflects the post-approval table edits, NOT the frozen snapshot.
const liveTexts = unapproved.resolved.map((m: any) => String(m.text)).sort();
assert.ok(liveTexts.some((t: string) => t.includes("EDITED")), "un-approved minutes resolve the live (edited) table motions");
assert.ok(liveTexts.some((t: string) => t.includes("Third motion added")), "un-approved minutes show the motion added after approval");
assert.ok(!liveTexts.some((t: string) => t === "First motion"), "un-approved minutes no longer serve the stale frozen record");

// Re-approving must re-freeze from the CURRENT table state (the edited set), not
// resurrect the old snapshot — proving the guard was reset by the un-approve.
await mutate("reApprove", (ctx: any) => updatePortable(ctx, { id: setup.minutesId, patch: { approvedAt: "2026-03-05T00:00:00.000Z" } }));
const reApproved: any = await query("reApproved", async (ctx: any) => {
  const m: any = await ctx.db.get(setup.minutesId);
  return { snapshots: m.motionSnapshots, resolved: await resolveMinutesMotions(ctx, m) };
});
assert.deepEqual(reApproved.resolved.map((m: any) => String(m.text)).sort(), liveTexts, "re-approval re-froze the current (edited) motions");
assert.notDeepEqual(reApproved.snapshots?.map((m: any) => String(m.text)).sort(), frozenTexts, "re-approval did not resurrect the original stale snapshot");
console.log("✓ clearApproval drops the snapshot; un-approved minutes resolve the live table; re-approval re-freezes the current set");

console.log("\nminutes snapshot-immutability checks passed.");
