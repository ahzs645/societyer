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

if (steps.length !== 14) throw new Error(`expected 14 CBCA steps, got ${steps.length}`);
expectEqual("first step", steps[0].key, "prepare-federal-articles");
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
if (!none.steps.some((step: any) => step.key === "society-agm-annual-report")) throw new Error("BC society flow missing annual report step.");

console.log("Post-incorporation checklist flow checks passed.");

// Staging a draft is preparation, never registry or execution evidence.
await client.mutation("postIncorporation:recordEvidence", {
  societyId: society.societyId, stepKey: "society-official-incorporation-evidence", stage: "preparing",
});
await (async () => {
  try {
    await client.mutation("postIncorporation:recordEvidence", {
      societyId: society.societyId, stepKey: "society-official-incorporation-evidence", stage: "certified",
    });
    throw new Error("Certified stage accepted without evidence");
  } catch (error: any) {
    if (!error.message.includes("Attach the executed document")) throw error;
  }
})();
const evidenceDocument = await client.mutation("documents:create", {
  societyId: society.societyId, title: "Registry certificate", category: "governance", content: "Certificate fixture", tags: [],
});
await client.mutation("postIncorporation:recordEvidence", {
  societyId: society.societyId, stepKey: "society-official-incorporation-evidence", stage: "certified",
  documentId: evidenceDocument, confirmationNumber: "CERT-123",
});
const certified = await client.query("postIncorporation:checklist", { societyId: society.societyId });
expectEqual("one evidence entry after update", certified.evidence.length, 1);
expectEqual("certificate evidence stage retained", certified.evidence[0].stage, "certified");
expectEqual("receipt reference retained", certified.evidence[0].confirmationNumber, "CERT-123");
expectEqual("certificate does not imply generated packet", certified.generatedPacketKeys, []);
try {
  await client.mutation("postIncorporation:recordEvidence", {
    societyId: created.societyId, stepKey: "appoint-first-directors", stage: "executed", documentId: evidenceDocument,
  });
  throw new Error("Cross-organization evidence was accepted");
} catch (error: any) {
  if (!error.message.includes("not found")) throw error;
}
console.log("Checklist evidence stages and document ownership checks passed.");
