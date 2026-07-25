// Conformance for seedToMinutes under Phase 4C/4D (docs/motions-migration-finish-scope.md).
// "Seed backlog motions into minutes" used to copy agenda-item text into the
// embedded minutes.motions[]. Since 4C that array is no longer read, so the fix
// LINKS the existing backlog motion ROWS into the minutes (stamp minutesId +
// append to minutes.motionIds) — the linked row IS the minutes motion, so the
// seeded motions appear via the resolver, no copies, no master-list duplication.
// Runs on a MemoryDb; no live backend.

import assert from "node:assert/strict";
import {
  MemoryDb,
  PortableRuntime,
  definePortableQuery,
  definePortableMutation,
  makeCapabilities,
} from "../shared/portable/index";
import { syncMotionsForMinutes, resolveMinutesMotions } from "../shared/functions/minutes";
import { seedToMinutesPortable } from "../shared/functions/motionBacklog";

const db = new MemoryDb({ seed: {} });
const caps = makeCapabilities({});
const rt = () => new PortableRuntime({ db, capabilities: caps, principalProvider: () => ({ kind: "anonymous", runtime: "test", assurance: "none" }) });
const query = (name: string, handler: any) => rt().register(definePortableQuery({ name, handler })).runQuery(name, {});
const mutate = (name: string, handler: any) => rt().register(definePortableMutation({ name, handler })).runMutation(name, {});

const setup: any = await mutate("setup", async (ctx: any) => {
  const societyId = await ctx.db.insert("societies", { name: "Seed Co" });
  const meetingId = await ctx.db.insert("meetings", { societyId, title: "Board Q1", status: "Scheduled" });
  const minutesId = await ctx.db.insert("minutes", { societyId, meetingId, status: "Draft" });
  // One existing minutes motion, materialized into the table (motionIds set).
  await syncMotionsForMinutes(ctx, {
    societyId, minutesId, meetingId,
    motions: [{ name: "Existing", text: "Existing minutes motion", outcome: "Pending" }],
  });
  // Two backlog motion ROWS + an agenda that links them.
  const iso = "2026-02-01T00:00:00.000Z";
  const backlogA = await ctx.db.insert("motions", { societyId, title: "Backlog A", text: "Backlog motion A", status: "Backlog", source: "manual", createdAtISO: iso, updatedAtISO: iso });
  const backlogB = await ctx.db.insert("motions", { societyId, title: "Backlog B", text: "Backlog motion B", status: "Backlog", source: "manual", createdAtISO: iso, updatedAtISO: iso });
  const agendaId = await ctx.db.insert("agendas", { societyId, meetingId, title: "Agenda", status: "Draft", createdAtISO: iso, updatedAtISO: iso });
  await ctx.db.insert("agendaItems", { societyId, agendaId, order: 0, type: "motion", title: "Backlog A", motionId: backlogA, motionText: "Backlog motion A", createdAtISO: iso });
  await ctx.db.insert("agendaItems", { societyId, agendaId, order: 1, type: "motion", title: "Backlog B", motionId: backlogB, motionText: "Backlog motion B", createdAtISO: iso });
  return { societyId, meetingId, minutesId, backlogA: String(backlogA), backlogB: String(backlogB) };
});

const seedResult: any = await mutate("seed", (ctx: any) => seedToMinutesPortable(ctx, { meetingId: setup.meetingId }));
assert.equal(seedResult.inserted, 2, "linked 2 backlog motions into the minutes");

const afterSeed: any = await query("afterSeed", async (ctx: any) => {
  const m: any = await ctx.db.get(setup.minutesId);
  const resolved = await resolveMinutesMotions(ctx, m);
  const allRows = await ctx.db.query("motions").withIndex("by_society", (q: any) => q.eq("societyId", setup.societyId)).collect();
  const backlogA: any = await ctx.db.get(setup.backlogA);
  return {
    resolvedTexts: resolved.map((x: any) => x.text).sort(),
    resolvedIds: resolved.map((x: any) => String(x.motionId)),
    motionIds: (m.motionIds ?? []).map(String),
    rawMotions: m.motions ?? null,
    rowCount: allRows.length,
    backlogAStatus: backlogA.status,
    backlogAMinutesId: String(backlogA.minutesId ?? ""),
  };
});

// Seeded backlog motions appear in the minutes, alongside the existing one.
assert.deepEqual(
  afterSeed.resolvedTexts,
  ["Backlog motion A", "Backlog motion B", "Existing minutes motion"],
  "seeded backlog motions appear in the minutes via the resolver",
);
// They are the SAME rows (direct link), not copies.
assert.ok(
  afterSeed.resolvedIds.includes(setup.backlogA) && afterSeed.resolvedIds.includes(setup.backlogB),
  "the minutes links the existing backlog rows (no copies)",
);
// No duplicate rows: 1 existing minutes motion + 2 backlog rows = 3.
assert.equal(afterSeed.rowCount, 3, "no duplicate rows created — backlog rows linked, not copied");
assert.equal(afterSeed.motionIds.length, 3, "motionIds holds all three linked motions in order");
// minutes.motions[] is not written (Phase 4C).
assert.equal(afterSeed.rawMotions, null, "seedToMinutes does not write the embedded minutes.motions[]");
// The linked backlog row is stamped.
assert.equal(afterSeed.backlogAStatus, "Draft", "linked backlog motion marked Draft");
assert.equal(afterSeed.backlogAMinutesId, String(setup.minutesId), "linked backlog motion stamped with minutesId");
console.log("✓ seedToMinutes links backlog motion rows into the minutes (no copies, no embedded write)");

// Idempotent: re-seeding links nothing new and creates no rows.
await mutate("seed2", (ctx: any) => seedToMinutesPortable(ctx, { meetingId: setup.meetingId }));
const afterReseed: any = await query("afterReseed", async (ctx: any) => {
  const m: any = await ctx.db.get(setup.minutesId);
  const allRows = await ctx.db.query("motions").withIndex("by_society", (q: any) => q.eq("societyId", setup.societyId)).collect();
  return { motionIds: (m.motionIds ?? []).map(String).length, rowCount: allRows.length };
});
assert.equal(afterReseed.rowCount, 3, "re-seed creates no new rows (idempotent)");
assert.equal(afterReseed.motionIds, 3, "re-seed does not double-link (motionIds stable)");
console.log("✓ re-seeding is idempotent (dedup by id + text)");

console.log("\nseedToMinutes checks passed.");
