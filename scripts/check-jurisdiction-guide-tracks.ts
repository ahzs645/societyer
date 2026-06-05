import assert from "node:assert/strict";

import {
  getJurisdictionGuidePack,
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
assert.ok(bc.rules.some((rule) => rule.citationLabel.includes("BC Societies Act")));

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

console.log("Jurisdiction guide track checks passed.");
