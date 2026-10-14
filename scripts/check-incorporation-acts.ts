/**
 * Incorporation-Act catalogue gate (shared/incorporationActs.ts).
 *
 * - Every Act with full guidance maps to exactly the setup values its
 *   registered pathway produced in the old "pathway" picker, and still resolves
 *   to the same reviewed legal profile, pathway and jurisdiction module.
 * - Every other Act (and "Another Act" per jurisdiction) maps to a
 *   records-only setup: no legal profile, no pathway, no jurisdiction module.
 * - Stored values are allowed options, setup answers round-trip, and the
 *   catalogue covers federal plus all 13 provinces and territories.
 *
 *   npm run test:incorporation-acts
 */
import assert from "node:assert/strict";
import {
  ANOTHER_ACT_VALUE, INCORPORATION_ACTS, INCORPORATION_JURISDICTIONS, RECORDS_ONLY_PATHWAY_KEY,
  anotherActFor, describeGoverningAct, incorporationActById, incorporationActForValue, incorporationActSetup,
  incorporationActSummary, incorporationActsFor, incorporationJurisdictionForCode, type IncorporationAct,
} from "../shared/incorporationActs";
import { PATHWAY_REGISTRY, getPathway, resolvePathway } from "../shared/pathways/registry";
import { legalGovernanceProfile, legalProfileRegistry } from "../shared/legalGovernanceProfiles";
import { jurisdictionDisplayCopy, jurisdictionModuleContract } from "../shared/jurisdictionWorkspace";
import { isCorporation, validateWorkspaceLegalIdentity } from "../shared/organizationDomain";
import { readOnboardingAnswersJson } from "../shared/onboarding";
import { SOURCE_OPTION_VALUES, isAllowedOption } from "../shared/orgHubOptions";
import { ORG_HUB_OPTION_SETS } from "../src/lib/orgHubOptions";
import { StaticConvexClient } from "../src/lib/staticConvex";

const problems: string[] = [];
const check = (condition: unknown, message: string) => { if (!condition) problems.push(message); };

// ---------------------------------------------------------------------------
// Catalogue shape and coverage
// ---------------------------------------------------------------------------
const ids = INCORPORATION_ACTS.map((act) => act.id);
check(new Set(ids).size === ids.length, "Catalogue ids must be unique.");
const values = INCORPORATION_ACTS.flatMap((act) => [act.actFormedUnder, ...(act.actAliases ?? [])]);
check(new Set(values).size === values.length, "Each stored Act value must name one catalogue Act.");
check(INCORPORATION_JURISDICTIONS.filter((place) => place.level === "federal").length === 1, "One federal jurisdiction.");
check(INCORPORATION_JURISDICTIONS.filter((place) => place.level !== "federal").length === 13, "All 13 provinces and territories.");
for (const place of INCORPORATION_JURISDICTIONS) {
  const listed = INCORPORATION_ACTS.filter((act) => act.jurisdiction === place.id);
  check(listed.some((act) => act.entityKinds.includes("business_corporation")), `${place.name}: list its business-corporations Act.`);
  check(incorporationActsFor(place.id).at(-1)?.actFormedUnder === ANOTHER_ACT_VALUE, `${place.name}: end with "Another Act".`);
  check(incorporationActById(anotherActFor(place.id).id)?.jurisdiction === place.id, `${place.name}: "Another Act" id round-trips.`);
  for (const alias of place.aliases) check(incorporationJurisdictionForCode(alias)?.id === place.id, `${alias} resolves to ${place.name}.`);
}
for (const required of ["ca-cbca", "ca-cnca", "ca-coops", "bc-societies", "bc-bca", "bc-coops", "on-obca", "on-onca", "on-coops", "ab-bca", "ab-societies", "ab-companies-part9", "qc-bca", "qc-companies-part3"]) {
  check(incorporationActById(required), `Catalogue must include ${required}.`);
}
for (const act of INCORPORATION_ACTS) {
  check(act.summary.trim().length > 0 && act.summary.length <= 120, `${act.id}: one-line summary.`);
  check(act.entityKinds.length > 0, `${act.id}: at least one entity kind.`);
  check(act.support === "full" ? Boolean(act.pathwayKey) : !act.pathwayKey, `${act.id}: only full-guidance Acts name a pathway.`);
}

// ---------------------------------------------------------------------------
// Full guidance: same values the old pathway picker produced
// ---------------------------------------------------------------------------
const full = INCORPORATION_ACTS.filter((act) => act.support === "full");
check(full.map((act) => act.pathwayKey).sort().join() === PATHWAY_REGISTRY.map((pathway) => pathway.key).sort().join(), "Every registered pathway has exactly one full-guidance Act.");
for (const act of full) {
  const pathway = getPathway(act.pathwayKey!);
  if (!pathway) { problems.push(`${act.id}: pathway ${act.pathwayKey} is not registered.`); continue; }
  // The old picker's choosePathway(): pathway setup + first subtype + cleared flags.
  const legacy = {
    jurisdictionCode: pathway.setup.jurisdictionCode, entityType: pathway.setup.entityType, actFormedUnder: pathway.setup.actFormedUnder,
    legalSubtype: pathway.eligibility.subtypes[0] ?? "other", isMemberFunded: false, isCharity: false, numbered: false, distributing: false, charityStatus: "unknown",
    pathwayKey: pathway.key,
  };
  assert.deepEqual(incorporationActSetup(act), legacy, `${act.id}: setup must equal the ${pathway.key} pathway's setup.`);
  const setup = incorporationActSetup(act);
  const profile = legalGovernanceProfile(setup);
  check(profile?.actKeys.includes(act.actFormedUnder), `${act.id}: resolves its reviewed legal profile.`);
  // Jurisdiction + entity + Act identify the pathway (OBCA records an unreviewed subtype, as before).
  check(resolvePathway({ ...setup, legalSubtype: pathway.eligibility.subtypes.length ? setup.legalSubtype : undefined }).pathway?.key === pathway.key, `${act.id}: resolves pathway ${pathway.key}.`);
  check(jurisdictionModuleContract(setup).registryPortalKey !== "generic_registry", `${act.id}: keeps its jurisdiction module.`);
  check(incorporationActForValue(act.actFormedUnder, act.jurisdictionCode)?.id === act.id, `${act.id}: stored value resolves back.`);
}

// ---------------------------------------------------------------------------
// Records only: no profile, pathway or module
// ---------------------------------------------------------------------------
const recordsOnly: IncorporationAct[] = [
  ...INCORPORATION_ACTS.filter((act) => act.support === "records_only"),
  ...INCORPORATION_JURISDICTIONS.map((place) => anotherActFor(place.id)),
];
for (const act of recordsOnly) {
  for (const kind of act.entityKinds) {
    const setup = incorporationActSetup(act, kind);
    const label = `${act.id}/${kind}`;
    check(setup.pathwayKey === RECORDS_ONLY_PATHWAY_KEY, `${label}: records-only pathway key.`);
    check(setup.legalSubtype === "other", `${label}: legal subtype needs review.`);
    check(!legalProfileRegistry.resolve(setup), `${label}: must not inherit a legal profile.`);
    check(!resolvePathway(setup).pathway && !resolvePathway(setup).allowed, `${label}: must not resolve a preparation pathway.`);
    check(jurisdictionModuleContract(setup).registryPortalKey === "generic_registry", `${label}: must use the generic registry module (got ${jurisdictionModuleContract(setup).registryPortalKey}).`);
    check(jurisdictionDisplayCopy(setup).entityLabel === "organization", `${label}: must use neutral jurisdiction copy.`);
    check(isCorporation(setup) === (kind === "business_corporation"), `${label}: share-ledger copy only for business corporations.`);
    try { validateWorkspaceLegalIdentity(setup); } catch (error) { problems.push(`${label}: legal identity rejected: ${(error as Error).message}`); }
  }
}

// ---------------------------------------------------------------------------
// Stored values are allowed options with labels
// ---------------------------------------------------------------------------
const labels = (set: keyof typeof ORG_HUB_OPTION_SETS) => new Set((ORG_HUB_OPTION_SETS[set] as readonly { value: string }[]).map((option) => option.value));
for (const act of [...INCORPORATION_ACTS, ...recordsOnly]) {
  for (const kind of act.entityKinds) {
    const setup = incorporationActSetup(act, kind);
    check(isAllowedOption("actsFormedUnder", setup.actFormedUnder) && labels("actsFormedUnder").has(setup.actFormedUnder), `${act.id}: ${setup.actFormedUnder} must be an allowed, labelled Act option.`);
    check(isAllowedOption("entityTypes", setup.entityType) && labels("entityTypes").has(setup.entityType), `${act.id}: ${setup.entityType} must be an allowed, labelled entity type.`);
    check(SOURCE_OPTION_VALUES.entityJurisdictions.includes(setup.jurisdictionCode) && labels("entityJurisdictions").has(setup.jurisdictionCode), `${act.id}: ${setup.jurisdictionCode} must be an allowed, labelled jurisdiction.`);
  }
}

// ---------------------------------------------------------------------------
// Identity validation and setup answers
// ---------------------------------------------------------------------------
assert.throws(() => validateWorkspaceLegalIdentity({ jurisdictionCode: "CA-AB", entityType: "corporation__business_", actFormedUnder: "business_corporations_act__quebec_" }), /jurisdiction/);
assert.throws(() => validateWorkspaceLegalIdentity({ jurisdictionCode: "CA-ON", entityType: "corporation__business_", actFormedUnder: "not_for_profit_corporations_act__2010__ontario_" }), /same legal setup/);
validateWorkspaceLegalIdentity({ jurisdictionCode: "alberta", entityType: "society", actFormedUnder: "societies_act__alberta_" }); // legacy slug code

const baseAnswers = { version: 1, previousUse: "new", governanceStructure: "needs_review", classDetails: "", governanceDocuments: "needs_review", peopleReadiness: "add_later", operatingRegions: "" };
function organizationFor(act: IncorporationAct, stage: "preparing" | "existing", extra: Record<string, unknown> = {}) {
  const { pathwayKey, ...setup } = incorporationActSetup(act, act.entityKinds[0]);
  return {
    name: `${act.id} example`, ...setup,
    formationStatus: stage === "preparing" ? "preparing" : "unverified_existing", organizationStatus: stage === "preparing" ? "pre_incorporation" : "active",
    onboardingAnswersJson: JSON.stringify({ ...baseAnswers, organizationStage: stage, pathwayKey, incorporationActId: act.id, ...(act.actFormedUnder === ANOTHER_ACT_VALUE ? { otherActName: "Special Act" } : {}), ...extra }),
  };
}
for (const act of [...INCORPORATION_ACTS, ...recordsOnly]) for (const stage of ["preparing", "existing"] as const) {
  const organization = organizationFor(act, stage);
  try { readOnboardingAnswersJson(organization.onboardingAnswersJson, organization); } catch (error) { problems.push(`${act.id}/${stage}: setup answers rejected: ${(error as Error).message}`); }
}
const cbca = incorporationActById("ca-cbca")!;
const albertaBca = incorporationActById("ab-bca")!;
const albertaOther = anotherActFor("AB");
assert.throws(() => { const org = organizationFor(cbca, "existing"); readOnboardingAnswersJson(org.onboardingAnswersJson, { ...org, jurisdictionCode: "CA-FED" }); }, /disagree/);
assert.throws(() => { const org = organizationFor(albertaBca, "existing", { pathwayKey: "federal_cbca" }); readOnboardingAnswersJson(org.onboardingAnswersJson); }, /disagree/);
assert.throws(() => { const org = organizationFor(albertaBca, "existing", { incorporationActId: "zz-unknown" }); readOnboardingAnswersJson(org.onboardingAnswersJson); }, /Unknown governing Act/);
assert.throws(() => { const org = organizationFor(albertaOther, "existing", { otherActName: " " }); readOnboardingAnswersJson(org.onboardingAnswersJson); }, /name of the governing Act/);
assert.throws(() => { const org = organizationFor(albertaBca, "existing", { otherActName: "Not allowed here" }); readOnboardingAnswersJson(org.onboardingAnswersJson); }, /otherActName/);
assert.throws(() => readOnboardingAnswersJson(JSON.stringify({ ...baseAnswers, organizationStage: "existing", pathwayKey: RECORDS_ONLY_PATHWAY_KEY })), /must name the governing Act/);
// Older answers keep working: the manual existing route and pathway keys without an Act id.
readOnboardingAnswersJson(JSON.stringify({ ...baseAnswers, organizationStage: "existing", pathwayKey: "custom_existing" }));
readOnboardingAnswersJson(JSON.stringify({ ...baseAnswers, organizationStage: "preparing", pathwayKey: "bc_society" }));
assert.throws(() => readOnboardingAnswersJson(JSON.stringify({ ...baseAnswers, organizationStage: "preparing", pathwayKey: "custom_existing" })), /registered setup pathway/);

// ---------------------------------------------------------------------------
// Display summaries
// ---------------------------------------------------------------------------
assert.equal(incorporationActSummary(cbca), "Federal · CBCA");
assert.equal(incorporationActSummary(incorporationActById("bc-societies")!), "British Columbia · Societies Act");
assert.equal(incorporationActSummary(incorporationActById("ab-companies-part9")!), "Alberta · Companies Act, Part 9");
assert.equal(incorporationActSummary(albertaOther, "Special Act"), "Alberta · Special Act");
assert.equal(describeGoverningAct({ jurisdictionCode: "CA-BC", actFormedUnder: "business_corporations_act" }).summary, "British Columbia · Business Corporations Act");
assert.equal(describeGoverningAct({ jurisdictionCode: "CA-ON-OBCA", actFormedUnder: "business_corporations_act__ontario_" }).support, "full");
assert.equal(describeGoverningAct({ jurisdictionCode: "CA-QC", actFormedUnder: ANOTHER_ACT_VALUE }).summary, "Quebec · Another Act");
assert.equal(describeGoverningAct({ jurisdictionCode: "CA-AB", actFormedUnder: "unreviewed_act" }).support, "records_only");

// ---------------------------------------------------------------------------
// End to end in the browser-local runtime: records-only preparation and full existing
// ---------------------------------------------------------------------------
const client = new StaticConvexClient({ databaseName: `incorporation-acts-${Date.now()}`, seed: { societies: [] } });
for (const [act, stage] of [[albertaBca, "preparing"], [cbca, "existing"], [albertaOther, "existing"]] as const) {
  const organization = organizationFor(act, stage);
  const created = await client.mutation("society:createWorkspace", organization) as any;
  const saved = client.exportLocalWorkspaceSnapshot().tables.societies.find((row: any) => row._id === created.societyId)!;
  check(saved.jurisdictionCode === act.jurisdictionCode && saved.actFormedUnder === act.actFormedUnder, `${act.id}: workspace stores the catalogue setup.`);
}
const otherTasks = client.exportLocalWorkspaceSnapshot().tables.tasks.filter((task: any) => task.description.includes("Governing Act named at setup: Special Act"));
check(otherTasks.length > 0, "Another Act: the named Act reaches the onboarding tasks.");

if (problems.length) {
  console.error(`Incorporation-Act catalogue: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`Incorporation-Act catalogue: ${INCORPORATION_ACTS.length} Acts across ${INCORPORATION_JURISDICTIONS.length} jurisdictions; ${full.length} with full guidance map to their pathways, the rest (and "Another Act") are records only.`);
