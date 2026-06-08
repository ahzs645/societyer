import assert from "node:assert/strict";

import {
  POST_INCORPORATION_FLOWS,
  postIncorporationStepsForOrganization,
  postIncorporationStepsByCategory,
} from "../shared/postIncorporationSteps";
import {
  CORPORATION_DOCUMENT_PACKETS,
  corporationPacketForComplianceObligation,
} from "../shared/corporationDocumentPackets";
import { filingKindDefinitions } from "../shared/jurisdictionWorkspace";

// Validates the post-incorporation guided flow: ordering is sane, every step links to a real
// document packet and a real filing kind, the packet/obligation mappings agree, and the
// accessors return the right steps per organization. See shared/postIncorporationSteps.ts.

const packetKeys = new Set(CORPORATION_DOCUMENT_PACKETS.map((packet) => packet.key));
const problems: string[] = [];
const summary: string[] = [];

for (const flow of POST_INCORPORATION_FLOWS) {
  const filingKinds = new Set(filingKindDefinitions(flow.jurisdictionCode).map((definition) => definition.kind));
  const orders = flow.steps.map((step) => step.order);

  // Orders must be unique and contiguous 1..n.
  const expected = Array.from({ length: flow.steps.length }, (_, index) => index + 1);
  const actual = orders.slice().sort((a, b) => a - b);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    problems.push(`${flow.jurisdictionCode}: step orders must be unique and contiguous 1..${flow.steps.length}, got [${orders.join(", ")}]`);
  }

  const stepKeys = new Set<string>();
  for (const step of flow.steps) {
    const where = `${flow.jurisdictionCode}/${step.key}`;

    if (stepKeys.has(step.key)) problems.push(`${where}: duplicate step key`);
    stepKeys.add(step.key);

    // Authority must be complete and point at a real https government page.
    if (!step.authority.body.trim()) problems.push(`${where}: missing authority.body`);
    if (!step.authority.citation.trim()) problems.push(`${where}: missing authority.citation`);
    if (!/^https:\/\/\S+$/.test(step.authority.officialUrl)) {
      problems.push(`${where}: authority.officialUrl must be an https URL, got "${step.authority.officialUrl}"`);
    }

    // appliesTo sanity.
    if (!step.appliesTo.entityTypes.length) problems.push(`${where}: appliesTo.entityTypes is empty`);
    if (step.appliesTo.homeJurisdictionCodes && !step.appliesTo.homeJurisdictionCodes.includes(flow.jurisdictionCode)) {
      problems.push(`${where}: appliesTo.homeJurisdictionCodes does not include the flow jurisdiction ${flow.jurisdictionCode}`);
    }

    // Linked packet must exist.
    if (step.packetKey && !packetKeys.has(step.packetKey)) {
      problems.push(`${where}: packetKey "${step.packetKey}" does not exist in CORPORATION_DOCUMENT_PACKETS`);
    }

    // Linked filing kind must be defined for the jurisdiction.
    const filingKind = step.obligation?.filingKind;
    if (filingKind && !filingKinds.has(filingKind)) {
      problems.push(`${where}: obligation.filingKind "${filingKind}" is not a filing kind for ${flow.jurisdictionCode}`);
    }

    // Where the obligation→packet mapper resolves a packet, it must agree with packetKey (catch drift).
    if (filingKind && step.packetKey) {
      const mapped = corporationPacketForComplianceObligation({ filingKind });
      if (mapped && mapped.key !== step.packetKey) {
        problems.push(`${where}: packetKey "${step.packetKey}" disagrees with obligation mapper "${mapped.key}" for filingKind ${filingKind}`);
      }
    }
  }

  const oneTime = flow.steps.filter((step) => step.cadence === "one_time").length;
  const recurring = flow.steps.filter((step) => step.cadence === "recurring").length;
  const eventDriven = flow.steps.filter((step) => step.cadence === "event_driven").length;
  summary.push(
    `  ${flow.jurisdictionCode}: ${flow.steps.length} steps (one_time=${oneTime} recurring=${recurring} event_driven=${eventDriven}) · status=${flow.status}`,
  );
}

// The federal base flow must keep covering the core ISED next-steps.
const federalSteps = postIncorporationStepsForOrganization({
  homeJurisdictionCode: "CA-FED-CBCA",
  entityType: "corporation__business_",
});
const federalKeys = new Set(federalSteps.map((step) => step.key));
for (const required of [
  "appoint-first-directors",
  "make-bylaws",
  "issue-shares",
  "appoint-officers",
  "hold-first-shareholders-meeting",
  "set-up-minute-book",
  "file-annual-return",
  "file-isc-information",
]) {
  if (!federalKeys.has(required)) problems.push(`federal flow is missing required step "${required}"`);
}

// Accessors: federal corp gets ordered steps; a BC society gets none.
assert.ok(federalSteps.length > 0, "federal corporation should have post-incorporation steps");
for (let i = 1; i < federalSteps.length; i += 1) {
  assert.ok(federalSteps[i].order > federalSteps[i - 1].order, "steps must come back in ascending order");
}
const bcSocietySteps = postIncorporationStepsForOrganization({ jurisdictionCode: "CA-BC", entityType: "society" });
assert.equal(bcSocietySteps.length, 0, "BC society should have no federal post-incorporation steps");

const grouped = postIncorporationStepsByCategory({
  homeJurisdictionCode: "CA-FED-CBCA",
  entityType: "corporation__business_",
});
assert.equal(
  grouped.organize.length + grouped.registration.length + grouped.good_standing.length,
  federalSteps.length,
  "grouping by category must preserve every step",
);

console.log(`Checked ${POST_INCORPORATION_FLOWS.length} post-incorporation flow(s):`);
for (const line of summary) console.log(line);

if (problems.length > 0) {
  console.error("\nPost-incorporation step checks FAILED:");
  for (const problem of problems) console.error(`  ✗ ${problem}`);
}

assert.equal(problems.length, 0, `${problems.length} post-incorporation step problem(s)`);
console.log("\nPost-incorporation step checks passed.");
