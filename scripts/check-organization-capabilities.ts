import assert from "node:assert/strict";
import { organizationCapabilities, type CapabilityOrganization } from "../shared/organizationCapabilities";

const society: CapabilityOrganization = {
  jurisdictionCode: "CA-BC", entityType: "society", actFormedUnder: "societies_act",
  legalSubtype: "ordinary_society", isMemberFunded: false, formationStatus: "preparing",
};
const company: CapabilityOrganization = {
  jurisdictionCode: "CA-BC", entityType: "corporation__business_", actFormedUnder: "business_corporations_act__british_columbia_",
  legalSubtype: "ordinary_private_company", formationStatus: "incorporated",
};

const societyCoverage = organizationCapabilities(society);
assert.equal(societyCoverage.governance.supported, true);
assert.equal(societyCoverage.preparation.supported, true);
assert.equal(societyCoverage.reviewRequired, false);
assert.ok(societyCoverage.features.some((feature) => feature.key === "members" && feature.to === "/app/members"));
assert.ok(!societyCoverage.features.some((feature) => feature.key === "shares"));
assert.ok(societyCoverage.governance.records.some((record) => record.key === "members"));
assert.ok(societyCoverage.nextSteps.some((step) => step.key === "prepare"));

const companyCoverage = organizationCapabilities(company);
assert.equal(companyCoverage.governance.profileId, "bc_company");
assert.equal(companyCoverage.preparation.supported, true);
assert.ok(companyCoverage.features.some((feature) => feature.key === "shares"));
assert.ok(!companyCoverage.features.some((feature) => feature.key === "members"));
assert.ok(companyCoverage.governance.records.some((record) => record.key === "securities_register"));
assert.ok(companyCoverage.nextSteps.some((step) => step.key === "annual"));

const federal = organizationCapabilities({ ...company, jurisdictionCode: "CA-FED-CBCA", actFormedUnder: "canada_business_corporations_act", legalSubtype: "federal_private_corporation" });
assert.equal(federal.governance.profileId, "federal_cbca");
assert.equal(federal.preparation.supported, true);

// A reviewed core must never imply an available incorporation packet.
const ontario = organizationCapabilities({ ...company, jurisdictionCode: "CA-ON-OBCA", actFormedUnder: "business_corporations_act__ontario_", legalSubtype: undefined });
assert.equal(ontario.governance.supported, true);
assert.equal(ontario.preparation.supported, false);
assert.equal(ontario.reviewRequired, true);
assert.deepEqual(ontario.preparation.reviewedDrafts, ["annual-resolutions"]);
assert.ok(ontario.nextSteps.some((step) => step.key === "review"));

const specialist = organizationCapabilities({ ...company, legalSubtype: "benefit_company" });
assert.equal(specialist.governance.supported, true);
assert.equal(specialist.preparation.supported, false);
assert.equal(specialist.reviewRequired, true);
for (const flag of ["distributing", "solicitingPublicBenefit"] as const) {
  const publicOrganization = organizationCapabilities({ ...company, [flag]: true });
  assert.equal(publicOrganization.preparation.supported, false);
  assert.equal(publicOrganization.reviewRequired, true);
}

for (const organization of [
  {},
  { ...society, jurisdictionCode: undefined },
  { ...society, jurisdictionCode: "unknown" },
  { ...society, actFormedUnder: undefined },
  { ...society, actFormedUnder: "   " },
  { ...company, jurisdictionCode: "US-CA" },
  { ...company, actFormedUnder: "another_act" },
  { ...company, actFormedUnder: "societies_act" },
  { ...company, entityType: "cooperative" },
  { jurisdictionCode: "CA-FED", entityType: "corporation__nfp_", actFormedUnder: "canada_not_for_profit_corporations_act" },
] satisfies CapabilityOrganization[]) {
  const unsupported = organizationCapabilities(organization);
  assert.equal(unsupported.governance.supported, false, JSON.stringify(organization));
  assert.equal(unsupported.preparation.supported, false, JSON.stringify(organization));
  assert.equal(unsupported.reviewRequired, true);
  assert.deepEqual(unsupported.governance.records, []);
  assert.ok(unsupported.nextSteps.some((step) => step.key === "identity"));
  assert.ok(!unsupported.nextSteps.some((step) => step.key === "prepare"));
}

assert.equal(organizationCapabilities({ ...society, actFormedUnder: "   " }).actLabel, "Not recorded");
assert.deepEqual(organizationCapabilities({ ...company, jurisdictionCode: "CA-ON-OBCA", actFormedUnder: undefined, legalSubtype: undefined }).preparation.reviewedDrafts, []);

const nonprofit = organizationCapabilities({ jurisdictionCode: "CA-FED", entityType: "corporation__nfp_", actFormedUnder: "canada_not_for_profit_corporations_act" });
assert.equal(nonprofit.entityLabel, "Nonprofit corporation");
assert.ok(!nonprofit.features.some((feature) => feature.key === "shares"));
assert.match(nonprofit.nextSteps.find((step) => step.key === "tax")!.detail, /separate decisions/);
const charityConflict = organizationCapabilities({ ...society, legalSubtype: "member_funded_society", isMemberFunded: true, isCharity: true });
assert.equal(charityConflict.preparation.supported, false);
assert.match(charityConflict.preparation.message, /cannot be a registered charity/);

console.log("Organization capability checks passed: Act coverage, preparation gates, entity features, review fallbacks and separate tax guidance.");
