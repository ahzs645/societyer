// Wiring check: the post-incorporation checklist query returns the flow steps for
// a federal CBCA corporation through the same code path the app uses (static mirror).

import { StaticConvexClient } from "../src/lib/staticConvex";

function expectEqual(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

const client = new StaticConvexClient({
  databaseName: `societyer-static-postincorp-${Date.now()}`,
  seed: { societies: [] },
});

const created = await client.mutation("society:createWorkspace", {
  name: "Northstar Corp.",
  incorporationNumber: "123456-7",
  incorporationDate: "2026-01-01",
  jurisdictionCode: "CA-FED-CBCA",
  entityType: "corporation__business_",
  actFormedUnder: "canada_business_corporations_act",
});

const result = await client.query("postIncorporation:checklist", { societyId: created.societyId });
const steps = result.steps as any[];

if (steps.length !== 13) throw new Error(`expected 13 CBCA steps, got ${steps.length}`);
expectEqual("first step", steps[0].key, "appoint-first-directors");
expectEqual("steps are ordered", steps.map((s) => s.order), steps.map((_, i) => i + 1));
// Every step in each category appears; categories are the three known buckets.
const cats = new Set(steps.map((s) => s.category));
expectEqual("categories", [...cats].sort(), ["good_standing", "organize", "registration"]);
// A federal annual-return step links to its recurring filing obligation.
const annual = steps.find((s) => s.key === "file-annual-return");
if (!annual || annual.obligation?.filingKind !== "FederalAnnualReturn") {
  throw new Error("annual-return step should link FederalAnnualReturn obligation");
}
// Nothing generated yet.
expectEqual("no packets generated initially", result.generatedPacketKeys, []);

// A non-corporation society has no CBCA flow.
const society = await client.mutation("society:createWorkspace", { name: "A Society", entityType: "society" });
const none = await client.query("postIncorporation:checklist", { societyId: society.societyId });
expectEqual("society has no post-incorporation flow", none.steps.length, 0);

console.log("Post-incorporation checklist flow checks passed.");
