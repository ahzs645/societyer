// Pure evaluator checks for organization setup (`/app/organization-setup`):
// variants, phase transitions, the next-step rule, counts, skip decisions,
// restricted steps, records-only Acts, and corporation vs society wording.
import assert from "node:assert/strict";
import {
  emptyOrganizationSetupFacts,
  evaluateOrganizationSetup,
  setupVariant,
  type OrganizationSetupFacts,
} from "../shared/organizationSetup/evaluate";
import { setupCopyContext, setupStepCatalogue, type SetupOrganization } from "../shared/organizationSetup/catalogue";
import type { OrganizationSetupProgress, SetupStepDecision, SetupStepKey, SetupStepView } from "../shared/organizationSetup/types";
import { setupStepHref } from "../shared/organizationSetup/types";
import { describeOnboardingAnswers, onboardingAnswerSentences, type OrganizationOnboardingAnswers } from "../shared/onboarding";
import { ROLE_MATRIX } from "../shared/functions/permissions";
import {
  assertNameRequestFields, cleanImportedNameRequestFields, decisionExpectedFromFields, decisionTimeFields, decisionTimeViewerHint, formatDecisionExpected,
  nameApprovalPacketView, nameRequestProgressLine, nameRequestStatus, suggestedNameApprovalExpiry, summarizeNameRequests,
} from "../shared/nameRequests";
import { timeZoneAbbreviation, zonedDateTimeISO } from "../shared/timeZones";
import { stepNoteText } from "../src/features/organizationSetup/setupCopy";

const cbca: SetupOrganization = {
  name: "Northstar Corp.", jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__business_",
  actFormedUnder: "canada_business_corporations_act", legalSubtype: "federal_private_corporation",
  formationStatus: "preparing", organizationStatus: "pre_incorporation",
};
const bcCompany: SetupOrganization = {
  name: "Cedar Holdings Ltd.", jurisdictionCode: "CA-BC", entityType: "corporation__business_",
  actFormedUnder: "business_corporations_act__british_columbia_", legalSubtype: "ordinary_private_company",
  formationStatus: "preparing", organizationStatus: "pre_incorporation",
};
const bcSociety: SetupOrganization = {
  name: "Harbour Community Society", jurisdictionCode: "CA-BC", entityType: "society",
  actFormedUnder: "societies_act", legalSubtype: "ordinary_society",
  formationStatus: "preparing", organizationStatus: "pre_incorporation", isMemberFunded: false,
};
const albertaCompany: SetupOrganization = {
  name: "Prairie Works Inc.", jurisdictionCode: "CA-AB", entityType: "corporation__business_",
  actFormedUnder: "business_corporations_act__alberta_", legalSubtype: "other",
  formationStatus: "preparing", organizationStatus: "pre_incorporation",
};
const cnca: SetupOrganization = {
  name: "Maple Commons Foundation", jurisdictionCode: "CA-FED", entityType: "corporation__nfp_",
  actFormedUnder: "canada_not_for_profit_corporations_act", legalSubtype: "other",
  formationStatus: "preparing", organizationStatus: "pre_incorporation",
};

const preparingAnswers = (pathwayKey: string, extra: Partial<OrganizationOnboardingAnswers> = {}): OrganizationOnboardingAnswers => ({
  version: 1, previousUse: "new", organizationStage: "preparing", pathwayKey,
  governanceStructure: "needs_review", classDetails: "", governanceDocuments: "need_to_prepare",
  peopleReadiness: "add_later", operatingRegions: "", ...extra,
});

function facts(organization: SetupOrganization, patch: Partial<OrganizationSetupFacts> = {}, answers?: OrganizationOnboardingAnswers): OrganizationSetupFacts {
  return { ...emptyOrganizationSetupFacts(organization, answers), ...patch };
}
function steps(progress: OrganizationSetupProgress): SetupStepView[] {
  return progress.phases.flatMap((phase) => phase.steps);
}
function stepOf(progress: OrganizationSetupProgress, key: SetupStepKey): SetupStepView {
  const found = steps(progress).find((candidate) => candidate.key === key);
  assert.ok(found, `step ${key} should be present`);
  return found;
}
function hasStep(progress: OrganizationSetupProgress, key: SetupStepKey): boolean {
  return steps(progress).some((candidate) => candidate.key === key);
}
function phaseOf(progress: OrganizationSetupProgress, key: string) {
  return progress.phases.find((phase) => phase.key === key)!;
}
const decision = (stepKey: SetupStepKey, kind: "not_applicable" | "later", reason?: string): SetupStepDecision => ({
  stepKey, decision: kind, ...(reason ? { reason } : {}), decidedAtISO: "2026-10-15T00:00:00.000Z",
});
const allText = (progress: OrganizationSetupProgress) => JSON.stringify(progress.phases.map((phase) => ({ t: phase.title, d: phase.description, n: phase.statusNote, s: phase.steps.map((s) => [s.title, s.description, s.actionLabel, s.externalLabel, s.note]) })));

/* ---------------- Copy quality: every variant, every title ---------------- */
const BANNED = /workflow execution|classification needs review|needs_review|add_later|need_to_prepare|unverified_existing|pre_incorporation/i;
// Words that may be capitalized mid-title: registry, Act and place names, acronyms.
const PROPER = new Set(["BC", "Registries", "Corporations", "Canada", "Societies", "Online", "Corporate", "CRA", "NUANS", "Societyer", "Ontario", "Business", "Registry", "Alberta", "AGM", "Act", "Setup"]);
function assertSentenceCase(text: string, label: string) {
  assert.match(text, /^[A-Z0-9]/, `${label}: starts with a capital: ${text}`);
  const words = text.split(/\s+/).slice(1).map((word) => word.replace(/[^A-Za-z']/g, ""));
  for (const word of words) {
    if (/^[A-Z][a-z]/.test(word)) assert.ok(PROPER.has(word.replace(/'s?$/, "")), `${label}: "${word}" is title-cased in "${text}"`);
  }
}
const ORGS: Array<[string, SetupOrganization, OrganizationOnboardingAnswers | undefined]> = [
  ["cbca", cbca, preparingAnswers("federal_cbca")],
  ["bc company", bcCompany, preparingAnswers("bc_company")],
  ["bc society", bcSociety, preparingAnswers("bc_society")],
  ["alberta", albertaCompany, undefined],
  ["cnca", cnca, undefined],
  ["existing bc company", { ...bcCompany, formationStatus: "unverified_existing", organizationStatus: "active", incorporationNumber: "BC1234567" }, undefined],
  ["existing society", { ...bcSociety, formationStatus: "unverified_existing", organizationStatus: "active" }, undefined],
  ["submitted cbca", { ...cbca, formationStatus: "submitted" }, undefined],
  ["incorporated cbca", { ...cbca, formationStatus: "incorporated", organizationStatus: "active", certificateDate: "2026-02-01" }, preparingAnswers("federal_cbca")],
];
for (const [label, organization, answers] of ORGS) {
  const progress = evaluateOrganizationSetup(facts(organization, {}, answers));
  for (const phase of progress.phases) {
    assertSentenceCase(phase.title, `${label} phase`);
    assert.doesNotMatch(`${phase.title} ${phase.description}`, BANNED, `${label}: phase copy`);
    for (const step of phase.steps) {
      assertSentenceCase(step.title, `${label} ${step.key}`);
      assert.doesNotMatch(`${step.title} ${step.description} ${step.note ?? ""}`, BANNED, `${label}: ${step.key} copy`);
      assert.ok(step.description.endsWith(".") , `${label}: ${step.key} description ends with a full stop`);
      assert.equal(step.phase, phase.key);
      if (step.to) {
        assert.ok(step.to.startsWith("/app/"), `${label}: ${step.key} links inside the app`);
        // A section anchor stays last, after the return-to-setup param.
        const href = setupStepHref(step.to, step.key);
        assert.match(href, new RegExp(`[?&]setup=${step.key}(#[\\w-]+)?$`), `${label}: ${step.key} keeps setup before any anchor`);
      }
    }
    const keys = phase.steps.map((step) => step.key);
    assert.equal(new Set(keys).size, keys.length, `${label}: unique step keys in ${phase.key}`);
  }
  const all = steps(progress).map((step) => step.key);
  assert.equal(new Set(all).size, all.length, `${label}: step keys unique across phases`);
}

/* ---------------- CBCA preparing, fresh ---------------- */
{
  const progress = evaluateOrganizationSetup(facts(cbca, {}, preparingAnswers("federal_cbca")));
  assert.equal(progress.variant, "corporation_preparing");
  assert.equal(progress.currentPhase, "prepare");
  assert.deepEqual(progress.phases.map((phase) => phase.key), ["prepare", "file", "organize", "maintain"]);
  assert.deepEqual(progress.phases.map((phase) => phase.title), ["Get ready to file", "File with Corporations Canada", "After your certificate arrives", "Keep it in good standing"]);
  assert.equal(stepOf(progress, "act").state, "done");
  assert.equal(stepOf(progress, "name").state, "in_progress");
  assert.equal(stepOf(progress, "name").note, "Working name saved: Northstar Corp.");
  assert.equal(progress.next?.key, "office");
  assert.equal(progress.next?.title, "Add the registered office address");
  assert.equal(progress.next?.to, "/app/society#registered-office");
  // No step asks for an incorporation number before the certificate.
  assert.equal(hasStep(progress, "number"), false);
  assert.ok(!steps(progress).some((step) => step.phase === "prepare" && /incorporation number|corporation number/i.test(`${step.title} ${step.description}`)));
  assert.ok(stepOf(progress, "certificate").description.includes("corporation number"));
  assert.equal(stepOf(progress, "directors").description, "At least one person. At least 25% must be resident Canadians. Each director must agree to act.");
  assert.equal(stepOf(progress, "isc").title, "List people with significant control");
  assert.equal(stepOf(progress, "isc").allowNotApplicable, true);
  assert.equal(stepOf(progress, "review").optional, true);
  assert.equal(hasStep(progress, "records-office"), false);
  const file = stepOf(progress, "file");
  assert.equal(file.title, "File your incorporation online");
  assert.equal(file.action, "mark_submitted");
  assert.equal(file.externalLabel, "Open Corporations Canada");
  assert.ok(file.externalUrl?.startsWith("https://ised-isde.canada.ca/"));
  assert.equal(stepOf(progress, "certificate").action, "record_certificate");
  assert.equal(phaseOf(progress, "maintain").status, "upcoming");
  assert.equal(phaseOf(progress, "prepare").status, "current");
  // Counts: required steps over prepare..organize; optional review/provinces excluded.
  const required = steps(progress).filter((step) => step.phase !== "maintain" && !step.optional);
  assert.equal(progress.counts.total, required.length);
  assert.equal(progress.counts.done, 1);
  assert.equal(progress.complete, false);
  assert.equal(phaseOf(progress, "prepare").total, phaseOf(progress, "prepare").steps.filter((step) => !step.optional).length);
  assert.ok(allText(progress).includes("Corporations Canada"));
  assert.doesNotMatch(allText(progress), /\bsociety\b|\bmembers?\b|\bAGM\b|\bconstitution\b|\bbylaws\b|BC Registries/i);
}

/* ---------------- Records added: phase 1 → phase 2 ---------------- */
{
  const ready = facts({ ...cbca, registeredOfficeAddress: "1 Main St\nOttawa ON", numbered: true }, {
    roles: { director: { current: 0, proposed: 1 }, officer: { current: 0, proposed: 0 }, shareholder: { current: 0, proposed: 0 }, controller: { current: 0, proposed: 0 } },
    shareClasses: 1,
    evidence: { "prepare-federal-articles": "preparing" },
  }, preparingAnswers("federal_cbca"));
  let progress = evaluateOrganizationSetup(ready);
  assert.equal(stepOf(progress, "name").state, "done");
  assert.equal(stepOf(progress, "directors").state, "done", "a proposed director completes the step");
  assert.equal(stepOf(progress, "articles").state, "done");
  // Articles linked on the profile count as prepared, with no worksheet.
  const linked = evaluateOrganizationSetup(facts({ ...cbca, hasConstitutionDocument: true }, {}, preparingAnswers("federal_cbca")));
  assert.equal(stepOf(linked, "articles").state, "done", "articles on file complete the articles step");
  assert.equal(stepOf(linked, "articles").note, "Articles on file");
  assert.equal(progress.currentPhase, "prepare", "ISC is still open");
  assert.equal(progress.next?.key, "isc");
  // "Doesn't apply" needs a reason; without one it is ignored.
  progress = evaluateOrganizationSetup(ready, [decision("isc", "not_applicable")]);
  assert.equal(stepOf(progress, "isc").state, "todo");
  const totalBefore = progress.counts.total;
  progress = evaluateOrganizationSetup(ready, [decision("isc", "not_applicable", "No one owns 25% or more")]);
  assert.equal(stepOf(progress, "isc").state, "not_applicable");
  assert.equal(stepOf(progress, "isc").note, "No one owns 25% or more");
  assert.equal(progress.counts.total, totalBefore - 1, "not_applicable leaves the total");
  assert.equal(progress.currentPhase, "file", "every required phase-1 step is done or decided");
  assert.equal(progress.next?.key, "file");
  assert.equal(progress.next?.action, "mark_submitted");
  assert.equal(phaseOf(progress, "prepare").status, "complete");
  // A step that doesn't allow "Doesn't apply" ignores such a decision.
  assert.equal(stepOf(evaluateOrganizationSetup(facts(cbca, {}, preparingAnswers("federal_cbca")), [decision("office", "not_applicable", "x")]), "office").state, "todo");
}

/* ---------------- Remind me later ---------------- */
{
  const base = facts(cbca, {}, preparingAnswers("federal_cbca"));
  const later = evaluateOrganizationSetup(base, [decision("office", "later")]);
  assert.equal(stepOf(later, "office").state, "later");
  assert.equal(later.next?.key, "directors", "later steps are never the next step");
  assert.equal(later.counts.total, evaluateOrganizationSetup(base).counts.total, "later stays in the total");
  const prepareKeys = phaseOf(later, "prepare").steps.map((step) => step.key);
  assert.equal(prepareKeys.at(-1), "office", "later steps drop to the bottom of their phase");
  // Lifecycle steps can't be put off.
  assert.equal(stepOf(evaluateOrganizationSetup(base, [decision("file", "later")]), "file").state, "todo");
  // Decisions for unknown or other-variant keys are ignored.
  assert.equal(hasStep(evaluateOrganizationSetup(base, [decision("members", "later")]), "members"), false);
}

/* ---------------- Restricted steps ---------------- */
{
  const memberPermissions = new Set<string>(ROLE_MATRIX.Member);
  const progress = evaluateOrganizationSetup(facts({ ...cbca, registeredOfficeAddress: "1 Main St" }, {}, preparingAnswers("federal_cbca")), [], memberPermissions);
  // Members can't read directors or the significant-control register.
  assert.equal(stepOf(progress, "directors").state, "restricted");
  assert.equal(stepOf(progress, "directors").note, "Ask an owner or admin to do this");
  assert.equal(stepOf(progress, "isc").state, "restricted");
  assert.notEqual(progress.next?.key, "directors");
  assert.ok(progress.next, "a readable step is still recommended");
  assert.ok(!["directors", "isc", "articles", "review"].includes(progress.next!.key));
  // A predicate works too, and done steps stay done even when restricted.
  const nobody = evaluateOrganizationSetup(facts({ ...cbca, registeredOfficeAddress: "1 Main St" }, {}, preparingAnswers("federal_cbca")), [], () => false);
  assert.equal(stepOf(nobody, "act").state, "done");
  assert.equal(stepOf(nobody, "office").state, "done");
  assert.equal(stepOf(nobody, "directors").state, "restricted");
  assert.equal(nobody.next?.key, "file", "only steps without a page (lifecycle actions) remain");
}

/* ---------------- CBCA submitted → waiting ---------------- */
{
  const submitted = { ...cbca, formationStatus: "submitted", filingSubmittedAtISO: "2026-10-10", filingReference: "CC-123" };
  const progress = evaluateOrganizationSetup(facts(submitted, {}, preparingAnswers("federal_cbca")));
  assert.equal(progress.currentPhase, "file");
  assert.equal(phaseOf(progress, "file").statusNote, "Waiting for Corporations Canada");
  assert.equal(stepOf(progress, "file").state, "done");
  assert.equal(stepOf(progress, "file").note, "Filed on 2026-10-10 · Reference CC-123");
  assert.equal(progress.next?.key, "certificate");
  assert.equal(progress.next?.action, "record_certificate");
}

/* ---------------- CBCA incorporated → organize → maintain ---------------- */
{
  const incorporated = { ...cbca, formationStatus: "incorporated", organizationStatus: "active", certificateDate: "2026-02-01", incorporationNumber: "1234567-8", registeredOfficeAddress: "1 Main St", numbered: true };
  let progress = evaluateOrganizationSetup(facts(incorporated, { generatedPackets: ["organize-corporation"] }, preparingAnswers("federal_cbca")));
  assert.equal(progress.variant, "corporation_preparing");
  assert.equal(progress.currentPhase, "organize");
  assert.equal(stepOf(progress, "certificate").state, "done");
  assert.equal(stepOf(progress, "certificate").note, "Incorporated on February 1, 2026");
  assert.equal(stepOf(progress, "organize").state, "in_progress", "the organize packet counts as started");
  assert.equal(phaseOf(progress, "maintain").status, "ongoing");
  // Without answers, a workspace that went through "I've filed it" keeps the preparing track.
  assert.equal(setupVariant({ ...incorporated, filingSubmittedAtISO: "2026-01-10" }), "corporation_preparing");
  assert.equal(setupVariant(incorporated), "existing", "incorporated without having prepared here");
  // Everything in organize done → maintain.
  const roles = { director: { current: 1, proposed: 0 }, officer: { current: 1, proposed: 0 }, shareholder: { current: 1, proposed: 0 }, controller: { current: 1, proposed: 0 } };
  progress = evaluateOrganizationSetup(facts({ ...incorporated, craBnStatus: "confirmed" }, {
    roles, shareClasses: 1, holdings: 1, issuances: { posted: 1, draft: 0 }, users: 2,
    evidence: { "prepare-federal-articles": "executed", "hold-organizational-meeting": "executed" },
  }, preparingAnswers("federal_cbca")));
  assert.equal(progress.currentPhase, "maintain");
  assert.equal(progress.complete, true);
  assert.equal(progress.counts.done, progress.counts.total);
  assert.equal(progress.next?.key, "fiscal-year");
}

/* ---------------- BC company ---------------- */
{
  const progress = evaluateOrganizationSetup(facts(bcCompany, {}, preparingAnswers("bc_company")));
  assert.equal(progress.variant, "corporation_preparing");
  assert.equal(phaseOf(progress, "file").title, "File with BC Registries");
  assert.equal(stepOf(progress, "records-office").title, "Add the records office address");
  assert.equal(stepOf(progress, "articles").title, "Prepare the incorporation agreement and articles");
  assert.equal(stepOf(progress, "isc").title, "Plan your transparency register");
  assert.equal(stepOf(progress, "directors").description, "At least one director. There's no residency rule. Each director must agree to act.");
  assert.equal(stepOf(progress, "file").externalLabel, "Open BC Corporate Online");
  assert.ok(stepOf(progress, "certificate").description.includes("incorporation number"));
  const text = allText(progress);
  assert.doesNotMatch(text, /significant control|NUANS|Corporations Canada|resident Canadians/i, "no federal wording in a BC company");
  assert.doesNotMatch(text, /\bby-?laws?\b|\bsociety\b|\bmembers?\b|\bconstitution\b/i, "BC company copy uses articles only");
  // Federal copy never says BC Registries.
  assert.doesNotMatch(allText(evaluateOrganizationSetup(facts(cbca))), /BC Registries|BC Corporate Online|transparency register/);
}

/* ---------------- BC society preparing ---------------- */
{
  const answers = preparingAnswers("bc_society");
  let progress = evaluateOrganizationSetup(facts(bcSociety, { societyDirectors: 1 }, answers));
  assert.equal(progress.variant, "society_preparing");
  assert.equal(stepOf(progress, "name").action, undefined, "societies can't use a numbered name, so no numbered-name choice");
  assert.match(String(stepOf(progress, "name").to), /new=nameSearch/);
  assert.deepEqual(progress.phases.map((phase) => phase.title), ["Get ready to apply", "Apply to BC Registries", "After your society is incorporated", "Keep it in good standing"]);
  assert.equal(stepOf(progress, "name").title, "Reserve your society's name");
  assert.equal(stepOf(progress, "directors").state, "in_progress");
  assert.equal(stepOf(progress, "directors").note, "1 of 3 added");
  assert.equal(stepOf(progress, "file").title, "Apply through Societies Online");
  assert.equal(stepOf(progress, "file").externalLabel, "Open Societies Online");
  progress = evaluateOrganizationSetup(facts(bcSociety, { societyDirectors: 3 }, answers));
  assert.equal(stepOf(progress, "directors").state, "done");
  // Member-funded societies need only one director.
  progress = evaluateOrganizationSetup(facts({ ...bcSociety, isMemberFunded: true, legalSubtype: "member_funded_society" }, { societyDirectors: 1 }, answers));
  assert.equal(stepOf(progress, "directors").state, "done");
  for (const key of ["constitution", "bylaws", "members", "first-meeting", "tax", "agm"] as SetupStepKey[]) assert.ok(hasStep(progress, key), `society step ${key}`);
  for (const key of ["shares", "isc", "articles", "issue-shares", "officers", "annual-meeting"] as SetupStepKey[]) assert.equal(hasStep(progress, key), false, `no corporate step ${key}`);
  assert.doesNotMatch(allText(progress), /\bshares?\b|shareholders?|\bby-laws\b|Corporations Canada|articles/i, "society wording only");
  // Constitution in progress when the packet is generated, done with the document.
  progress = evaluateOrganizationSetup(facts(bcSociety, { generatedPackets: ["society-incorporation-constitution"] }, answers));
  assert.equal(stepOf(progress, "constitution").state, "in_progress");
  progress = evaluateOrganizationSetup(facts({ ...bcSociety, hasConstitutionDocument: true }, {}, answers));
  assert.equal(stepOf(progress, "constitution").state, "done");
}

/* ---------------- Tax registration lifecycle ---------------- */
{
  const tax = (organization: SetupOrganization, charityRegistration?: OrganizationSetupFacts["charityRegistration"]) => stepOf(evaluateOrganizationSetup(facts({ ...bcSociety, ...organization }, { charityRegistration })), "tax");
  assert.equal(tax({ craBnStatus: "pending", charityStatus: "application_pending" }).state, "in_progress", "recording pending applications must not complete the tax step");
  assert.equal(tax({ craBnStatus: "confirmed", charityStatus: "application_pending" }).state, "in_progress");
  assert.equal(tax({ craBnStatus: "pending", charityStatus: "not_applied" }).state, "in_progress");
  assert.equal(tax({ isCharity: false, charityStatus: "unknown", craBnStatus: "unknown" }).state, "todo", "false/default is not an established status");
  assert.equal(tax({ isCharity: true, charityStatus: "registered", craBnStatus: "confirmed" }).state, "in_progress", "legacy registered flag alone is not reviewed registration evidence");
  assert.equal(tax({ isCharity: false, charityStatus: "registered", craBnStatus: "confirmed" }).state, "in_progress");
  assert.equal(tax({ isCharity: false, charityStatus: "not_applied", craBnStatus: "confirmed" }).state, "done");
  assert.equal(tax({ isCharity: false, charityStatus: "application_pending", craBnStatus: "confirmed" }, { status: "registered", hasHistory: true }).state, "done", "reviewed dated history resolves the earlier application claim");
  assert.equal(tax({ isCharity: true, charityStatus: "registered", craBnStatus: "confirmed" }, { status: "conflict", hasHistory: true }).state, "in_progress");
}

/* ---------------- Existing BC company ---------------- */
{
  const existing = { ...bcCompany, formationStatus: "unverified_existing", organizationStatus: "active", incorporationNumber: "BC1234567", registeredOfficeAddress: "1 Main St" };
  let progress = evaluateOrganizationSetup(facts(existing));
  assert.equal(progress.variant, "existing");
  assert.deepEqual(progress.phases.map((phase) => phase.title), ["Confirm the basics", "Add your people", "Add your records", "Keep it in good standing"]);
  assert.equal(progress.currentPhase, "prepare");
  assert.equal(stepOf(progress, "certificate").title, "Upload your certificate of incorporation");
  assert.equal(stepOf(progress, "number").state, "done");
  assert.equal(progress.next?.key, "certificate");
  assert.equal(stepOf(progress, "governing-docs").title, "Upload your articles");
  assert.equal(stepOf(progress, "isc-register").title, "Add your transparency register");
  assert.equal(phaseOf(progress, "maintain").status, "ongoing");
  assert.ok(hasStep(progress, "meetings") && hasStep(progress, "filings"));
  // Certificate recorded → first phase with an open required step is "Add your people".
  progress = evaluateOrganizationSetup(facts({ ...existing, formationStatus: "incorporated", certificateDate: "2023-05-10" }));
  assert.equal(progress.currentPhase, "file");
  assert.equal(progress.next?.key, "directors");
  assert.equal(phaseOf(progress, "prepare").status, "complete");
  // Existing society wording.
  const society = evaluateOrganizationSetup(facts({ ...bcSociety, formationStatus: "unverified_existing", organizationStatus: "active" }));
  assert.equal(stepOf(society, "governing-docs").title, "Upload your constitution and bylaws");
  assert.equal(stepOf(society, "owners").title, "Add your members");
  assert.equal(stepOf(society, "directors").to, "/app/directors");
  assert.equal(hasStep(society, "officers"), false);
  assert.ok(hasStep(society, "agm"));
  // Legacy blank status is "already incorporated".
  assert.equal(setupVariant({ ...bcSociety, formationStatus: "" }), "existing");
}

/* ---------------- Records-only Act (Alberta) ---------------- */
{
  const progress = evaluateOrganizationSetup(facts(albertaCompany));
  assert.equal(progress.variant, "corporation_preparing");
  for (const key of ["articles", "review", "organize", "isc", "isc-register", "records-office"] as SetupStepKey[]) assert.equal(hasStep(progress, key), false, `records-only hides ${key}`);
  const file = stepOf(progress, "file");
  assert.equal(file.title, "File your incorporation");
  assert.equal(file.externalUrl, undefined, "no official link without guidance");
  assert.equal(file.description, "Societyer doesn't have step-by-step guidance for the Business Corporations Act yet. Use the registry's own instructions.");
  assert.equal(phaseOf(progress, "file").title, "File with the Alberta registry");
  assert.equal(stepOf(progress, "act").state, "done");
  assert.equal(stepOf(progress, "act").description, "Alberta, under the Business Corporations Act. You chose this when you created the workspace.");
}

/* ---------------- CNCA (not-for-profit corporation): member wording ---------------- */
{
  const progress = evaluateOrganizationSetup(facts(cnca));
  assert.equal(progress.variant, "corporation_preparing");
  assert.equal(phaseOf(progress, "file").title, "File with Corporations Canada");
  assert.equal(stepOf(progress, "name").title, "Choose your corporation's name");
  assert.equal(stepOf(progress, "shares").title, "Set out your membership classes");
  assert.ok(hasStep(progress, "members"));
  assert.equal(hasStep(progress, "issue-shares"), false);
  assert.match(stepOf(progress, "access").description, /Directors and members/);
  assert.match(stepOf(progress, "annual-meeting").title, /members' meeting/);
  assert.doesNotMatch(allText(progress), /shareholders?|\bshares\b/i);
}

/* ---------------- Shares in progress from setup notes ---------------- */
{
  const progress = evaluateOrganizationSetup(facts(cbca, {}, preparingAnswers("federal_cbca", { governanceStructure: "multiple_classes", classDetails: "Class A voting common" })));
  assert.equal(stepOf(progress, "shares").state, "in_progress");
  assert.equal(stepOf(progress, "shares").note, "Notes from setup: Class A voting common");
}

/* ---------------- Saved answers in plain language ---------------- */
{
  const lines = onboardingAnswerSentences(preparingAnswers("federal_cbca", { operatingRegions: "Ontario and Quebec" }), cbca);
  assert.deepEqual(lines, [
    "Share classes: not decided yet",
    "Documents: you'll draft them here",
    "People: you'll add them later",
    "Where you'll operate: Ontario and Quebec",
  ]);
  const society = describeOnboardingAnswers({ ...preparingAnswers("bc_society"), governanceStructure: "single_class", governanceDocuments: "available", peopleReadiness: "ready_to_add" }, bcSociety);
  assert.deepEqual(society.map((line) => `${line.label}: ${line.value}`), ["Membership classes: one membership class", "Documents: you have signed copies to upload", "People: details ready to enter"]);
  assert.deepEqual(describeOnboardingAnswers(undefined, cbca), []);
  for (const line of lines) assert.doesNotMatch(line, BANNED);
}

/* ---------------- Name requests: pending, approved, expiring, rejected ---------------- */
// Times converted between zones use past dates (February 2026). B.C. has kept UTC-7 all year since
// 2026-11-01 (tzdata 2026b), and later dates give different answers on older and newer time zone data.
{
  const answers = preparingAnswers("federal_cbca");
  const ddc: SetupOrganization = { ...cbca, name: "DDC North Inc." };
  const nameStep = (patch: Partial<OrganizationSetupFacts>, organization: SetupOrganization = ddc) =>
    stepOf(evaluateOrganizationSetup(facts(organization, patch, answers)), "name");

  // Submitted and waiting: in progress, with the dates and a link to record the decision. The server words the
  // time on the organization's clock; the parts let the view word it on the viewer's.
  const pending = nameStep({ nameRequest: { state: "pending", id: "ns_1", name: "DDC North Inc.", requestId: "21480579", submittedOn: "2026-02-17", decisionExpectedAtISO: "2026-02-18T14:00:00-08:00", timeZone: "America/Vancouver" } });
  assert.equal(pending.state, "in_progress");
  assert.equal(pending.note, "Submitted Feb 17 · decision expected Feb 18, 2:00 p.m. PST");
  assert.deepEqual(pending.noteParts, [{ text: "Submitted Feb 17 · decision expected " }, { at: "2026-02-18T14:00:00-08:00" }]);
  assert.equal(stepNoteText({ ...pending, noteParts: pending.noteParts }), `Submitted Feb 17 · decision expected ${formatDecisionExpected("2026-02-18T14:00:00-08:00")}`, "the view rewords the time on the runtime's clock");
  // No organization zone: the server words it in UTC; a day alone needs no zone and no parts.
  assert.equal(nameStep({ nameRequest: { state: "pending", id: "ns_1", submittedOn: "2026-02-17", decisionExpectedAtISO: "2026-02-18T14:00:00-08:00" } }).note, "Submitted Feb 17 · decision expected Feb 18, 10:00 p.m. UTC");
  const dayOnly = nameStep({ nameRequest: { state: "pending", id: "ns_1", submittedOn: "2026-11-17", decisionExpectedAtISO: "2026-11-18" } });
  assert.equal(dayOnly.note, "Submitted Nov 17 · decision expected Nov 18");
  assert.equal(dayOnly.noteParts, undefined);
  assert.equal(pending.actionLabel, "Record the decision");
  assert.equal(pending.to, "/app/formation-maintenance?nameSearch=ns_1");
  assert.equal(pending.action, undefined, "no numbered-name choice while a request is pending");
  // A pending request is never done, whatever the pathway or a NUANS number says.
  assert.equal(nameStep({ nameRequest: { state: "pending", id: "ns_1" }, pathwayRun: { nodes: { "name-approval": "completed" } } }).state, "in_progress");

  // Approved, well before expiry: done, with the approved name.
  const approved = nameStep({ nameRequest: { state: "approved", id: "ns_1", name: "DDC North Inc.", requestId: "21480579", decidedOn: "2026-11-18", expiresOn: "2027-02-16", daysUntilExpiry: 90 } });
  assert.equal(approved.state, "done");
  assert.equal(approved.note, "Name: DDC North Inc. · approved");
  assert.equal(approved.to, "/app/formation-maintenance?nameSearch=ns_1", "Open goes to the approved request");

  // Approved but expiring within 14 days before filing: a warning, back in progress.
  const expiring = nameStep({ nameRequest: { state: "approved", id: "ns_1", name: "DDC North Inc.", expiresOn: "2027-02-16", daysUntilExpiry: 10 } });
  assert.equal(expiring.state, "in_progress");
  assert.equal(expiring.noteTone, "warning");
  assert.equal(expiring.note, "Name approval expires Feb 16 — file before then");
  const expired = nameStep({ nameRequest: { state: "approved", id: "ns_1", name: "DDC North Inc.", expiresOn: "2027-02-16", daysUntilExpiry: -1 } });
  assert.equal(expired.state, "in_progress");
  assert.equal(expired.note, "Name approval expired Feb 16");
  // Once filed, expiry no longer matters.
  assert.equal(nameStep({ nameRequest: { state: "approved", name: "DDC North Inc.", expiresOn: "2027-02-16", daysUntilExpiry: -1 } }, { ...ddc, formationStatus: "submitted" }).state, "done");

  // Rejected: try another name (the numbered-name choice stays).
  const rejected = nameStep({ nameRequest: { state: "rejected", id: "ns_2", name: "DDC North Inc." } });
  assert.equal(rejected.state, "in_progress");
  assert.equal(rejected.note, "Name request rejected — try another name");
  assert.equal(rejected.action, "choose_name");

  // A legacy approval (NUANS number on a formation record, no statuses) reads the workspace name.
  assert.equal(nameStep({ nameRequest: { state: "approved" } }).note, "Name: DDC North Inc.");

  // The articles and filing steps carry the approved name; a different workspace name is a warning.
  const approvedFacts = { nameRequest: { state: "approved" as const, name: "DDC North Inc.", requestId: "21480579", daysUntilExpiry: 90 } };
  let progress = evaluateOrganizationSetup(facts(ddc, approvedFacts, answers));
  assert.equal(stepOf(progress, "articles").note, "Approved name: DDC North Inc. (request 21480579)");
  assert.equal(stepOf(progress, "file").note, "Approved name: DDC North Inc. (request 21480579)");
  progress = evaluateOrganizationSetup(facts({ ...ddc, name: "DDC Holdings Inc." }, approvedFacts, answers));
  assert.match(String(stepOf(progress, "articles").note), /workspace is named DDC Holdings Inc\.; change it to match/);
  assert.equal(stepOf(progress, "articles").noteTone, "warning");
}

/* ---------------- Name request summary ---------------- */
{
  const rows = [
    { _id: "a", name: "DDC North", suffix: "inc", status: "rejected", updatedAtISO: "2026-02-10T00:00:00Z" },
    { _id: "b", name: "DDC North", suffix: "inc", status: "submitted", requestId: "21480579", submittedOn: "2026-02-17", decisionExpectedAtISO: "2026-02-18T14:00", updatedAtISO: "2026-02-17T00:00:00Z" },
  ];
  const pending = summarizeNameRequests(rows, { legacyApproval: true, timeZone: "America/Vancouver" });
  assert.equal(pending.state, "pending", "a pending request beats a rejection, and a NUANS number never counts while one is pending");
  assert.equal(pending.id, "b");
  assert.equal(pending.name, "DDC North Inc.");
  assert.equal(pending.decisionExpectedAtISO, "2026-02-18T14:00:00-08:00", "an older bare time is pinned to the organization's zone");
  assert.equal(pending.timeZone, "America/Vancouver");
  assert.equal(summarizeNameRequests(rows).decisionExpectedAtISO, "2026-02-18T14:00", "without a zone it stays as saved");
  const approved = summarizeNameRequests([...rows, { _id: "c", name: "DDC North Inc.", status: "approved", decidedOn: "2026-11-18", expiresOn: "2027-02-16", updatedAtISO: "2026-11-18T00:00:00Z" }], { today: "2026-11-18" });
  assert.equal(approved.state, "approved");
  assert.equal(approved.daysUntilExpiry, 90);
  // Legacy rows: success true is approved; otherwise searching, which decides nothing.
  assert.equal(nameRequestStatus({ success: true }), "approved");
  assert.equal(nameRequestStatus({ success: false }), "searching");
  assert.equal(summarizeNameRequests([{ success: true, name: "Old Name Ltd." }]).state, "approved");
  assert.equal(summarizeNameRequests([], { legacyApproval: true }).state, "approved");
  assert.equal(summarizeNameRequests([{ status: "searching", name: "X" }], { legacyApproval: true }).state, "none", "statuses switch the NUANS fallback off");
  assert.equal(suggestedNameApprovalExpiry("2026-11-18"), "2027-02-16");
  assert.equal(nameRequestProgressLine(rows[1], { today: "2026-02-18", timeZone: "America/Vancouver" }), "Request 21480579 · Submitted Feb 17 · Decision expected Feb 18, 2:00 p.m. PST");
  assert.equal(nameRequestProgressLine(rows[1], { today: "2026-02-18", timeZone: "America/Toronto", sourceTimeZone: "America/Vancouver" }), "Request 21480579 · Submitted Feb 17 · Decision expected Feb 18, 5:00 p.m. EST", "an older bare time, given in Vancouver, read in Toronto");
  assert.equal(nameRequestProgressLine({ status: "approved", decidedOn: "2026-11-18", expiresOn: "2027-02-16" }, { today: "2026-11-18" }), "Approved Nov 18 · Expires Feb 16, 2027");
  assert.throws(() => assertNameRequestFields({ status: "pending" }), /status must be one of/);
  assert.throws(() => assertNameRequestFields({ decisionExpectedAtISO: "2026-11-18T25:00:00-08:00" }), /Decision expected/);
  assert.throws(() => assertNameRequestFields({ decisionExpectedAtISO: "2026-11-18T14:00" }), /needs a time zone/, "a new time is saved with its offset");
  assert.throws(() => assertNameRequestFields({ amountPaidCents: 13.8 }), /whole number/);
  assert.doesNotThrow(() => assertNameRequestFields({ status: "submitted", submittedOn: "2026-11-17", decisionExpectedAtISO: "2026-11-18T14:00:00-08:00", contactEmail: "owner@example.com", amountPaidCents: 1380, similarNamesReviewed: 50, exactMatchesFound: 0 }));
  assert.doesNotThrow(() => assertNameRequestFields({ decisionExpectedAtISO: "2026-11-18" }));
  const packet = nameApprovalPacketView([{ name: "DDC North Inc.", status: "approved", registry: "Corporations Canada", requestId: "21480579", nuansReportNumber: "123466315", decidedOn: "2026-11-18" }], "DDC North Inc.", (day) => day);
  assert.equal(packet.name, "DDC North Inc.");
  assert.equal(packet.line, "Proposed corporate name: DDC North Inc. Name approved by Corporations Canada on 2026-11-18 (request 21480579; NUANS 123466315). Use it exactly as approved in the application.");
}

/* ---------------- Decision times: zones, daylight time, the form ---------------- */
{
  // Saved with the offset of the chosen zone on that day, daylight time included.
  assert.equal(zonedDateTimeISO("2026-02-18", "14:00", "America/Vancouver"), "2026-02-18T14:00:00-08:00");
  assert.equal(zonedDateTimeISO("2026-07-02", "14:00", "America/Vancouver"), "2026-07-02T14:00:00-07:00");
  assert.equal(zonedDateTimeISO("2026-02-18", "14:00", "America/St_Johns"), "2026-02-18T14:00:00-03:30");
  assert.equal(zonedDateTimeISO("2026-03-08", "02:30", "America/Toronto"), "2026-03-08T03:30:00-04:00", "a skipped hour moves forward");
  assert.equal(timeZoneAbbreviation("America/St_Johns", Date.parse("2026-07-02T12:00:00Z")), "NDT");
  // Shown on the reader's clock, with its short name.
  assert.equal(formatDecisionExpected("2026-02-18T14:00:00-08:00", { timeZone: "America/Toronto" }), "Feb 18, 5:00 p.m. EST");
  assert.equal(formatDecisionExpected("2026-02-18T23:30:00-08:00", { timeZone: "America/Halifax" }), "Feb 19, 3:30 a.m. AST");
  assert.equal(formatDecisionExpected("2026-11-18", { timeZone: "America/Halifax" }), "Nov 18");

  // The form opens a saved time in the zone it was given in when it can tell.
  const vancouver = { viewerTimeZone: "America/Vancouver" };
  assert.deepEqual(decisionTimeFields("2026-02-18T14:00:00-08:00", vancouver), { date: "2026-02-18", time: "14:00", timeZone: "America/Vancouver" });
  assert.deepEqual(decisionTimeFields("2026-02-18T14:00:00-05:00", vancouver), { date: "2026-02-18", time: "14:00", timeZone: "America/Toronto" }, "an Eastern offset opens in Eastern time");
  assert.deepEqual(decisionTimeFields("2026-02-18T14:00:00+01:00", vancouver), { date: "2026-02-18", time: "05:00", timeZone: "America/Vancouver" }, "an unknown offset is converted to the viewer's zone");
  assert.deepEqual(decisionTimeFields("2026-11-18T14:00", { ...vancouver, sourceTimeZone: "America/Toronto" }), { date: "2026-11-18", time: "14:00", timeZone: "America/Toronto" }, "an older bare time opens in the organization's zone");
  assert.deepEqual(decisionTimeFields("2026-11-18", vancouver), { date: "2026-11-18", time: "", timeZone: "America/Vancouver" });
  assert.equal(decisionExpectedFromFields({ date: "2026-02-18", time: "14:00", timeZone: "America/Vancouver" }), "2026-02-18T14:00:00-08:00");
  assert.equal(decisionExpectedFromFields({ date: "2026-11-18", time: "", timeZone: "America/Vancouver" }), "2026-11-18");
  assert.equal(decisionExpectedFromFields({ date: "", time: "14:00" }), undefined);
  // The hint under the field converts to the viewer's clock only when it differs.
  assert.equal(decisionTimeViewerHint({ date: "2026-02-18", time: "14:00", timeZone: "America/Vancouver" }, "America/Toronto"), "That's 5:00 p.m. your time");
  assert.equal(decisionTimeViewerHint({ date: "2026-02-18", time: "23:00", timeZone: "America/Vancouver" }, "America/Toronto"), "That's Feb 19, 2:00 a.m. your time");
  assert.equal(decisionTimeViewerHint({ date: "2026-11-18", time: "14:00", timeZone: "America/Vancouver" }, "America/Vancouver"), undefined);
  assert.equal(decisionTimeViewerHint({ date: "2026-11-18", time: "", timeZone: "America/Halifax" }, "America/Vancouver"), undefined);

  // Import cleanup: each field on its own; what fails is named, the rest is kept.
  const cleaned = cleanImportedNameRequestFields({
    status: "Approved", registry: " Corporations Canada ", requestId: 21480579, decidedOn: "2026-11-18", expiresOn: "2026-11-01",
    decisionExpectedAtISO: "2026-11-18T14:00", contactEmail: "not an email", amountPaidCents: "1380", similarNamesReviewed: -1,
    supportingDocumentIds: ["local:approval.pdf", 7], submittedOn: "2026-02-30",
  });
  assert.deepEqual(cleaned.fields, {
    status: "approved", registry: "Corporations Canada", requestId: "21480579", decidedOn: "2026-11-18",
    decisionExpectedAtISO: "2026-11-18T14:00", amountPaidCents: 1380, supportingDocumentIds: ["local:approval.pdf"],
  });
  assert.deepEqual(cleaned.dropped.sort(), ["contactEmail", "expiresOn", "similarNamesReviewed", "submittedOn", "supportingDocumentIds"]);
  assert.deepEqual(cleanImportedNameRequestFields({ status: "pending", decisionExpectedAtISO: "tomorrow" }).dropped, ["status", "decisionExpectedAtISO"]);
}

/* ---------------- Catalogue helpers ---------------- */
{
  assert.equal(setupStepHref("/app/role-holders?role=director", "directors"), "/app/role-holders?role=director&setup=directors");
  const ctx = setupCopyContext(cbca);
  assert.equal(ctx.registry, "Corporations Canada");
  assert.equal(ctx.numberLabel, "corporation number");
  const catalogue = setupStepCatalogue("corporation_preparing", ctx);
  assert.deepEqual(catalogue.find((step) => step.key === "directors")?.readPermissions.sort(), ["directors:read", "documents:read"]);
  assert.deepEqual(catalogue.find((step) => step.key === "access")?.readPermissions.sort(), ["society:read", "users:read"]);
}

console.log("Organization setup steps: variants, phases, next step, counts, decisions, restricted steps, records-only Acts and wording checks passed.");
