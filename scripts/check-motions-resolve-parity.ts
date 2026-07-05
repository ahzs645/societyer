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
import { resolveMinutesMotions, syncMotionsForMinutes } from "../shared/functions/minutes";

const db = new MemoryDb({ seed: {} });
const caps = makeCapabilities({});
const rt = () => new PortableRuntime({ db, capabilities: caps });

// 1) Seed. The Phase 1 finalization routes every seeded minutes through the
//    dual-write, so each carries ordered motionIds + mirror rows.
await rt()
  .register(definePortableMutation({ name: "seed", handler: (ctx: any) => runPortable(ctx) }))
  .runMutation("seed", {});

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
  assert.deepEqual(
    rec.resolved.map(proj),
    rec.embedded.map(proj),
    `resolver output != embedded minutes.motions for minutes ${rec.id}`,
  );
  checkedMinutes += 1;
  checkedMotions += rec.embedded.length;
  if (rec.hasIds && rec.embedded.length > 0) viaTable += 1;
}
assert.ok(viaTable > 0, "expected at least one minutes to resolve through the motionIds -> table path");
console.log(
  `✓ resolver == embedded array across ${checkedMinutes} seeded minutes / ${checkedMotions} motions (${viaTable} via the table path)`,
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

console.log("\nmotions resolve-parity checks passed.");
