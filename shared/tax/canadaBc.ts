import type { TaxAnswers, TaxComponentDecision, TaxQuestion, TaxRulePack } from "./types";
import { updateTaxAnswer } from "./answerUpdates";

const choice = (value: string, label: string) => ({ value, label });
const evidence = (id: string, label: string, answer: string, oneOf: string[]): TaxQuestion => ({
  id, label, kind: "text", when: [{ answer, oneOf }],
  hint: "Record the applicable rule and your supporting document or review reference. Keep personal certificate numbers out of this note.",
});

const questions: TaxQuestion[] = [
  { id: "itemCategory", label: "What are you supplying?", kind: "choice", options: [
    choice("unknown", "Choose a category"), choice("goods", "Ordinary goods / equipment"), choice("software", "Software / software access"),
    choice("related_services", "Services to taxable goods, such as repairs"), choice("general_services", "Standalone general service / consulting"),
    choice("legal_services", "Legal services"), choice("accounting", "Accounting / bookkeeping"), choice("architecture", "Architectural services"),
    choice("engineering", "Engineering / geoscience"), choice("nonres_real_estate", "Non-residential real estate services"), choice("security", "Security / investigation"),
    choice("food", "Food / beverages"), choice("membership", "Membership / admission / program fee"), choice("health_education", "Health / education / care"),
    choice("real_property", "Real property / rental"), choice("accommodation", "Accommodation"), choice("donation", "Donation / sponsorship"), choice("other", "Other / mixed supply"),
  ] },
  { id: "sellerKind", label: "What is the supplier's tax status?", kind: "choice", hint: "An incorporation Act, nonprofit label or NAICS sector does not establish charity status or a sales-tax exemption.", options: [
    choice("unknown", "Not established"), choice("business", "Ordinary business"), choice("nonprofit", "Nonprofit organization, not a registered charity"),
    choice("charity", "Registered charity"), choice("public_body", "Other public service body / government"),
  ] },
  { id: "scopeConfirmed", label: "Does this fit an ordinary domestic B.C. supply?", kind: "choice", hint: "Choose review for cross-border or mixed-location supplies, non-resident sellers, marketplace collection, vehicles, liquor, tobacco, telecom, bundled supplies, or special rates. The delivery/use and place-of-supply rules must support B.C.; the incorporation address is insufficient.", options: [
    choice("unknown", "Not confirmed"), choice("yes", "Yes — place, supplier and ordinary-rate scope confirmed"), choice("no", "No / a special rule may apply"),
  ] },
  { id: "federalException", label: "Does a specific GST/HST exception apply?", kind: "choice", options: [
    choice("unknown", "I need to check"), choice("none", "No — ordinary taxable supply"), choice("zero_rated", "Zero-rated (taxable at 0%)"),
    choice("exempt", "Exempt supply"), choice("out_of_scope", "Outside GST/HST scope / no supply for consideration"),
  ] },
  evidence("federalEvidence", "GST/HST rule and supporting evidence", "federalException", ["zero_rated", "exempt", "out_of_scope"]),
  evidence("charityEvidence", "Charity supply review", "sellerKind", ["charity"]),
  { id: "gstRegistration", label: "May this supplier collect GST/HST?", kind: "choice", when: [{ answer: "federalException", oneOf: ["none"] }], hint: "Registered small suppliers still collect. Not having a number does not establish small-supplier eligibility. Ordinary businesses generally use $30,000; public service bodies generally use $50,000. Charities have additional tests and exceptions.", options: [
    choice("unknown", "Registration needs review"), choice("registered", "Registered for GST/HST"), choice("not_required", "Not registered; reviewed as not required to register"), choice("required_not_registered", "Required to register, but not yet registered"),
  ] },
  evidence("gstRegistrationEvidence", "Why GST/HST registration is not required", "gstRegistration", ["not_required"]),
  { id: "provincialException", label: "Does a specific B.C. PST exception apply?", kind: "choice", options: [
    choice("unknown", "I need to check"), choice("category", "Use the category guidance"), choice("exempt", "Specific product or service exemption"), choice("not_subject", "Outside the scope of PST"),
  ] },
  evidence("provincialEvidence", "PST rule and supporting evidence", "provincialException", ["exempt", "not_subject"]),
  { id: "softwareScope", label: "Have the B.C. software conditions been checked?", kind: "choice", when: [{ answer: "itemCategory", oneOf: ["software"] }, { answer: "provincialException", oneOf: ["category"] }], hint: "Confirm taxable, non-custom software used on devices ordinarily situated in B.C.; review custom software, multiple-location use and any permitted self-assessment certificate separately.", options: [choice("unknown", "Not yet checked"), choice("yes", "Yes — ordinary taxable software conditions confirmed"), choice("no", "No / an exception or allocation may apply")] },
  { id: "relatedServiceScope", label: "Have related-service exclusions and exemptions been checked?", kind: "choice", when: [{ answer: "itemCategory", oneOf: ["related_services"] }, { answer: "provincialException", oneOf: ["category"] }], hint: "Confirm the service is taxable after reviewing the rules for the particular goods and work. Household-appliance repairs, cleaning, towing and work on real property can have different treatment.", options: [choice("unknown", "Not yet checked"), choice("yes", "Yes — taxable related service and no applicable exception"), choice("no", "No / a specific exemption or property rule may apply")] },
  { id: "legalServiceScope", label: "Have the legal-service location and exemption rules been checked?", kind: "choice", when: [{ answer: "itemCategory", oneOf: ["legal_services"] }, { answer: "provincialException", oneOf: ["category"] }], hint: "This ordinary path covers legal services provided in B.C. to a B.C. resident or business, with no legal-aid or other exemption. Other locations and special arrangements need review.", options: [choice("unknown", "Not yet checked"), choice("yes", "Yes — ordinary B.C. legal services; no exception"), choice("no", "No / another location or exemption needs review")] },
  { id: "pstRegistration", label: "What is the supplier's PST collection position?", kind: "choice", when: [{ answer: "provincialException", oneOf: ["category"] }], hint: "A missing PST number never proves exemption. B.C.'s small-seller conditions are different from the GST/HST small-supplier rules. For a non-taxable category this answer does not change its treatment.", options: [
    choice("unknown", "Registration needs review"), choice("registered", "Registered to collect PST"), choice("not_required", "Reviewed collection exception / qualifying small seller"), choice("required_not_registered", "Collect PST; registration / number is pending"),
  ] },
  evidence("pstRegistrationEvidence", "PST collection exception and evidence", "pstRegistration", ["not_required"]),
  { id: "customerRelief", label: "Does this customer claim tax relief for this transaction?", kind: "choice", when: [{ answer: "scope", oneOf: ["transaction"] }], hint: "Check the actual eligibility, delivery/use conditions and required evidence. Nonprofit or charity status alone is not blanket customer relief.", options: [
    choice("unknown", "Not checked"), choice("none", "No customer-specific relief"), choice("gst", "GST/HST relief"), choice("pst", "PST relief (for example, qualifying resale)"), choice("both", "Separate, evidenced relief for both"),
  ] },
  evidence("customerEvidence", "Customer relief rules and evidence reference", "customerRelief", ["gst", "pst", "both"]),
  { id: "pstReliefDocumentation", label: "How is the purchaser's PST exemption documented?", kind: "choice", when: [{ answer: "scope", oneOf: ["transaction"] }, { answer: "customerRelief", oneOf: ["pst", "both"] }], hint: "Some exemptions use the purchaser's PST registration number, which must be recorded on the invoice. Other exemptions require a certificate or other specified evidence. Choose the route required for this exemption.", options: [
    choice("unknown", "Documentation route needs review"), choice("pst_number", "Valid purchaser PST registration number"), choice("certificate", "Permitted exemption certificate retained"), choice("other", "Another permitted document / written-agreement route reviewed"),
  ] },
  { id: "purchaserPstNumber", label: "Purchaser PST number to print on this invoice", kind: "text", when: [{ answer: "scope", oneOf: ["transaction"] }, { answer: "customerRelief", oneOf: ["pst", "both"] }, { answer: "pstReliefDocumentation", oneOf: ["pst_number"] }], hint: "Enter PST-1234-5678. This is the purchaser's number, separate from your organization's seller number. This field prints on the document." },
  { id: "pstCertificateType", label: "PST certificate form and eligibility basis", kind: "text", when: [{ answer: "scope", oneOf: ["transaction"] }, { answer: "customerRelief", oneOf: ["pst", "both"] }, { answer: "pstReliefDocumentation", oneOf: ["certificate"] }], hint: "Name the permitted form and why the purchaser may use it. FIN 490 is only available for eligible purchasers without a PST number; small sellers cannot use it to buy resale inventory exempt. Keep the actual certificate and its personal identifiers in your records." },
  { id: "pstReliefConditions", label: "Have you checked the required PST exemption conditions?", kind: "choice", when: [{ answer: "scope", oneOf: ["transaction"] }, { answer: "customerRelief", oneOf: ["pst", "both"] }], hint: "Verify that this documentation route is permitted and that eligibility, use/resale and delivery conditions are met. A number alone does not establish the exemption.", options: [choice("unknown", "Not yet verified"), choice("confirmed", "Yes — required evidence and transaction conditions verified")] },
];

const ordinaryFederal = new Set(["goods", "software", "related_services", "general_services", "legal_services", "accounting", "architecture", "engineering", "nonres_real_estate", "security"]);
const ordinaryPst = new Set(["goods", "software", "related_services", "legal_services"]);
const professionalExempt = new Set(["accounting", "architecture", "engineering", "nonres_real_estate", "security"]);
const has = (a: TaxAnswers, key: string) => Boolean(a[key]?.trim());

function review(taxId: string, label: string, reason: string, authorityIds: string[]): TaxComponentDecision {
  return { taxId, label, treatment: "review_required", collection: "review_required", reason, authorityIds };
}

function federal(a: TaxAnswers): TaxComponentDecision {
  const base = { taxId: "CA-GST", label: "GST", authorityIds: ["cra-supplies", "cra-collection"] };
  if (a.sellerKind === "charity" && !has(a, "charityEvidence")) return review(base.taxId, base.label, "Review the charity's specific supply rules; many charity supplies are exempt, with exceptions.", ["cra-charities"]);
  if (["zero_rated", "exempt", "out_of_scope"].includes(a.federalException)) {
    if (!has(a, "federalEvidence")) return review(base.taxId, base.label, "Record the GST/HST rule and evidence supporting this exception.", base.authorityIds);
    return { ...base, treatment: a.federalException as "zero_rated" | "exempt" | "out_of_scope", collection: "do_not_collect", ...(a.federalException === "zero_rated" ? { ratePercent: 0 } : {}), reason: "Specific GST/HST treatment confirmed using the recorded rule and evidence." };
  }
  if (a.federalException !== "none") return review(base.taxId, base.label, "Decide whether a federal exception applies.", base.authorityIds);
  if (!ordinaryFederal.has(a.itemCategory)) return review(base.taxId, base.label, "This category has supply-specific rules. Review its GST/HST treatment and record a supported exception where applicable.", base.authorityIds);
  if (a.gstRegistration === "registered") return { ...base, treatment: "standard", collection: "collect", ratePercent: 5, reason: "Ordinary taxable supply in B.C. by a GST/HST registrant." };
  if (a.gstRegistration === "not_required" && has(a, "gstRegistrationEvidence")) return { ...base, treatment: "standard", collection: "do_not_collect", ratePercent: 5, reason: "Taxable supply; GST is not collected under the recorded supplier registration assessment.", authorityIds: ["cra-small-supplier"] };
  return review(base.taxId, base.label, "Resolve GST/HST registration and record evidence before applying the collection decision.", ["cra-small-supplier"]);
}

function provincial(a: TaxAnswers, allowPendingRegistration = false): TaxComponentDecision {
  const base = { taxId: "CA-BC-PST", label: "PST", authorityIds: ["bc-pst"] };
  if (["exempt", "not_subject"].includes(a.provincialException)) {
    if (!has(a, "provincialEvidence")) return review(base.taxId, base.label, "Record the PST rule and evidence supporting this exception.", base.authorityIds);
    return { ...base, treatment: a.provincialException as "exempt" | "not_subject", collection: "do_not_collect", reason: "Specific PST treatment confirmed using the recorded rule and evidence." };
  }
  if (a.provincialException !== "category") return review(base.taxId, base.label, "Decide whether a provincial exception applies.", base.authorityIds);
  if (professionalExempt.has(a.itemCategory)) return { ...base, treatment: "exempt", collection: "do_not_collect", reason: "B.C. Reg. 161/2026 exempts this professional-service category from October 1, 2026. Separate goods or software supplies still need their own assessment.", authorityIds: ["bc-professional-exemption"] };
  if (a.itemCategory === "general_services") return { ...base, treatment: "not_subject", collection: "do_not_collect", reason: "Standalone general services outside the specifically taxable categories are not subject to PST. The scope confirmation excludes goods-related services, software, telecom and legal services." };
  if (!ordinaryPst.has(a.itemCategory)) return review(base.taxId, base.label, "This category needs a specific PST assessment; ordinary 7% guidance is insufficient.", base.authorityIds);
  const categoryScope = ({ software: ["softwareScope", "bc-software"], related_services: ["relatedServiceScope", "bc-related-services"], legal_services: ["legalServiceScope", "bc-legal-services"] } as Record<string, string[]>)[a.itemCategory];
  if (categoryScope && a[categoryScope[0]] !== "yes") return review(base.taxId, base.label, "Confirm the category's location, use and exemption conditions before using ordinary PST guidance.", [categoryScope[1]]);
  if (a.pstRegistration === "registered") return { ...base, treatment: "standard", collection: "collect", ratePercent: 7, reason: "Ordinary taxable B.C. supply with no identified PST exemption." };
  if (allowPendingRegistration && a.pstRegistration === "required_not_registered") return { ...base, treatment: "standard", collection: "collect", ratePercent: 7, reason: "PST must be collected and remitted while the supplier registration or number is outstanding.", authorityIds: ["bc-register"] };
  if (a.pstRegistration === "not_required" && has(a, "pstRegistrationEvidence")) return { ...base, treatment: "standard", collection: "do_not_collect", ratePercent: 7, reason: "Taxable category; collection exception is supported by the recorded seller assessment.", authorityIds: ["bc-small-seller", "bc-register"] };
  return review(base.taxId, base.label, "Review PST collection obligations. A missing registration does not remove the obligation to collect and remit.", ["bc-register", "bc-small-seller"]);
}

export const canadaBcTaxPack: TaxRulePack = {
  id: "ca-bc-ordinary-sales", version: "2026-11-06.1", label: "Canada · British Columbia", jurisdictionCode: "CA-BC",
  effectiveFrom: "2026-10-01", reviewedOn: "2026-11-06", questions, updateAnswer: updateTaxAnswer,
  authorities: [
    { id: "cra-supplies", title: "CRA: Type of supply — taxable, zero-rated and exempt", url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-type-supply.html" },
    { id: "cra-collection", title: "CRA: GST/HST rates, collection and invoices", url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate.html" },
    { id: "cra-small-supplier", title: "CRA: Find out if you must register for GST/HST", url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/when-register-charge.html" },
    { id: "cra-charities", title: "CRA: GST/HST information for charities (RC4082)", url: "https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4082/gst-hst-information-charities.html" },
    { id: "cra-nonprofits", title: "CRA: GST/HST information for nonprofit organizations (RC4081)", url: "https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4081/gst-hst-information-non-profit-organizations.html" },
    { id: "bc-pst", title: "B.C.: PST — taxable goods and services", url: "https://www2.gov.bc.ca/gov/content/taxes/sales-taxes/pst" },
    { id: "bc-register", title: "B.C.: Register to collect PST", url: "https://www2.gov.bc.ca/gov/content/taxes/sales-taxes/pst/register" },
    { id: "bc-small-seller", title: "B.C.: Small sellers (PST 003)", url: "https://www2.gov.bc.ca/assets/gov/taxes/sales-taxes/publications/pst-003-small-sellers.pdf" },
    { id: "bc-professional-exemption", title: "B.C. Reg. 161/2026: professional-service exemptions effective October 1, 2026", url: "https://www.bclaws.gov.bc.ca/civix/document/id/bcgaz2/bcgaz2/v69n16_161-2026" },
    { id: "bc-exemption-evidence", title: "B.C. PST Regulation: invoices and purchaser exemption evidence, sections 85–86", url: "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/1295368594" },
    { id: "bc-software", title: "B.C.: PST on software", url: "https://www2.gov.bc.ca/gov/content/taxes/sales-taxes/pst/publications/software" },
    { id: "bc-related-services", title: "B.C.: Related services (PST 301)", url: "https://www2.gov.bc.ca/assets/gov/taxes/sales-taxes/publications/pst-301-related-services.pdf" },
    { id: "bc-legal-services", title: "B.C.: Legal services (PST 106)", url: "https://www2.gov.bc.ca/assets/gov/taxes/sales-taxes/publications/pst-106-legal-services.pdf" },
    { id: "bc-fin490", title: "B.C.: General certificate of exemption (FIN 490) and eligibility instructions", url: "https://www2.gov.bc.ca/assets/gov/taxes/sales-taxes/forms/fin-490-certificate-exemption-general.pdf" },
  ],
  evaluate: (a) => evaluateCanadaBc(a, false),
};

function evaluateCanadaBc(a: TaxAnswers, allowPendingRegistration: boolean): ReturnType<TaxRulePack["evaluate"]> {
  const issues: string[] = [];
  if (a.scopeConfirmed !== "yes") issues.push("Confirm the place of supply and ordinary domestic scope. Special or mixed supplies need review.");
  if (!["business", "nonprofit", "charity"].includes(a.sellerKind)) issues.push("Establish the supplier's tax status. Other public bodies require a reviewed rule pack.");
  if (!a.itemCategory || ["unknown", "other"].includes(a.itemCategory)) issues.push("Choose a supported supply category or obtain a specific tax review.");
  if (a.scope === "transaction" && (!a.customerRelief || a.customerRelief === "unknown")) issues.push("Check whether this customer claims transaction-specific relief.");
  if (a.scope === "catalog" && a.customerRelief !== "none") issues.push("Customer-specific relief belongs on the invoice, not the reusable catalog item.");
  if (a.scope === "catalog" && (has(a, "customerEvidence") || has(a, "purchaserPstNumber"))) issues.push("Keep customer exemption evidence on the transaction, not the catalog item.");
  if (["pst", "both"].includes(a.customerRelief)) {
    if (!["pst_number", "certificate", "other"].includes(a.pstReliefDocumentation) || a.pstReliefConditions !== "confirmed") issues.push("Verify the required purchaser PST exemption documentation route and transaction conditions.");
    if (a.pstReliefDocumentation === "pst_number" && !/^PST-\d{4}-\d{4}$/.test(a.purchaserPstNumber ?? "")) issues.push("Record a purchaser PST number in PST-1234-5678 format for the invoice.");
    if (a.pstReliefDocumentation === "certificate" && !has(a, "pstCertificateType")) issues.push("Record the permitted PST certificate form and the purchaser's eligibility to use it.");
  }
  let components = [federal(a), provincial(a, allowPendingRegistration)];
  const categoryAuthority = ({ software: "bc-software", related_services: "bc-related-services", legal_services: "bc-legal-services" } as Record<string, string>)[a.itemCategory];
  if (categoryAuthority) components[1].authorityIds = [...new Set([...components[1].authorityIds, categoryAuthority])];
  if (["gst", "pst", "both"].includes(a.customerRelief)) {
    if (!has(a, "customerEvidence")) issues.push("Record the rule, conditions and evidence for customer-specific relief.");
    else if (a.scope === "transaction") components = components.map((component) => {
      const applies = a.customerRelief === "both" || (a.customerRelief === "gst" ? component.taxId === "CA-GST" : component.taxId === "CA-BC-PST");
      // Relief cannot settle a missing underlying classification or supplier registration assessment.
      if (!applies || component.collection !== "collect") return component;
      return { ...component, treatment: "relieved", collection: "do_not_collect", reason: "Customer-specific relief is supported by the recorded eligibility, delivery/use conditions and evidence.", authorityIds: [...component.authorityIds, ...(component.taxId === "CA-BC-PST" ? ["bc-exemption-evidence", ...(a.pstReliefDocumentation === "certificate" ? ["bc-fin490"] : [])] : [])] };
    });
  }
  for (const component of components) if (component.collection === "review_required") issues.push(`${component.label}: ${component.reason}`);
  return { components, issues };
}

/** Preserve the reviewed legacy evaluator for stored assessments; new guides use
 * the revision that supports collection while a PST number is pending. */
export const canadaBcPendingPstTaxPack: TaxRulePack = {
  ...canadaBcTaxPack, version: "2026-11-09.1", reviewedOn: "2026-11-09",
  evaluate: (a) => evaluateCanadaBc(a, true),
};
