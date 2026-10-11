import assert from "node:assert/strict";

import {
  getJurisdictionGuidePack,
  getPrivacyLegalGuideRules,
  formatGuideDateRange,
  getLegalGuideRules,
  JURISDICTION_GUIDE_PACKS,
  JURISDICTION_OPTIONS,
  resolveJurisdictionCode,
} from "../src/lib/jurisdictionGuideTracks";

for (const pack of JURISDICTION_GUIDE_PACKS) {
  assert.ok(pack.code, "pack code is required");
  assert.ok(pack.name, `${pack.code}: pack name is required`);
  assert.ok(pack.description, `${pack.code}: pack description is required`);
  assert.ok(pack.sources.length > 0, `${pack.code}: at least one source is required`);
  for (const source of pack.sources) {
    assert.ok(source.label, `${pack.code}: source label is required`);
    assert.match(source.url, /^https?:\/\//, `${pack.code}: source URL must be absolute`);
  }
  for (const rule of pack.rules) {
    assert.equal(rule.jurisdictionCode, pack.code, `${rule.id}: rule jurisdiction must match pack`);
    assert.ok(rule.id, `${pack.code}: rule id is required`);
    assert.ok(rule.statuteKey, `${rule.id}: statute key is required`);
    assert.ok(rule.citationLabel, `${rule.id}: citation label is required`);
    assert.ok(rule.sectionLabel, `${rule.id}: section label is required`);
    assert.ok(rule.summary, `${rule.id}: summary is required`);
    assert.ok(rule.tooltipText, `${rule.id}: tooltip text is required`);
    assert.ok(rule.topics.length > 0, `${rule.id}: at least one topic is required`);
    assert.match(rule.sourceUrl, /^https?:\/\//, `${rule.id}: source URL must be absolute`);
  }
}

const bc = getJurisdictionGuidePack("CA-BC");
assert.equal(bc.code, "CA-BC");
assert.ok(bc.rules.some((rule) => rule.instrument === "Societies Act"));

const federal = getJurisdictionGuidePack("CA-FED-CBCA");
assert.equal(federal.code, "CA-FED-CBCA");
assert.ok(federal.sources.some((source) => source.url.includes("laws-lois.justice.gc.ca")));
assert.ok(getLegalGuideRules({ jurisdictionCode: "CA-FED-CBCA", topics: ["records"] }).length > 0);
assert.ok(getLegalGuideRules({ jurisdictionCode: "CA-FED-CBCA", topics: ["special_resolution"] }).length > 0);

const ontario = getJurisdictionGuidePack("CA-ON-OBCA");
assert.equal(ontario.code, "CA-ON-OBCA");
assert.ok(ontario.sources.some((source) => source.url.includes("ontario.ca")));
assert.ok(getLegalGuideRules({ jurisdictionCode: "CA-ON-OBCA", topics: ["records"] }).length > 0);
assert.ok(getLegalGuideRules({ jurisdictionCode: "CA-ON-OBCA", topics: ["directors_quorum"] }).length > 0);

const unknown = getJurisdictionGuidePack("CA-XX-TEST");
assert.equal(unknown.code, "CA-XX-TEST");
assert.equal(unknown.rules.length, 0);
assert.notEqual(unknown.name, bc.name);
assert.deepEqual(getLegalGuideRules({ jurisdictionCode: "CA-XX-TEST" }), []);
assert.equal(resolveJurisdictionCode(null), "unknown");
assert.equal(resolveJurisdictionCode({ jurisdictionCode: "" }), "unknown");
assert.equal(resolveJurisdictionCode({ jurisdictionCode: "CA-FED-CBCA" }), "CA-FED-CBCA");

assert.ok(JURISDICTION_OPTIONS.some((option) => option.value === "CA-FED-CBCA"));
assert.ok(JURISDICTION_OPTIONS.some((option) => option.value === "CA-ON-OBCA"));

// A current-wording review is metadata, not a start date: earlier meetings keep
// guidance, and an unverified commencement is disclosed instead of hidden.
for (const code of ["CA-BC-BCA", "CA-FED-CBCA", "CA-ON-OBCA"]) {
  const current = getLegalGuideRules({ jurisdictionCode: code, dateISO: "2026-10-11", topics: ["records"] });
  assert.ok(current.length > 0);
  assert.ok(current.every((rule) => !!rule.currentAsOfISO && !rule.dateCaveatText), `${code}: review dates are kept and need no caveat on the review date`);
  const unverified = current.find((rule) => !rule.effectiveFromISO);
  assert.ok(unverified, `${code}: expected an unverified current rule`);
  assert.match(formatGuideDateRange(unverified), /reviewed.*commencement not verified/);
  const historical = getLegalGuideRules({ jurisdictionCode: code, dateISO: "2000-01-01", topics: ["records"] });
  assert.ok(historical.every((rule) => !/transparency|isc/.test(rule.id)), `${code}: no false historical application of modern transparency/ISC rules`);
}
const federalRecords = getLegalGuideRules({ jurisdictionCode: "CA-FED-CBCA", dateISO: "2026-10-11", topics: ["records"] });
assert.ok(federalRecords.some((rule) => rule.sourceCurrentToISO === "2026-09-21" && rule.currentAsOfISO === "2026-10-11"), "source currency and review dates remain separate");
assert.equal(getJurisdictionGuidePack(resolveJurisdictionCode({ jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__nfp_", actFormedUnder: "canada_not_for_profit_corporations_act" })).rules.length, 0);
// BC PIPA applies to every organization (s. 3(1)), so a BC-home workspace gets
// the presumed BC PIPA guides and nothing else; a recorded federal work removes them.
assert.deepEqual([...new Set(getPrivacyLegalGuideRules({ organization: { jurisdictionCode: "CA-BC", entityType: "society" } }).map((rule) => rule.statuteKey))], ["bc_pipa"], "BC-home privacy guides are limited to the presumed BC PIPA");
assert.deepEqual(getPrivacyLegalGuideRules({ organization: { jurisdictionCode: "CA-BC", entityType: "society", privacyFederalWork: "yes" } }), [], "a recorded federal work displaces the BC presumption");
assert.deepEqual(getPrivacyLegalGuideRules({ organization: { jurisdictionCode: "CA-ON-OBCA", entityType: "corporation__business_" } }), [], "privacy guides never infer activity from incorporation outside BC");
const bcHandling = { privacyOperatingJurisdictions: ["CA-BC"], privacyFederalWork: "no" as const, privacyCommercialActivity: "yes" as const, privacyCrossBorderCommercial: "yes" as const, privacySectorSpecific: "none" as const };
const privacy = getPrivacyLegalGuideRules({ organization: bcHandling });
assert.ok(privacy.some((rule) => rule.statuteKey === "bc_pipa"));
assert.ok(privacy.some((rule) => rule.statuteKey === "pipeda"));
assert.ok(privacy.every((rule) => rule.currentAsOfISO === "2026-10-11" && !rule.effectiveFromISO));
assert.equal(privacy.find((rule) => rule.id === "privacy-bc_pipa-breach")?.ruleKind, "policy_guidance", "BC recommended private breach practice is not presented as a general mandatory report");
assert.ok(!privacy.some((rule) => /C-36|CPPA/.test(rule.citationLabel)), "proposed reforms never become operative guides");

console.log("Jurisdiction guide track checks passed: correct Act, shared sources, historical boundaries, separate review and consolidation dates, activity-scoped privacy, recommendations and proposed-law exclusion.");
