import assert from "node:assert/strict";

import { SOCIETY_DOCUMENT_PACKETS } from "../shared/societyDocumentPackets";
import { CORPORATION_DOCUMENT_PACKETS } from "../shared/corporationDocumentPackets";
import { StaticConvexClient } from "../src/lib/staticConvex";

/**
 * Society document packets seed into the legal catalog the same way corporation
 * packets do (legalTemplates + legalPrecedents), via the generalized seeder. The
 * two catalogs coexist (distinct markers) and the combined entity-aware entry
 * point picks the right set by entity kind.
 */
const client = new StaticConvexClient({
  databaseName: `societyer-static-society-packets-${Date.now()}`,
  seed: { societies: [] },
});

const created = await client.mutation("society:createWorkspace", {
  name: "Riverbend Community Society",
  fiscalYearEnd: "12-31",
  jurisdictionCode: "CA-BC",
  entityType: "society",
  actFormedUnder: "societies_act",
  seedDocumentPackets: false,
});
const societyId = created.societyId;

// Direct society seed.
const seed = await client.mutation("legalOperations:seedSocietyDocumentPackets", { societyId });
assert.equal(seed.insertedTemplates, SOCIETY_DOCUMENT_PACKETS.length);
assert.equal(seed.insertedPrecedents, SOCIETY_DOCUMENT_PACKETS.length);
assert.equal(seed.total, SOCIETY_DOCUMENT_PACKETS.length);

// They appear in the template engine with society entity types.
const engine = await client.query("legalOperations:templateEngine", { societyId });
for (const packet of SOCIETY_DOCUMENT_PACKETS) {
  assert.ok(engine.templates.some((row: any) => row.name === packet.templateName), `missing society template ${packet.templateName}`);
}
const special = engine.templates.find((row: any) => row.name === "Special resolution of the members");
assert.ok(special, "special resolution template seeded");
assert.ok((special.entityTypes ?? []).includes("society"), "society entity type tagged");

// Idempotent: re-seeding inserts nothing new.
const reseed = await client.mutation("legalOperations:seedSocietyDocumentPackets", { societyId });
assert.equal(reseed.insertedTemplates, 0);

// The combined entry point picks society for a society entity.
const auto = await client.mutation("legalOperations:seedDocumentPacketsForEntity", { societyId });
assert.equal(auto.kind, "society");

// And the two catalogs coexist — seeding corporation packets adds them alongside.
const corpSeed = await client.mutation("legalOperations:seedCorporationDocumentPackets", { societyId });
assert.equal(corpSeed.insertedTemplates, CORPORATION_DOCUMENT_PACKETS.length);
const engine2 = await client.query("legalOperations:templateEngine", { societyId });
assert.equal(engine2.templates.length, SOCIETY_DOCUMENT_PACKETS.length + CORPORATION_DOCUMENT_PACKETS.length);

console.log("OK society-packet-seeding");
