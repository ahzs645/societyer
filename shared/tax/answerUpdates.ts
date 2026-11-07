import type { TaxAnswers } from "./types";

const categoryConditions: TaxAnswers = {
  softwareScope: "unknown",
  relatedServiceScope: "unknown",
  legalServiceScope: "unknown",
};

const purchaserDocumentation: TaxAnswers = {
  purchaserPstNumber: "",
  pstReliefDocumentation: "unknown",
  pstReliefConditions: "unknown",
  pstCertificateType: "",
};

const customerAnswers = (scope: string): TaxAnswers => ({
  customerRelief: scope === "catalog" ? "none" : "unknown",
  customerEvidence: "",
  ...purchaserDocumentation,
});

/**
 * Update a guide answer without carrying evidence across a changed decision.
 * These dependencies belong to the Canada/B.C. pack. Other jurisdictions
 * register their own updateAnswer hook alongside their questions and evaluator.
 */
export function updateTaxAnswer(answers: TaxAnswers, key: string, value: string): TaxAnswers {
  if (answers[key] === value) return answers;
  const next: TaxAnswers = { ...answers, [key]: value };

  if (["itemCategory", "jurisdictionCode", "sellerKind", "supplyDate"].includes(key)) {
    Object.assign(next, {
      scopeConfirmed: "unknown",
      federalException: "unknown",
      federalEvidence: "",
      provincialException: "unknown",
      provincialEvidence: "",
      charityEvidence: "",
      ...categoryConditions,
      ...customerAnswers(next.scope),
    });
    // Registration belongs to the supplier. Selecting another item does not
    // revoke an active registration or its separate registration assessment.
    if (key !== "itemCategory") Object.assign(next, {
      gstRegistration: "unknown",
      gstRegistrationEvidence: "",
      pstRegistration: "unknown",
      pstRegistrationEvidence: "",
    });
    return next;
  }

  switch (key) {
    case "scope":
      Object.assign(next, customerAnswers(value));
      break;
    case "federalException":
      next.federalEvidence = "";
      break;
    case "provincialException":
      next.provincialEvidence = "";
      Object.assign(next, categoryConditions);
      if (["pst", "both"].includes(next.customerRelief)) next.pstReliefConditions = "unknown";
      break;
    case "gstRegistration":
      next.gstRegistrationEvidence = "";
      break;
    case "pstRegistration":
      next.pstRegistrationEvidence = "";
      if (["pst", "both"].includes(next.customerRelief)) next.pstReliefConditions = "unknown";
      break;
    case "customerRelief":
      next.customerEvidence = "";
      Object.assign(next, purchaserDocumentation);
      break;
    case "pstReliefDocumentation":
      next.purchaserPstNumber = "";
      next.pstCertificateType = "";
      next.pstReliefConditions = "unknown";
      break;
    case "purchaserPstNumber":
    case "pstCertificateType":
    case "customerEvidence":
      next.pstReliefConditions = "unknown";
      break;
  }
  return next;
}
