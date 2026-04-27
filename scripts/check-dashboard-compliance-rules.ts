import assert from "node:assert/strict";
import {
  bcSocietiesDashboardComplianceRulePack,
  evaluateDashboardComplianceRules,
} from "../convex/lib/dashboardComplianceRules";

let fixtureCount = 0;

for (const rule of bcSocietiesDashboardComplianceRulePack.rules) {
  assert.ok(rule.id, "rule id is required");
  assert.ok(rule.jurisdiction, `${rule.id} jurisdiction is required`);
  assert.ok(rule.societyType, `${rule.id} society type is required`);
  assert.ok(rule.effectiveDate, `${rule.id} effective date is required`);
  assert.ok(rule.ruleText, `${rule.id} rule text is required`);
  assert.ok(rule.citation, `${rule.id} citation is required`);
  assert.ok(rule.evidenceRequired.length > 0, `${rule.id} evidence is required`);
  assert.ok(rule.fixtures.length > 0, `${rule.id} needs at least one fixture`);

  for (const fixture of rule.fixtures) {
    fixtureCount += 1;
    const result = rule.passFail(fixture.context);
    assert.equal(
      result?.level ?? null,
      fixture.expectedLevel,
      `${rule.id}: ${fixture.name}`,
    );
    if (result) {
      assert.equal(result.ruleId, rule.id, `${rule.id}: fixture result should carry rule id`);
      assert.deepEqual(
        result.evidenceRequired,
        rule.evidenceRequired,
        `${rule.id}: fixture result should carry evidence requirements`,
      );
    }
  }
}

const okFlags = evaluateDashboardComplianceRules({
  society: {
    isMemberFunded: false,
    privacyPolicyDocId: "doc_privacy",
    privacyProgramStatus: "Documented",
    memberDataAccessStatus: "Society-controlled",
    memberDataGapDocumented: true,
    constitutionDocId: "doc_constitution",
    bylawsDocId: "doc_bylaws",
  },
  activeDirectors: [
    { consentOnFile: true, isBCResident: true },
    { consentOnFile: true, isBCResident: false },
    { consentOnFile: true, isBCResident: false },
  ],
  rulesConfigured: true,
});

assert.equal(okFlags.length, 1);
assert.equal(okFlags[0].level, "ok");

console.log(
  `Checked ${bcSocietiesDashboardComplianceRulePack.rules.length} dashboard compliance rules and ${fixtureCount} fixtures.`,
);
