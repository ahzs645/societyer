// Firm-wide layer: cross-entity overview rollup + batch ("Multiple_Copy") packet
// generation, exercised through the static mirror (the app's code path).

import { StaticConvexClient } from "../src/lib/staticConvex";

function expectEqual(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

const client = new StaticConvexClient({
  databaseName: `societyer-static-firm-${Date.now()}`,
  seed: { societies: [] },
});

const corpArgs = (name: string, num: string) => ({
  name,
  incorporationNumber: num,
  incorporationDate: "2026-01-01",
  jurisdictionCode: "CA-FED-CBCA",
  entityType: "corporation__business_",
  actFormedUnder: "canada_business_corporations_act",
});

const a = await client.mutation("society:createWorkspace", corpArgs("Alpha Corp.", "111"));
const b = await client.mutation("society:createWorkspace", corpArgs("Beta Corp.", "222"));
const s = await client.mutation("society:createWorkspace", { name: "Gamma Society", entityType: "society" });

// An overdue deadline on Alpha.
await client.mutation("deadlines:create", {
  societyId: a.societyId,
  title: "Annual return",
  dueDate: "2020-01-01",
  category: "filing",
});

// --- firm overview rolls up every entity ---
const overview = await client.query("firm:overview", { todayISO: "2026-06-25" });
expectEqual("entity count", overview.entities.length, 3);
expectEqual("corporation total", overview.totals.corporations, 2);
expectEqual("society total", overview.totals.societies, 1);
expectEqual("firm-wide overdue", overview.totals.overdueDeadlines, 1);
const alpha = overview.entities.find((e: any) => e._id === a.societyId);
expectEqual("alpha overdue", alpha.overdueDeadlines, 1);
if (!(alpha.postIncorpTotal > 0)) throw new Error("corporation should have post-incorporation steps");
expectEqual("alpha not yet started", alpha.postIncorpDone, 0);

// --- batch generate a corporation packet across both corporations ---
const result = await client.mutation("firm:batchGeneratePacket", {
  societyIds: [a.societyId, b.societyId],
  packetKey: "annual-resolutions",
});
expectEqual("batch generated for both corporations", result.generated, 2);
expectEqual("no failures", result.failed, 0);

// Post-incorporation progress reflects the generated annual-resolutions packet.
const after = await client.query("firm:overview", { todayISO: "2026-06-25" });
const alphaAfter = after.entities.find((e: any) => e._id === a.societyId);
if (!(alphaAfter.postIncorpDone > 0)) throw new Error("generating a packet should advance post-incorporation progress");

// A corporation packet applied to a society is skipped and reported, not thrown.
const mixed = await client.mutation("firm:batchGeneratePacket", {
  societyIds: [s.societyId],
  packetKey: "issue-shares",
});
expectEqual("society skipped for corp packet", mixed.generated, 0);
expectEqual("reported as failed", mixed.failed, 1);

console.log("Firm flow checks passed.");
