import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { FEDERAL_BC_PREPARATION } from "../shared/federalBcIncorporation";
import { incorporationPreparationForOrganization } from "../shared/incorporationPreparation";
import { incorporationWorksheetText } from "../shared/incorporationWorksheet";
import type { LegalEntityLike } from "../shared/organizationDomain";
import { setupCopyContext, setupStepCatalogue } from "../shared/organizationSetup/catalogue";
import { FederalBcIncorporationGuide } from "../src/components/FederalBcIncorporationGuide";

const federal = {
  name: "Example Planning Inc.",
  entityType: "corporation__business_",
  jurisdictionCode: "CA-FED-CBCA",
  actFormedUnder: "canada_business_corporations_act",
};
const bc = { ...federal, jurisdictionCode: "CA-BC", actFormedUnder: "business_corporations_act" };
const society = { ...bc, entityType: "society", actFormedUnder: "societies_act" };
const ontario = { ...federal, jurisdictionCode: "CA-ON-OBCA", actFormedUnder: "business_corporations_act__ontario_" };
const inventoryHeading = "DETAILED FEDERAL AND BC PREPARATION INVENTORY";

function markup(organization?: LegalEntityLike | null) {
  return renderToStaticMarkup(createElement(StaticRouter, { location: "/app/society" },
    createElement(FederalBcIncorporationGuide, { organization })));
}

const html = markup(federal);
assert.match(html, /Detailed federal and BC preparation checklist/);
assert.match(html, /href="\/app\/document-catalog"/);
assert.match(html, /<details/);
assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|\s|>)/, "the large inventory starts collapsed");
assert.doesNotMatch(html, /<(?:input|textarea|form)\b/, "the inventory must not collect personal information");
assert.ok(html.includes(FEDERAL_BC_PREPARATION.reviewedOn));

// Home jurisdiction and Act determine the route, not the presence of a BC office.
assert.ok(markup({ ...federal, registeredOfficeAddress: "Vancouver, BC" }).length > 0);
assert.ok(markup({ jurisdiction: "federal__canada_", entityType: federal.entityType, actFormedUnder: federal.actFormedUnder }).length > 0);
for (const organization of [
  null, undefined, bc, society,
  { ...federal, entityType: "corporation__not_for_profit_", actFormedUnder: "canada_not_for_profit_corporations_act" },
  ontario,
  { ...federal, actFormedUnder: "societies_act" },
  { entityType: federal.entityType },
]) assert.equal(markup(organization), "", `no federal incorporation pack for ${JSON.stringify(organization)}`);

// Both Acts use a control register, but only the federal workflow calls for
// filing changes with Corporations Canada. Exercise the actual shared catalogue.
const federalIsc = setupStepCatalogue("corporation_preparing", setupCopyContext(federal)).find((step) => step.key === "isc-register");
const ontarioIsc = setupStepCatalogue("corporation_preparing", setupCopyContext(ontario)).find((step) => step.key === "isc-register");
assert.ok(federalIsc && ontarioIsc, "both corporation routes retain their ISC register step");
assert.match(federalIsc.description, /Corporations Canada within 15 days after the register entry/);
assert.match(ontarioIsc.description, /within 15 days after becoming aware/);
assert.doesNotMatch(ontarioIsc.description, /Corporations Canada|file the change/, "federal ISC filing instructions must not leak into Ontario");

const federalGuide = incorporationPreparationForOrganization(federal)!;
const worksheet = incorporationWorksheetText(federalGuide, federal);
assert.ok(worksheet.includes(inventoryHeading));
assert.ok(worksheet.includes(FEDERAL_BC_PREPARATION.privacyNote));
assert.ok(worksheet.includes("Restricted record reference (keep personal information separately)"));
for (const section of FEDERAL_BC_PREPARATION.sections) {
  assert.ok(worksheet.includes(section.title), `export retains ${section.title}`);
  for (const field of section.fields) {
    assert.ok(worksheet.includes(field.label), `export retains ${field.id}`);
    assert.ok(worksheet.includes(field.detail), `export retains detail for ${field.id}`);
    if (field.appliesWhen) assert.ok(worksheet.includes(field.appliesWhen), `export retains condition for ${field.id}`);
  }
}
for (const organization of [bc, society]) {
  const guide = incorporationPreparationForOrganization(organization)!;
  assert.ok(!incorporationWorksheetText(guide, organization).includes(inventoryHeading));
  assert.ok(!incorporationWorksheetText(federalGuide, organization).includes(inventoryHeading), "a mismatched caller cannot add the federal pack");
}

// A worksheet may use the working company name. It must not serialize nearby
// private fields, even if callers pass a complete workspace object in future.
const privateValues = [
  "PRIVATE_DATE_OF_BIRTH", "PRIVATE_HOME_ADDRESS", "PRIVATE_CITIZENSHIP",
  "PRIVATE_TAX_ACCOUNT", "PRIVATE_PORTAL_KEY", "PRIVATE_FOUNDER_NOTE",
];
const privateOrganization = {
  ...federal,
  registeredOfficeAddress: privateValues[1],
  taxStatusEvidence: privateValues[3],
  registryPortalKey: privateValues[4],
  notes: privateValues[5],
  roleHolders: [{ dateOfBirth: privateValues[0], address: privateValues[1], citizenshipCountries: [privateValues[2]] }],
};
const privateWorksheet = incorporationWorksheetText(federalGuide, privateOrganization);
const privateHtml = markup(privateOrganization);
assert.ok(privateWorksheet.includes(federal.name));
for (const value of privateValues) {
  assert.ok(!privateWorksheet.includes(value), `${value} must not leak into the export`);
  assert.ok(!privateHtml.includes(value), `${value} must not leak into static guidance`);
}

const sources = new Map(FEDERAL_BC_PREPARATION.sources.map((source) => [source.id, source]));
assert.equal(sources.size, FEDERAL_BC_PREPARATION.sources.length, "source IDs are unique");
const fields = FEDERAL_BC_PREPARATION.sections.flatMap((section) => section.fields);
assert.equal(new Set(fields.map((field) => field.id)).size, fields.length, "field IDs are unique");
for (const item of [...fields, ...FEDERAL_BC_PREPARATION.rules, ...FEDERAL_BC_PREPARATION.sequence]) {
  assert.ok(item.sourceIds.length > 0, `${item.id} needs source provenance`);
  for (const id of item.sourceIds) {
    const source = sources.get(id);
    assert.ok(source, `${item.id}: ${id} must resolve`);
    assert.equal(new URL(source.url).protocol, "https:");
    assert.ok(worksheet.includes(source.url), `${item.id}: source travels with the downloaded worksheet`);
  }
}

console.log(`Federal and BC preparation passed: route isolation, collapsed guidance, ${fields.length} exported fields, source integrity, and no private-record export.`);
