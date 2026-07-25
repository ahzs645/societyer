import assert from "node:assert/strict";

import { StaticConvexClient } from "../src/lib/staticConvex";
import { complianceFactsForOrganization, computeComplianceObligations } from "../src/lib/compliance";
import { deriveCurrentHoldings } from "../src/lib/equity";

async function assertRejects(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(`${label} should have been rejected.`);
}

const source = new StaticConvexClient({
  databaseName: `societyer-corporation-mvp-source-${Date.now()}`,
  seed: { societies: [] },
});

const created = await source.mutation("society:createWorkspace", {
  name: "Northstar MVP Holdings Inc.",
  incorporationNumber: "999999-1",
  incorporationDate: "2025-02-10",
  fiscalYearEnd: "12-31",
  jurisdictionCode: "CA-FED-CBCA",
  entityType: "corporation__business_",
  actFormedUnder: "canada_business_corporations_act",
});
assert.ok(created.societyId, "Federal CBCA corporation workspace should be created");

const [workspace] = await source.query("society:list", {});
assert.equal(workspace.jurisdictionCode, "CA-FED-CBCA");
assert.equal(workspace.homeJurisdictionCode, "CA-FED-CBCA");
assert.equal(workspace.entityType, "corporation__business_");
assert.equal(workspace.anniversaryDate, "2025-02-10");
assert.ok(workspace.primaryRegistrationId);

const directorId = await source.mutation("legalOperations:upsertRoleHolder", {
  societyId: created.societyId,
  roleType: "director",
  status: "current",
  fullName: "Dina Director",
  ageOver18: true,
});
const officerId = await source.mutation("legalOperations:upsertRoleHolder", {
  societyId: created.societyId,
  roleType: "officer",
  status: "current",
  fullName: "Omar Officer",
  officerTitle: "president",
});
const shareholderId = await source.mutation("legalOperations:upsertRoleHolder", {
  societyId: created.societyId,
  roleType: "shareholder",
  status: "current",
  fullName: "Sera Shareholder",
});
const controllerId = await source.mutation("legalOperations:upsertRoleHolder", {
  societyId: created.societyId,
  roleType: "controller",
  status: "current",
  fullName: "Cleo Controller",
  natureOfControl: "Owns voting shares directly.",
});
const people = await source.query("legalOperations:listRoleHolders", { societyId: created.societyId });
assert.deepEqual(
  people.map((row: any) => row.roleType).sort(),
  ["controller", "director", "officer", "shareholder"],
);
assert.deepEqual(
  people.map((row: any) => row._id).sort(),
  [controllerId, directorId, officerId, shareholderId].sort(),
);

const commonSharesId = await source.mutation("legalOperations:upsertRightsClass", {
  societyId: created.societyId,
  className: "Common shares",
  classType: "share",
  status: "active",
  votingRights: "One vote per share.",
});
const issuanceId = await source.mutation("legalOperations:upsertRightsholdingTransfer", {
  societyId: created.societyId,
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
let ledger = await source.query("legalOperations:rightsLedger", { societyId: created.societyId });
assert.deepEqual(deriveCurrentHoldings(ledger.transfers), [{
  rightsClassId: commonSharesId,
  holderKey: `roleHolder:${shareholderId}`,
  quantity: 100,
}]);
await assertRejects("over-transfer mutation", () => source.mutation("legalOperations:upsertRightsholdingTransfer", {
  societyId: created.societyId,
  transferType: "transfer",
  status: "posted",
  transferDate: "2025-02-12",
  rightsClassId: commonSharesId,
  sourceRoleHolderId: shareholderId,
  destinationHolderName: "Outside buyer",
  quantity: 101,
}));

const ontarioRegistrationId = await source.mutation("organizationDetails:upsertRegistration", {
  societyId: created.societyId,
  registrationType: "extra_provincial",
  jurisdiction: "CA-ON-OBCA",
  homeJurisdiction: "CA-FED-CBCA",
  registrationNumber: "ON-MVP-001",
  registrationDate: "2026-01-05",
  annualReturnDueDate: "2026-06-30",
  registryPortalKey: "ontario_business_registry",
  status: "active",
});
const detail = await source.query("organizationDetails:overview", { societyId: created.societyId });
assert.equal(detail.registrations.length, 2);
assert.ok(detail.registrations.some((row: any) => row._id === workspace.primaryRegistrationId && row.registrationType === "home"));
assert.ok(detail.registrations.some((row: any) => row._id === ontarioRegistrationId));

const facts = complianceFactsForOrganization(workspace, {
  asOfDate: "2026-02-01",
  registrations: detail.registrations,
});
const obligations = facts.flatMap((factSet) => computeComplianceObligations(factSet));
assert.ok(obligations.some((obligation) => obligation.creates?.filingKind === "FederalAnnualReturn"));
assert.ok(obligations.some((obligation) => obligation.creates?.filingKind === "FederalIscUpdate"));
assert.ok(obligations.some((obligation) => obligation.creates?.filingKind === "FederalDirectorChange"));
assert.ok(obligations.some((obligation) => obligation.creates?.filingKind === "FederalRegisteredOfficeChange"));
assert.ok(
  obligations.some((obligation) =>
    obligation.sourceRegistrationId === ontarioRegistrationId &&
    obligation.creates?.filingKind === "OntarioInitialReturn"
  ),
  "Ontario registration obligations should be computed separately from federal obligations",
);

const issuancePacket = await source.mutation("legalOperations:stageShareIssuancePacket", {
  societyId: created.societyId,
  transferId: issuanceId,
});
assert.equal(issuancePacket.packetKey, "issue-shares");

const annualReturn = obligations.find((obligation) => obligation.creates?.filingKind === "FederalAnnualReturn");
assert.ok(annualReturn);
const filingId = await source.mutation("filings:create", {
  societyId: created.societyId,
  kind: annualReturn.creates?.filingKind,
  jurisdictionCode: annualReturn.jurisdictionCode,
  contextKind: annualReturn.contextKind,
  sourceRegistrationId: annualReturn.sourceRegistrationId,
  periodLabel: annualReturn.title,
  dueDate: annualReturn.dueDate,
  status: "Upcoming",
  submissionChecklist: annualReturn.creates?.checklist,
});
const [trackedAnnualReturn] = (await source.query("filings:list", { societyId: created.societyId }))
  .filter((filing: any) => filing._id === filingId);
assert.equal(trackedAnnualReturn.jurisdictionCode, "CA-FED-CBCA");
assert.equal(trackedAnnualReturn.contextKind, "home");
assert.equal(trackedAnnualReturn.sourceRegistrationId, undefined);
const annualPacket = await source.mutation("legalOperations:stageCorporationDocumentPacket", {
  societyId: created.societyId,
  obligationKey: annualReturn.obligationKey,
  obligationRuleId: annualReturn.ruleId,
  obligationTitle: annualReturn.title,
  filingKind: annualReturn.creates?.filingKind,
  dueDate: annualReturn.dueDate,
  filingId,
});
assert.equal(annualPacket.packetKey, "annual-resolutions");

ledger = await source.query("legalOperations:rightsLedger", { societyId: created.societyId });
const linkedIssuance = ledger.transfers.find((row: any) => row._id === issuanceId);
assert.equal(linkedIssuance.precedentRunId, issuancePacket.runId);

const packets = await source.query("legalOperations:templateEngine", { societyId: created.societyId });
assert.ok(packets.runs.some((row: any) => row._id === issuancePacket.runId));
assert.ok(packets.runs.some((row: any) => row._id === annualPacket.runId));

const snapshot = source.exportLocalWorkspaceSnapshot();
const imported = new StaticConvexClient({
  databaseName: `societyer-corporation-mvp-import-${Date.now()}`,
  seed: { societies: [] },
});
await imported.importLocalWorkspaceSnapshot(snapshot);
const importedWorkspace = (await imported.query("society:list", {})).find((row: any) => row._id === created.societyId);
assert.equal(importedWorkspace.entityType, "corporation__business_");
assert.equal(importedWorkspace.primaryRegistrationId, workspace.primaryRegistrationId);
const importedLedger = await imported.query("legalOperations:rightsLedger", { societyId: created.societyId });
assert.equal(importedLedger.classes[0]._id, commonSharesId);
assert.equal(importedLedger.transfers.find((row: any) => row._id === issuanceId).precedentRunId, issuancePacket.runId);
assert.deepEqual(deriveCurrentHoldings(importedLedger.transfers), [{
  rightsClassId: commonSharesId,
  holderKey: `roleHolder:${shareholderId}`,
  quantity: 100,
}]);
const importedDetails = await imported.query("organizationDetails:overview", { societyId: created.societyId });
assert.ok(importedDetails.registrations.some((row: any) => row._id === workspace.primaryRegistrationId && row.registrationType === "home"));
assert.ok(importedDetails.registrations.some((row: any) => row._id === ontarioRegistrationId));
const importedPackets = await imported.query("legalOperations:templateEngine", { societyId: created.societyId });
assert.ok(importedPackets.runs.some((row: any) => row._id === issuancePacket.runId));
assert.ok(importedPackets.runs.some((row: any) => row._id === annualPacket.runId));

console.log("Corporation MVP flow checks passed.");
