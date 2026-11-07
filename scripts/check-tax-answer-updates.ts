import assert from "node:assert/strict";
import { assessTax, defaultTaxAnswers, type TaxAnswers } from "../shared/tax";
import { updateTaxAnswer } from "../shared/tax/answerUpdates";

const food: TaxAnswers = {
  ...defaultTaxAnswers("transaction", "2026-11-06"),
  jurisdictionCode: "CA-BC", itemCategory: "food", sellerKind: "business", scopeConfirmed: "yes",
  federalException: "zero_rated", federalEvidence: "Synthetic qualifying basic-grocery rule",
  provincialException: "exempt", provincialEvidence: "Synthetic food exemption review",
  gstRegistration: "registered", pstRegistration: "registered", customerRelief: "none",
};
assert.equal(assessTax(food, true).confirmed, true);
const original = JSON.stringify(food);
const software = updateTaxAnswer(food, "itemCategory", "software");
assert.equal(software.itemCategory, "software");
assert.equal(software.federalEvidence, "");
assert.equal(software.provincialEvidence, "");
assert.equal(software.softwareScope, "unknown");
assert.equal(software.customerRelief, "unknown");
assert.equal(assessTax(software, true).confirmed, false, "grocery evidence cannot authorize a new software supply");
assert.equal(software.gstRegistration, "registered", "item changes preserve supplier registrations");
assert.equal(software.pstRegistration, "registered");
assert.equal(JSON.stringify(food), original, "updates do not mutate saved answers");
assert.equal(assessTax({ ...software, scopeConfirmed: "yes", federalException: "none", provincialException: "category", softwareScope: "yes", customerRelief: "none" }, true).confirmed, true, "the changed item can be assessed again");

const exempt = updateTaxAnswer(food, "federalException", "exempt");
assert.equal(exempt.federalEvidence, "");
assert.equal(exempt.provincialEvidence, food.provincialEvidence, "an independent provincial decision remains available");
assert.equal(assessTax(exempt, true).confirmed, false, "zero-rating evidence cannot silently support an exemption");
const provincial = updateTaxAnswer({ ...food, relatedServiceScope: "yes" }, "provincialException", "category");
assert.equal(provincial.provincialEvidence, "");
assert.equal(provincial.relatedServiceScope, "unknown");

const relief: TaxAnswers = {
  ...food, itemCategory: "goods", federalException: "none", federalEvidence: "",
  provincialException: "category", provincialEvidence: "", customerRelief: "pst",
  customerEvidence: "Synthetic eligibility and retained documentation reference",
  pstReliefDocumentation: "pst_number", purchaserPstNumber: "PST-1234-5678", pstReliefConditions: "confirmed",
};
assert.equal(assessTax(relief, true).confirmed, true);
const changedNumber = updateTaxAnswer(relief, "purchaserPstNumber", "PST-8765-4321");
assert.equal(changedNumber.pstReliefConditions, "unknown");
assert.equal(assessTax(changedNumber, true).confirmed, false, "a replacement purchaser number needs renewed verification");
const certificate = updateTaxAnswer(relief, "pstReliefDocumentation", "certificate");
assert.equal(certificate.purchaserPstNumber, "", "the number route cannot leak into a certificate route");
assert.equal(certificate.pstCertificateType, "");
assert.equal(certificate.pstReliefConditions, "unknown");
assert.equal(assessTax(certificate, true).confirmed, false);
const completeCertificate = { ...certificate, pstCertificateType: "FIN 490; eligible unregistered wholesaler; retained certificate reference", pstReliefConditions: "confirmed" };
assert.equal(assessTax(completeCertificate, true).confirmed, true);
assert.equal(assessTax(updateTaxAnswer(completeCertificate, "pstCertificateType", "Different prescribed certificate"), true).confirmed, false, "changing the certificate resets its eligibility confirmation");
assert.equal(assessTax(updateTaxAnswer(relief, "customerEvidence", "Replacement evidence reference"), true).confirmed, false);
const both = updateTaxAnswer(relief, "customerRelief", "both");
assert.equal(both.customerEvidence, "", "PST evidence alone cannot confirm federal relief");
assert.equal(both.purchaserPstNumber, "");
assert.equal(assessTax(both, true).confirmed, false);
const none = updateTaxAnswer(relief, "customerRelief", "none");
assert.equal(none.customerEvidence, "");
assert.equal(none.purchaserPstNumber, "");
assert.equal(none.pstReliefConditions, "unknown");

for (const [key, value] of [["jurisdictionCode", "CA-ON"], ["sellerKind", "charity"], ["supplyDate", "2026-11-07"]]) {
  const changed = updateTaxAnswer(relief, key, value);
  assert.equal(changed[key], value);
  assert.equal(changed.gstRegistration, "unknown");
  assert.equal(changed.pstRegistration, "unknown");
  assert.equal(changed.federalException, "unknown");
  assert.equal(changed.provincialException, "unknown");
  assert.equal(changed.customerRelief, "unknown");
  assert.equal(changed.customerEvidence, "");
  assert.equal(changed.purchaserPstNumber, "");
  assert.equal(assessTax(changed, true).confirmed, false);
}
const catalog = updateTaxAnswer(completeCertificate, "scope", "catalog");
assert.equal(catalog.customerRelief, "none");
assert.equal(catalog.pstCertificateType, "");
assert.equal(catalog.customerEvidence, "");
const transaction = updateTaxAnswer(catalog, "scope", "transaction");
assert.equal(transaction.customerRelief, "unknown");
for (const tax of ["gst", "pst"]) {
  const position = updateTaxAnswer({ ...relief, [`${tax}Registration`]: "not_required", [`${tax}RegistrationEvidence`]: "Earlier registration review" }, `${tax}Registration`, "required_not_registered");
  assert.equal(position[`${tax}RegistrationEvidence`], "");
}
assert.equal(updateTaxAnswer(relief, "purchaserPstNumber", relief.purchaserPstNumber), relief, "unchanged values retain the existing review");
assert.equal(updateTaxAnswer(relief, "futurePackQuestion", "answer").futurePackQuestion, "answer");
console.log("PASS tax answer updates: category and context changes invalidate old exemptions; registration independence; purchaser documentation and evidence require renewed review; catalog transitions discard customer relief.");
