import assert from "node:assert/strict";

import { StaticConvexClient } from "../src/lib/staticConvex";

/**
 * The Document Catalog "Generate" action: generateDocumentFromCatalog resolves a
 * packet by key from the corporation OR society catalog and produces a draft
 * document (+ version + artifacts) via the same packet-run path. Works for both
 * entity kinds.
 */
function packetKeyOf(t: any): string | null {
  const marker = (t.sourceExternalIds ?? []).find((m: string) => m.includes("-packet-template:"));
  return marker ? marker.split(":").pop() : null;
}

const client = new StaticConvexClient({
  databaseName: `societyer-generate-${Date.now()}`,
  seed: { societies: [] },
});

// --- Society: generate from an auto-seeded society template ------------------
const soc = await client.mutation("society:createWorkspace", {
  name: "Riverbend Community Society",
  jurisdictionCode: "CA-BC",
  entityType: "society",
  actFormedUnder: "societies_act",
});
const socEngine = await client.query("legalOperations:templateEngine", { societyId: soc.societyId });
const socTemplate = socEngine.templates.find((t: any) => packetKeyOf(t) === "society-directors-resolution");
assert.ok(socTemplate, "society directors-resolution template present");
const socDocsBefore = (await client.query("documents:list", { societyId: soc.societyId })).length;
const socGen = await client.mutation("legalOperations:generateDocumentFromCatalog", {
  societyId: soc.societyId,
  packetKey: "society-directors-resolution",
});
assert.ok(socGen.runId, "society generate returns a runId");
assert.ok(socGen.draftDocumentId, "society generate produced a draft document");
const socDocsAfter = (await client.query("documents:list", { societyId: soc.societyId })).length;
assert.ok(socDocsAfter > socDocsBefore, "society document count increased");

// --- Corporation: generate from an auto-seeded corporation template ----------
const corp = await client.mutation("society:createWorkspace", {
  name: "Northstar Manufacturing Inc.",
  incorporationNumber: "987654-3",
  jurisdictionCode: "CA-FED-CBCA",
  entityType: "corporation__business_",
  actFormedUnder: "canada_business_corporations_act",
});
const corpGen = await client.mutation("legalOperations:generateDocumentFromCatalog", {
  societyId: corp.societyId,
  packetKey: "organize-corporation",
});
assert.ok(corpGen.runId && corpGen.draftDocumentId, "corporation generate produced a draft document");

// --- Unknown key throws ------------------------------------------------------
let threw = false;
try {
  await client.mutation("legalOperations:generateDocumentFromCatalog", {
    societyId: soc.societyId,
    packetKey: "no-such-packet",
  });
} catch {
  threw = true;
}
assert.ok(threw, "unknown packet key throws");

console.log("OK generate-from-catalog");
