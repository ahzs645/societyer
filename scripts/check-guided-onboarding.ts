import assert from "node:assert/strict";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { readOnboardingAnswersJson, validateInitialOrganizationProfile } from "../shared/onboarding";
import { validateSetupBackup } from "../shared/onboardingBackup";
import { getPathway } from "../shared/pathways/registry";
import { workspaceOnboardingWorkflowConfig } from "../shared/jurisdictionWorkspace";
import { validateWorkspaceLegalIdentity } from "../shared/organizationDomain";

const answers = {
  version: 1, previousUse: "returning", organizationStage: "existing", pathwayKey: "bc_company",
  governanceStructure: "multiple_classes", classDetails: "Class A voting common shares", governanceDocuments: "available",
  peopleReadiness: "ready_to_add", operatingRegions: "British Columbia and Alberta",
};
const pathway = getPathway("bc_company")!;
const organization = {
  name: "Guided Setup Existing Company Inc.", jurisdictionCode: pathway.setup.jurisdictionCode,
  entityType: pathway.setup.entityType, actFormedUnder: pathway.setup.actFormedUnder,
  formationStatus: "unverified_existing", organizationStatus: "active", legalSubtype: "ordinary_private_company",
  registeredOfficeAddress: "123 Example Road\nVictoria, British Columbia, V1V 1V1\nCanada",
  mailingAddress: "123 Example Road\nVictoria, British Columbia, V1V 1V1\nCanada", fiscalYearEnd: "12-31",
  incorporationNumber: "BC1234567", incorporationDate: "2023-05-10", officialEmail: "records@example.test",
  onboardingAnswersJson: JSON.stringify(answers),
};
assert.deepEqual(readOnboardingAnswersJson(organization.onboardingAnswersJson, organization), answers);
assert.throws(() => readOnboardingAnswersJson(JSON.stringify({ ...answers, authSubject: "forged" }), organization), /Unknown/);
assert.throws(() => readOnboardingAnswersJson(JSON.stringify({ ...answers, pathwayKey: "federal_cbca" }), organization), /disagree/);
assert.throws(() => readOnboardingAnswersJson(organization.onboardingAnswersJson, { ...organization, formationStatus: "incorporated" }), /certificate verification/);
assert.throws(() => readOnboardingAnswersJson(JSON.stringify({ ...answers, classDetails: "x".repeat(2001) }), organization), /classDetails/);
assert.throws(() => readOnboardingAnswersJson(JSON.stringify({ ...answers, version: 2 }), organization), /version/);
assert.throws(() => validateInitialOrganizationProfile({ name: "Company", fiscalYearEnd: "02-30" }), /valid MM-DD/);
assert.throws(() => validateInitialOrganizationProfile({ name: "Company", fiscalYearEnd: "13-31" }), /valid MM-DD/);
assert.throws(() => validateInitialOrganizationProfile({ name: "Company", incorporationDate: "2023-02-29" }), /Incorporation date/);
validateInitialOrganizationProfile({ name: "Company", fiscalYearEnd: "02-29" });
assert.equal(workspaceOnboardingWorkflowConfig(organization).formationStage, "unverified_existing");

const client = new StaticConvexClient({ databaseName: `guided-onboarding-${Date.now()}`, seed: { societies: [] } });
const result = await client.mutation("society:createWorkspace", organization) as any;
const snapshot = client.exportLocalWorkspaceSnapshot();
const saved = snapshot.tables.societies.find((row: any) => row._id === result.societyId)!;
assert.equal(saved.onboardingAnswersJson, organization.onboardingAnswersJson);
assert.equal(saved.registeredOfficeAddress, organization.registeredOfficeAddress);
assert.equal(saved.certificateEvidenceDocumentId, undefined);
assert.ok(snapshot.tables.tasks.some((task: any) => task.description.includes(answers.classDetails)));
assert.equal(snapshot.tables.workflows[0].config.initialSetupAnswers.governanceStructure, "multiple_classes");
assert.equal((snapshot.tables.rightsholdingTransfers ?? []).length, 0);
assert.equal((snapshot.tables.roleHolders ?? []).length, 0);
validateSetupBackup(snapshot);
const before = snapshot.tables.societies.length;
await assert.rejects(() => client.mutation("society:createWorkspace", { ...organization, formationStatus: "incorporated" }), /certificate verification/);
assert.equal(client.exportLocalWorkspaceSnapshot().tables.societies.length, before);

const manual = { ...organization, name: "Existing Alberta Society", jurisdictionCode: "alberta", entityType: "society", actFormedUnder: "societies_act__alberta_", legalSubtype: "other", onboardingAnswersJson: JSON.stringify({ ...answers, pathwayKey: "custom_existing", governanceStructure: "single_class" }) };
validateWorkspaceLegalIdentity(manual);
assert.equal(readOnboardingAnswersJson(manual.onboardingAnswersJson, manual)?.pathwayKey, "custom_existing");
const manualCreated = await client.mutation("society:createWorkspace", manual) as any;
assert.equal(client.exportLocalWorkspaceSnapshot().tables.societies.find((row: any) => row._id === manualCreated.societyId)?.actFormedUnder, "societies_act__alberta_");
await assert.rejects(() => client.mutation("society:createWorkspace", { ...manual, formationStatus: "preparing", organizationStatus: "pre_incorporation", incorporationNumber: "", incorporationDate: "", onboardingAnswersJson: JSON.stringify({ ...answers, pathwayKey: "custom_existing", organizationStage: "preparing" }) }), /registered setup pathway/);

for (const invalid of [
  { tables: [] }, { tables: { societies: [{ _id: "a", name: "A" }, { _id: "a", name: "B" }] } },
  { tables: { societies: [] } }, { tables: { societies: [{ _id: "a", name: "A" }] }, attachments: [{ key: "x", provider: "local", storageKey: "ref", fileSizeBytes: -1 }] },
  { kind: "unrelated", tables: snapshot.tables },
]) assert.throws(() => validateSetupBackup(invalid));
const restored = new StaticConvexClient({ databaseName: `guided-restored-${Date.now()}`, seed: { societies: [] } });
await restored.importLocalWorkspaceSnapshot(snapshot);
assert.equal(restored.exportLocalWorkspaceSnapshot().tables.societies[0].onboardingAnswersJson, organization.onboardingAnswersJson);
console.log("Guided onboarding: persisted native-compatible setup, legal boundaries, invalid-answer atomicity and bounded backup validation checks passed.");
