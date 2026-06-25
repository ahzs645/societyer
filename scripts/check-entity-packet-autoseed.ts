import assert from "node:assert/strict";

import { SOCIETY_DOCUMENT_PACKETS } from "../shared/societyDocumentPackets";
import { CORPORATION_DOCUMENT_PACKETS } from "../shared/corporationDocumentPackets";
import { StaticConvexClient } from "../src/lib/staticConvex";

/**
 * Creating an entity auto-seeds the right document packet catalog by kind
 * (society.createWorkspace → seedDocumentPacketsForEntityHelper). No explicit
 * seed call needed.
 */
const client = new StaticConvexClient({
  databaseName: `societyer-autoseed-${Date.now()}`,
  seed: { societies: [] },
});

// Society workspace → society packets present, no corporation packets.
const soc = await client.mutation("society:createWorkspace", {
  name: "Riverbend Community Society",
  jurisdictionCode: "CA-BC",
  entityType: "society",
  actFormedUnder: "societies_act",
});
const socEngine = await client.query("legalOperations:templateEngine", { societyId: soc.societyId });
for (const p of SOCIETY_DOCUMENT_PACKETS) {
  assert.ok(socEngine.templates.some((r: any) => r.name === p.templateName), `society auto-seed missing ${p.templateName}`);
}
assert.equal(socEngine.templates.length, SOCIETY_DOCUMENT_PACKETS.length, "society gets exactly its own catalog");

// Corporation workspace → corporation packets present.
const corp = await client.mutation("society:createWorkspace", {
  name: "Northstar Manufacturing Inc.",
  incorporationNumber: "987654-3",
  jurisdictionCode: "CA-FED-CBCA",
  entityType: "corporation__business_",
  actFormedUnder: "canada_business_corporations_act",
});
const corpEngine = await client.query("legalOperations:templateEngine", { societyId: corp.societyId });
assert.equal(corpEngine.templates.length, CORPORATION_DOCUMENT_PACKETS.length, "corporation gets exactly its own catalog");
const issueShares = corpEngine.templates.find((r: any) => r.name === "Issue shares");
assert.ok(issueShares, "corporation auto-seed includes share instruments");

console.log("OK entity-packet-autoseed");
