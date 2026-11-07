import assert from "node:assert/strict";
import { assessTax, cleanTaxAssessment, defaultTaxAnswers, taxAssessmentRates, taxAssessmentForTransaction, taxAssessmentProblem, taxAssessmentSummary, taxAssessmentPrintSummary, assertInvoiceTaxAssessments, resolveTaxPack, type TaxAnswers } from "../shared/tax";
import { computeInvoiceTotals } from "../shared/invoicing";
import { documentPresentation } from "../src/features/invoicing/documentPresentation";

const ordinary: TaxAnswers = {
  ...defaultTaxAnswers("transaction", "2026-11-06"), jurisdictionCode: "CA-BC", itemCategory: "goods", sellerKind: "business", scopeConfirmed: "yes",
  federalException: "none", gstRegistration: "registered", provincialException: "category", pstRegistration: "registered", customerRelief: "none",
};
const assess = (patch: TaxAnswers = {}) => assessTax({ ...ordinary, ...patch }, true);
const priced = (patch: TaxAnswers = {}) => { const taxAssessment = assess(patch); return { key: "tax", item: "Synthetic item", quantity: 1, unitPriceCents: 10000, taxAssessment, ...taxAssessmentRates(taxAssessment) }; };

assert.equal(computeInvoiceTotals([priced()]).totalCents, 11200);
assert.equal(computeInvoiceTotals([priced({ sellerKind: "nonprofit" })]).totalCents, 11200, "nonprofit is not a blanket exemption");
assert.equal(assess({ sellerKind: "charity" }).status, "review_required", "charity-specific rules must be reviewed");
assert.equal(assess({ sellerKind: "public_body" }).status, "review_required");
assert.equal(assess({ scopeConfirmed: "no" }).status, "review_required", "no ordinary rate for mixed/special supplies");
assert.equal(assess({ federalException: "exempt" }).status, "review_required", "exception needs evidence");
assert.equal(assess({ provincialException: "exempt" }).status, "review_required");
assert.equal(assess({ gstRegistration: "not_required" }).status, "review_required");
assert.equal(assess({ pstRegistration: "not_required" }).status, "review_required");
assert.equal(assess({ pstRegistration: "required_not_registered" }).status, "review_required", "missing number does not erase collection obligation");

const zero = priced({ federalException: "zero_rated", federalEvidence: "Synthetic specific zero-rating review" });
assert.equal(zero.taxAssessment.components[0].treatment, "zero_rated");
assert.equal(zero.taxLabel, "PST", "provincial tax survives zero-rated federal treatment");
assert.equal(computeInvoiceTotals([zero]).totalCents, 10700);
assert.equal(priced({ federalException: "exempt", federalEvidence: "Synthetic exempt rule" }).taxLabel, "PST");
const noCollection = priced({ gstRegistration: "not_required", gstRegistrationEvidence: "Synthetic small-supplier analysis", pstRegistration: "not_required", pstRegistrationEvidence: "Synthetic small-seller review" });
assert.equal(noCollection.taxAssessment.components[0].treatment, "standard", "not collecting is not zero-rating/exemption");
assert.equal(noCollection.taxAssessment.components[0].ratePercent, 5);
assert.equal(computeInvoiceTotals([noCollection]).totalCents, 10000);
assert.match(taxAssessmentSummary(noCollection.taxAssessment), /supplier status/);

for (const itemCategory of ["accounting", "architecture", "engineering", "nonres_real_estate", "security"]) {
  const line = priced({ itemCategory, pstRegistration: "unknown" });
  assert.equal(computeInvoiceTotals([line]).totalCents, 10500, `${itemCategory} uses later Regulation 161/2026`);
  assert.equal(line.taxAssessment.components[1].treatment, "exempt");
  assert.deepEqual(line.taxAssessment.components[1].authorityIds, ["bc-professional-exemption"]);
}
assert.equal(priced({ itemCategory: "general_services", pstRegistration: "unknown" }).taxAssessment.components[1].treatment, "not_subject");
for (const [itemCategory, question] of [["software", "softwareScope"], ["related_services", "relatedServiceScope"], ["legal_services", "legalServiceScope"]]) {
  assert.equal(assess({ itemCategory }).status, "review_required");
  assert.equal(computeInvoiceTotals([priced({ itemCategory, [question]: "yes" })]).totalCents, 11200);
}
for (const itemCategory of ["health_education", "food", "membership", "accommodation", "real_property", "donation", "other"]) assert.equal(assess({ itemCategory }).status, "review_required", `${itemCategory} is not blanket classified`);
const exemptFood = priced({ itemCategory: "food", federalException: "zero_rated", federalEvidence: "Reviewed basic grocery criteria", provincialException: "exempt", provincialEvidence: "Reviewed B.C. food exemption" });
assert.equal(computeInvoiceTotals([exemptFood]).totalCents, 10000);
assert.equal(exemptFood.taxAssessment.components[0].treatment, "zero_rated");
assert.equal(exemptFood.taxAssessment.components[1].treatment, "exempt");

for (const jurisdictionCode of ["CA-ON", "CA-FED-CBCA", "US-WA", "GB", "unknown"]) {
  const result = assess({ jurisdictionCode });
  assert.equal(result.status, "review_required"); assert.equal(result.components.length, 0); assert.equal(result.confirmed, false);
  assert.throws(() => taxAssessmentRates(result), /Complete and confirm/);
}
assert.equal(resolveTaxPack("CA-BC", "2026-09-30"), undefined);
assert.equal(assess({ supplyDate: "2026-09-30" }).status, "review_required");
assert.equal(resolveTaxPack("CA-BC", "2026-10-01")?.id, "ca-bc-ordinary-sales");
assert.throws(() => assess({ supplyDate: "2026-02-30" }), /valid/);
assert.throws(() => assess({ federalException: "invented" }), /supported answer/);

assert.equal(assess({ customerRelief: "pst" }).status, "review_required");
const customer = priced({ customerRelief: "pst", customerEvidence: "SYNTHETIC INTERNAL EVIDENCE; reviewed resale conditions", pstReliefDocumentation: "pst_number", purchaserPstNumber: "PST-1234-5678", pstReliefConditions: "confirmed" });
assert.equal(computeInvoiceTotals([customer]).totalCents, 10500);
assert.equal(customer.taxAssessment.components[1].treatment, "relieved");
assert.equal(assess({ scope: "catalog", customerRelief: "pst", customerEvidence: "Example" }).status, "review_required");
const catalog = assess({ scope: "catalog" });
assert.equal(catalog.confirmed, true);
const sale = taxAssessmentForTransaction(catalog, "2026-11-07")!;
assert.equal(sale.confirmed, false); assert.equal(sale.answers.customerRelief, "unknown"); assert.equal(sale.answers.supplyDate, "2026-11-07");
assert.match(taxAssessmentProblem({ ...priced(), taxAssessment: sale }, "2026-11-07")!, /confirm/);
assert.match(taxAssessmentProblem(priced(), "2026-11-07")!, /date changed/);
assert.match(taxAssessmentProblem({ ...priced(), taxRatePercent: 1 }, "2026-11-06")!, /differ/);
assert.equal(taxAssessmentProblem({ taxRatePercent: 5 }, "2026-11-06"), null, "manual/legacy lines remain explicit and unassessed");
assert.throws(() => assertInvoiceTaxAssessments([{ ...priced(), taxAssessment: sale }], "2026-11-07"), /Synthetic item/);
const tampered = { ...priced().taxAssessment, components: [], issues: [], status: "ready" as const };
assert.equal(cleanTaxAssessment(tampered)?.components.length, 2, "client results are recomputed");
assert.throws(() => cleanTaxAssessment({ ...tampered, rulePackVersion: "old" }), /version changed/);
assert.equal(taxAssessmentPrintSummary(customer.taxAssessment).includes("INTERNAL EVIDENCE"), false);
assert.match(taxAssessmentPrintSummary(customer.taxAssessment), /purchaser PST-1234-5678/);
assert.equal(assess({ customerRelief: "pst", customerEvidence: "Rule reviewed" }).status, "review_required", "an internal note alone is not the purchaser documentation pathway");
assert.equal(assess({ customerRelief: "pst", customerEvidence: "Applicable certificate retained", pstReliefDocumentation: "certificate", pstReliefConditions: "confirmed", pstCertificateType: "FIN 490; eligible purchaser with no PST number" }).status, "ready");
const zeroWithRelief = assess({ ...customer.taxAssessment.answers, customerRelief: "both", federalException: "zero_rated", federalEvidence: "Qualifying rule" });
assert.equal(zeroWithRelief.components[0].treatment, "zero_rated", "customer relief does not erase an existing zero-rating");
const view = documentPresentation({ number: "TEST-1", issueDate: "2026-11-06", dueDate: "2026-11-06", terms: "due_on_receipt", currency: "CAD", billToName: "Synthetic customer", lines: [exemptFood] });
assert.match(view.cellValue("tax", exemptFood, 0), /GST zero-rated; PST exempt/);
console.log("PASS tax guidance: independent components, exemptions/evidence, registration, charities, professional-service change, unsupported locations, date boundaries, customer relief, catalog recheck, tamper resistance and safe document wording.");
