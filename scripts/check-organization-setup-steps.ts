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
