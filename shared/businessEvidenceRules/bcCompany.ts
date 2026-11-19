// BC Laws, consolidation consulted 2026-11-19.
const act = "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02057_";

export const bcCompanyEvidence = {
  shareNotices: [
    { text: "After an uncertificated issue or transfer, send the holder written notice within a reasonable time. Unlimited liability companies must use certificates.", citation: "BCA s. 107", url: act + "05#section107" },
    { text: "Review the notice against the certificate particulars, including the company, holder, number and class of shares, series where applicable, par value details, issue date, identifier and applicable legends.", citation: "BCA s. 57", url: act + "04#section57" },
  ],
  directorConsents: [
    { text: "Record the basis for consent. Depending on the appointment, written consent or qualifying conduct may be relevant.", citation: "BCA ss. 121–123", url: act + "06#section123" },
    { text: "Keep a copy of each consent to act received by the company at its records office, subject to the Act’s records provisions.", citation: "BCA s. 42", url: act + "02#section42" },
  ],
  governanceDecisions: [
    { text: "An auditor waiver covers one financial year. Record the unanimous resolution of all shareholders, including holders of non-voting shares.", citation: "BCA s. 203", url: act + "08#section203" },
    { text: "Keep shareholder consent resolutions and their counterparts with the company records.", citation: "BCA s. 42", url: act + "02#section42" },
  ],
};

export function bcCompanyAllows(table: string, subtype?: string | null) {
  return table !== "shareNotices" || !["ulc", "unlimited_liability_company"].includes(subtype ?? "");
}
