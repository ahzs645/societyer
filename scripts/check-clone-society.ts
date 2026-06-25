import assert from "node:assert/strict";

import { StaticConvexClient } from "../src/lib/staticConvex";

/**
 * #2 Clone completeness + ID remapping. A deep clone must (a) copy the equity
 * ledger / dividends / assets / SI-step child tables that the prior clone
 * silently dropped, and (b) rewrite intra-clone Id references so cloned
 * holdings/transfers/asset-events point at the CLONED rows, not the source
 * society's — the latent dangling-reference bug.
 */

const SRC = "soc-src";
const seed = {
  societies: [{ _id: SRC, name: "Source Inc.", entityType: "corporation__business_", actFormedUnder: "business_corporations_act" }],
  roleHolders: [{ _id: "rh-1", societyId: SRC, roleType: "director", fullName: "Alice Stone", status: "current" }],
  rightsClasses: [{ _id: "rc-1", societyId: SRC, className: "Class A", classType: "share", status: "active" }],
  rightsHoldings: [
    { _id: "hold-1", societyId: SRC, rightsClassId: "rc-1", holderRoleHolderId: "rh-1", holderKey: "roleHolder:rh-1", quantity: 100, status: "current", lastTransactionId: "xfer-1", sourceDocumentIds: ["doc-ext-1"], sourceExternalIds: [] },
  ],
  rightsholdingTransfers: [
    { _id: "xfer-1", societyId: SRC, transferType: "issuance", status: "posted", rightsClassId: "rc-1", destinationRoleHolderId: "rh-1", quantity: 100, sourceDocumentIds: ["doc-ext-1"], sourceExternalIds: [] },
  ],
  dividends: [{ _id: "div-1", societyId: SRC, declaredOn: "2026-01-02", className: "Class A", perShareCents: 50, sharesOutstanding: 100, totalCents: 5000, currency: "C$" }],
  assets: [{ _id: "asset-1", societyId: SRC, name: "Forklift", status: "active" }],
  assetEvents: [{ _id: "ae-1", societyId: SRC, assetId: "asset-1", eventType: "intake", happenedAtISO: "2026-01-02T00:00:00.000Z", documentIds: [] }],
  significantIndividualSteps: [{ _id: "si-1", societyId: SRC, name: "Alice Stone", stepsNarrative: "Mailed inquiry", stepDate: "2026-01-02" }],
} as unknown as Record<string, unknown[]>;

const client = new StaticConvexClient({
  databaseName: `societyer-clone-${Date.now()}`,
  seed: seed as never,
});

const result = (await client.mutation("society:cloneSociety", {
  sourceSocietyId: SRC,
  newName: "Clone Inc.",
  nowISO: new Date().toISOString(),
})) as { societyId: string; copiedRows: number };

const newId = result.societyId;
assert.ok(newId && newId !== SRC, "clone produced a new society id");
assert.equal(result.copiedRows, 8, "all eight seeded child rows copied");

const tables = (client as unknown as { exportLocalWorkspaceSnapshot(): { tables: Record<string, any[]> } })
  .exportLocalWorkspaceSnapshot().tables;
const inNew = (table: string) => (tables[table] ?? []).filter((r) => r.societyId === newId);
const inSrc = (table: string) => (tables[table] ?? []).filter((r) => r.societyId === SRC);

// --- the previously-dropped tables are now present in the clone --------------
for (const table of ["rightsHoldings", "rightsholdingTransfers", "dividends", "assets", "assetEvents", "significantIndividualSteps"]) {
  assert.equal(inNew(table).length, 1, `${table} copied into clone`);
}

// --- cross-references are remapped to the CLONED rows ------------------------
const clonedClass = inNew("rightsClasses")[0];
const clonedHolder = inNew("roleHolders")[0];
const clonedXfer = inNew("rightsholdingTransfers")[0];
const clonedHolding = inNew("rightsHoldings")[0];
const clonedAsset = inNew("assets")[0];
const clonedEvent = inNew("assetEvents")[0];

assert.notEqual(clonedHolding.rightsClassId, "rc-1", "holding.rightsClassId remapped off source");
assert.equal(clonedHolding.rightsClassId, clonedClass._id, "holding → cloned rights class");
assert.equal(clonedHolding.holderRoleHolderId, clonedHolder._id, "holding → cloned role holder");
assert.equal(clonedHolding.lastTransactionId, clonedXfer._id, "holding → cloned transfer");
assert.equal(clonedXfer.rightsClassId, clonedClass._id, "transfer → cloned rights class");
assert.equal(clonedXfer.destinationRoleHolderId, clonedHolder._id, "transfer → cloned role holder");
assert.equal(clonedEvent.assetId, clonedAsset._id, "asset event → cloned asset");

// --- cross-tenant Ids we did NOT clone pass through untouched ----------------
assert.deepEqual(clonedHolding.sourceDocumentIds, ["doc-ext-1"], "uncloned document refs preserved");

// --- the source society's rows are untouched --------------------------------
assert.equal(inSrc("rightsHoldings")[0].rightsClassId, "rc-1", "source holding unchanged");

console.log("OK clone-society");
