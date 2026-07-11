// Conformance for the motionBacklog carry-forward / convert-by-index read flip
// (docs/motions-migration-finish-scope.md, write-side). Proves
// createFromMinutesMotionPortable and carryForwardToMeetingPortable index into
// the RESOLVED motions (resolveMinutesMotions: frozen snapshots for approved,
// ordered motionIds -> table rows for drafts) rather than the raw embedded
// minutes.motions[] — so the positional index matches the list the frontend
// indexed and the read survives the embedded array being dropped in Phase 4.
// Runs on a MemoryDb; no live backend.

import assert from "node:assert/strict";
import {
  MemoryDb,
  PortableRuntime,
  definePortableQuery,
  definePortableMutation,
  makeCapabilities,
} from "../shared/portable/index";
import {
  createFromMinutesMotionPortable,
  carryForwardToMeetingPortable,
} from "../shared/functions/motionBacklog";

const db = new MemoryDb({ seed: {} });
const caps = makeCapabilities({});
const rt = () => new PortableRuntime({ db, capabilities: caps });
const query = (name: string, handler: any) => rt().register(definePortableQuery({ name, handler })).runQuery(name, {});
const mutate = (name: string, handler: any) => rt().register(definePortableMutation({ name, handler })).runMutation(name, {});

// --- Scenario A: APPROVED minutes -------------------------------------------
// The resolver returns the frozen motionSnapshots[] (immutable legal record).
// The raw embedded motions[] is deliberately different so a stale index basis
// (reading motions[i]) would pick the wrong motion.
const approved: any = await mutate("setupApproved", async (ctx: any) => {
  const societyId = await ctx.db.insert("societies", { name: "Carryforward Co" });
  const sourceMeetingId = await ctx.db.insert("meetings", { societyId, title: "AGM 2025", status: "Complete" });
  const minutesId = await ctx.db.insert("minutes", {
    societyId,
    meetingId: sourceMeetingId,
    status: "Approved",
    // Raw embedded array — must NOT be what the index reads.
    motions: [
      { name: "RAW A", text: "RAW embedded motion at index 0", outcome: "Pending" },
      { name: "RAW B", text: "RAW embedded motion at index 1", outcome: "Pending" },
    ],
    // Frozen snapshots — resolveMinutesMotions returns these for approved minutes.
    motionSnapshots: [
      { name: "SNAP A", text: "Snapshot motion at index 0", outcome: "Carried" },
      { name: "SNAP B", text: "Snapshot motion at index 1", outcome: "Defeated" },
    ],
  });
  return { societyId, sourceMeetingId, minutesId };
});

// convert-by-index: createFromMinutesMotion at index 1 must read snapshot B.
const converted: any = await mutate("convert", (ctx: any) =>
  createFromMinutesMotionPortable(ctx, { minutesId: approved.minutesId, motionIndex: 1 }));
const convertedRow: any = await query("convertedRow", (ctx: any) => ctx.db.get(converted.backlogId));
assert.equal(
  convertedRow.text,
  "Snapshot motion at index 1",
  "createFromMinutesMotion indexes the resolved snapshot, not the raw embedded array",
);
assert.notEqual(convertedRow.text, "RAW embedded motion at index 1", "did not read the raw embedded array");
console.log("✓ approved: createFromMinutesMotion converts the resolved snapshot at the given index");

// --- Scenario B: DRAFT minutes ----------------------------------------------
// The resolver walks the ordered motionIds -> first-class rows. We scramble the
// raw embedded motions[] order (reverse it) while leaving motionIds intact, so
// raw[0] != resolved[0]. carry-forward must follow motionIds, not the raw array.
const draft: any = await mutate("setupDraft", async (ctx: any) => {
  const societyId = await ctx.db.insert("societies", { name: "Draft Co" });
  const sourceMeetingId = await ctx.db.insert("meetings", { societyId, title: "Board Q1", status: "Complete" });
  const targetMeetingId = await ctx.db.insert("meetings", { societyId, title: "Board Q2", status: "Scheduled" });
  const minutesId = await ctx.db.insert("minutes", { societyId, meetingId: sourceMeetingId, status: "Draft", motions: [] });
  // Two first-class rows in order, as the dual-write would have created them.
  const rowA = await ctx.db.insert("motions", {
    societyId, minutesId, primaryMeetingId: sourceMeetingId,
    title: "First", text: "First motion FIRST", status: "Voted", outcome: "Carried", source: "minutes",
  });
  const rowB = await ctx.db.insert("motions", {
    societyId, minutesId, primaryMeetingId: sourceMeetingId,
    title: "Second", text: "Second motion SECOND", status: "Deferred", source: "minutes",
  });
  // motionIds keeps the true order [A, B]; the embedded array is scrambled to [B, A].
  await ctx.db.patch(minutesId, {
    motionIds: [rowA, rowB],
    motions: [
      { name: "Second", text: "Second motion SECOND", outcome: "Deferred", motionId: rowB },
      { name: "First", text: "First motion FIRST", outcome: "Carried", motionId: rowA },
    ],
  });
  return { societyId, sourceMeetingId, targetMeetingId, minutesId };
});

// Sanity: the raw embedded array's index 0 is the OTHER motion — so a regression
// to reading motions[0] would carry "Second motion SECOND".
const rawIndex0: any = await query("rawIndex0", async (ctx: any) => {
  const m: any = await ctx.db.get(draft.minutesId);
  return m.motions[0].text;
});
assert.equal(rawIndex0, "Second motion SECOND", "raw embedded[0] is the scrambled motion (guards the assertion below)");

// carry-forward index 0 must resolve motionIds[0] -> rowA -> "First motion FIRST".
const carried: any = await mutate("carry", (ctx: any) =>
  carryForwardToMeetingPortable(ctx, {
    meetingId: draft.targetMeetingId,
    sourceMinutesId: draft.minutesId,
    motionIndexes: [0],
  }));
assert.equal(carried.created, 1, "carry-forward created one motion");
const agendaItem: any = await query("agendaItem", async (ctx: any) => {
  const items = await ctx.db.query("agendaItems").withIndex("by_agenda", (q: any) => q.eq("agendaId", carried.agendaId)).collect();
  return items.find((it: any) => it.type === "motion");
});
assert.ok(agendaItem, "carry-forward linked an agenda item onto the target agenda");
assert.equal(
  agendaItem.motionText,
  "First motion FIRST",
  "carry-forward indexes the ordered motionIds->rows, not the scrambled raw embedded array",
);
console.log("✓ draft: carry-forward reads the ordered motionIds->rows, not the raw embedded array");

console.log("\nmotions carry-forward checks passed.");
