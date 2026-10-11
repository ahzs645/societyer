import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { governancePageGuidance, type GovernanceGuidanceTopic } from "../src/lib/governancePageGuidance";
import { LegalGovernanceGuidance } from "../src/components/LegalGovernanceGuidance";
import { LegalRecordsRequirements } from "../src/components/LegalRecordsRequirements";
import { citationAppliesToOrganization, getRegulatoryCitation, regulatoryCitations } from "../src/lib/regulatoryCitations";
import { hasRecordedEntityType, legalGovernanceProfile } from "../shared/legalGovernanceProfiles";
import { organizationRuleScope } from "../shared/entityRuleScope";
import { legalCopyForOrganization, RECORDS_INSPECTION_GUIDANCE } from "../src/lib/legalCopy";
import { JURISDICTION_GUIDE_PACK_JSON } from "../src/lib/jurisdictionGuidePackRegistry";
import { jurisdictionGuidePackSchema } from "../src/lib/jurisdictionGuideSchema";
import { LEGAL_SOURCES } from "../shared/legalSources";
import { dashboardComplianceRulePackForOrganization } from "../shared/dashboardComplianceRules";
import { directorComplianceProfile } from "../shared/directorCompliance";
import { getLegalGuideRules, getPrivacyLegalGuideRules, resolveJurisdictionCode, type LegalGuideRule } from "../src/lib/jurisdictionGuideTracks";

const society = { entityType: "society", jurisdictionCode: "CA-BC", actFormedUnder: "societies_act" };
const bc = { entityType: "corporation__business_", jurisdictionCode: "CA-BC", actFormedUnder: "business_corporations_act" };
const federal = { ...bc, jurisdictionCode: "CA-FED-CBCA", actFormedUnder: "canada_business_corporations_act" };
const ontario = { ...bc, jurisdictionCode: "CA-ON-OBCA", actFormedUnder: "business_corporations_act__ontario_" };
const unsupported = [
  { ...federal, entityType: "corporation__nfp_", actFormedUnder: "canada_not_for_profit_corporations_act" },
  { ...ontario, entityType: "corporation__nfp_", actFormedUnder: "not_for_profit_corporations_act_2010__ontario_" },
  { ...bc, entityType: "cooperative", actFormedUnder: "cooperative_association_act" },
];
const topics: GovernanceGuidanceTopic[] = ["conflicts", "auditors", "court_orders", "qualifications"];

// This test checks visible text, not hydration or tooltip placement. React's
// expected layout-effect warning does not apply to this static render; retain
// every other warning or error emitted by the components under test.
function renderMarkup(element: Parameters<typeof renderToStaticMarkup>[0]) {
  const logError = console.error;
  console.error = (message, ...args) => {
    if (typeof message === "string" && message.startsWith("Warning: useLayoutEffect does nothing on the server")) return;
    logError(message, ...args);
  };
  try { return renderToStaticMarkup(element); } finally { console.error = logError; }
}

// Test the actual rendered guidance, as well as the source selectors, across
// reviewed profiles and explicit entities for which no profile has been reviewed.
for (const organization of [society, bc, federal, ontario]) {
  for (const topic of topics) {
    const { sources, profile } = governancePageGuidance(organization, topic);
    assert.ok(sources.length, `${profile?.id}: ${topic} guidance is present`);
    for (const source of sources) {
      assert.ok(citationAppliesToOrganization(source.id, organization), source.id);
      assert.notEqual(source.status, "proposed", `${source.id}: not operative`);
    }
    const html = renderMarkup(createElement(LegalGovernanceGuidance, { organization, topic }));
    assert.match(html, /<section/);
    if (organization !== society) assert.doesNotMatch(html, /Societies Act|BC-SOC-/);
    if (topic === "qualifications") assert.match(html, /annual attestation is an optional governance practice/);
  }
  const profile = legalGovernanceProfile(organization)!;
  for (const record of profile.records) {
    for (const sourceId of record.sourceIds) assert.ok(citationAppliesToOrganization(sourceId, organization), `${profile.id}: ${record.key} source ${sourceId}`);
  }
  const recordsHtml = renderMarkup(createElement(LegalRecordsRequirements, { organization, inspection: true }));
  if (organization !== society) assert.doesNotMatch(recordsHtml, /Societies Act|BC-SOC-/);
}
for (const organization of unsupported) {
  for (const topic of topics) {
    assert.deepEqual(governancePageGuidance(organization, topic).sources, []);
    const html = renderMarkup(createElement(LegalGovernanceGuidance, { organization, topic }));
    assert.match(html, /does not yet have a reviewed legal profile/);
    assert.doesNotMatch(html, /Societies Act|Canada Business Corporations Act|Business Corporations Act \(Ontario\)/);
  }
  assert.equal(directorComplianceProfile(organization).minimumActiveDirectors, undefined);
  assert.equal(getLegalGuideRules({ jurisdictionCode: resolveJurisdictionCode(organization), dateISO: "2026-10-11" }).length, 0);
}

// The BC society audit rule is conditional; director and senior-manager
// conflicts have distinct sources. Do not import one statute's exceptions.
assert.match(getRegulatoryCitation("BC-SOC-AUDITOR")!.quote, /bylaws or (the )?regulations/);
assert.match(getRegulatoryCitation("BC-SOC-AUDITOR")!.quote, /optional/);
assert.deepEqual(governancePageGuidance(society, "conflicts").sources.map(s => s.id), ["BC-SOC-CONFLICTS", "BC-SOC-SENIOR-MANAGER-CONFLICTS"]);
assert.match(getRegulatoryCitation("BC-BCA-CONFLICTS")!.caveat!, /no blanket.*leave/);
assert.match(getRegulatoryCitation("CBCA-CONFLICTS")!.caveat!, /no express blanket.*leave/);
assert.match(getRegulatoryCitation("OBCA-CONFLICTS")!.quote, /leave the discussion/);
assert.match(getRegulatoryCitation("OBCA-AUDITOR-APPOINTMENT")!.caveat!, /152\(5\).*repealed/);
assert.match(getRegulatoryCitation("CBCA-AUDITOR-APPOINTMENT")!.quote, /court exemption/);

// Societies Act s. 51 has no general 15- or 30-day director-change deadline;
// the Directors page reads the profile's timing instead of a fixed number.
assert.match(directorComplianceProfile(society).directorChangeSubtext, /^Promptly/);
assert.doesNotMatch(directorComplianceProfile(society).directorChangeSubtext, /\b(15|30)\b/);
assert.match(directorComplianceProfile(bc).directorChangeSubtext, /15 days/);
const directorsPage = readFileSync("src/pages/Directors.tsx", "utf8");
assert.doesNotMatch(directorsPage, /within 30 days/, "Directors page must not assert a 30-day director-change deadline");
assert.match(directorsPage, /directorProfile\.directorChangeSubtext/);

const memberFunded = { ...society, isMemberFunded: true };
assert.deepEqual(directorComplianceProfile(memberFunded).citationIds, ["BC-SOC-MEMBER-FUNDED-DIRECTORS"]);
const minimumRule = dashboardComplianceRulePackForOrganization(memberFunded).rules.find(rule => rule.id === "BC-SOC-DIRECTORS-MIN")!;
assert.equal(minimumRule.passFail({ society: memberFunded, activeDirectors: [], rulesConfigured: false })?.citationId, "BC-SOC-MEMBER-FUNDED-DIRECTORS");
for (const rule of dashboardComplianceRulePackForOrganization(society).rules.filter(rule => rule.id.startsWith("MEMBER-DATA"))) {
  assert.doesNotMatch(JSON.stringify({ citation: rule.citation, actions: rule.remediationActions }), /PIPA/);
}

// Ontario information-return sources are not general federal rules. A foreign
// registration source remains conditional review material, outside core guides.
for (const source of LEGAL_SOURCES.filter(source => source.id.startsWith("ON-CIA-"))) {
  assert.ok(citationAppliesToOrganization(source.id, ontario), source.id);
  for (const organization of [society, bc, federal, ...unsupported]) assert.equal(citationAppliesToOrganization(source.id, organization), false, source.id);
}
assert.equal(getRegulatoryCitation("BC-BCA-EXTRAPROVINCIAL")!.audience, "general");
// Rule ids are lowercase while source ids are uppercase: compare the authority
// fields case-insensitively, including every registry source behind a rule.
const registrySourcesByRuleId = new Map(JURISDICTION_GUIDE_PACK_JSON.flatMap((raw) =>
  jurisdictionGuidePackSchema.parse(raw).rules.map((rule) => [rule.ruleId, [rule.authority.sourceId, ...(rule.authority.registrySourceIds ?? [])]] as const)));
const citesExtraprovincial = (rule: LegalGuideRule) =>
  [rule.id, rule.statuteKey, ...(registrySourcesByRuleId.get(rule.id) ?? [])].some((value) => /extraprovincial|extra-provincial/i.test(value));
const bcCompanyGuide = getLegalGuideRules({ jurisdictionCode: resolveJurisdictionCode(bc), dateISO: "2026-10-11" });
assert.ok(bcCompanyGuide.length > 0, "BC company guide is populated");
assert.ok(bcCompanyGuide.every(rule => !citesExtraprovincial(rule)), "BC company guide never cites extraprovincial registration");
// The assertion is not vacuous: an extraprovincial authority in the guide is caught.
assert.equal(citesExtraprovincial({ ...bcCompanyGuide[0], statuteKey: "BC-BCA-EXTRAPROVINCIAL" }), true);
assert.equal(citesExtraprovincial({ ...bcCompanyGuide[0], id: "ca-bc-bca-bc-bca-extraprovincial" }), true);
registrySourcesByRuleId.set("synthetic-registry-rule", ["BC-BCA-RECORDS", "BC-BCA-EXTRAPROVINCIAL"]);
assert.equal(citesExtraprovincial({ ...bcCompanyGuide[0], id: "synthetic-registry-rule" }), true);
registrySourcesByRuleId.delete("synthetic-registry-rule");

// An explicitly recorded "unknown" jurisdiction is a review state, not the
// legacy BC society default. Only a missing or blank jurisdiction is legacy.
for (const organization of [{ jurisdictionCode: "unknown" }, { jurisdictionCode: "unknown", entityType: "society" }, { jurisdictionCode: " unknown ", entityType: "society", actFormedUnder: "societies_act" }]) {
  const label = JSON.stringify(organization);
  assert.equal(legalGovernanceProfile(organization), undefined, `${label}: no registry profile`);
  assert.equal(organizationRuleScope(organization).isBcSociety, false, `${label}: no Societies Act scope`);
  assert.equal(organizationRuleScope(organization).legacyIdentity, false, `${label}: not legacy`);
  const dashboard = dashboardComplianceRulePackForOrganization(organization).rules;
  assert.ok(!dashboard.some(rule => rule.id === "BC-SOC-DIRECTORS-MIN"), `${label}: no Societies Act director-minimum rule`);
  const flags = dashboard.map(rule => rule.passFail({ society: organization, activeDirectors: [], rulesConfigured: false }));
  assert.doesNotMatch(JSON.stringify(flags), /Societies Act s\. 40/, `${label}: no Societies Act s. 40 dashboard flag`);
  assert.notDeepEqual(legalCopyForOrganization(organization).recordsInspectionGuidance, RECORDS_INSPECTION_GUIDANCE, `${label}: no Societies Act inspection copy`);
  assert.doesNotMatch(JSON.stringify(legalCopyForOrganization(organization)), /Societies Act/, `${label}: no Societies Act copy`);
}
for (const organization of [{}, { jurisdictionCode: "" }, { jurisdictionCode: "   " }, { jurisdictionCode: "CA-BC" }, { jurisdictionCode: "  ", entityType: "society" }]) {
  const label = JSON.stringify(organization);
  assert.equal(legalGovernanceProfile(organization)?.id, "bc_society", `${label}: legacy workspace keeps the BC society profile`);
  assert.equal(organizationRuleScope(organization).isBcSociety, true, `${label}: legacy workspace keeps Societies Act scope`);
  assert.deepEqual(legalCopyForOrganization(organization).recordsInspectionGuidance, RECORDS_INSPECTION_GUIDANCE);
}
// Whitespace-only entity fields are "not recorded" for both the registry and the scope.
for (const organization of [{ jurisdictionCode: "CA-BC", entityType: "   " }, { jurisdictionCode: "CA-BC", kind: " ", organizationKind: "\t" }, { entityType: " " }]) {
  const label = JSON.stringify(organization);
  assert.equal(hasRecordedEntityType(organization), false, label);
  assert.equal(legalGovernanceProfile(organization)?.id, "bc_society", `${label}: registry treats blank entity fields as legacy`);
  assert.equal(organizationRuleScope(organization).legacyIdentity, true, `${label}: scope treats blank entity fields as legacy`);
  assert.equal(organizationRuleScope(organization).isBcSociety, true, label);
}
for (const organization of [{ jurisdictionCode: "CA-BC", entityType: "cooperative" }, { jurisdictionCode: "CA-BC", entityType: " cooperative " }]) {
  assert.equal(hasRecordedEntityType(organization), true);
  assert.equal(legalGovernanceProfile(organization), undefined);
  assert.equal(organizationRuleScope(organization).isBcSociety, false);
}

const bcOperations = { ...federal, privacyOperatingJurisdictions: ["CA-BC"], privacyCommercialActivity: "no", privacyFederalWork: "no", privacyCrossBorderCommercial: "no", privacySectorSpecific: "none" } as const;
const commercialOntario = { ...ontario, ...bcOperations, jurisdictionCode: ontario.jurisdictionCode, actFormedUnder: ontario.actFormedUnder, privacyOperatingJurisdictions: ["CA-ON"], privacyCommercialActivity: "yes" } as const;
assert.equal(citationAppliesToOrganization("PIPA-POLICY", federal), false, "incorporation is not privacy scope");
assert.equal(citationAppliesToOrganization("PIPA-POLICY", bcOperations), true, "BC operations can engage PIPA for a federal corporation");
assert.equal(citationAppliesToOrganization("OPC-PRIVACY-PLAN-TOOL", commercialOntario), true);
assert.equal(citationAppliesToOrganization("OPC-PRIVACY-PLAN-TOOL", bcOperations), false);
assert.equal(citationAppliesToOrganization("OIPC-PIPA-PRIVATE-ORGS", commercialOntario), false);
assert.equal(getPrivacyLegalGuideRules({ organization: federal }).length, 0);
assert.ok(getPrivacyLegalGuideRules({ organization: bcOperations }).every(rule => rule.currentAsOfISO && !rule.effectiveFromISO));
assert.equal(regulatoryCitations["AB-PIPA-ACCESS"].sourceCurrentToISO, "2025-09-01", "Alberta PIPA carries the King's Printer consolidation date actually displayed");
assert.equal(regulatoryCitations["OIPC-PIPA-PRIVATE-ORGS"].sourceCurrentToISO, undefined);
assert.notEqual(regulatoryCitations["PIPA-POLICY"].sourceCurrentToISO, regulatoryCitations["PIPA-POLICY"].reviewedOnISO);
console.log("Legal guidance passed: rendered entity cards, records citations, unsupported-entity review, auditor and conflicts exceptions, member-funded sources, activity-based privacy routing, Ontario source isolation and honest review dates, explicit-unknown and blank-entity scope agreement, and a non-vacuous extraprovincial guard.");
