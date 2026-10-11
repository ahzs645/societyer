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
import { entityMeetingWording } from "../shared/entityMeetingWording";
import { deriveComplianceDeadlines } from "../shared/corporationSettings";
import { meetingNoticeCoverage, votingShareholderNoticeAudience } from "../shared/meetingNoticeAudience";
import { pipaSetupMotionsFor } from "../shared/functions/motionBacklog";

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

/* -------------------- annual-meeting wording (server) -------------------- */

assert.equal(entityMeetingWording(ENTITIES.bcSociety).annualMeeting, "AGM");
assert.equal(entityMeetingWording(ENTITIES.legacyBcSociety).holders, "members");
for (const key of CORPORATIONS) {
  const wording = entityMeetingWording(ENTITIES[key]);
  assert.equal(wording.annualMeeting, "annual meeting", `${key}: annual meeting`);
  assert.equal(wording.holders, "shareholders", `${key}: shareholders`);
}
assert.equal(entityMeetingWording(ENTITIES.bcCustomEntity).holders, null, "a custom entity names no voters");

// Derived compliance deadlines (Compliance settings) carry entity wording in their basis.
const deadlineBasis = (organization: any) => deriveComplianceDeadlines(
  { agmMonth: 6, agmDay: 15, fiscalYearEnd: "12-31", anniversaryDate: "2020-03-10", entityType: organization.entityType, jurisdictionCode: organization.jurisdictionCode },
  "2026-01-01",
).map((deadline) => deadline.basis ?? "").join(" | ");
assert.match(deadlineBasis(ENTITIES.bcSociety), /financial statements for the AGM\./);
for (const key of CORPORATIONS) {
  const basis = deadlineBasis(ENTITIES[key]);
  assert.match(basis, /financial statements for the annual meeting of shareholders\./, `${key}: ${basis}`);
  assert.doesNotMatch(basis, /\bAGM\b/, `${key}: no AGM in derived deadline basis`);
}
assert.match(deadlineBasis(ENTITIES.bcCustomEntity), /financial statements for the annual meeting\./);

// Starter privacy-policy resource: member data for societies only.
assert.match(JSON.stringify(legalCopyForOrganization(ENTITIES.bcSociety).templateResources), /member-data situation/);
for (const key of [...CORPORATIONS, "bcCustomEntity"] as const) {
  const resources = JSON.stringify(legalCopyForOrganization(ENTITIES[key]).templateResources);
  assert.doesNotMatch(resources, /member/i, `${key}: no member-data wording in template resources`);
}
assert.match(JSON.stringify(legalCopyForOrganization(ENTITIES.bcCompany).templateResources), /shareholder register/);

// Privacy setup motions: the member-data gap memo is society-only; PIPA only where BC PIPA applies.
const motionKeys = (organization: any) => pipaSetupMotionsFor(organization).map((motion) => motion.seededKey);
assert.ok(motionKeys(ENTITIES.bcSociety).includes("pipa-member-data-gap-memo"));
assert.ok(motionKeys(ENTITIES.legacyBcSociety).includes("pipa-member-data-gap-memo"));
for (const key of [...CORPORATIONS, "bcCustomEntity"] as const) {
  const motions = pipaSetupMotionsFor(ENTITIES[key]);
  assert.ok(!motions.some((motion) => motion.seededKey === "pipa-member-data-gap-memo"), `${key}: no member-data gap memo motion`);
  assert.doesNotMatch(JSON.stringify(motions), /\b[Ss]ociety\b|member-data/, `${key}: no society wording in setup motions`);
}
assert.match(JSON.stringify(pipaSetupMotionsFor(ENTITIES.bcCompany)), /the Corporation/);
assert.match(JSON.stringify(pipaSetupMotionsFor(ENTITIES.bcCompany)), /PIPA/, "BC company keeps BC PIPA");
assert.doesNotMatch(JSON.stringify(pipaSetupMotionsFor(ENTITIES.federalCbca)), /PIPA privacy policy/, "federal corporation: no BC PIPA policy");

// Notice coverage: society output is the historical members count; a corporation counts voting shareholders.
const memberRows = [
  { _id: "m1", firstName: "Ada", lastName: "Voter", status: "Active", votingRights: true, email: "ada@example.test" },
  { _id: "m2", firstName: "Ben", lastName: "Voter", status: "Active", votingRights: true },
  { _id: "m3", firstName: "Cy", lastName: "Nonvoting", status: "Active", votingRights: false },
];
const societyCoverage = meetingNoticeCoverage({ organization: ENTITIES.bcSociety, members: memberRows, deliveries: [{ status: "sent" }, { status: "bounced" }], recordedRecipientCount: 0 });
assert.deepEqual(
  { value: societyCoverage.value, detail: societyCoverage.detail, tone: societyCoverage.tone },
  { value: "1 notified · 2 voting members", detail: "1 delivery record logged", tone: "warn" },
);
assert.equal(meetingNoticeCoverage({ organization: ENTITIES.bcSociety, members: [] }).value, "No voting member register");
const ledger = {
  classes: [{ _id: "common", classType: "share", votingRights: "One vote per share." }, { _id: "pref", classType: "share", votingRights: "Non-voting." }],
  holdings: [
    { rightsClassId: "common", holderKey: "roleHolder:r1", holderRoleHolderId: "r1", quantity: 100, status: "current" },
    { rightsClassId: "common", holderKey: "name:Paper Holder", quantity: 5, status: "current" },
    { rightsClassId: "pref", holderKey: "roleHolder:r2", holderRoleHolderId: "r2", quantity: 10, status: "current" },
  ],
  roleHolders: [
    { _id: "r1", roleType: "shareholder", status: "current", fullName: "Sera Shareholder", email: "sera@example.test" },
    { _id: "r2", roleType: "shareholder", status: "current", fullName: "Pat Preferred" },
  ],
};
const shareholders = votingShareholderNoticeAudience(ledger);
assert.equal(shareholders.source, "share_register");
assert.deepEqual(shareholders.recipients.map((row) => row.name), ["Paper Holder", "Sera Shareholder"], "non-voting holders get no meeting notice");
const corporationCoverage = meetingNoticeCoverage({ organization: ENTITIES.federalCbca, members: memberRows, shareholders, deliveries: [{ status: "sent" }] });
assert.equal(corporationCoverage.basis, "shareholders");
assert.equal(corporationCoverage.value, "1 notified · 2 voting shareholders");
assert.match(corporationCoverage.detail, /share register/);
assert.match(corporationCoverage.detail, /1 shareholder has no email or mailing address on file/, "missing shareholder contact details are stated, not hidden");
assert.doesNotMatch(`${corporationCoverage.value} ${corporationCoverage.detail}`, /\bmember/);
assert.equal(meetingNoticeCoverage({ organization: ENTITIES.bcCompany, shareholders: votingShareholderNoticeAudience({}) }).value, "No shareholders recorded");
const roleOnly = votingShareholderNoticeAudience({ roleHolders: ledger.roleHolders });
assert.equal(roleOnly.source, "shareholder_role_holders", "no share register positions: fall back to shareholder role holders");
assert.equal(roleOnly.recipients.length, 2);

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
  "./continuity.js": () => import("../convex/continuity"),
  "./yearEnd.js": () => import("../convex/yearEnd"),
  "./agm.js": () => import("../convex/agm"),
  "./publicPortal.js": () => import("../convex/publicPortal"),
  "./motionBacklog.js": () => import("../convex/motionBacklog"),
  "./meetingTemplates.js": () => import("../convex/meetingTemplates"),
  "./documents.js": () => import("../convex/documents"),
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
  const continuityCitations = ((await actor.query(api.continuity.dashboardChecks, { societyId }) as any).checks as any[]).map((check) => check.citation).filter(Boolean);

  if (appliesBcSocietyRules(ENTITIES[key])) {
    for (const ruleId of ["BC-SOC-DIRECTORS-MIN", "BC-SOC-DIRECTORS-BC-RESIDENT", "BC-SOC-DIRECTOR-CONSENT", "BC-SOC-CONSTITUTION-EVIDENCE"]) {
      assert.ok(ids.includes(ruleId), `${key}: society still gets ${ruleId}`);
    }
    assert.ok(citations.includes("BC-SOC-DIRECTORS-MIN"), `${key}: society still gets Societies Act citations`);
    assert.ok(cycleItems.some((item) => item.id === "member-register"));
    assert.equal(cycleItems.find((item) => item.id === "post-agm-directors").status, "blocked", `${key}: BC society needs a BC-resident director`);
    assert.match(coreCheck.label, /constitution/i);
    assert.ok(continuityCitations.some((citation: string) => /Societies Act/.test(citation)), `${key}: continuity checks keep Societies Act citations`);
    continue;
  }

  assert.ok(!ids.some((id: string) => SOCIETY_ONLY_RULES.test(id)), `${key}: no society rules, got ${ids.join(", ")}`);
  for (const flag of summary.complianceFlags) assert.doesNotMatch(flag.text, SOCIETY_ONLY_TEXT, `${key}: ${flag.text}`);
  for (const id of citations) {
    assert.ok(!String(id).startsWith("BC-SOC-"), `${key}: Societies Act citation ${id} leaked`);
    assert.ok(citationAppliesToOrganization(id, ENTITIES[key]), `${key}: inapplicable citation ${id}`);
  }
  for (const citation of continuityCitations) assert.doesNotMatch(citation, /Societies Act/, `${key}: continuity citation ${citation} leaked`);
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
    for (const item of cycleItems) {
      assert.doesNotMatch(JSON.stringify([item.title, item.detail, item.actionLabel, item.evidence]), /\bAGM\b|bylaw rule set/, `${key}: annual-cycle item ${item.id} uses annual-meeting wording`);
    }
    assert.ok(cycleItems.some((item) => item.title === "Schedule the annual meeting"), `${key}: schedule the annual meeting`);
    assert.doesNotMatch(String(cycle.currentStage), /AGM/);
    assert.doesNotMatch(cycle.caveats.join(" "), /bylaw rule set|BC annual reports/, `${key}: corporate caveats`);
  }
}

/* ---------- year-end, annual cycle, notice coverage, public intake ---------- */

{
  const society = await workspace("bcSociety");
  const corporation = await workspace("federalCbca");
  const custom = await workspace("bcCustomEntity");
  const read = (key: string, societyId: any) => test.withIdentity({ subject: key, issuer }).query(api.yearEnd.readiness, { societyId, fiscalYear: "2026" });
  const label = (readiness: any, id: string) => readiness.items.find((item: any) => item.key === id);

  const societyReadiness = await read("bcSociety", society);
  assert.equal(label(societyReadiness, "financialsPresented").label, "Financial statements presented to members at the AGM");
  assert.equal(label(societyReadiness, "financialsPresented").detail, "Not yet linked to an AGM.");
  assert.equal(label(societyReadiness, "agm").label, "Annual general meeting held");
  assert.equal(label(societyReadiness, "agm").detail, "No held AGM found.");
  assert.equal(label(societyReadiness, "annualReport").label, "BC annual report filed");

  const corporationReadiness = await read("federalCbca", corporation);
  assert.equal(label(corporationReadiness, "financialsPresented").label, "Financial statements presented to shareholders at the annual meeting");
  assert.equal(label(corporationReadiness, "financialsPresented").detail, "Not yet linked to an annual meeting.");
  assert.equal(label(corporationReadiness, "agm").label, "Annual meeting of shareholders held");
  assert.equal(label(corporationReadiness, "agm").detail, "No held annual meeting found.");
  assert.equal(label(corporationReadiness, "annualReport").label, "Annual registry report or return filed", "federal corporation: no BC annual report");
  assert.doesNotMatch(JSON.stringify(corporationReadiness.items), /\bAGM\b|\bmembers\b/);

  const customReadiness = await read("bcCustomEntity", custom);
  assert.equal(label(customReadiness, "financialsPresented").label, "Financial statements presented at the annual meeting", "custom entity: neutral wording");

  // Annual cycle with a scheduled annual meeting: society wording unchanged, corporation wording swapped.
  const addMeeting = (societyId: any, title: string) => test.run((ctx) => ctx.db.insert("meetings", { societyId, type: "AGM", title, scheduledAt: "2026-06-15T18:00:00.000Z", electronic: false, status: "Scheduled", attendeeIds: [] } as any));
  const societyMeetingId = await addMeeting(society, "2026 Annual General Meeting");
  const corporationMeetingId = await addMeeting(corporation, "2026 Annual Meeting of Shareholders");
  const cycleItems = async (key: string, societyId: any) => Object.values((await test.withIdentity({ subject: key, issuer }).query(api.annualCycle.summary, { societyId, year: 2026 })).phases).flat() as any[];
  const societyCycle = await cycleItems("bcSociety", society);
  assert.equal(societyCycle.find((item) => item.id === "agm-scheduled").title, "Schedule the AGM");
  assert.equal(societyCycle.find((item) => item.id === "agm-scheduled").actionLabel, "Open AGM");
  assert.equal(societyCycle.find((item) => item.id === "votes-minutes").detail, "No AGM minutes are linked yet.");
  assert.equal(societyCycle.find((item) => item.id === "notice-package").title, "Send member notice package");
  const corporationCycle = await cycleItems("federalCbca", corporation);
  assert.equal(corporationCycle.find((item) => item.id === "agm-scheduled").actionLabel, "Open annual meeting");
  assert.equal(corporationCycle.find((item) => item.id === "votes-minutes").detail, "No annual meeting minutes are linked yet.");
  assert.equal(corporationCycle.find((item) => item.id === "elections").detail, "No annual meeting election or director appointment evidence is linked.");
  assert.equal(corporationCycle.find((item) => item.id === "notice-package").title, "Send shareholder notice package");
  for (const item of corporationCycle) assert.doesNotMatch(JSON.stringify([item.title, item.detail, item.actionLabel, item.evidence]), /\bAGM\b|\bmembers?\b/, `corporation cycle item ${item.id}`);

  // Notice coverage: members for the society, share register for the corporation.
  await test.run(async (ctx) => {
    await ctx.db.insert("members", { societyId: society, firstName: "Ada", lastName: "Voter", status: "Active", membershipClass: "Regular", joinedAt: "2020-01-01", votingRights: true });
    await ctx.db.insert("members", { societyId: corporation, firstName: "Stale", lastName: "Member", status: "Active", membershipClass: "Regular", joinedAt: "2020-01-01", votingRights: true });
    const roleHolder = (fullName: string, extra: Record<string, unknown> = {}) => ctx.db.insert("roleHolders", { societyId: corporation, roleType: "shareholder", status: "current", fullName, citizenshipCountries: [], taxResidenceCountries: [], relatedShareholderIds: [], controllingIndividualIds: [], sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: "2026-01-01", updatedAtISO: "2026-01-01", ...extra } as any);
    const reachable = await roleHolder("Sera Shareholder", { email: "sera@example.test" });
    const unreachable = await roleHolder("Una Unreachable");
    const classId = await ctx.db.insert("rightsClasses", { societyId: corporation, className: "Common shares", classType: "share", status: "active", votingRights: "One vote per share.", sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: "2026-01-01", updatedAtISO: "2026-01-01" } as any);
    for (const [holder, quantity] of [[reachable, 60], [unreachable, 40]] as const) {
      await ctx.db.insert("rightsHoldings", { societyId: corporation, rightsClassId: classId, holderRoleHolderId: holder, holderKey: `roleHolder:${holder}`, quantity, status: "current", sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: "2026-01-01", updatedAtISO: "2026-01-01" } as any);
    }
  });
  const societyNotice = await test.withIdentity({ subject: "bcSociety", issuer }).query(api.agm.noticeCoverage, { meetingId: societyMeetingId });
  assert.equal(societyNotice.value, "0 notified · 1 voting member", "society notice coverage still counts voting members");
  assert.equal(societyNotice.detail, "0 delivery records logged");
  const corporationNotice = await test.withIdentity({ subject: "federalCbca", issuer }).query(api.agm.noticeCoverage, { meetingId: corporationMeetingId });
  assert.equal(corporationNotice.basis, "shareholders");
  assert.equal(corporationNotice.value, "0 notified · 2 voting shareholders", "corporation notice coverage counts voting shareholders, not members");
  assert.match(corporationNotice.detail, /1 shareholder has no email or mailing address on file/);
  assert.doesNotMatch(corporationNotice.value, /member register/);

  // Queued notice records go to the corporation's shareholders, not its members table.
  await test.withIdentity({ subject: "federalCbca", issuer }).mutation(api.agm.queueNoticeToAllVotingMembers, { societyId: corporation, meetingId: corporationMeetingId, channel: "mail" });
  const queued = await test.run((ctx) => ctx.db.query("noticeDeliveries").withIndex("by_meeting", (q: any) => q.eq("meetingId", corporationMeetingId)).collect());
  assert.deepEqual(queued.map((row: any) => row.recipientName).sort(), ["Sera Shareholder", "Una Unreachable"]);

  // Privacy setup motions seeded for a corporation leave out the member-data memo.
  const seeded = await test.withIdentity({ subject: "federalCbca", issuer }).mutation(api.motionBacklog.seedPipaSetup, { societyId: corporation });
  assert.equal(seeded.inserted, 3);
  const motions = await test.run((ctx) => ctx.db.query("motions").withIndex("by_society", (q: any) => q.eq("societyId", corporation)).collect());
  assert.ok(!motions.some((motion: any) => motion.seededKey === "pipa-member-data-gap-memo"));

  // Default meeting templates: annual meeting of shareholders for a corporation.
  await test.withIdentity({ subject: "federalCbca", issuer }).mutation(api.meetingTemplates.seedDefaults, { societyId: corporation });
  const templates = await test.run((ctx) => ctx.db.query("meetingTemplates").withIndex("by_society", (q: any) => q.eq("societyId", corporation)).collect());
  assert.ok(templates.some((template: any) => template.name === "Annual meeting of shareholders"));

  // Privacy policy starter draft: shareholder records, not member records, for a corporation.
  const draft = await test.withIdentity({ subject: "federalCbca", issuer }).mutation(api.documents.createPipaPolicyDraft, { societyId: corporation });
  assert.match(draft.document.content, /## 8\. Shareholder Records/);
  assert.doesNotMatch(draft.document.content, /society records|member register|member-data|communicate with members/i);
  const societyDraft = await test.withIdentity({ subject: "bcSociety", issuer }).mutation(api.documents.createPipaPolicyDraft, { societyId: society });
  assert.match(societyDraft.document.content, /## 8\. Member Records and Institution-Held Data/, "society draft unchanged");

  // Public intake context carries the registry identity so the form wording switches.
  await test.run((ctx) => ctx.db.patch(corporation, { publicSlug: "northwind", publicTransparencyEnabled: true, publicVolunteerIntakeEnabled: true } as any));
  const intake = await test.query(api.publicPortal.volunteerIntakeContext, { slug: "northwind" });
  assert.deepEqual(
    { entityType: intake.society.entityType, jurisdictionCode: intake.society.jurisdictionCode, actFormedUnder: intake.society.actFormedUnder },
    { entityType: "corporation__business_", jurisdictionCode: "CA-FED-CBCA", actFormedUnder: "canada_business_corporations_act" },
  );
  const allowed = new Set(["_id", "actFormedUnder", "entityType", "jurisdictionCode", "name", "privacyNotice", "privacyOfficerName", "publicContactEmail", "publicSlug"]);
  for (const field of Object.keys(intake.society)) assert.ok(allowed.has(field), `public intake context leaks ${field}`);
  assert.equal(legalCopyForOrganization(intake.society).entityNoun, "corporation", "intake pages word their copy for a corporation");
}

console.log("Entity rule scope passed: BC societies keep Societies Act warnings and citations; BC/federal/Ontario corporations, non-BC societies and custom entities receive none (dashboard, annual cycle, minute book, guide tracks, citations, legal copy, decision warnings); year-end readiness, annual-cycle summary, derived deadlines, notice coverage, privacy setup motions, meeting templates and public intake use annual-meeting and shareholder wording for corporations.");
