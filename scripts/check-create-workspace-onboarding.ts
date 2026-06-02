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

console.log("Create workspace onboarding checks passed.");
