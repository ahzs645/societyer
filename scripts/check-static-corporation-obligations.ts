import assert from "node:assert/strict";

import { StaticConvexClient } from "../src/lib/staticConvex";
import { complianceFactsForOrganization, computeComplianceObligations } from "../src/lib/compliance";

const client = new StaticConvexClient({
  databaseName: `societyer-static-corp-obligations-${Date.now()}`,
  seed: { societies: [] },
});

const created = await client.mutation("society:createWorkspace", {
  name: "Northstar Federal Holdings Inc.",
  incorporationNumber: "123456-7",
  incorporationDate: "2025-02-10",
  fiscalYearEnd: "12-31",
  jurisdictionCode: "CA-FED-CBCA",
  entityType: "corporation__business_",
  actFormedUnder: "canada_business_corporations_act",
});

assert.equal(created.taskIds.length, 5);

const tasks = await client.query("tasks:list", { societyId: created.societyId });
assert.ok(tasks.some((task: any) => task.title.includes("Corporations Canada")));
assert.equal(tasks.some((task: any) => task.description.includes("BC Registry")), false);

const [workspace] = await client.query("society:list", {});
assert.equal(workspace.jurisdictionCode, "CA-FED-CBCA");
assert.equal(workspace.homeJurisdictionCode, "CA-FED-CBCA");
assert.equal(workspace.entityType, "corporation__business_");
assert.equal(workspace.anniversaryDate, "2025-02-10");
assert.ok(workspace.primaryRegistrationId);

let detail = await client.query("organizationDetails:overview", { societyId: created.societyId });
assert.equal(detail.registrations.length, 1);
assert.equal(detail.registrations[0]._id, workspace.primaryRegistrationId);
assert.equal(detail.registrations[0].registrationType, "home");
assert.equal(detail.registrations[0].jurisdiction, "CA-FED-CBCA");

const ontarioRegistrationId = await client.mutation("organizationDetails:upsertRegistration", {
  societyId: created.societyId,
  registrationType: "extra_provincial",
  jurisdiction: "CA-ON-OBCA",
  homeJurisdiction: "CA-FED-CBCA",
  registrationNumber: "ON-9001",
  registrationDate: "2026-01-05",
  annualReturnDueDate: "2026-06-30",
  status: "active",
});
assert.ok(ontarioRegistrationId);

const bcRegistrationId = await client.mutation("organizationDetails:upsertRegistration", {
  societyId: created.societyId,
  registrationType: "extra_provincial",
  jurisdiction: "CA-BC",
  homeJurisdiction: "CA-FED-CBCA",
  registrationNumber: "A123456",
  registrationDate: "2025-04-01",
  annualReturnDueDate: "2026-04-30",
  status: "active",
});
assert.ok(bcRegistrationId);

detail = await client.query("organizationDetails:overview", { societyId: created.societyId });
assert.equal(detail.registrations.length, 3);
assert.ok(detail.registrations.some((row: any) => row.registrationType === "home"));
assert.equal(detail.registrations.filter((row: any) => row.registrationType === "extra_provincial").length, 2);

const obligations = computeComplianceObligations({
  jurisdictionCode: workspace.jurisdictionCode,
  entityType: workspace.entityType,
  asOfDate: "2026-06-04",
  incorporationDate: workspace.incorporationDate,
  anniversaryDate: workspace.incorporationDate,
  fiscalYearEnd: "2025-12-31",
});
const annualReturn = obligations.find((obligation) => obligation.creates?.filingKind === "FederalAnnualReturn");
assert.ok(annualReturn);

const allFacts = complianceFactsForOrganization(workspace, {
  asOfDate: "2026-02-01",
  registrations: detail.registrations,
});
const registrationObligations = allFacts.flatMap((facts) => computeComplianceObligations(facts));
assert.ok(
  registrationObligations.some((obligation) =>
    obligation.sourceRegistrationId === ontarioRegistrationId &&
    obligation.creates?.filingKind === "OntarioInitialReturn"
  ),
  "Static local corporation should compute Ontario registration obligations",
);
const bcRegistrationObligation = registrationObligations.find((obligation) =>
    obligation.sourceRegistrationId === bcRegistrationId &&
    obligation.creates?.filingKind === "BCExtraProvincialAnnualReport"
);
assert.ok(
  bcRegistrationObligation,
  "Static local corporation should compute BC extra-provincial registration obligations",
);

const filingId = await client.mutation("filings:create", {
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
assert.ok(filingId);
const [createdFiling] = (await client.query("filings:list", { societyId: created.societyId }))
  .filter((filing: any) => filing._id === filingId);
assert.equal(createdFiling.jurisdictionCode, "CA-FED-CBCA");
assert.equal(createdFiling.contextKind, "home");
assert.equal(createdFiling.sourceRegistrationId, undefined);

const bcRegistrationFilingId = await client.mutation("filings:create", {
  societyId: created.societyId,
  kind: bcRegistrationObligation.creates?.filingKind,
  jurisdictionCode: bcRegistrationObligation.jurisdictionCode,
  contextKind: bcRegistrationObligation.contextKind,
  sourceRegistrationId: bcRegistrationObligation.sourceRegistrationId,
  periodLabel: bcRegistrationObligation.title,
  dueDate: bcRegistrationObligation.dueDate,
  status: "Upcoming",
  submissionChecklist: bcRegistrationObligation.creates?.checklist,
});
const [bcRegistrationFiling] = (await client.query("filings:list", { societyId: created.societyId }))
  .filter((filing: any) => filing._id === bcRegistrationFilingId);
assert.equal(bcRegistrationFiling.jurisdictionCode, "CA-BC");
assert.equal(bcRegistrationFiling.contextKind, "extra_provincial");
assert.equal(bcRegistrationFiling.sourceRegistrationId, bcRegistrationId);

await client.mutation("complianceObligations:markReviewed", {
  societyId: created.societyId,
  ruleId: annualReturn.ruleId,
  flagLevel: "info",
  flagText: annualReturn.title,
  evidenceRequired: annualReturn.creates?.requiredEvidence ?? [],
  targetTable: "filings",
  targetId: filingId,
});

let decisions = await client.query("complianceObligations:listDecisions", { societyId: created.societyId });
assert.equal(decisions.length, 1);
assert.equal(decisions[0].status, "resolved");
assert.equal(decisions[0].targetId, filingId);

await client.mutation("complianceObligations:dismissDecision", {
  societyId: created.societyId,
  ruleId: annualReturn.ruleId,
  flagLevel: "info",
  flagText: annualReturn.title,
  evidenceRequired: annualReturn.creates?.requiredEvidence ?? [],
});
decisions = await client.query("complianceObligations:listDecisions", { societyId: created.societyId });
assert.equal(decisions[0].status, "dismissed");

await client.mutation("complianceObligations:reopenDecision", {
  societyId: created.societyId,
  ruleId: annualReturn.ruleId,
  flagLevel: "info",
  flagText: annualReturn.title,
  evidenceRequired: annualReturn.creates?.requiredEvidence ?? [],
});
decisions = await client.query("complianceObligations:listDecisions", { societyId: created.societyId });
assert.equal(decisions[0].status, "open");

console.log("Static corporation obligation checks passed.");
