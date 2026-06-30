import assert from "node:assert/strict";

import { StaticConvexClient } from "../src/lib/staticConvex";
import { complianceFactsForOrganization, computeComplianceObligations } from "../src/lib/compliance";
import { deriveCurrentHoldings } from "../src/lib/equity";

const source = new StaticConvexClient({
  databaseName: `societyer-snapshot-source-${Date.now()}`,
  seed: { societies: [] },
});

const bcWorkspace = await source.mutation("society:createWorkspace", {
  name: "Riverside Snapshot Society",
  incorporationNumber: "S-0007777",
  incorporationDate: "2020-04-15",
  fiscalYearEnd: "03-31",
  jurisdictionCode: "CA-BC",
  entityType: "society",
  actFormedUnder: "bc_societies_act",
});

const federalWorkspace = await source.mutation("society:createWorkspace", {
  name: "Northstar Snapshot Holdings Inc.",
  incorporationNumber: "456789-1",
  incorporationDate: "2025-02-10",
  fiscalYearEnd: "12-31",
  jurisdictionCode: "CA-FED-CBCA",
  entityType: "corporation__business_",
  actFormedUnder: "canada_business_corporations_act",
});

const directorId = await source.mutation("legalOperations:upsertRoleHolder", {
  societyId: federalWorkspace.societyId,
  roleType: "director",
  status: "current",
  fullName: "Dina Director",
  ageOver18: true,
});
const officerId = await source.mutation("legalOperations:upsertRoleHolder", {
  societyId: federalWorkspace.societyId,
  roleType: "officer",
  status: "current",
  fullName: "Omar Officer",
  officerTitle: "president",
});
const shareholderId = await source.mutation("legalOperations:upsertRoleHolder", {
  societyId: federalWorkspace.societyId,
  roleType: "shareholder",
  status: "current",
  fullName: "Sera Shareholder",
});
const controllerId = await source.mutation("legalOperations:upsertRoleHolder", {
  societyId: federalWorkspace.societyId,
  roleType: "controller",
  status: "current",
  fullName: "Cleo Controller",
  natureOfControl: "Owns voting shares directly.",
});

const commonSharesId = await source.mutation("legalOperations:upsertRightsClass", {
  societyId: federalWorkspace.societyId,
  className: "Common shares",
  classType: "share",
  status: "active",
  votingRights: "One vote per share.",
});
const issuanceId = await source.mutation("legalOperations:upsertRightsholdingTransfer", {
  societyId: federalWorkspace.societyId,
  transferType: "issuance",
  status: "posted",
  transferDate: "2025-02-11",
  rightsClassId: commonSharesId,
  destinationRoleHolderId: shareholderId,
  quantity: 100,
  considerationType: "cash",
  priceToOrganizationCents: 100,
  priceToOrganizationCurrency: "cad",
});

const ontarioRegistrationId = await source.mutation("organizationDetails:upsertRegistration", {
  societyId: federalWorkspace.societyId,
  registrationType: "extra_provincial",
  jurisdiction: "CA-ON-OBCA",
  homeJurisdiction: "CA-FED-CBCA",
  registrationNumber: "ON-SNAP-001",
  registrationDate: "2026-01-05",
  annualReturnDueDate: "2026-06-30",
  registryPortalKey: "ontario-business-registry",
  status: "active",
});

const packetSeed = await source.mutation("legalOperations:seedCorporationDocumentPackets", {
  societyId: federalWorkspace.societyId,
});
// createWorkspace already auto-seeds the corporation document packets, so this
// explicit re-seed is idempotent (updates rather than inserts). Derive the
// catalog size from the seed result so the round-trip assertions stay correct as
// the corporation packet catalog grows.
const corpTemplateCount = packetSeed.insertedTemplates + packetSeed.updatedTemplates;
const corpPrecedentCount = packetSeed.insertedPrecedents + packetSeed.updatedPrecedents;
assert.ok(corpTemplateCount > 0, "corporation packet catalog should seed templates");
assert.ok(corpPrecedentCount > 0, "corporation packet catalog should seed precedents");
const issuancePacket = await source.mutation("legalOperations:stageShareIssuancePacket", {
  societyId: federalWorkspace.societyId,
  transferId: issuanceId,
});
assert.ok(issuancePacket.draftDocumentVersionId);

await source.mutation("complianceObligations:markReviewed", {
  societyId: federalWorkspace.societyId,
  ruleId: "ca-fed-cbca.annual-return",
  flagLevel: "info",
  flagText: "Federal annual return",
  evidenceRequired: ["registry_confirmation"],
  targetTable: "rightsholdingTransfers",
  targetId: issuanceId,
});

const snapshot = source.exportLocalWorkspaceSnapshot();
assert.equal(snapshot.kind, "societyer.localWorkspaceSnapshot");
assert.equal(snapshot.workspace.schemaVersion, 2);
assert.ok(snapshot.tables.societies.some((row: any) => row._id === bcWorkspace.societyId), "BC society workspace missing from snapshot");
assert.ok(snapshot.tables.societies.some((row: any) => row._id === federalWorkspace.societyId), "Federal corporation workspace missing from snapshot");
assert.ok(snapshot.tables.organizationRegistrations.some((row: any) => row._id === ontarioRegistrationId), "Ontario registration missing from snapshot");
assert.ok(snapshot.tables.roleHolders.some((row: any) => row._id === directorId), "Director missing from snapshot");
assert.ok(snapshot.tables.rightsClasses.some((row: any) => row._id === commonSharesId), "Share class missing from snapshot");
assert.ok(snapshot.tables.rightsholdingTransfers.some((row: any) => row._id === issuanceId), "Share issuance missing from snapshot");
assert.ok(snapshot.tables.rightsHoldings.some((row: any) => row.lastTransactionId === issuanceId && row.quantity === 100), "Materialized holding missing from snapshot");
assert.ok(snapshot.tables.documentVersions.some((row: any) => row._id === issuancePacket.draftDocumentVersionId && row.storageProvider === "generated-inline"), "Generated DOCX version missing from snapshot");
assert.equal(snapshot.tables.legalTemplates.filter((row: any) => row.societyId === federalWorkspace.societyId).length, corpTemplateCount);
assert.equal(snapshot.tables.legalPrecedents.filter((row: any) => row.societyId === federalWorkspace.societyId).length, corpPrecedentCount);
assert.equal(snapshot.tables.complianceRemediations.filter((row: any) => row.societyId === federalWorkspace.societyId).length, 1);

const imported = new StaticConvexClient({
  databaseName: `societyer-snapshot-import-${Date.now()}`,
  seed: { societies: [] },
});
await imported.importLocalWorkspaceSnapshot(snapshot);

const workspaces = await imported.query("society:list", {});
const importedBc = workspaces.find((row: any) => row._id === bcWorkspace.societyId);
const importedFederal = workspaces.find((row: any) => row._id === federalWorkspace.societyId);
assert.equal(importedBc.entityType, "society");
assert.equal(importedBc.jurisdictionCode, "CA-BC");
assert.equal(importedBc.homeJurisdictionCode, "CA-BC");
assert.equal(importedFederal.entityType, "corporation__business_");
assert.equal(importedFederal.jurisdictionCode, "CA-FED-CBCA");
assert.equal(importedFederal.homeJurisdictionCode, "CA-FED-CBCA");
assert.equal(importedFederal.anniversaryDate, "2025-02-10");
assert.ok(importedFederal.primaryRegistrationId);

const importedPeople = await imported.query("legalOperations:listRoleHolders", { societyId: federalWorkspace.societyId });
assert.deepEqual(
  importedPeople.map((row: any) => row._id).sort(),
  [controllerId, directorId, officerId, shareholderId].sort(),
);

const importedLedger = await imported.query("legalOperations:rightsLedger", { societyId: federalWorkspace.societyId });
assert.equal(importedLedger.classes[0]._id, commonSharesId);
assert.equal(importedLedger.transfers[0]._id, issuanceId);
assert.equal(importedLedger.holdings[0].lastTransactionId, issuanceId);
assert.equal(importedLedger.holdings[0].quantity, 100);
const holdings = deriveCurrentHoldings(importedLedger.transfers);
assert.deepEqual(holdings, [{
  rightsClassId: commonSharesId,
  holderKey: `roleHolder:${shareholderId}`,
  quantity: 100,
}]);

const importedDetails = await imported.query("organizationDetails:overview", { societyId: federalWorkspace.societyId });
assert.equal(importedDetails.registrations.length, 2);
assert.ok(importedDetails.registrations.some((row: any) => row._id === importedFederal.primaryRegistrationId && row.registrationType === "home"));
assert.ok(importedDetails.registrations.some((row: any) => row._id === ontarioRegistrationId && row.registrationType === "extra_provincial"));

const importedPackets = await imported.query("legalOperations:templateEngine", { societyId: federalWorkspace.societyId });
assert.equal(importedPackets.templates.length, corpTemplateCount);
assert.equal(importedPackets.precedents.length, corpPrecedentCount);
assert.ok(importedPackets.runs.some((row: any) => row._id === issuancePacket.runId));
assert.ok(importedPackets.generatedDocuments.some((row: any) => row._id === issuancePacket.generatedDocumentId));
assert.ok(importedPackets.templates.some((row: any) => row.name === "Issue shares"));
assert.ok(importedPackets.precedents.some((row: any) => row.packageName === "Annual resolutions and return packet"));
const importedDocxVersion = await imported.query("documentVersions:latest", { documentId: issuancePacket.draftDocumentId });
assert.equal(importedDocxVersion._id, issuancePacket.draftDocumentVersionId);
assert.equal(importedDocxVersion.storageProvider, "generated-inline");
assert.ok(importedDocxVersion.storageKey.startsWith("data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEsDB"));

const decisions = await imported.query("complianceObligations:listDecisions", { societyId: federalWorkspace.societyId });
assert.equal(decisions.length, 1);
assert.equal(decisions[0].targetId, issuanceId);

const facts = complianceFactsForOrganization(importedFederal, {
  asOfDate: "2026-02-01",
  registrations: importedDetails.registrations,
});
const obligations = facts.flatMap((factSet) => computeComplianceObligations(factSet));
assert.ok(obligations.some((obligation) => obligation.creates?.filingKind === "FederalAnnualReturn"));
assert.ok(obligations.some((obligation) => obligation.sourceRegistrationId === ontarioRegistrationId && obligation.creates?.filingKind === "OntarioInitialReturn"));

const legacyImport = new StaticConvexClient({
  databaseName: `societyer-snapshot-legacy-import-${Date.now()}`,
  seed: { societies: [] },
});
await legacyImport.importLocalWorkspaceSnapshot({
  kind: "societyer.localWorkspaceSnapshot",
  exportedAtISO: "2024-01-01T00:00:00.000Z",
  workspace: {
    id: "legacy-bc-society",
    name: "Legacy BC Society",
    schemaVersion: 1,
    createdAtISO: "2024-01-01T00:00:00.000Z",
    updatedAtISO: "2024-01-01T00:00:00.000Z",
  },
  tables: {
    societies: [{
      _id: "legacy_society_1",
      _creationTime: Date.parse("2020-01-01T00:00:00.000Z"),
      name: "Legacy Society",
      incorporationNumber: "S-LEGACY",
      incorporationDate: "2019-05-01",
      fiscalYearEnd: "12-31",
    }],
  },
  attachments: [],
  changes: [],
});
const legacyWorkspaces = await legacyImport.query("society:list", {});
assert.equal(legacyImport.exportLocalWorkspaceSnapshot().workspace.schemaVersion, 2);
assert.equal(legacyWorkspaces[0].jurisdictionCode, "CA-BC");
assert.equal(legacyWorkspaces[0].entityType, "society");
assert.equal(legacyWorkspaces[0].actFormedUnder, "societies_act");
const legacyDetails = await legacyImport.query("organizationDetails:overview", { societyId: "legacy_society_1" });
assert.equal(legacyDetails.registrations.length, 1);
assert.equal(legacyDetails.registrations[0].registrationType, "home");
assert.equal(legacyDetails.registrations[0].jurisdiction, "CA-BC");
assert.equal(legacyDetails.registrations[0].registrationNumber, "S-LEGACY");

console.log("Local workspace snapshot round-trip checks passed.");
