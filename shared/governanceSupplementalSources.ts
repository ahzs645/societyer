import type { LegalSourceRecord } from "./legalGovernanceTypes";

/** Additional official-source guidance for the appointment and attestation
 * registers. These summaries do not turn factual checkboxes into legal findings. */
export const GOVERNANCE_SUPPLEMENTAL_SOURCES: readonly LegalSourceRecord[] = [
  {
    id: "BC-BCA-DIRECTOR-QUALIFICATIONS",
    instrument: "Business Corporations Act (British Columbia)", section: "ss. 124–125",
    fullCitation: "Business Corporations Act, S.B.C. 2002, c. 57, ss. 124–125",
    url: "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02057_00_multi#section124",
    consolidatedThrough: "2026-10-06", reviewedOn: "2026-10-11", status: "in_force",
    summary: "A director must be an individual aged at least 18 and satisfy the statutory incapacity, bankruptcy and specified-conviction requirements. A director who ceases to qualify must promptly resign. Articles may require share ownership.",
    caveat: "Conviction disqualification has court, elapsed-time and pardon/record-suspension exceptions. Assess the exact statutory events and any additional governing-document requirements; a blank attestation is not a disqualification finding.",
  },
  {
    id: "BC-BCA-AUDITOR-APPOINTMENT",
    instrument: "Business Corporations Act (British Columbia)", section: "ss. 204–206, 208",
    fullCitation: "Business Corporations Act, S.B.C. 2002, c. 57, ss. 204–206, 208",
    url: "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02057_00_multi#section204",
    consolidatedThrough: "2026-10-06", reviewedOn: "2026-10-11", status: "in_force",
    summary: "Directors appoint the first auditor; shareholders appoint by ordinary resolution on or before each annual reference date. Directors may fill a casual vacancy, and the court has an appointment route. Give the auditor prompt written appointment notice. Audit authorization and independence require verification.",
    caveat: "Independence concerns the company, affiliates and relevant relationships and interests. Section 208 includes remediation, resignation and a court exemption route. The annual waiver, replacement procedures and other professional or securities-law duties are separate.",
  },
  {
    id: "CBCA-DIRECTOR-QUALIFICATIONS",
    instrument: "Canada Business Corporations Act", section: "ss. 105(1)–(2), 108(1)(c)",
    fullCitation: "Canada Business Corporations Act, R.S.C. 1985, c. C-44, ss. 105(1)–(2), 108(1)(c)",
    url: "https://laws-lois.justice.gc.ca/eng/acts/C-44/FullText.html",
    consolidatedThrough: "2026-09-21", reviewedOn: "2026-10-11", status: "in_force",
    summary: "Directors must be individual adults and cannot have the Act's defined incapacity or bankruptcy status. Share ownership is unnecessary unless the articles require it. A director ceases to hold office on becoming disqualified under s. 105(1).",
    caveat: "Use the statutory definition of incapacity and the actual governing documents. Resident-Canadian board composition is a separate rule; an individual annual attestation is evidence, not a statutory renewal of office.",
  },
  {
    id: "CBCA-AUDITOR-APPOINTMENT",
    instrument: "Canada Business Corporations Act", section: "ss. 104(1)(e), 161–162, 166–167",
    fullCitation: "Canada Business Corporations Act, R.S.C. 1985, c. C-44, ss. 104(1)(e), 161–162, 166–167",
    url: "https://laws-lois.justice.gc.ca/eng/acts/C-44/FullText.html",
    consolidatedThrough: "2026-09-21", reviewedOn: "2026-10-11", status: "in_force",
    summary: "Shareholders appoint an auditor by ordinary resolution at annual meetings, subject to a valid waiver. Directors may appoint the initial auditor at the organization meeting and fill vacancies subject to the articles. Independence is assessed from actual relationships and interests, with specified disqualifications and a court exemption route.",
    caveat: "Vacancy, court appointment and incumbent-continuation rules differ. Check the separate all-shareholder waiver and applicable professional or securities-law duties; an independence checkbox is not a substitute for that assessment.",
  },
  {
    id: "OBCA-DIRECTOR-QUALIFICATIONS",
    instrument: "Business Corporations Act (Ontario)", section: "s. 118",
    fullCitation: "Business Corporations Act, R.S.O. 1990, c. B.16, s. 118",
    url: "https://www.ontario.ca/laws/statute/90b16",
    consolidatedThrough: "2026-10-07", reviewedOn: "2026-10-11", status: "in_force",
    summary: "Directors must be individual adults. The statutory incapacity findings and bankruptcy status disqualify an individual; share ownership is unnecessary unless articles require it. The former resident-Canadian quota in s. 118(3) is repealed.",
    caveat: "The property-incapacity provisions refer to specified legal findings. Annual attestations do not establish those findings or automatically renew eligibility. Current official indexed passages and amendment annotations were checked; direct full-page retrieval was unavailable.",
  },
  {
    id: "OBCA-AUDITOR-APPOINTMENT",
    instrument: "Business Corporations Act (Ontario)", section: "ss. 149, 152",
    fullCitation: "Business Corporations Act, R.S.O. 1990, c. B.16, ss. 149, 152",
    url: "https://www.ontario.ca/laws/statute/90b16",
    consolidatedThrough: "2026-10-07", reviewedOn: "2026-10-11", status: "in_force",
    summary: "Shareholders appoint at the first annual or special meeting by ordinary resolution and at each annual meeting thereafter. Directors act if the first appointment is omitted and may fill a casual vacancy; a court appointment route exists. Give written appointment notice promptly. The auditor must satisfy the independence rules.",
    caveat: "Independence is factual and has specified disqualifying relationships. The old s. 152(5) court exemption was repealed; do not import the federal exemption. The separate annual waiver, replacement-auditor duties and professional requirements still need review. Direct full-page retrieval was unavailable; current official indexed passages were checked.",
  },
];
