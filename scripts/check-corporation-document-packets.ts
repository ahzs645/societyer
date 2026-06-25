import assert from "node:assert/strict";

import { CORPORATION_DOCUMENT_PACKETS } from "../shared/corporationDocumentPackets";
import { StaticConvexClient } from "../src/lib/staticConvex";

const client = new StaticConvexClient({
  databaseName: `societyer-static-corp-packets-${Date.now()}`,
  seed: { societies: [] },
});

const created = await client.mutation("society:createWorkspace", {
  name: "Northstar Packet Co.",
  incorporationNumber: "987654-3",
  incorporationDate: "2025-02-10",
  fiscalYearEnd: "12-31",
  jurisdictionCode: "CA-FED-CBCA",
  entityType: "corporation__business_",
  seedDocumentPackets: false,
  actFormedUnder: "canada_business_corporations_act",
});

const seedResult = await client.mutation("legalOperations:seedCorporationDocumentPackets", {
  societyId: created.societyId,
});

assert.equal(seedResult.insertedTemplates, CORPORATION_DOCUMENT_PACKETS.length);
assert.equal(seedResult.insertedPrecedents, CORPORATION_DOCUMENT_PACKETS.length);
assert.equal(seedResult.total, CORPORATION_DOCUMENT_PACKETS.length);

const engine = await client.query("legalOperations:templateEngine", { societyId: created.societyId });
assert.equal(engine.templates.length, CORPORATION_DOCUMENT_PACKETS.length);
assert.equal(engine.precedents.length, CORPORATION_DOCUMENT_PACKETS.length);

for (const title of [
  "Organize corporation / initial resolutions",
  "Issue shares",
  "Annual resolutions",
  "ISC register update",
  "Extra-provincial registration evidence packet",
]) {
  assert.ok(engine.templates.some((row: any) => row.name === title), `Missing template ${title}`);
}

const shareTemplate = engine.templates.find((row: any) => row.name === "Issue shares");
assert.equal(shareTemplate.documentTag, "9___transfer_register");
assert.ok(shareTemplate.requiredSigners.includes("transfer_participants"));
assert.ok(shareTemplate.requiredDataFields.includes("ShareClass"));

const annualPrecedent = engine.precedents.find((row: any) => row.packageName === "Annual resolutions and return packet");
assert.equal(annualPrecedent.requiresAnnualMaintenanceRecord, true);
assert.ok(annualPrecedent.templateFilingNames.includes("Annual return"));

const extraProvincialPrecedent = engine.precedents.find((row: any) => row.packageName === "Extra-provincial registration evidence packet");
assert.equal(extraProvincialPrecedent.partType, "registration");
assert.ok(extraProvincialPrecedent.templateRegistrationNames.includes("Ontario extra-provincial registration"));

for (const precedent of engine.precedents) {
  assert.equal(precedent.templateIds.length, 1, `${precedent.packageName} should link to its seeded template`);
}

const staged = await client.mutation("legalOperations:stageCorporationDocumentPacket", {
  societyId: created.societyId,
  obligationKey: "annual_return",
  obligationRuleId: "cbca-annual-return",
  obligationTitle: "File CBCA annual return",
  filingKind: "FederalAnnualReturn",
  dueDate: "2026-03-12",
});
assert.equal(staged.packetKey, "annual-resolutions");
assert.ok(staged.runId);
assert.equal(staged.precedentId, annualPrecedent._id);

const engineWithRun = await client.query("legalOperations:templateEngine", { societyId: created.societyId });
assert.equal(engineWithRun.runs.length, 1);
assert.equal(engineWithRun.runs[0]._id, staged.runId);
assert.equal(engineWithRun.runs[0].precedentId, annualPrecedent._id);
assert.equal(engineWithRun.runs[0].status, "draft");
assert.ok(engineWithRun.runs[0].sourceExternalIds.includes("societyer:corporation-packet-run:annual-resolutions"));
assert.equal(engineWithRun.generatedDocuments.length, 1);
assert.equal(engineWithRun.generatedDocuments[0]._id, staged.generatedDocumentId);
assert.equal(engineWithRun.generatedDocuments[0].draftDocumentId, staged.draftDocumentId);
assert.equal(engineWithRun.generatedDocuments[0].documentTag, "13___annual_return_filings");
assert.equal(engineWithRun.generatedDocuments[0].sourceExternalIds.includes(`societyer:document-version:${staged.draftDocumentVersionId}`), true);
const annualDocxVersion = await client.query("documentVersions:latest", { documentId: staged.draftDocumentId });
assert.equal(annualDocxVersion._id, staged.draftDocumentVersionId);
assert.equal(annualDocxVersion.storageProvider, "generated-inline");
assert.equal(annualDocxVersion.mimeType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
assert.ok(annualDocxVersion.storageKey.startsWith("data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEsDB"));

const shareholderId = await client.mutation("legalOperations:upsertRoleHolder", {
  societyId: created.societyId,
  roleType: "shareholder",
  status: "current",
  fullName: "Sera Shareholder",
});
const commonSharesId = await client.mutation("legalOperations:upsertRightsClass", {
  societyId: created.societyId,
  className: "Common shares",
  classType: "share",
  status: "active",
});
const issuanceId = await client.mutation("legalOperations:upsertRightsholdingTransfer", {
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
const issuancePacket = await client.mutation("legalOperations:stageShareIssuancePacket", {
  societyId: created.societyId,
  transferId: issuanceId,
});
assert.equal(issuancePacket.packetKey, "issue-shares");
assert.ok(issuancePacket.runId);
assert.equal(issuancePacket.transferId, issuanceId);

const engineWithIssuance = await client.query("legalOperations:templateEngine", { societyId: created.societyId });
const shareRun = engineWithIssuance.runs.find((row: any) => row._id === issuancePacket.runId);
assert.equal(shareRun.status, "draft");
assert.equal(shareRun.eventId, issuanceId);
assert.ok(shareRun.sourceExternalIds.includes(`societyer:rightsholding-transfer:${issuanceId}`));
assert.ok(shareRun.sourceExternalIds.includes("societyer:corporation-packet-run:issue-shares"));

const ledger = await client.query("legalOperations:rightsLedger", { societyId: created.societyId });
const linkedIssuance = ledger.transfers.find((row: any) => row._id === issuanceId);
assert.equal(linkedIssuance.precedentRunId, issuancePacket.runId);
assert.ok(linkedIssuance.sourceDocumentIds.includes(issuancePacket.draftDocumentId));
assert.ok(linkedIssuance.sourceExternalIds.includes("societyer:corporation-packet-run:issue-shares"));
assert.ok(linkedIssuance.sourceExternalIds.includes(`societyer:legal-precedent-run:${issuancePacket.runId}`));
assert.ok(linkedIssuance.sourceExternalIds.includes(`societyer:generated-legal-document:${issuancePacket.generatedDocumentId}`));
assert.ok(linkedIssuance.sourceExternalIds.includes(`societyer:minute-book-item:${issuancePacket.minuteBookItemId}`));
assert.ok(linkedIssuance.sourceExternalIds.includes(`societyer:source-evidence:${issuancePacket.sourceEvidenceId}`));
assert.ok(issuancePacket.signerIds.length >= 1);
assert.ok(linkedIssuance.sourceExternalIds.includes(`societyer:legal-signer:${issuancePacket.signerIds[0]}`));

const engineWithIssuanceArtifacts = await client.query("legalOperations:templateEngine", { societyId: created.societyId });
const generatedShareDocument = engineWithIssuanceArtifacts.generatedDocuments.find((row: any) => row._id === issuancePacket.generatedDocumentId);
assert.equal(generatedShareDocument.draftDocumentId, issuancePacket.draftDocumentId);
assert.equal(generatedShareDocument.precedentRunId, issuancePacket.runId);
assert.ok(generatedShareDocument.sourceExternalIds.includes(`societyer:document-version:${issuancePacket.draftDocumentVersionId}`));
assert.ok(engineWithIssuanceArtifacts.signers.some((row: any) => row._id === issuancePacket.signerIds[0]));
const shareDocxVersion = await client.query("documentVersions:latest", { documentId: issuancePacket.draftDocumentId });
assert.equal(shareDocxVersion._id, issuancePacket.draftDocumentVersionId);
assert.equal(shareDocxVersion.storageProvider, "generated-inline");
assert.ok(shareDocxVersion.storageKey.startsWith("data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEsDB"));

const reseedResult = await client.mutation("legalOperations:seedCorporationDocumentPackets", {
  societyId: created.societyId,
});
assert.equal(reseedResult.updatedTemplates, CORPORATION_DOCUMENT_PACKETS.length);
assert.equal(reseedResult.updatedPrecedents, CORPORATION_DOCUMENT_PACKETS.length);
assert.equal((await client.query("legalOperations:templateEngine", { societyId: created.societyId })).templates.length, CORPORATION_DOCUMENT_PACKETS.length);

console.log("Corporation document packet checks passed.");
