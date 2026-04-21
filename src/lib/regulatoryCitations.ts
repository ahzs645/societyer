/**
 * Regulatory citation database.
 *
 * A flat lookup map keyed by stable citation id. Each entry points the user
 * at the primary legal source (statute, regulation, policy) that a
 * compliance flag is resting on — so a warning like "No PIPA privacy policy
 * on file" can show the user the exact wording of the rule that requires
 * that policy, plus a deep link out to the authoritative source.
 *
 * Usage:
 *   <Flag level="warn" citationId="PIPA-POLICY">...</Flag>
 *
 * Keep ids stable — they are referenced from pages across the app. When a
 * statute changes, prefer adding a new id (with a caveat) over rewriting
 * an existing quote so older screens still resolve.
 */

export type RegulatoryJurisdiction =
  | "CA"
  | "CA-BC"
  | "CA-AB"
  | "CA-ON"
  | "International"
  | string;

export interface RegulatoryCitation {
  /** Stable id referenced from UI, e.g. "PIPA-POLICY". */
  id: string;
  /** One-line source label shown as the tooltip title. */
  source: string;
  /** Full academic/legal citation string. */
  fullCitation: string;
  /** Jurisdiction code (e.g. "CA-BC"). */
  jurisdiction: RegulatoryJurisdiction;
  /** Instrument (e.g. "Personal Information Protection Act", "Societies Act"). */
  instrument: string;
  /** Section label, e.g. "s.5" or "ss.20-24". */
  section?: string;
  /** Deep link to the canonical source. */
  url: string;
  /** Optional point-in-time URL for historical checks. */
  pointInTimeUrl?: string;
  /** ISO date the source was last reviewed against. */
  sourceCurrentToISO?: string;
  /** Short quote (or close paraphrase) from the section. */
  quote: string;
  /** Optional caveat shown beneath the quote. */
  caveat?: string;
  /** Optional — tie this citation to one of the LegalGuideRule topics
   * (jurisdictionGuideTracks.ts) so the two can be cross-linked later. */
  relatedGuideTopic?: string;
}

const BC_LAWS_PIPA =
  "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/03063_01";
const BC_LAWS_SOCIETIES_ACT =
  "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/15018_01";
const BC_LAWS_SOCIETIES_ACT_PIT =
  "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/15018_pit";
const BC_LAWS_SOCIETIES_REG =
  "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/216_2015";
const CASL_URL =
  "https://laws-lois.justice.gc.ca/eng/acts/e-1.6/page-1.html";
const CRA_RECORDS_URL =
  "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/keeping-records.html";
const CRA_CHARITIES_BOOKS_URL =
  "https://www.canada.ca/en/revenue-agency/services/charities-giving/charities/operating-a-registered-charity/books-records.html";

const BC_CURRENT_TO_ISO = "2026-04-14";

export const regulatoryCitations: Record<string, RegulatoryCitation> = {
  // ---------------------------------------------------------------
  // BC Personal Information Protection Act (PIPA)
  // ---------------------------------------------------------------
  "PIPA-POLICY": {
    id: "PIPA-POLICY",
    source: "BC PIPA s.5 — Policies and practices",
    fullCitation:
      "Personal Information Protection Act, SBC 2003, c.63, s.5. BC Laws, current to " +
      BC_CURRENT_TO_ISO +
      ".",
    jurisdiction: "CA-BC",
    instrument: "Personal Information Protection Act",
    section: "s.5",
    url: BC_LAWS_PIPA,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    quote:
      "An organization must (a) develop and follow policies and practices that are necessary for the organization to meet the obligations of the organization under this Act, (b) develop a process to respond to complaints that may arise respecting the application of this Act, and (c) make information about the policies and practices described in paragraph (a) and the complaint process described in paragraph (b) available on request.",
    caveat:
      "PIPA applies to most private-sector organizations in BC, including societies that handle personal information about members, employees, or the public.",
  },
  "PIPA-OFFICER": {
    id: "PIPA-OFFICER",
    source: "BC PIPA s.4(3)-(4) — Privacy officer",
    fullCitation:
      "Personal Information Protection Act, SBC 2003, c.63, s.4. BC Laws, current to " +
      BC_CURRENT_TO_ISO +
      ".",
    jurisdiction: "CA-BC",
    instrument: "Personal Information Protection Act",
    section: "s.4(3)-(4)",
    url: BC_LAWS_PIPA,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    quote:
      "An organization is responsible for personal information that is in its custody or under its control. An organization must designate one or more individuals to be responsible for ensuring that the organization complies with this Act.",
    caveat:
      "The designated individual's contact information must be made available to anyone on request.",
  },
  "PIPA-CONSENT": {
    id: "PIPA-CONSENT",
    source: "BC PIPA ss.6-8 — Consent required",
    fullCitation:
      "Personal Information Protection Act, SBC 2003, c.63, ss.6-8. BC Laws, current to " +
      BC_CURRENT_TO_ISO +
      ".",
    jurisdiction: "CA-BC",
    instrument: "Personal Information Protection Act",
    section: "ss.6-8",
    url: BC_LAWS_PIPA,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    quote:
      "An organization must not collect, use or disclose personal information about an individual unless the individual gives consent to the collection, use or disclosure, or this Act authorizes the collection, use or disclosure without consent. An organization must not, as a condition of supplying a product or service, require an individual to consent to the collection, use or disclosure of personal information beyond what is necessary to provide the product or service.",
    caveat:
      "Consent may be express, deemed, or opt-out depending on the sensitivity of the information and the context.",
  },
  "PIPA-RETENTION": {
    id: "PIPA-RETENTION",
    source: "BC PIPA s.35 — Retention of personal information",
    fullCitation:
      "Personal Information Protection Act, SBC 2003, c.63, s.35. BC Laws, current to " +
      BC_CURRENT_TO_ISO +
      ".",
    jurisdiction: "CA-BC",
    instrument: "Personal Information Protection Act",
    section: "s.35",
    url: BC_LAWS_PIPA,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    quote:
      "If an organization uses an individual's personal information to make a decision that directly affects the individual, the organization must retain that information for at least one year after using it so that the individual has a reasonable opportunity to obtain access to it. An organization must destroy its documents containing personal information, or remove the means by which the personal information can be associated with particular individuals, as soon as it is reasonable to assume that the purpose is no longer being served by retention of the personal information and retention is no longer necessary for legal or business purposes.",
  },
  "PIPA-ACCESS": {
    id: "PIPA-ACCESS",
    source: "BC PIPA s.23 — Access to personal information",
    fullCitation:
      "Personal Information Protection Act, SBC 2003, c.63, s.23. BC Laws, current to " +
      BC_CURRENT_TO_ISO +
      ".",
    jurisdiction: "CA-BC",
    instrument: "Personal Information Protection Act",
    section: "s.23",
    url: BC_LAWS_PIPA,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    quote:
      "On request of an individual, an organization must provide the individual with the following: (a) the individual's personal information under the control of the organization; (b) information about the ways in which the personal information referred to in paragraph (a) has been and is being used by the organization; (c) the names of the individuals and organizations to whom the personal information referred to in paragraph (a) has been disclosed by the organization.",
  },

  // ---------------------------------------------------------------
  // Canada's Anti-Spam Legislation (CASL)
  // ---------------------------------------------------------------
  "CASL-CONSENT": {
    id: "CASL-CONSENT",
    source: "CASL s.6 — Consent to send commercial electronic messages",
    fullCitation:
      "An Act to promote the efficiency and adaptability of the Canadian economy (Canada's Anti-Spam Legislation), SC 2010, c.23, s.6.",
    jurisdiction: "CA",
    instrument: "Canada's Anti-Spam Legislation",
    section: "s.6",
    url: CASL_URL,
    quote:
      "It is prohibited to send or cause or permit to be sent to an electronic address a commercial electronic message unless (a) the person to whom the message is sent has consented to receiving it, whether the consent is express or implied; and (b) the message complies with [prescribed form and content requirements, including sender identification and an unsubscribe mechanism].",
    caveat:
      "Societies communicating with members, donors, volunteers, or the public by email, SMS, or direct message need a CASL basis and functioning unsubscribe handling.",
  },

  // ---------------------------------------------------------------
  // BC Societies Act — Directors & governance
  // ---------------------------------------------------------------
  "BC-SOC-DIRECTORS-MIN": {
    id: "BC-SOC-DIRECTORS-MIN",
    source: "BC Societies Act s.42 — Minimum number of directors",
    fullCitation:
      "Societies Act, SBC 2015, c.18, s.42. BC Laws, current to " +
      BC_CURRENT_TO_ISO +
      ".",
    jurisdiction: "CA-BC",
    instrument: "Societies Act",
    section: "s.42",
    url: BC_LAWS_SOCIETIES_ACT,
    pointInTimeUrl: BC_LAWS_SOCIETIES_ACT_PIT,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    quote:
      "A society must have at least 3 directors, but a member-funded society is only required to have one director.",
    caveat:
      "The society's filed bylaws can set a higher minimum.",
  },
  "BC-SOC-DIRECTORS-BC-RESIDENT": {
    id: "BC-SOC-DIRECTORS-BC-RESIDENT",
    source: "BC Societies Act s.44(1) — Residency requirement",
    fullCitation:
      "Societies Act, SBC 2015, c.18, s.44. BC Laws, current to " +
      BC_CURRENT_TO_ISO +
      ".",
    jurisdiction: "CA-BC",
    instrument: "Societies Act",
    section: "s.44(1)",
    url: BC_LAWS_SOCIETIES_ACT,
    pointInTimeUrl: BC_LAWS_SOCIETIES_ACT_PIT,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    quote:
      "At least one director of a society must be ordinarily resident in British Columbia.",
  },
  "BC-SOC-DIRECTOR-CONSENT": {
    id: "BC-SOC-DIRECTOR-CONSENT",
    source: "BC Societies Act s.45 — Consent to be a director",
    fullCitation:
      "Societies Act, SBC 2015, c.18, s.45. BC Laws, current to " +
      BC_CURRENT_TO_ISO +
      ".",
    jurisdiction: "CA-BC",
    instrument: "Societies Act",
    section: "s.45",
    url: BC_LAWS_SOCIETIES_ACT,
    pointInTimeUrl: BC_LAWS_SOCIETIES_ACT_PIT,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    quote:
      "An individual must not be elected or appointed as a director of a society unless the individual has, before the election or appointment, consented in writing to be a director, or consents at the meeting at which the individual is elected or appointed and the consent is recorded in the minutes.",
    caveat:
      "Keep the signed consent (or minuted consent) in the society's records alongside the director register.",
  },
  "BC-SOC-DIRECTOR-QUALIFICATIONS": {
    id: "BC-SOC-DIRECTOR-QUALIFICATIONS",
    source: "BC Societies Act s.44(2) — Director qualifications",
    fullCitation:
      "Societies Act, SBC 2015, c.18, s.44(2). BC Laws, current to " +
      BC_CURRENT_TO_ISO +
      ".",
    jurisdiction: "CA-BC",
    instrument: "Societies Act",
    section: "s.44(2)",
    url: BC_LAWS_SOCIETIES_ACT,
    pointInTimeUrl: BC_LAWS_SOCIETIES_ACT_PIT,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    quote:
      "An individual is not qualified to become or act as a director of a society if the individual (a) is under the age of 18 years, (b) has been found by any court to be incapable of managing the individual's own affairs, (c) is an undischarged bankrupt, or (d) has been convicted [of specified offences] within the previous 5 years.",
  },
  "BC-SOC-RECORDS": {
    id: "BC-SOC-RECORDS",
    source: "BC Societies Act ss.20-24 — Records and inspection",
    fullCitation:
      "Societies Act, SBC 2015, c.18, ss.20-24. BC Laws, current to " +
      BC_CURRENT_TO_ISO +
      ".",
    jurisdiction: "CA-BC",
    instrument: "Societies Act",
    section: "ss.20-24",
    url: BC_LAWS_SOCIETIES_ACT,
    pointInTimeUrl: BC_LAWS_SOCIETIES_ACT_PIT,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    quote:
      "A society must keep at its registered office records including its certificate of incorporation, constitution and bylaws, register of directors, register of members, minutes of general meetings and directors' meetings, and adequate accounting records. Members and directors are entitled to inspect most records during normal business hours; the bylaws may restrict public access to some records.",
  },
  "BC-SOC-AGM": {
    id: "BC-SOC-AGM",
    source: "BC Societies Act ss.71-73 — AGM timing and annual report",
    fullCitation:
      "Societies Act, SBC 2015, c.18, ss.71-73. BC Laws, current to " +
      BC_CURRENT_TO_ISO +
      ".",
    jurisdiction: "CA-BC",
    instrument: "Societies Act",
    section: "ss.71-73",
    url: BC_LAWS_SOCIETIES_ACT,
    pointInTimeUrl: BC_LAWS_SOCIETIES_ACT_PIT,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    quote:
      "A society must hold an annual general meeting at least once in each calendar year, and not more than 15 months after its last annual general meeting. After the AGM, the society must file an annual report with the registrar.",
    caveat:
      "Registrar extensions and deemed-AGM provisions can move the ordinary date.",
    relatedGuideTopic: "agm_timing",
  },
  "BC-SOC-DIRECTOR-CHANGE-FILING": {
    id: "BC-SOC-DIRECTOR-CHANGE-FILING",
    source: "BC Societies Act s.48 — Notice of change of directors",
    fullCitation:
      "Societies Act, SBC 2015, c.18, s.48. BC Laws, current to " +
      BC_CURRENT_TO_ISO +
      ".",
    jurisdiction: "CA-BC",
    instrument: "Societies Act",
    section: "s.48",
    url: BC_LAWS_SOCIETIES_ACT,
    pointInTimeUrl: BC_LAWS_SOCIETIES_ACT_PIT,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    quote:
      "A society must file with the registrar, in the form established by the registrar, a notice of change of directors within 15 days after the change.",
    caveat:
      "Filed through Societies Online. Some societies are used to the prior 30-day guidance — confirm the current rule before relying on it for a specific change.",
  },
  "BC-SOC-MODEL-BYLAWS-QUORUM": {
    id: "BC-SOC-MODEL-BYLAWS-QUORUM",
    source: "BC Model Bylaws ss.3.6-3.7 — Quorum",
    fullCitation:
      "Societies Regulation, BC Reg 216/2015, Schedule (Model Bylaws), ss.3.6-3.7. BC Laws, current to " +
      BC_CURRENT_TO_ISO +
      ".",
    jurisdiction: "CA-BC",
    instrument: "Societies Regulation — Model Bylaws",
    section: "ss.3.6-3.7",
    url: BC_LAWS_SOCIETIES_REG,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    quote:
      "The quorum for a general meeting is 3 voting members or 10% of the voting members, whichever is greater.",
    caveat:
      "Applies only to societies that adopted the Model Bylaws or matching wording — the society's own filed bylaws control if different.",
    relatedGuideTopic: "model_bylaws_quorum",
  },

  // ---------------------------------------------------------------
  // Canada Revenue Agency — Books and records
  // ---------------------------------------------------------------
  "CRA-BOOKS-RECORDS": {
    id: "CRA-BOOKS-RECORDS",
    source: "CRA — Keeping records (6-year retention)",
    fullCitation:
      "Canada Revenue Agency. Keeping records. Updated guidance on how long to keep business and non-profit books and records.",
    jurisdiction: "CA",
    instrument: "Income Tax Act & CRA guidance",
    section: "ITA s.230; CRA guidance",
    url: CRA_RECORDS_URL,
    quote:
      "Keep all required records and supporting documents for a period of six years from the end of the last tax year they relate to. If you file your return late, keep your records for six years from the date you file that return.",
    caveat:
      "Some records (for example those relating to the acquisition and disposal of capital property, share registers, and the general ledger) must be kept for longer or indefinitely.",
  },
  "CRA-CHARITIES-BOOKS": {
    id: "CRA-CHARITIES-BOOKS",
    source: "CRA — Books and records for registered charities",
    fullCitation:
      "Canada Revenue Agency. Books and records for registered charities. Updated CRA guidance.",
    jurisdiction: "CA",
    instrument: "Income Tax Act & CRA charities guidance",
    section: "ITA s.230(4); CRA charities guidance",
    url: CRA_CHARITIES_BOOKS_URL,
    quote:
      "Registered charities must keep adequate books and records so the CRA can verify donations, revenues, expenses, and activities. Governing documents (for example, the constitution, bylaws, and minutes of meetings of the directors and members) must be kept as long as the charity is registered and for a minimum of two years after revocation.",
  },
};

/** Look up a citation. Returns undefined if the id is unknown. */
export function getRegulatoryCitation(
  id: string | undefined | null,
): RegulatoryCitation | undefined {
  if (!id) return undefined;
  return regulatoryCitations[id];
}

/** All citation ids, useful for exhaustiveness checks in tests. */
export const REGULATORY_CITATION_IDS = Object.keys(
  regulatoryCitations,
) as (keyof typeof regulatoryCitations)[];
