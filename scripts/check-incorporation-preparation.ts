import assert from "node:assert/strict";
import { incorporationPreparationForOrganization } from "../shared/incorporationPreparation";
import { incorporationWorksheetFileName, incorporationWorksheetText } from "../shared/incorporationWorksheet";

// The same provincial code must never leak society instructions into a company.
assert.equal(incorporationPreparationForOrganization({
  jurisdictionCode: "CA-BC", entityType: "society", actFormedUnder: "societies_act",
})?.id, "bc_society");
assert.equal(incorporationPreparationForOrganization({
  jurisdictionCode: "british_columbia", entityType: "corporation__business_",
  actFormedUnder: "business_corporations_act__british_columbia_",
})?.id, "bc_company");
assert.equal(incorporationPreparationForOrganization({
  jurisdiction: "federal__canada_", entityType: "corporation__business_",
  actFormedUnder: "canada_business_corporations_act",
})?.id, "federal_cbca");

// Unsupported provincial / nonprofit paths and inconsistent profiles do not fall back.
for (const organization of [
  undefined,
  { jurisdictionCode: "CA-BC", entityType: "corporation__business_", actFormedUnder: "societies_act" },
  { jurisdictionCode: "CA-BC", entityType: "society", actFormedUnder: "business_corporations_act__british_columbia_" },
  { jurisdictionCode: "CA-FED-CBCA", entityType: "society" },
  { jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__not_for_profit_" },
  { jurisdictionCode: "CA-ON-OBCA", entityType: "corporation__business_" },
  { entityType: "corporation__business_" },
]) assert.equal(incorporationPreparationForOrganization(organization), undefined);

// Downloaded preparation retains the selected track, provenance, and limits even
// when the worksheet is shared outside the app.
for (const [entityType, jurisdictionCode, expectedId, expectedRequirement] of [
  ["society", "CA-BC", "bc_society", "Prepare the constitution"],
  ["corporation__business_", "CA-BC", "bc_company", "Prepare and sign the incorporation agreement"],
  ["corporation__business_", "CA-FED-CBCA", "federal_cbca", "Prepare the articles of incorporation"],
]) {
  const organization = { name: "Example / Planning Company", entityType, jurisdictionCode };
  const guide = incorporationPreparationForOrganization(organization);
  assert.ok(guide);
  assert.equal(guide.id, expectedId);
  const worksheet = incorporationWorksheetText(guide, organization);
  assert.ok(worksheet.includes(expectedRequirement));
  assert.ok(worksheet.includes("does not incorporate an entity"));
  assert.ok(worksheet.includes("Verify current registry channels, fees, forms, and mail availability"));
  assert.ok(worksheet.includes("repository evidence dated"));
  assert.ok(worksheet.includes(guide.filingChannel.onlineUrl));
  const filename = incorporationWorksheetFileName(guide, organization);
  assert.ok(filename.endsWith(`${expectedId}-incorporation-preparation.txt`));
  assert.ok(!filename.includes("/"), "workspace names cannot add directories to a worksheet filename");
}

console.log("Incorporation preparation: entity/act discrimination, jurisdiction aliases, and unsupported paths passed.");
