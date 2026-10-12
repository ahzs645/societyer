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
  societies: [{
    _id: SRC, name: "Source Inc.", entityType: "corporation__business_", actFormedUnder: "business_corporations_act",
    // The source entity's own annual-business evidence must not travel with a clone.
    annualDeadlineCalendarReviews: [{ category: "annual-report", cycleYear: 2025 }],
    annualMeetingCompletions: [{ cycleYear: 2025, writtenResolutionId: "wr-src" }],
    annualMeetingFinancialYearEnd: "2025-12-31",
    annualReturnPeriodEnd: "2025-12-31",
  }],
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

// --- the clone is a distinct legal entity: no inherited annual evidence -------
const clonedSociety = (tables.societies ?? []).find((r) => r._id === newId);
for (const field of ["annualDeadlineCalendarReviews", "annualMeetingCompletions", "annualMeetingFinancialYearEnd", "annualReturnPeriodEnd", "incorporationNumber"]) {
  assert.equal(clonedSociety?.[field], undefined, `${field} is not copied into the clone`);
}

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
assert.equal(clonedHolding.holderKey, `roleHolder:${clonedHolder._id}`, "holder key remapped to the cloned role holder");

// --- template-clone options (YCN Date_Over_Ride / Multiple_Copy) -------------
const TPL = "soc-template";
const templateClient = new StaticConvexClient({
  databaseName: `societyer-clone-template-${Date.now()}`,
  seed: {
    societies: [
      { _id: TPL, name: "Template Holdings Ltd.", incorporationNumber: "BC0000001", entityType: "corporation__business_", jurisdictionCode: "CA-BC", actFormedUnder: "business_corporations_act",
        operativeArticles: { base: "bc_table_1", table1Version: "am_50_2023", sourceDocumentId: "doc-src-articles" } },
      { _id: "soc-other", name: "Existing Numbered Ltd.", incorporationNumber: "BC0000099", entityType: "corporation__business_", jurisdictionCode: "CA-BC", actFormedUnder: "business_corporations_act" },
    ],
    roleHolders: [
      { _id: "rh-dir", societyId: TPL, roleType: "director", fullName: "Synthetic Director", status: "current", startDate: "2019-03-01" },
      { _id: "rh-si", societyId: TPL, roleType: "controller", fullName: "Synthetic Controller", status: "current", startDate: "2019-03-01" },
      { _id: "rh-old", societyId: TPL, roleType: "officer", fullName: "Synthetic Former Officer", status: "former", startDate: "2019-03-01", endDate: "2020-01-01" },
    ],
    organizationAddresses: [{ _id: "addr-1", societyId: TPL, type: "registered_office", status: "current", effectiveFrom: "2019-03-01", street: "1 Example St", city: "Victoria", country: "CA", createdAtISO: "2019-03-01T00:00:00Z", updatedAtISO: "2019-03-01T00:00:00Z" }],
    rightsClasses: [{ _id: "rc-t", societyId: TPL, className: "Common", classType: "share", status: "active", startDate: "2019-03-01" }],
    rightsholdingTransfers: [{ _id: "xfer-t", societyId: TPL, transferType: "issuance", status: "posted", transferDate: "2019-03-02", rightsClassId: "rc-t", destinationRoleHolderId: "rh-dir", quantity: 10, sourceDocumentIds: [], sourceExternalIds: [] }],
    rightsHoldings: [{ _id: "hold-t", societyId: TPL, rightsClassId: "rc-t", holderRoleHolderId: "rh-dir", holderKey: "roleHolder:rh-dir", quantity: 10, status: "current", sourceDocumentIds: [], sourceExternalIds: [] }],
    significantIndividualSteps: [{ _id: "si-t", societyId: TPL, individualName: "Synthetic Controller", roleHolderId: "rh-si", stepsNarrative: "Inquiry", stepDate: "2020-01-02" }],
    societyNameHistory: [{ _id: "nh-t", societyId: TPL, name: "Template Holdings Ltd.", startISO: "2019-03-01", createdAtISO: "2019-03-01T00:00:00Z" }],
  } as never,
});
const template = await templateClient.mutation("society:cloneSociety", {
  sourceSocietyId: TPL, newName: "Numbered Co", nowISO: new Date().toISOString(),
  resetEffectiveDatesTo: "2026-11-01", excludeHoldings: true, excludeSignificantIndividuals: true, incorporationNumber: "BC0000099",
}) as { societyId: string; societyIds: string[]; copiedRows: number; warnings: string[] };
const tplTables = (templateClient as unknown as { exportLocalWorkspaceSnapshot(): { tables: Record<string, any[]> } }).exportLocalWorkspaceSnapshot().tables;
const tplRows = (table: string, societyId: string) => (tplTables[table] ?? []).filter((row) => row.societyId === societyId);
assert.ok(template.warnings.some((w) => /BC0000099 is already recorded for Existing Numbered Ltd\./.test(w)), "registry number clash is warned, not blocked");
assert.ok(template.warnings.some((w) => /1 copied row ends before 2026-11-01/.test(w)), "ended rows are flagged after a date reset");
const tplSociety = (tplTables.societies ?? []).find((row) => row._id === template.societyId);
assert.equal(tplSociety.incorporationNumber, "BC0000099");
assert.equal(tplSociety.operativeArticles.base, "bc_table_1", "the articles record travels");
assert.equal(tplSociety.operativeArticles.sourceDocumentId, undefined, "but not the source workspace's articles document");
assert.deepEqual(tplRows("roleHolders", template.societyId).map((row) => row.fullName).sort(), ["Synthetic Director", "Synthetic Former Officer"], "significant individuals left out");
assert.ok(tplRows("roleHolders", template.societyId).every((row) => row.startDate === "2026-11-01"), "start dates reset");
assert.equal(tplRows("roleHolders", template.societyId).find((row) => row.fullName === "Synthetic Former Officer").endDate, "2020-01-01", "end dates are kept for review");
assert.equal(tplRows("organizationAddresses", template.societyId)[0].effectiveFrom, "2026-11-01");
assert.equal(tplRows("societyNameHistory", template.societyId)[0].startISO, "2026-11-01");
for (const table of ["rightsHoldings", "rightsholdingTransfers", "significantIndividualSteps"]) assert.equal(tplRows(table, template.societyId).length, 0, `${table} left out`);
assert.equal(tplRows("rightsClasses", template.societyId).length, 1, "share classes are kept for a template");
assert.equal(tplRows("roleHolders", TPL).find((row) => row._id === "rh-dir").startDate, "2019-03-01", "source dates untouched");

const batch = await templateClient.mutation("society:cloneSociety", { sourceSocietyId: TPL, newName: "Batch Co", nowISO: new Date().toISOString(), copies: 3, excludePeople: true }) as { societyIds: string[]; warnings: string[] };
assert.equal(batch.societyIds.length, 3);
assert.deepEqual(batch.societyIds.map((id) => (tplTables.societies ?? []).length && (templateClient as any).exportLocalWorkspaceSnapshot().tables.societies.find((row: any) => row._id === id).name), ["Batch Co 1", "Batch Co 2", "Batch Co 3"]);
const batchTables = (templateClient as any).exportLocalWorkspaceSnapshot().tables;
for (const id of batch.societyIds) {
  for (const table of ["roleHolders", "rightsHoldings", "rightsholdingTransfers", "significantIndividualSteps", "entitySigners"]) {
    assert.equal((batchTables[table] ?? []).filter((row: any) => row.societyId === id).length, 0, `${table} left out when people are excluded`);
  }
  assert.equal((batchTables.rightsClasses ?? []).filter((row: any) => row.societyId === id).length, 1);
}
await assert.rejects(templateClient.mutation("society:cloneSociety", { sourceSocietyId: TPL, newName: "Too many", nowISO: new Date().toISOString(), copies: 21 }), /between 1 and 20/);
await assert.rejects(templateClient.mutation("society:cloneSociety", { sourceSocietyId: TPL, newName: "Two", nowISO: new Date().toISOString(), copies: 2, incorporationNumber: "BC1" }), /only when creating one clone/);
await assert.rejects(templateClient.mutation("society:cloneSociety", { sourceSocietyId: TPL, newName: "Bad date", nowISO: new Date().toISOString(), resetEffectiveDatesTo: "2026-02-30" }), /valid date/);

console.log("OK clone-society (including template options: date reset, exclusions, batch copies, registry-number warning)");
