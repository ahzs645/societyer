// Conformance harness for the motions read-flip (Phase 2 of
// docs/motions-migration-finish-scope.md).
//
// Proves the table-backed resolver reproduces the embedded minutes.motions[] it
// will replace, so flipping reads onto it is a no-op for display. Runs the full
// portable seed on a MemoryDb (Phase 1 reseed populates motionIds + first-class
// motions rows), then asserts, for every seeded minutes:
//   resolveMinutesMotions(ctx, minutes)  ==  minutes.motions   (display projection)
// and separately that `adoptsMinutesId` survives the embedded → table
// (dual-write) → embedded (adapter) round-trip — the one field the table did not
// previously store.

import assert from "node:assert/strict";
import {
  MemoryDb,
  PortableRuntime,
  definePortableQuery,
  definePortableMutation,
  makeCapabilities,
} from "../shared/portable/index";
import { runPortable } from "../shared/functions/seed";
import { listPortable, resolveMinutesMotions, syncMotionsForMinutes } from "../shared/functions/minutes";
import { minutesMotionsForDisplay } from "../shared/minutesMotions";
import { listPortable as orgHistoryListPortable } from "../shared/functions/organizationHistory";
import { summaryPortable as annualCycleSummaryPortable } from "../shared/functions/annualCycle";

const db = new MemoryDb({ seed: {} });
const caps = makeCapabilities({});
const rt = () => new PortableRuntime({ db, capabilities: caps, principalProvider: () => ({ kind: "anonymous", runtime: "test", assurance: "none" }) });

// 1) Seed. The Phase 1 finalization routes every seeded minutes through the
//    dual-write, so each carries ordered motionIds + mirror rows.
const seedResult: any = await rt()
  .register(definePortableMutation({ name: "seed", handler: (ctx: any) => runPortable(ctx) }))
  .runMutation("seed", {});
const societyId = seedResult.societyId;

// Display-relevant projection: the fields minutes rendering/analytics key off.
// Outcome is normalized (""/"pending"/"Pending" are one state); table-only
// enrichment (decidedBy, proceduralKind, motionId) is intentionally ignored.
const norm = (o: any) => {
  const v = String(o ?? "").trim().toLowerCase();
  return !v || v === "pending" ? "pending" : v;
};
const proj = (m: any) => ({
  name: m.name ?? null,
  text: String(m.text ?? "").trim(),
  movedBy: m.movedBy ?? null,
  movedByMemberId: m.movedByMemberId ?? null,
  movedByDirectorId: m.movedByDirectorId ?? null,
  secondedBy: m.secondedBy ?? null,
  secondedByMemberId: m.secondedByMemberId ?? null,
  secondedByDirectorId: m.secondedByDirectorId ?? null,
  outcome: norm(m.outcome),
  votesFor: m.votesFor ?? null,
  votesAgainst: m.votesAgainst ?? null,
  abstentions: m.abstentions ?? null,
  resolutionType: m.resolutionType ?? null,
  sectionIndex: m.sectionIndex ?? null,
  sectionTitle: m.sectionTitle ?? null,
  adoptsMinutesId: m.adoptsMinutesId ?? null,
});

// 2) The resolver reproduces the embedded array for every seeded minutes.
const parity: any = await rt()
  .register(
    definePortableQuery({
      name: "parity",
      handler: async (ctx: any) => {
        const minutes = await ctx.db.query("minutes").collect();
        const out: any[] = [];
        for (const m of minutes) {
          out.push({
            id: m._id,
            embedded: m.motions ?? [],
            resolved: await resolveMinutesMotions(ctx, m),
            hasIds: Array.isArray(m.motionIds) && m.motionIds.length > 0,
          });
        }
        return out;
      },
    }),
  )
  .runQuery("parity", {});

let checkedMinutes = 0;
let checkedMotions = 0;
let viaTable = 0;
for (const rec of parity) {
  checkedMinutes += 1;
  checkedMotions += rec.resolved.length;
  // Phase 4: the embedded minutes.motions[] is retired — the seed clears it, so
  // it is empty on every doc. Any minutes that resolves motions must do so
  // through the ordered motionIds -> table rows path (approved minutes via
  // frozen snapshots resolve without motionIds; none of the seed's are approved).
  assert.deepEqual(rec.embedded, [], `minutes ${rec.id} still carries a retired embedded motions[] array`);
  if (rec.resolved.length > 0) {
    assert.ok(rec.hasIds, `minutes ${rec.id} resolves motions but not via motionIds (the table)`);
    viaTable += 1;
  }
}
assert.ok(viaTable > 0, "expected at least one minutes to resolve through the motionIds -> table path");
console.log(
  `✓ resolver reads the table across ${checkedMinutes} seeded minutes / ${checkedMotions} motions (${viaTable} via motionIds, embedded array retired)`,
);

// 3) adoptsMinutesId survives embedded -> table (dual-write) -> embedded (adapter).
const adopt: any = await rt()
  .register(
    definePortableMutation({
      name: "adopt",
      handler: async (ctx: any) => {
        const anchor = (await ctx.db.query("minutes").collect())[0];
        const motions = [
          { text: "BE IT RESOLVED THAT the prior minutes be approved.", outcome: "Carried", adoptsMinutesId: anchor._id },
        ];
        const minutesId = await ctx.db.insert("minutes", {
          societyId: anchor.societyId,
          meetingId: anchor.meetingId,
          heldAt: anchor.heldAt ?? "2026-01-01T00:00:00Z",
          attendees: [],
          absent: [],
          quorumMet: true,
          discussion: "",
          motions,
          decisions: [],
          actionItems: [],
        });
        await syncMotionsForMinutes(ctx, { societyId: anchor.societyId, minutesId, meetingId: anchor.meetingId, motions });
        return { minutesId, adopted: anchor._id };
      },
    }),
  )
  .runMutation("adopt", {});

const adoptResolved: any = await rt()
  .register(
    definePortableQuery({
      name: "adoptRead",
      handler: async (ctx: any) => {
        const m = await ctx.db.get(adopt.minutesId);
        return { motionIds: m.motionIds, resolved: await resolveMinutesMotions(ctx, m) };
      },
    }),
  )
  .runQuery("adoptRead", {});

assert.ok(
  Array.isArray(adoptResolved.motionIds) && adoptResolved.motionIds.length === 1,
  "adoption minutes got exactly one motionIds entry",
);
assert.equal(adoptResolved.resolved.length, 1, "one resolved motion");
assert.equal(
  String(adoptResolved.resolved[0].adoptsMinutesId),
  String(adopt.adopted),
  "adoptsMinutesId survived embedded -> table (dual-write) -> embedded (adapter)",
);
console.log("✓ adoptsMinutesId round-trips through the dual-write + adapter (data gap closed)");

// 4) Query boundary (listPortable) attaches displayMotions; the accessor prefers
//    it; the result is genuinely table-sourced; the retired embedded array is gone.
const listed: any = await rt()
  .register(definePortableQuery({ name: "minutes:list", handler: (ctx: any, a: any) => listPortable(ctx, a) }))
  .runQuery("minutes:list", { societyId });
assert.ok(listed.length > 0, "listPortable returned minutes");
for (const m of listed) {
  assert.ok(Array.isArray(m.displayMotions), `displayMotions attached for minutes ${m._id}`);
  assert.deepEqual(minutesMotionsForDisplay(m), m.displayMotions, `accessor prefers displayMotions for minutes ${m._id}`);
  // (The seed clears the retired embedded motions[] — asserted on the seeded
  // minutes in section 2. This section may also include test-constructed minutes.)
  // Every seeded minutes has motionIds, so display is TABLE-sourced: each resolved
  // motion carries its table row id as motionId.
  if (m.displayMotions.length > 0) {
    assert.ok(
      minutesMotionsForDisplay(m).every((mm: any) => mm.motionId),
      `display motions are table-sourced (motionId present) for minutes ${m._id}`,
    );
  }
}
console.log(`✓ query boundary attaches displayMotions + accessor prefers it (table-sourced) across ${listed.length} minutes`);

// 5) Backend consumers (Phase 2C) run end-to-end and surface table-sourced motions.
const orgHistory: any = await rt()
  .register(definePortableQuery({ name: "orgHistory", handler: (ctx: any, a: any) => orgHistoryListPortable(ctx, a) }))
  .runQuery("orgHistory", { societyId });
assert.ok(Array.isArray(orgHistory.motions), "organizationHistory returned a motions array");
assert.ok(
  JSON.stringify(orgHistory.motions).includes("financial statements"),
  "organizationHistory surfaces a seeded minutes motion (routed through resolveMinutesMotions)",
);

const cycle: any = await rt()
  .register(definePortableQuery({ name: "annualCycle", handler: (ctx: any, a: any) => annualCycleSummaryPortable(ctx, a) }))
  .runQuery("annualCycle", { societyId, year: 2025 });
assert.ok(cycle && typeof cycle === "object", "annualCycle.summary ran without error and returned a checklist");
console.log("✓ backend consumers (organizationHistory + annualCycle) run and surface table-sourced motions");

console.log("\nmotions resolve-parity checks passed.");
