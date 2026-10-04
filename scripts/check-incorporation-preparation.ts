import { verifyFixtureFormation } from "./helpers/verifiedFormation";
import { complianceFactsForOrganization, computeComplianceObligations } from "../src/lib/compliance";
import assert from "node:assert/strict";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { SOCIETY_DOCUMENT_PACKETS } from "../shared/societyDocumentPackets";
import { CORPORATION_DOCUMENT_PACKETS } from "../shared/corporationDocumentPackets";
import { corporationPacketDocxBytes } from "../shared/corporationPacketDocx";
import { buildRenderContext } from "../shared/renderContext";
import { entitySetupFields, validateEntitySetup } from "../shared/entitySetup";

const client = new StaticConvexClient({ databaseName: `societyer-preparation-${Date.now()}`, seed: { societies: [] } });
const society = await client.mutation("society:createWorkspace", { name: "Cedar Learning Society", purposes: "To advance education through public workshops.", jurisdictionCode: "CA-BC", entityType: "society", actFormedUnder: "societies_act", legalSubtype: "ordinary_society", charityStatus: "application_pending", annualMeetingDate: "2026-04-10", annualMeetingYear: 2026, agmExtensionDate: "2026-06-30", agmExtensionEvidence: "Registrar approval EXT-1" });
const constitution = SOCIETY_DOCUMENT_PACKETS.find((packet) => packet.key === "society-incorporation-constitution")!;
const context = buildRenderContext({ org: { name: "Cedar Learning Society", entityType: "society", actFormedUnder: "societies_act", purposes: "To advance education through public workshops." }, asOf: "2026-10-03" });
const docx = new TextDecoder().decode(corporationPacketDocxBytes(constitution, { ...context, execution: { adoptionClause: "FAKE ADOPTION MUST NOT APPEAR", lines: ["FAKE SIGNATURE"] } } as any));
assert.ok(docx.includes("To advance education through public workshops."));
assert.ok(!docx.includes("FAKE ADOPTION"));
assert.ok(!docx.includes("FAKE SIGNATURE"));
const generation = await client.mutation("legalOperations:generateDocumentFromCatalog", { societyId: society.societyId, packetKey: constitution.key });
const doc = (await client.query("documents:list", { societyId: society.societyId })).find((row: any) => row._id === generation.draftDocumentId);
const snapshot = JSON.parse(doc.sourcePayloadJson).templateProvenance;
assert.equal(snapshot.templateSnapshot.preparationOnly, true);
assert.equal(snapshot.documentState, "draft");
assert.ok(snapshot.templateSnapshot.sourceUrls.length > 0);
assert.equal(snapshot.filingEvidence, null);
const profile = await client.query("society:getById", { id: society.societyId });
assert.equal(profile.charityStatus, "application_pending");
assert.equal(profile.isCharity, false);
assert.equal(profile.annualMeetingYear, 2026);
assert.equal(profile.agmExtensionEvidence, "Registrar approval EXT-1");
const bc = await client.mutation("society:createWorkspace", { name: "Cedar Holdings Ltd.", jurisdictionCode: "CA-BC", entityType: "corporation__business_", actFormedUnder: "business_corporations_act", legalSubtype: "ordinary_private_company", incorporationDate: "2026-01-15", annualReferenceDate: "2026-06-30", craBnStatus: "confirmed", craRcStatus: "confirmed", gstHstStatus: "pending", taxStatusEvidence: "CRA receipt BN-1" });
for (const packetKey of ["bc-incorporation-agreement", "bc-articles-preparation"]) {
  const generated = await client.mutation("legalOperations:generateDocumentFromCatalog", { societyId: bc.societyId, packetKey });
  assert.ok(generated.draftDocumentId);
}
const bcProfile = await client.query("society:getById", { id: bc.societyId });
assert.equal(bcProfile.annualReferenceDate, "2026-06-30");
assert.equal(bcProfile.incorporationDate, "2026-01-15");
assert.equal(bcProfile.gstHstStatus, "pending");
const federated = await client.mutation("society:createWorkspace", { name: "Cedar Federal Inc.", jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__business_", actFormedUnder: "canada_business_corporations_act" });
assert.ok((await client.mutation("legalOperations:generateDocumentFromCatalog", { societyId: federated.societyId, packetKey: "federal-articles-preparation" })).draftDocumentId);
const registration = await client.mutation("organizationDetails:upsertRegistration", { societyId: federated.societyId, jurisdiction: "CA-BC", registrationType: "extra_provincial", registrationDate: "2026-05-01", activityCommencementDate: "2026-03-01", status: "active" });
const registrations = (await client.query("organizationDetails:overview", { societyId: federated.societyId })).registrations;
assert.equal(registrations.find((row: any) => row._id === registration).activityCommencementDate, "2026-03-01");
await assert.rejects(client.mutation("organizationDetails:upsertRegistration", { societyId: federated.societyId, jurisdiction: "CA-ON-OBCA", registrationType: "extra_provincial", corporationClass: "foreign_epca_licensed", status: "active" }), /licence evidence/);
assert.throws(() => validateEntitySetup({ legalSubtype: "member_funded_society", isCharity: true }), /cannot be a registered charity/);
assert.throws(() => validateEntitySetup({ annualMeetingDate: "2026-02-30" }), /valid YYYY-MM-DD/);
assert.equal(entitySetupFields({ craRcStatus: "pending" }).craRcStatus, "pending");
assert.equal(CORPORATION_DOCUMENT_PACKETS.find((packet) => packet.key === "federal-articles-preparation")?.preparationOnly, true);
console.log("Incorporation preparation, evidence provenance and separate entity anchors passed.");
import { incorporationPreparationForOrganization } from "../shared/incorporationPreparation";
import { incorporationWorksheetFileName, incorporationWorksheetText } from "../shared/incorporationWorksheet";

// The same provincial code must never leak society instructions into a company.
assert.equal(incorporationPreparationForOrganization({
  jurisdictionCode: "CA-BC", entityType: "society", actFormedUnder: "societies_act",
})?.id, "bc_society");
assert.equal(incorporationPreparationForOrganization({
  jurisdictionCode: "british_columbia", entityType: "corporation__business_",
  actFormedUnder: "business_corporations_act__british_columbia_",
})?.id, "bc_company");
assert.equal(incorporationPreparationForOrganization({
  jurisdiction: "federal__canada_", entityType: "corporation__business_",
  actFormedUnder: "canada_business_corporations_act",
})?.id, "federal_cbca");

// Unsupported provincial / nonprofit paths and inconsistent profiles do not fall back.
for (const organization of [
  undefined,
  { jurisdictionCode: "CA-BC", entityType: "corporation__business_", actFormedUnder: "societies_act" },
  { jurisdictionCode: "CA-BC", entityType: "society", actFormedUnder: "business_corporations_act__british_columbia_" },
  { jurisdictionCode: "CA-FED-CBCA", entityType: "society" },
  { jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__not_for_profit_" },
  { jurisdictionCode: "CA-ON-OBCA", entityType: "corporation__business_" },
  { entityType: "corporation__business_" },
]) assert.equal(incorporationPreparationForOrganization(organization), undefined);

// Downloaded preparation retains the selected track, provenance, and limits even
// when the worksheet is shared outside the app.
for (const [entityType, jurisdictionCode, expectedId, expectedRequirement] of [
  ["society", "CA-BC", "bc_society", "Prepare the constitution"],
  ["corporation__business_", "CA-BC", "bc_company", "Prepare and sign the incorporation agreement"],
  ["corporation__business_", "CA-FED-CBCA", "federal_cbca", "Prepare the articles of incorporation"],
]) {
  const organization = { name: "Example / Planning Company", entityType, jurisdictionCode };
  const guide = incorporationPreparationForOrganization(organization);
  assert.ok(guide);
  assert.equal(guide.id, expectedId);
  const worksheet = incorporationWorksheetText(guide, organization);
  assert.ok(worksheet.includes(expectedRequirement));
  assert.ok(worksheet.includes("does not incorporate an entity"));
  assert.ok(worksheet.includes("Verify current registry channels, fees, forms, and mail availability"));
  assert.ok(worksheet.includes("repository evidence dated"));
  assert.ok(worksheet.includes(guide.filingChannel.onlineUrl));
  const filename = incorporationWorksheetFileName(guide, organization);
  assert.ok(filename.endsWith(`${expectedId}-incorporation-preparation.txt`));
  assert.ok(!filename.includes("/"), "workspace names cannot add directories to a worksheet filename");
}

console.log("Incorporation preparation: entity/act discrimination, jurisdiction aliases, and unsupported paths passed.");


// Workspace lifecycle and legal formation are independent; planned dates do not activate duties.
assert.equal(profile.formationStatus, "preparing");
const dutyProfile = await client.query("society:getById", { id: bc.societyId });
assert.equal(complianceFactsForOrganization(dutyProfile, { asOfDate: "2026-10-03" }).flatMap(computeComplianceObligations).length, 0);
const baseVerification = { id: society.societyId, name: profile.name, isCharity: false, isMemberFunded: false, formationStatus: "incorporated", certificateReference: "OFFICIAL-CERT-1", certificateDate: "2026-02-01" };
await assert.rejects(client.mutation("society:upsert", baseVerification), /uploaded certificate/);
await assert.rejects(client.mutation("society:upsert", { ...baseVerification, certificateEvidenceDocumentId: generation.draftDocumentId }), /generated draft/);
const urlOnly = await client.mutation("documents:create", { societyId: society.societyId, title: "Certificate reference only", category: "governance", url: "https://example.org/certificate.pdf", tags: [] });
await assert.rejects(client.mutation("society:upsert", { ...baseVerification, certificateEvidenceDocumentId: urlOnly }), /uploaded file/);
const foreignCertificate = await verifyFixtureFormation(client, bc.societyId, "2026-02-01");
assert.equal((await client.query("society:getById", { id: bc.societyId })).anniversaryDate, "2026-02-01", "Actual certificate date replaces the copied planned anniversary");
await assert.rejects(client.mutation("society:upsert", { ...baseVerification, certificateEvidenceDocumentId: foreignCertificate }), /not found/);
const uploadedCertificate = await verifyFixtureFormation(client, society.societyId, "2026-02-01");
const verifiedProfile = await client.query("society:getById", { id: society.societyId });
assert.equal(verifiedProfile.formationStatus, "incorporated");
assert.equal(verifiedProfile.incorporationDate, "2026-02-01");
assert.equal(verifiedProfile.certificateEvidenceDocumentId, uploadedCertificate);
assert.equal(verifiedProfile.organizationStatus, "active");
await client.mutation("society:upsert", { id: federated.societyId, name: "Cedar Federal Inc.", isCharity: false, isMemberFunded: false, formationStatus: "submitted", incorporationDate: "2026-01-01" });
const submittedProfile = await client.query("society:getById", { id: federated.societyId });
assert.equal(complianceFactsForOrganization(submittedProfile, { asOfDate: "2026-10-03" }).flatMap(computeComplianceObligations).length, 0);
console.log("Formation certificate ownership, uploaded-file evidence and pending-duty gates passed.");
