import assert from "node:assert/strict";

import {
  buildWorkspaceOnboardingNodes,
  buildWorkspaceOnboardingTasks,
} from "../convex/society";

const bcTasks = buildWorkspaceOnboardingTasks({ jurisdictionCode: "CA-BC" });
assert.ok(bcTasks.some((task) => task.title.includes("BC Registry")));
assert.ok(bcTasks.some((task) => task.description.includes("BC Registry browser workspace")));

const federalTasks = buildWorkspaceOnboardingTasks({ jurisdictionCode: "CA-FED-CBCA" });
assert.ok(federalTasks.some((task) => task.title.includes("Corporations Canada")));
assert.equal(federalTasks.some((task) => task.description.includes("BC Registry")), false);

const ontarioTasks = buildWorkspaceOnboardingTasks({ jurisdictionCode: "CA-ON-OBCA" });
assert.ok(ontarioTasks.some((task) => task.title.includes("Ontario Business Registry")));
assert.equal(ontarioTasks.some((task) => task.description.includes("BC Registry")), false);

const unknownNodes = buildWorkspaceOnboardingNodes({ jurisdictionCode: "CA-XX-TEST" });
const registryNode = unknownNodes.find((node) => node.key === "registry_optional");
assert.equal(registryNode?.label, "Registry verification");
assert.equal(registryNode?.description.includes("BC Registry"), false);

const bcCompany = {
  jurisdictionCode: "CA-BC",
  entityType: "corporation__business_",
  actFormedUnder: "business_corporations_act__british_columbia_",
};
const companyTasks = buildWorkspaceOnboardingTasks(bcCompany);
assert.ok(companyTasks.some((task) => task.description.includes("Corporate Online")));
assert.equal(companyTasks.some((task) => /constitution|member register|Societies Online/.test(task.description)), false);
assert.ok(companyTasks.some((task) => task.description.includes("signed incorporation agreement")));
assert.ok(companyTasks.some((task) => task.description.includes("shareholders")));
const preparingTasks = buildWorkspaceOnboardingTasks({ ...bcCompany, organizationStatus: "pre_incorporation" });
assert.ok(preparingTasks.some((task) => task.tags.includes("formation")));
assert.ok(buildWorkspaceOnboardingNodes(bcCompany).some((node) => node.description.includes("securities register")));
console.log("Create workspace onboarding checks passed.");
