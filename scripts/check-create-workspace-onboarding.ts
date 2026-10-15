import assert from "node:assert/strict";

import {
  buildWorkspaceOnboardingNodes,
  buildWorkspaceOnboardingTasks,
} from "../convex/society";
import { evaluateOrganizationSetup, emptyOrganizationSetupFacts } from "../shared/organizationSetup/evaluate";

// New workspaces get ONE task that points at the setup page; the step list
// itself (and its registry wording) lives in the setup catalogue.
for (const jurisdictionCode of ["CA-BC", "CA-FED-CBCA", "CA-ON-OBCA"]) {
  const tasks = buildWorkspaceOnboardingTasks({ name: "Example Org", jurisdictionCode });
  assert.equal(tasks.length, 1, `${jurisdictionCode}: one setup task`);
  assert.equal(tasks[0].title, "Finish setting up Example Org");
  assert.ok(tasks[0].description.includes("/app/organization-setup"));
  assert.ok(tasks[0].tags.includes("organization-setup"));
}

// A pre-incorporation workspace is never told its incorporation number or date is missing.
const cbcaPreparing = {
  name: "Northstar Corp.", jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__business_",
  actFormedUnder: "canada_business_corporations_act", organizationStatus: "pre_incorporation", formationStatus: "preparing",
};
const [preparingTask] = buildWorkspaceOnboardingTasks(cbcaPreparing);
assert.doesNotMatch(preparingTask.description, /Missing profile fields|incorporation number|incorporation date/);
assert.ok(preparingTask.tags.includes("formation"));
assert.equal(preparingTask.priority, "Medium");

// Saved answers appear in plain language, never as raw option values.
const answers = {
  version: 1, previousUse: "new", organizationStage: "preparing", pathwayKey: "federal_cbca", incorporationActId: "ca-cbca",
  governanceStructure: "needs_review", classDetails: "", governanceDocuments: "need_to_prepare", peopleReadiness: "add_later", operatingRegions: "",
};
const [withAnswers] = buildWorkspaceOnboardingTasks({ ...cbcaPreparing, legalSubtype: "federal_private_corporation", onboardingAnswersJson: JSON.stringify(answers) });
assert.ok(withAnswers.description.includes("Share classes: not decided yet"));
assert.doesNotMatch(withAnswers.description, /classification needs review|needs review|add later|needs_review|add_later/);

// Registry wording moved from the old tasks to the setup catalogue.
const registryPhase = (organization: Record<string, any>) =>
  evaluateOrganizationSetup(emptyOrganizationSetupFacts(organization)).phases.find((phase) => phase.key === "file")!.title;
assert.equal(registryPhase(cbcaPreparing), "File with Corporations Canada");
const bcCompany = {
  jurisdictionCode: "CA-BC",
  entityType: "corporation__business_",
  actFormedUnder: "business_corporations_act__british_columbia_",
};
assert.equal(registryPhase({ ...bcCompany, formationStatus: "preparing" }), "File with BC Registries");
assert.equal(registryPhase({ jurisdictionCode: "CA-BC", entityType: "society", actFormedUnder: "societies_act", formationStatus: "preparing" }), "Apply to BC Registries");
assert.equal(registryPhase({ jurisdictionCode: "CA-ON-OBCA", entityType: "corporation__business_", actFormedUnder: "business_corporations_act__ontario_", formationStatus: "preparing" }), "File with the Ontario Business Registry");

// The workflow record is still written for existing code; its nodes keep jurisdiction wording.
const unknownNodes = buildWorkspaceOnboardingNodes({ jurisdictionCode: "CA-XX-TEST" });
const registryNode = unknownNodes.find((node) => node.key === "registry_optional");
assert.equal(registryNode?.label, "Registry verification");
assert.equal(registryNode?.description.includes("BC Registry"), false);
assert.ok(buildWorkspaceOnboardingNodes(bcCompany).some((node) => node.description.includes("securities register")));
assert.ok(buildWorkspaceOnboardingNodes({ jurisdictionCode: "CA-FED-CBCA" }).some((node) => node.label.includes("Corporations Canada")));
console.log("Create workspace onboarding checks passed.");
