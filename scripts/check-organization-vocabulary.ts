/**
 * Entity-aware page wording (src/lib/organizationVocabulary.ts and the helpers
 * built on it): one vocabulary module, the two older projections kept as
 * compatible re-exports, nav labels that name BC law only in BC, workflow
 * recipe wording, research-library applicability and render-time record-table
 * labels. No helper may supply a statute citation.
 */
import assert from "node:assert/strict";
import { organizationVocabulary } from "../src/lib/organizationVocabulary";
import { governanceVocabulary as legacyGovernanceVocabulary, capitalize } from "../src/lib/governanceVocabulary";
import { organizationCopy as legacyOrganizationCopy } from "../src/lib/organizationCopy";
import { ROUTE_IDENTITY, routeLabelForOrganization } from "../src/lib/routeIdentity";
import { catalogForOrganization, presentRecipe, recipeAppliesToOrganization } from "../src/lib/workflowRecipePresentation";
import { researchAreaApplies, researchAreasForOrganization } from "../src/lib/researchApplicability";
import { applyEntityObjectLabels, applyEntityViewLabels } from "../src/lib/entityRecordLabels";
import research from "../src/lib/research/societyerResearch.json";

const ENTITIES = {
  bcSociety: { name: "Riverside Community Society", jurisdictionCode: "CA-BC", entityType: "society", actFormedUnder: "societies_act" },
  legacyBcSociety: { name: "Legacy Society", jurisdictionCode: "CA-BC" },
  bcCompany: { name: "Example Provincial Inc.", jurisdictionCode: "CA-BC", entityType: "corporation__business_", actFormedUnder: "business_corporations_act" },
  federalCbca: { name: "Northwind Ltd.", jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__business_", actFormedUnder: "canada_business_corporations_act" },
  ontarioObca: { name: "Contoso Inc.", jurisdictionCode: "CA-ON-OBCA", entityType: "corporation__business_" },
  albertaSociety: { name: "Prairie Society", jurisdictionCode: "alberta", entityType: "society", actFormedUnder: "societies_act__alberta_" },
  bcCustomEntity: { name: "Custom BC Entity", jurisdictionCode: "CA-BC", entityType: "cooperative" },
} as const;
type Key = keyof typeof ENTITIES;
const KEYS = Object.keys(ENTITIES) as Key[];
const CORPORATIONS: Key[] = ["bcCompany", "federalCbca", "ontarioObca"];
const CITATION = /\bs\.\s?\d|\bss\.\s?\d|Societies Act|PIPA s\./;

/* ----------------------------- vocabulary ------------------------------ */

const vocab = Object.fromEntries(KEYS.map((key) => [key, organizationVocabulary(ENTITIES[key])])) as Record<Key, ReturnType<typeof organizationVocabulary>>;
for (const key of ["bcSociety", "legacyBcSociety"] as const) {
  assert.equal(vocab[key].societyLaw, true, key);
  assert.equal(vocab[key].voterNounPlural, "members");
  assert.equal(vocab[key].annualMeeting, "AGM");
  assert.equal(vocab[key].annualMeetingFormal, "Annual General Meeting");
  assert.equal(vocab[key].privacyLabel, "Privacy (PIPA)");
}
for (const key of CORPORATIONS) {
  assert.equal(vocab[key].isCorporation, true, key);
  assert.equal(vocab[key].societyLaw, false, key);
  assert.equal(vocab[key].voterNounPlural, "shareholders");
  assert.equal(vocab[key].contactNounPlural, "contacts");
  assert.equal(vocab[key].annualMeeting, "annual meeting");
}
assert.equal(vocab.bcCompany.annualMeetingFormal, "Annual General Meeting", "the BC Business Corporations Act term");
assert.equal(vocab.federalCbca.annualMeetingFormal, "Annual Meeting");
assert.equal(vocab.ontarioObca.annualMeetingFormal, "Annual Meeting");
assert.equal(vocab.bcCompany.governingDocuments, "articles");
assert.equal(vocab.federalCbca.governingDocuments, "articles and by-laws");
assert.equal(vocab.bcCompany.privacyLabel, "Privacy (PIPA)", "PIPA applies to every BC-home organization");
assert.equal(vocab.federalCbca.privacyLabel, "Privacy");
assert.equal(vocab.albertaSociety.societyLaw, false, "a society formed outside BC gets no Societies Act wording");
assert.equal(vocab.albertaSociety.privacyLabel, "Privacy");
assert.equal(organizationVocabulary(null).isSociety, false, "nothing society-only while loading");
for (const key of KEYS) for (const value of Object.values(vocab[key])) if (typeof value === "string") assert.doesNotMatch(value, CITATION, `${key}: vocabulary never cites a statute`);

// The two older modules re-export projections of the same vocabulary.
for (const key of KEYS) {
  const v = vocab[key];
  assert.deepEqual(legacyGovernanceVocabulary(ENTITIES[key]), {
    kind: v.kind, isSociety: v.isSociety, isCorporation: v.isCorporation, societyLaw: v.societyLaw,
    organizationNoun: v.organizationNoun, voterNoun: v.voterNoun, voterNounPlural: v.voterNounPlural,
  }, key);
  assert.deepEqual(legacyOrganizationCopy(ENTITIES[key]), {
    society: v.isSociety, bcSociety: v.societyLaw, corporation: v.isCorporation, bcCompany: v.bcCompany,
    entityNoun: v.organizationNoun, entityTitle: v.organizationTitle, annualMeeting: v.annualMeeting,
    annualMeetingTitle: v.annualMeetingTitle, governingDocuments: v.governingDocuments, governingDocumentsTitle: v.governingDocumentsTitle,
  }, key);
}
assert.equal(capitalize("shareholders"), "Shareholders");

/* ------------------------------ nav labels ----------------------------- */

for (const key of KEYS) {
  assert.equal(routeLabelForOrganization(ROUTE_IDENTITY["/app/privacy"], ENTITIES[key]), vocab[key].privacyLabel, `${key}: privacy nav label`);
}
assert.equal(routeLabelForOrganization(ROUTE_IDENTITY["/app/pipa-training"], ENTITIES.federalCbca), "Privacy training");
assert.equal(routeLabelForOrganization(ROUTE_IDENTITY["/app/pipa-training"], ENTITIES.bcCompany), "PIPA training");
assert.equal(routeLabelForOrganization(ROUTE_IDENTITY["/app/society"], ENTITIES.federalCbca), "Corporation");
for (const path of ["/app/members", "/app/proposals", "/app/receipts", "/app/membership"]) {
  assert.deepEqual(ROUTE_IDENTITY[path].entityKinds, ["society"], `${path} stays society-only (EntityKindGate reads this)`);
}

/* --------------------------- workflow recipes -------------------------- */

const catalog = [
  { key: "workspace_onboarding", label: "Workspace onboarding", description: "Starts a new society workspace with the essentials.", steps: ["Create society profile", "Optionally verify BC Registry access"] },
  { key: "agm_prep", label: "AGM prep", description: "T-minus reminders before an AGM — draft agenda.", steps: ["Collect active members and director roster", "Draft agenda from bylaw-required items"] },
  { key: "annual_report_filing", label: "Annual report filing", description: "Runs the Societies Online filing bot." },
  { key: "agm_date_deadlines", label: "AGM date set -> generate deadlines", description: "Turns a newly set AGM date into deadlines." },
];
assert.deepEqual(catalogForOrganization(catalog, ENTITIES.bcSociety), catalog, "societies keep the catalog unchanged");
const cbcaCatalog = catalogForOrganization(catalog, ENTITIES.federalCbca)!;
assert.deepEqual(cbcaCatalog.map((recipe) => recipe.label), ["Workspace onboarding", "Annual meeting prep", "Annual meeting date set -> generate deadlines"]);
assert.equal(recipeAppliesToOrganization("annual_report_filing", ENTITIES.bcCompany), false, "Societies Online recipes need BC society law");
assert.equal(recipeAppliesToOrganization("annual_report_filing", ENTITIES.legacyBcSociety), true);
assert.deepEqual(cbcaCatalog[0].steps, ["Create corporation profile", "Optionally verify registry access"]);
assert.deepEqual(cbcaCatalog[1].steps, ["Collect shareholder and director rosters", "Draft agenda from items the articles and by-laws require"]);
assert.equal(cbcaCatalog[1].description, "T-minus reminders before an annual meeting — draft agenda.");
assert.deepEqual(presentRecipe(catalog[0], ENTITIES.bcCompany).steps, ["Create corporation profile", "Optionally verify BC Registry access"]);
for (const recipe of cbcaCatalog) assert.doesNotMatch(JSON.stringify(recipe), /\bAGM\b|society|Societies/, recipe.key);

/* ---------------------------- research library ------------------------- */

const templates = research.templates as Array<{ id: string; research_area: string }>;
const visibleTemplates = (key: Key) => {
  const areas = researchAreasForOrganization(ENTITIES[key]);
  return templates.filter((entry) => researchAreaApplies(entry.research_area, areas)).map((entry) => entry.id);
};
assert.ok(visibleTemplates("bcSociety").every((id) => id.startsWith("SOC-")) && visibleTemplates("bcSociety").length === 8);
assert.ok(visibleTemplates("bcCompany").every((id) => id.startsWith("BCC-")) && visibleTemplates("bcCompany").length === 10);
assert.ok(visibleTemplates("federalCbca").every((id) => id.startsWith("FED-")) && visibleTemplates("federalCbca").length === 10);
assert.deepEqual(visibleTemplates("ontarioObca"), visibleTemplates("federalCbca"));
// No research area of its own: only platform research by default (another
// entity's templates would read as guidance for this one); "All entity types"
// still lists every record, labelled.
assert.equal(visibleTemplates("albertaSociety").length, 0, "no matching research area: no other entity's templates by default");
assert.equal(researchAreasForOrganization(null), null, "while loading, nothing is filtered");
assert.equal(researchAreaApplies("storage", ["bc_company"]), true, "platform research applies everywhere");
assert.equal(templates.length, 28, "templates are filtered, never deleted");

/* ---------------------------- record labels ---------------------------- */

const proposalObject = { nameSingular: "memberProposal", labelSingular: "Member proposal", labelPlural: "Member proposals", fields: [{ name: "title", label: "Title" }] };
assert.equal(applyEntityObjectLabels(proposalObject, ENTITIES.federalCbca)!.labelPlural, "Shareholder proposals");
assert.equal(applyEntityObjectLabels(proposalObject, ENTITIES.bcSociety)!.labelPlural, "Member proposals");
assert.equal(applyEntityObjectLabels(proposalObject, null), proposalObject, "unchanged while loading");
assert.equal(applyEntityObjectLabels({ ...proposalObject, labelPlural: "Renamed by us" }, ENTITIES.federalCbca)!.labelPlural, "Renamed by us", "a renamed label is left alone");
const roleHolderObject = {
  nameSingular: "roleHolder", labelSingular: "Role holder", labelPlural: "Role holders",
  fields: [
    { name: "membershipClassName", label: "Membership / right class" },
    { name: "directorTerm", label: "Director term", config: { options: [{ value: "until_the_next_annual_general_meeting", label: "Until the next AGM" }] } },
  ],
};
const corpRoleHolder = applyEntityObjectLabels(roleHolderObject, ENTITIES.bcCompany)!;
assert.equal(corpRoleHolder.fields[0].label, "Share / right class");
assert.equal(corpRoleHolder.fields[1].config!.options[0].label, "Until the next annual meeting");
const view = applyEntityViewLabels("roleHolder", { columns: roleHolderObject.fields.map((field) => ({ field })) }, ENTITIES.federalCbca)!;
assert.equal(view.columns[0].field.label, "Share / right class", "view columns carry their own field copies");
const pipa = { nameSingular: "pipaTraining", labelSingular: "PIPA training record", labelPlural: "PIPA training", fields: [] };
assert.equal(applyEntityObjectLabels(pipa, ENTITIES.federalCbca)!.labelPlural, "Privacy training");
assert.equal(applyEntityObjectLabels(pipa, ENTITIES.bcCompany)!.labelPlural, "PIPA training");

console.log("Organization vocabulary passed: one wording module (old names re-exported), BC-only PIPA nav labels, corporate workflow recipes, research applicability by entity/jurisdiction, and render-time record-table labels.");
