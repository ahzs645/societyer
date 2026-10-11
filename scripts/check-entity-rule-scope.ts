/**
 * Entity-scoped warnings and citations.
 *
 * A workspace can be a BC society, a BC/federal/Ontario business corporation, or
 * a custom existing entity. Societies Act warnings and citations must reach only
 * BC societies; BC PIPA reaches only BC-home organizations. This check covers
 * the pure helpers and runs the real dashboard / annual-cycle / minute-book
 * queries through the convex-test oracle for each entity type.
 */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import {
  appliesBcPrivacyRules,
  appliesBcSocietyRules,
  automatedComplianceChecksLabel,
  organizationRuleScope,
} from "../shared/entityRuleScope";
import {
  bcSocietiesDashboardComplianceRulePack,
  dashboardComplianceRulePackForOrganization,
} from "../shared/dashboardComplianceRules";
import {
  citationAppliesToOrganization,
  citationAudience,
  citationIdForOrganization,
  citationIdsForOrganization,
  pickCitationIdForOrganization,
  regulatoryCitations,
} from "../src/lib/regulatoryCitations";
import { getJurisdictionGuidePack, resolveJurisdictionCode } from "../src/lib/jurisdictionGuideTracks";
import { jurisdictionDisplayCopy } from "../shared/jurisdictionWorkspace";
import { evaluateLegalDecision, legalMeetingQuorum } from "../shared/legalDecision";
import { legalCopyForOrganization, RECORDS_INSPECTION_GUIDANCE } from "../src/lib/legalCopy";

const ENTITIES = {
  bcSociety: { name: "Riverside Community Society", jurisdictionCode: "CA-BC", entityType: "society", actFormedUnder: "societies_act" },
  legacyBcSociety: { name: "Legacy Society", jurisdictionCode: "CA-BC" },
  bcCompany: { name: "Example Provincial Inc.", jurisdictionCode: "CA-BC", entityType: "corporation__business_", actFormedUnder: "business_corporations_act__british_columbia_" },
  federalCbca: { name: "Northwind Ltd.", jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__business_", actFormedUnder: "canada_business_corporations_act" },
  ontarioObca: { name: "Contoso Inc.", jurisdictionCode: "CA-ON-OBCA", entityType: "corporation__business_", actFormedUnder: "business_corporations_act__ontario_" },
  albertaSociety: { name: "Prairie Society", jurisdictionCode: "alberta", entityType: "society", actFormedUnder: "societies_act__alberta_" },
  bcCustomEntity: { name: "Custom BC Entity", jurisdictionCode: "CA-BC", entityType: "cooperative" },
} as const;
const CORPORATIONS = ["bcCompany", "federalCbca", "ontarioObca"] as const;
const NON_BC_SOCIETY = [...CORPORATIONS, "albertaSociety", "bcCustomEntity"] as const;

/* ------------------------------ scope helpers ----------------------------- */

assert.equal(appliesBcSocietyRules(ENTITIES.bcSociety), true);
assert.equal(appliesBcSocietyRules(ENTITIES.legacyBcSociety), true, "legacy BC workspaces keep their society rules");
assert.equal(organizationRuleScope({ name: "No identity" }).isBcSociety, true, "no recorded identity uses the BC society default");
for (const key of NON_BC_SOCIETY) assert.equal(appliesBcSocietyRules(ENTITIES[key]), false, `${key}: no Societies Act rules`);
assert.equal(appliesBcSocietyRules(null), false, "a missing profile shows no society rules");
assert.equal(appliesBcPrivacyRules(ENTITIES.bcCompany), true, "BC PIPA applies to a BC company");
assert.equal(appliesBcPrivacyRules(ENTITIES.federalCbca), false);
assert.equal(appliesBcPrivacyRules(ENTITIES.ontarioObca), false);
for (const key of NON_BC_SOCIETY) assert.doesNotMatch(automatedComplianceChecksLabel(ENTITIES[key]), /Societies Act/);
assert.match(automatedComplianceChecksLabel(ENTITIES.bcSociety), /Societies Act/);

/* -------------------------------- citations ------------------------------- */

for (const citation of Object.values(regulatoryCitations)) {
  if (/Societies/.test(citation.instrument)) assert.equal(citationAudience(citation), "bc_society", `${citation.id} is BC-society-only`);
}
const societyCitationIds = Object.values(regulatoryCitations).filter((citation) => citationAudience(citation) === "bc_society").map((citation) => citation.id);
assert.ok(societyCitationIds.includes("BC-SOC-AGM") && societyCitationIds.includes("BC-SOC-MODEL-BYLAWS-QUORUM"));
for (const key of NON_BC_SOCIETY) {
  for (const id of societyCitationIds) assert.equal(citationAppliesToOrganization(id, ENTITIES[key]), false, `${key}: ${id} suppressed`);
  assert.equal(citationIdForOrganization("BC-SOC-RECORDS", ENTITIES[key]), undefined);
  assert.equal(pickCitationIdForOrganization({ society: "BC-SOC-AGM" }, ENTITIES[key]), undefined);
}
assert.equal(citationIdForOrganization("BC-SOC-RECORDS", ENTITIES.bcSociety), "BC-SOC-RECORDS");
assert.equal(pickCitationIdForOrganization({ society: "BC-SOC-AGM", fallback: "CRA-BOOKS-RECORDS" }, ENTITIES.bcSociety), "BC-SOC-AGM");
assert.equal(pickCitationIdForOrganization({ society: "BC-SOC-AGM", fallback: "CRA-BOOKS-RECORDS" }, ENTITIES.federalCbca), "CRA-BOOKS-RECORDS");
assert.deepEqual(citationIdsForOrganization(["PIPA-POLICY", "BC-SOC-RECORDS"], ENTITIES.bcCompany), ["PIPA-POLICY"]);
assert.deepEqual(citationIdsForOrganization(["PIPA-POLICY", "BC-SOC-RECORDS", "CASL-CONSENT"], ENTITIES.ontarioObca), ["CASL-CONSENT"]);
assert.equal(citationAppliesToOrganization("NOT-A-CITATION", ENTITIES.bcSociety), false);

/* ------------------------- guide tracks and copy -------------------------- */

assert.equal(resolveJurisdictionCode(ENTITIES.bcSociety), "CA-BC");
assert.equal(resolveJurisdictionCode(ENTITIES.legacyBcSociety), "CA-BC");
assert.equal(resolveJurisdictionCode(ENTITIES.bcCompany), "CA-BC-BCA");
const customGuide = getJurisdictionGuidePack(resolveJurisdictionCode(ENTITIES.bcCustomEntity));
assert.equal(customGuide.rules.length, 0, "a custom BC entity gets no Societies Act guide rules");
assert.doesNotMatch(customGuide.name, /Societies/);
for (const key of NON_BC_SOCIETY) {
  const copy = JSON.stringify(jurisdictionDisplayCopy(ENTITIES[key]));
  assert.doesNotMatch(copy, /Societies Online|BC society|BC resident required/, `${key}: no society display copy`);
}
assert.match(jurisdictionDisplayCopy(ENTITIES.bcSociety).filingsSubtitle, /Societies Online/);

const writtenDirectors = { jurisdiction: "CA-BC" as const, body: "directors" as const, mode: "written" as const, resolution: "ordinary" as const, votesFor: 3, votesAgainst: 0, eligibleVotes: 3, circulatedToAll: true, governingInstrumentEvidence: "Articles" };
assert.ok(evaluateLegalDecision({ ...writtenDirectors, entityType: "corporation__business_" }).warnings.every((warning) => !/society/i.test(warning)));
assert.ok(evaluateLegalDecision({ ...writtenDirectors, entityType: "society" }).warnings.some((warning) => /society bylaw/.test(warning)));
assert.doesNotMatch(legalMeetingQuorum({ entityType: "society", jurisdiction: "CA-ON-OBCA", eligiblePeople: 10, presentPeople: 5 }).citation, /Societies Act/);

const societyCopy = legalCopyForOrganization(ENTITIES.bcSociety);
assert.deepEqual(societyCopy.recordsInspectionGuidance, RECORDS_INSPECTION_GUIDANCE);
assert.equal(societyCopy.privacyLawLabel, "PIPA");
for (const key of CORPORATIONS) {
  const copy = legalCopyForOrganization(ENTITIES[key]);
  assert.deepEqual(copy.recordsInspectionGuidance, [], `${key}: no Societies Act records guidance`);
  assert.doesNotMatch(JSON.stringify([copy.intakeNotice, copy.directorAttestation, copy.templateResources, copy.policyRequirements]), /\bsociety\b|Member notice/i, `${key}: no society wording`);
}
assert.ok(legalCopyForOrganization(ENTITIES.federalCbca).templateResources.every((resource) => !/BC OIPC/.test(resource.title)), "BC OIPC resources stay BC-only");
assert.equal(legalCopyForOrganization(ENTITIES.federalCbca).privacyLawLabel, "applicable privacy law");

/* ------------------------------ rule pack -------------------------------- */

const ruleIds = (organization: any) => dashboardComplianceRulePackForOrganization(organization).rules.map((rule) => rule.id);
assert.equal(ruleIds(ENTITIES.bcSociety).length, bcSocietiesDashboardComplianceRulePack.rules.length);
assert.deepEqual(ruleIds(ENTITIES.bcCompany), ["PIPA-POLICY-DOCUMENTED", "PIPA-POLICY-EVIDENCE"]);
assert.deepEqual(ruleIds(ENTITIES.federalCbca), []);
assert.deepEqual(ruleIds(ENTITIES.ontarioObca), []);
assert.deepEqual(ruleIds(ENTITIES.albertaSociety), []);

/* --------------------- live queries via convex-test ---------------------- */

const issuer = betterAuthIssuer();
const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./dashboard.js": () => import("../convex/dashboard"),
  "./annualCycle.js": () => import("../convex/annualCycle"),
  "./minuteBook.js": () => import("../convex/minuteBook"),
} as any);

const SOCIETY_ONLY_TEXT = /Societies Act|s\.40|s\.197|member-funded|BC-resident|BC resident|Constitution not uploaded|Bylaws not uploaded|BC defaults|Member list|Member data|constitution/i;
const SOCIETY_ONLY_RULES = /^(BC-SOC-|MEMBER-DATA-|BYLAW-RULE-SET-)/;

async function workspace(key: keyof typeof ENTITIES) {
  return test.run(async (ctx) => {
    const societyId = await ctx.db.insert("societies", { ...ENTITIES[key], isCharity: false, isMemberFunded: false, updatedAt: Date.now() } as any);
    await ctx.db.insert("users", { societyId, role: "Owner", status: "Active", displayName: `${key} owner`, email: `${key}@example.test`, authSubject: key, authIssuer: issuer, authProvider: "better-auth", createdAtISO: new Date().toISOString() });
    await ctx.db.insert("directors", { societyId, firstName: "Only", lastName: "Director", position: "Director", status: "Active", termStart: "2026-01-01", isBCResident: false, consentOnFile: false });
    return societyId;
  });
}

for (const key of Object.keys(ENTITIES) as (keyof typeof ENTITIES)[]) {
  const societyId = await workspace(key);
  const actor = test.withIdentity({ subject: key, issuer });
  const summary = await actor.query(api.dashboard.summary, { societyId });
  const ids = summary.complianceFlags.map((flag: any) => flag.ruleId);
  const citations = summary.complianceFlags.flatMap((flag: any) => [flag.citationId, ...(flag.citationIds ?? [])]).filter(Boolean);
  const cycle = await actor.query(api.annualCycle.summary, { societyId, year: 2026 });
  const cycleItems = Object.values(cycle.phases).flat() as any[];
  const binder = await actor.query(api.minuteBook.overview, { societyId });
  const coreCheck = binder.checks.find((check: any) => check.key === "missing_core_documents");

  if (appliesBcSocietyRules(ENTITIES[key])) {
    for (const ruleId of ["BC-SOC-DIRECTORS-MIN", "BC-SOC-DIRECTORS-BC-RESIDENT", "BC-SOC-DIRECTOR-CONSENT", "BC-SOC-CONSTITUTION-EVIDENCE"]) {
      assert.ok(ids.includes(ruleId), `${key}: society still gets ${ruleId}`);
    }
    assert.ok(citations.includes("BC-SOC-DIRECTORS-MIN"), `${key}: society still gets Societies Act citations`);
    assert.ok(cycleItems.some((item) => item.id === "member-register"));
    assert.equal(cycleItems.find((item) => item.id === "post-agm-directors").status, "blocked", `${key}: BC society needs a BC-resident director`);
    assert.match(coreCheck.label, /constitution/i);
    continue;
  }

  assert.ok(!ids.some((id: string) => SOCIETY_ONLY_RULES.test(id)), `${key}: no society rules, got ${ids.join(", ")}`);
  for (const flag of summary.complianceFlags) assert.doesNotMatch(flag.text, SOCIETY_ONLY_TEXT, `${key}: ${flag.text}`);
  for (const id of citations) {
    assert.ok(!String(id).startsWith("BC-SOC-"), `${key}: Societies Act citation ${id} leaked`);
    assert.ok(citationAppliesToOrganization(id, ENTITIES[key]), `${key}: inapplicable citation ${id}`);
  }
  if (appliesBcPrivacyRules(ENTITIES[key])) assert.deepEqual(ids, ["PIPA-POLICY-DOCUMENTED", "PIPA-POLICY-EVIDENCE"], `${key}: BC-home entity keeps only BC PIPA checks`);
  else assert.deepEqual(ids, [], `${key}: no automated checks are configured, so none run`);

  assert.ok(!cycleItems.some((item) => /BC resident/.test(item.detail)), `${key}: no BC-resident director copy`);
  assert.equal(cycleItems.find((item) => item.id === "post-agm-directors").status, "complete", `${key}: no BC-resident director requirement`);
  if (!appliesBcPrivacyRules(ENTITIES[key])) assert.ok(!cycleItems.some((item) => /PIPA/.test(`${item.title} ${item.detail}`)), `${key}: no PIPA wording`);
  if ((CORPORATIONS as readonly string[]).includes(key)) {
    assert.ok(!cycleItems.some((item) => item.id === "member-register"), `${key}: no member register step`);
    assert.ok(!cycleItems.some((item) => /\bmember\b/i.test(`${item.title} ${item.detail}`)), `${key}: no member wording`);
    assert.equal(cycle.annualReportDueDate, undefined, `${key}: annual report is not AGM-anchored`);
    assert.equal(coreCheck.label, "Missing articles/minutes");
    assert.doesNotMatch(coreCheck.detail, /Constitution|Bylaws/);
  }
}

console.log("Entity rule scope passed: BC societies keep Societies Act warnings and citations; BC/federal/Ontario corporations, non-BC societies and custom entities receive none (dashboard, annual cycle, minute book, guide tracks, citations, legal copy, decision warnings).");
