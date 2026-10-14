import type { LegalEntityLike } from "./organizationDomain";
import { organizationRuleScope } from "./entityRuleScope";

/** Privacy follows the activity, information and operating territory. Recorded
 * facts always decide. The one default is BC PIPA for a BC-home workspace: BC
 * PIPA s. 1 defines "organization" to include a not-for-profit and s. 3(1)
 * applies it to every organization, so it is presumed (and labelled as a
 * presumption) until the assessment records federal-work status or operations
 * that exclude BC. Never infer any other law from incorporation jurisdiction,
 * entity type or a postal address.
 * Sources and research limitations: docs/legal-research/privacy.md. */
export const PRIVACY_REVIEWED_ON = "2026-10-11";
export type PrivacyAnswer = "yes" | "no" | "unknown";
export type PrivacyLawId = "bc_pipa" | "ab_pipa" | "qc_private" | "pipeda";
export type PrivacyAssessmentFacts = {
  privacyOperatingJurisdictions?: string[];
  privacyCommercialActivity?: PrivacyAnswer;
  privacyFederalWork?: PrivacyAnswer;
  privacyCrossBorderCommercial?: PrivacyAnswer;
  privacyQuebecEnterprise?: PrivacyAnswer;
  privacyAlbertaNonprofitClass?: "section-56" | "other" | "unknown";
  privacySectorSpecific?: "none" | "health" | "public" | "unknown";
  privacyScopeReviewedAtISO?: string;
};
export type PrivacyAssessmentInput = LegalEntityLike & PrivacyAssessmentFacts;
export type PrivacyCitation = {
  id: string;
  source: string;
  fullCitation: string;
  jurisdiction: string;
  instrument: string;
  section: string;
  url: string;
  quote: string;
  sourceCurrentToISO?: string;
  caveat?: string;
};

const BC_ACT = "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/00_03063_01";
const AB_ACT = "https://kings-printer.alberta.ca/documents/Acts/P06P5.pdf";
const QC_ACT = "https://www.legisquebec.gouv.qc.ca/en/document/cs/P-39.1";
const FED_ACT = "https://laws-lois.justice.gc.ca/eng/acts/P-8.6/FullText.html";

function citation(id: string, source: string, instrument: string, fullCitation: string, section: string, jurisdiction: string, url: string, quote: string, sourceCurrentToISO?: string, caveat?: string): PrivacyCitation {
  return { id, source, instrument, fullCitation, section, jurisdiction, url, quote, sourceCurrentToISO, caveat };
}
const bc = (id: string, title: string, section: string, summary: string) => citation(id, `BC PIPA — ${title}`, "Personal Information Protection Act", `Personal Information Protection Act, SBC 2003, c. 63, ${section}`, section, "CA-BC", BC_ACT, summary, "2026-10-06");
const ab = (id: string, title: string, section: string, summary: string) => citation(id, `Alberta PIPA — ${title}`, "Personal Information Protection Act (Alberta)", `Personal Information Protection Act, SA 2003, c. P-6.5, ${section}`, section, "CA-AB", AB_ACT, summary, "2025-09-01", "King's Printer office consolidation current as of 2025-09-01, retrieved 2026-10-11 (s. 56 last amended 2025, c. 6, s. 39); official regulator guidance also checked.");
const qc = (id: string, title: string, section: string, summary: string) => citation(id, `Québec private-sector privacy law — ${title}`, "Act respecting the protection of personal information in the private sector", `Act respecting the protection of personal information in the private sector, CQLR c. P-39.1, ${section}`, section, "CA-QC", QC_ACT, summary, "2026-08-12");
const fed = (id: string, title: string, section: string, summary: string) => citation(id, `PIPEDA — ${title}`, "Personal Information Protection and Electronic Documents Act", `Personal Information Protection and Electronic Documents Act, SC 2000, c. 5, ${section}`, section, "CA", FED_ACT, summary, "2026-09-21");

/** Paraphrases, not statutory quotations. Keep provenance attached when a new
 * jurisdiction or obligation is added; dates denote the consolidation read. */
export const PRIVACY_CITATIONS: Record<string, PrivacyCitation> = Object.fromEntries([
  bc("PIPA-SCOPE", "Application", "ss. 1, 3(1)-(2)", "\"Organization\" includes a not-for-profit organization; the Act applies to every organization except where the federal Act applies, such as to a federal work, undertaking or business or to interprovincial or international commercial transfers."),
  bc("PIPA-OFFICER", "Accountability", "s. 4(3)-(4)", "Designate at least one individual responsible for compliance and make their contact details available on request."),
  bc("PIPA-POLICY", "Policies and complaints", "s. 5", "Develop and follow privacy practices and a complaints process, and make information about them available on request."),
  bc("PIPA-CONSENT", "Consent", "ss. 6-9", "Obtain consent where required; document a permitted exception or deemed consent when relying on it."),
  bc("PIPA-ACCESS", "Individual access", "ss. 1, 23, 29, 31", "Respond to access requests within 30 days excluding Saturdays and holidays, subject to lawful extensions and pauses."),
  bc("PIPA-RETENTION", "Retention", "s. 35", "Keep information used for an affecting decision at least one year; destroy or de-identify when purpose and legal or business retention needs end."),
  bc("PIPA-SAFEGUARDS", "Safeguards", "s. 34", "Use reasonable security arrangements to protect personal information. Private-sector breach reporting remains regulator-recommended, not a general mandatory PIPA report."),
  fed("PIPEDA-OFFICER", "Accountability", "Schedule 1, cls. 4.1, 4.1.1", "Assign accountability for compliance to a designated individual or individuals."),
  fed("PIPEDA-POLICY", "Policies and transparency", "Schedule 1, cls. 4.1.4, 4.8, 4.10", "Implement policies, safeguards, training and complaint procedures; make privacy practices readily available."),
  fed("PIPEDA-CONSENT", "Meaningful consent", "s. 6.1; Schedule 1, cl. 4.3", "Consent must be understandable for its nature, purpose and consequences; statutory exceptions remain available."),
  fed("PIPEDA-ACCESS", "Individual access", "ss. 8(3)-(4), 9; Schedule 1, cl. 4.9", "Respond within 30 calendar days, subject to the statutory extension and refusal rules."),
  fed("PIPEDA-RETENTION", "Retention", "s. 8(8); Schedule 1, cls. 4.5-4.5.3", "Retain only for identified purposes, permit meaningful access to decision information, and preserve requested information through recourse."),
  fed("PIPEDA-BREACH", "Breach reporting", "ss. 10.1-10.3", "Report and notify qualifying breaches as soon as feasible; keep a record of every breach under the organization's control."),
  citation("PIPEDA-BREACH-RECORDS", "PIPEDA breach records", "Breach of Security Safeguards Regulations", "Breach of Security Safeguards Regulations, SOR/2018-64, s. 6", "s. 6", "CA", "https://laws-lois.justice.gc.ca/eng/regulations/SOR-2018-64/FullText.html", "Maintain every breach record for at least 24 months after determining that the breach occurred.", "2026-09-21"),
  ab("AB-PIPA-OFFICER", "Accountability", "s. 5(3)", "Designate an individual or individuals responsible for compliance."),
  ab("AB-PIPA-POLICY", "Policies and foreign providers", "ss. 6, 13.1", "Implement reasonable practices and required foreign-provider country/purpose information and notices; make policy information available on request."),
  ab("AB-PIPA-CONSENT", "Consent", "ss. 7-10", "Obtain consent where required, or document the statutory basis for collection, use or disclosure without it."),
  ab("AB-PIPA-ACCESS", "Individual access", "ss. 24-28, 31", "Respond to an access or correction request within 45 calendar days, subject to permitted extensions."),
  ab("AB-PIPA-RETENTION", "Retention", "s. 35", "Retain information only while reasonable for legal or business purposes; then destroy or render it non-identifying."),
  ab("AB-PIPA-BREACH", "Breach reporting", "ss. 34.1, 37.1", "Report to the Commissioner without unreasonable delay when a reasonable person would find a real risk of significant harm; follow any individual-notification direction."),
  ab("AB-PIPA-NONPROFIT", "Defined nonprofits", "s. 56(1)-(3)", "Only the defined class of nonprofits receives the commercial-activity limitation; other nonprofits remain within the ordinary scope."),
  qc("QC-PRIVACY-OFFICER", "Person in charge", "s. 3.1", "The highest authority is responsible unless delegated in writing; publish the title and contact details."),
  qc("QC-PRIVACY-POLICY", "Governance and publication", "ss. 3.2, 8.2", "Adopt proportionate privacy governance practices, publish the required details and publish a policy for collection using technology."),
  qc("QC-PRIVACY-CONSENT", "Consent", "ss. 8, 12-14", "Use purpose-specific, clear and informed consent where required; obtain express consent for sensitive information where the Act requires it."),
  qc("QC-PRIVACY-ACCESS", "Access and portability", "ss. 27, 32", "Answer within 30 calendar days. Provide eligible applicant-supplied computerized data in a structured common format unless serious practical difficulty prevents it."),
  qc("QC-PRIVACY-RETENTION", "Retention", "ss. 11, 23", "Keep decision information at least one year; after purposes end, destroy or lawfully anonymize, subject to other legal retention."),
  qc("QC-PRIVACY-PIA", "Privacy impact assessments", "ss. 3.3, 17", "Assess relevant system projects from the outset and information transfers or entrusted handling outside Québec before proceeding."),
  qc("QC-PRIVACY-INCIDENT", "Confidentiality incidents", "ss. 3.5-3.8", "Maintain an incident register, reduce harm and recurrence, and promptly notify the CAI and affected individuals where there is a risk of serious injury."),
  citation("QC-PRIVACY-INCIDENT-RECORDS", "Québec incident register retention", "Regulation respecting confidentiality incidents", "Regulation respecting confidentiality incidents, CQLR c. A-2.1, r. 3.1, ss. 7-8", "ss. 7-8", "CA-QC", "https://www.legisquebec.gouv.qc.ca/en/document/cr/A-2.1,%20r.%203.1", "Keep register information current and retain it for at least five years after becoming aware of the incident.", undefined, "Official CAI guidance and regulation section checked 2026-10-11; consolidation date not established."),
].map((item) => [item.id, item]));

export type PrivacyRule = {
  key: "officer" | "policy" | "consent" | "access" | "retention" | "breach" | "pia";
  title: string;
  body: string;
  citationIds: string[];
  obligation: "statutory" | "recommended";
};
export type PrivacyLawDefinition = {
  id: PrivacyLawId;
  label: string;
  jurisdiction: string;
  regulator: string;
  regulatorUrl: string;
  resources: { title: string; href: string; body: string }[];
  access: { days: number; basis: "calendar" | "bc-business"; exceptions: string };
  incidentRecordMinimumMonths: number | null;
  rules: PrivacyRule[];
};
const rule = (key: PrivacyRule["key"], title: string, citationIds: string[], body?: string, obligation: PrivacyRule["obligation"] = "statutory"): PrivacyRule => ({ key, title, citationIds, body: body ?? PRIVACY_CITATIONS[citationIds[0]].quote, obligation });

export const PRIVACY_LAWS: Record<PrivacyLawId, PrivacyLawDefinition> = {
  bc_pipa: {
    id: "bc_pipa", label: "BC PIPA", jurisdiction: "CA-BC", regulator: "Office of the Information and Privacy Commissioner for British Columbia", regulatorUrl: "https://www.oipc.bc.ca/for-private-organizations/",
    resources: [
      { title: "BC OIPC: private organizations", href: "https://www.oipc.bc.ca/for-private-organizations/", body: "PIPA guidance, privacy management and private-sector breach resources." },
      { title: "BC OIPC: privacy breach reporting", href: "https://www.oipc.bc.ca/resources/breach-notification-representatives-of-organizations-and-public-bodies/", body: "Separates mandatory public-body reports from recommended private-sector reports." },
    ],
    access: { days: 30, basis: "bc-business", exceptions: "Exclude Saturdays and statutory holidays; check PIPA ss. 29(2)-(3) and 31 before recording a pause or extension." },
    incidentRecordMinimumMonths: null,
    rules: [rule("officer", "Designate a privacy officer", ["PIPA-OFFICER"]), rule("policy", "Document policies and complaints", ["PIPA-POLICY"]), rule("consent", "Record consent or the legal exception", ["PIPA-CONSENT"]), rule("access", "Handle individual access and correction", ["PIPA-ACCESS"]), rule("retention", "Maintain a justified retention schedule", ["PIPA-RETENTION"]), rule("breach", "Prepare and document breach response", ["PIPA-SAFEGUARDS"], "Maintain a breach log and assess notification as recommended by the OIPC. BC PIPA has no general mandatory breach-reporting or fixed incident-log retention period; other applicable laws may impose one.", "recommended")],
  },
  ab_pipa: {
    id: "ab_pipa", label: "Alberta PIPA", jurisdiction: "CA-AB", regulator: "Office of the Information and Privacy Commissioner of Alberta", regulatorUrl: "https://oipc.ab.ca/legislation/pipa/",
    resources: [
      { title: "Alberta OIPC: PIPA scope", href: "https://oipc.ab.ca/legislation/pipa/", body: "Private-sector coverage and the limited exception for defined nonprofits." },
      { title: "Alberta OIPC: breach notification", href: "https://oipc.ab.ca/breach-notification/", body: "Reporting threshold, timing, forms and individual-notification directions." },
      { title: "Alberta OIPC: access requests", href: "https://oipc.ab.ca/how-to-make-an-access-request/", body: "The PIPA response period is 45 calendar days." },
    ],
    access: { days: 45, basis: "calendar", exceptions: "Check statutory extensions under s. 31 and any Commissioner direction." },
    incidentRecordMinimumMonths: null,
    rules: [rule("officer", "Designate an accountable person", ["AB-PIPA-OFFICER"]), rule("policy", "Document privacy practices", ["AB-PIPA-POLICY"]), rule("consent", "Record consent or the legal exception", ["AB-PIPA-CONSENT"]), rule("access", "Respond within 45 calendar days", ["AB-PIPA-ACCESS"]), rule("retention", "Maintain a justified retention schedule", ["AB-PIPA-RETENTION"]), rule("breach", "Assess and report qualifying breaches", ["AB-PIPA-BREACH"])],
  },
  qc_private: {
    id: "qc_private", label: "Québec private-sector privacy law", jurisdiction: "CA-QC", regulator: "Commission d’accès à l’information du Québec", regulatorUrl: "https://www.cai.gouv.qc.ca/protection-renseignements-personnels/information-entreprises-privees",
    resources: [
      { title: "CAI: Law 25 changes", href: "https://www.cai.gouv.qc.ca/protection-renseignements-personnels/sujets-et-domaines-dinteret/principaux-changements-loi-25", body: "Implementation guidance; operative requirements are in the amended private-sector Act." },
      { title: "CAI: incidents and security", href: "https://www.cai.gouv.qc.ca/protection-renseignements-personnels/information-entreprises-privees/incidents-confidentialite-mesures-securite-entreprises", body: "Risk assessment, notices and the five-year incident-register minimum." },
      { title: "CAI: enterprise scope", href: "https://www.cai.gouv.qc.ca/protection-renseignements-personnels/information-entreprises-privees/champ-application-loi_entreprises", body: "An organized economic activity can be noncommercial; nonprofit status is not a blanket exclusion." },
    ],
    access: { days: 30, basis: "calendar", exceptions: "Verify identity, access exceptions and serious practical difficulties for portability; do not invent a general extension." },
    incidentRecordMinimumMonths: 60,
    rules: [rule("officer", "Identify the person in charge and publish contact details", ["QC-PRIVACY-OFFICER"]), rule("policy", "Approve and publish proportionate privacy practices", ["QC-PRIVACY-POLICY"]), rule("consent", "Use valid purpose-specific consent", ["QC-PRIVACY-CONSENT"]), rule("access", "Handle access, correction and portability", ["QC-PRIVACY-ACCESS"]), rule("retention", "Apply retention and lawful disposal", ["QC-PRIVACY-RETENTION"]), rule("breach", "Maintain incidents and notify when required", ["QC-PRIVACY-INCIDENT", "QC-PRIVACY-INCIDENT-RECORDS"]), rule("pia", "Assess systems and transfers outside Québec", ["QC-PRIVACY-PIA"])],
  },
  pipeda: {
    id: "pipeda", label: "PIPEDA", jurisdiction: "CA", regulator: "Office of the Privacy Commissioner of Canada", regulatorUrl: "https://www.priv.gc.ca/en/",
    resources: [
      { title: "OPC: PIPEDA requirements", href: "https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda_brief/", body: "Commercial activity, federal works and provincial-law interaction." },
      { title: "OPC: charitable and nonprofit activities", href: "https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/r_o_p/02_05_d_19/", body: "Ordinary noncommercial membership administration is generally outside PIPEDA." },
      { title: "OPC: privacy compliance and training tools", href: "https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda-compliance-help/pipeda-compliance-and-training-tools/", body: "Guides and self-assessment materials for organizations subject to PIPEDA." },
      { title: "OPC: mandatory breach reporting", href: "https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/privacy-breaches-at-your-business/gd_pb_201810/", body: "Reporting, notification and records for all breaches." },
    ],
    access: { days: 30, basis: "calendar", exceptions: "Extensions under s. 8(4) require the statutory ground and notice; s. 9 controls withholding." },
    incidentRecordMinimumMonths: 24,
    rules: [rule("officer", "Designate an accountable individual", ["PIPEDA-OFFICER"]), rule("policy", "Publish practices and provide a complaints process", ["PIPEDA-POLICY"]), rule("consent", "Obtain meaningful consent where required", ["PIPEDA-CONSENT"]), rule("access", "Respond within 30 calendar days", ["PIPEDA-ACCESS"]), rule("retention", "Keep information only for justified purposes", ["PIPEDA-RETENTION"]), rule("breach", "Report qualifying breaches and retain every breach record", ["PIPEDA-BREACH", "PIPEDA-BREACH-RECORDS"])],
  },
};

/** `basis: "presumed"` marks the BC-home default: treated as applicable for
 * checks and labels, but shown as "Presumed: confirm facts" until recorded. */
export type PrivacyLawAssessment = { lawId: PrivacyLawId; applicability: "applies" | "possible"; reason: string; basis?: "recorded" | "presumed" };
export const PRESUMED_PRIVACY_LAW_LABEL = "Presumed: confirm facts";
export type ResolvedPrivacyProfile = {
  /** `presumed`: no operating facts are recorded and BC PIPA is presumed for a BC-home workspace. */
  status: "unassessed" | "presumed" | "conditional" | "assessed" | "no-general-law-identified";
  label: string;
  /** Includes presumed laws; see `presumedLawIds`. */
  applicableLawIds: PrivacyLawId[];
  /** Applicable laws that rest on the BC-home presumption rather than recorded facts. */
  presumedLawIds: PrivacyLawId[];
  possibleLawIds: PrivacyLawId[];
  assessments: PrivacyLawAssessment[];
  unresolvedFacts: string[];
  operatingJurisdictions: string[];
  /** Always true: CASL classification is message-specific and independent of PIPA/PIPEDA. */
  assessCommunicationsSeparately: true;
};
export const PRIVACY_OPERATING_JURISDICTIONS = [
  ["CA-BC", "British Columbia"], ["CA-AB", "Alberta"], ["CA-QC", "Québec"], ["CA-ON", "Ontario"],
  ["CA-SK", "Saskatchewan"], ["CA-MB", "Manitoba"], ["CA-NB", "New Brunswick"], ["CA-NS", "Nova Scotia"],
  ["CA-PE", "Prince Edward Island"], ["CA-NL", "Newfoundland and Labrador"], ["CA-YT", "Yukon"],
  ["CA-NT", "Northwest Territories"], ["CA-NU", "Nunavut"],
] as const;
const PROVINCES = new Set<string>(PRIVACY_OPERATING_JURISDICTIONS.map(([code]) => code));
const TERRITORIES = new Set(["CA-YT", "CA-NT", "CA-NU"]);
const isYes = (value: unknown) => value === "yes";
const isNo = (value: unknown) => value === "no";

export function resolvePrivacyProfile(organization?: PrivacyAssessmentInput | null): ResolvedPrivacyProfile {
  const org = organization ?? {};
  const rawLocations = Array.isArray(org.privacyOperatingJurisdictions) ? org.privacyOperatingJurisdictions : [];
  const locations = [...new Set(rawLocations.filter((value) => typeof value === "string" && PROVINCES.has(value)))];
  const unresolved = new Set<string>();
  const results = new Map<PrivacyLawId, PrivacyLawAssessment>();
  const add = (lawId: PrivacyLawId, applicability: PrivacyLawAssessment["applicability"], reason: string, basis?: PrivacyLawAssessment["basis"]) => {
    if (results.get(lawId)?.applicability === "applies") return;
    results.set(lawId, { lawId, applicability, reason, ...(applicability === "applies" ? { basis: basis ?? "recorded" } : {}) });
  };
  const federal = org.privacyFederalWork;
  const commercial = org.privacyCommercialActivity;
  const crossBorder = org.privacyCrossBorderCommercial;
  const sector = org.privacySectorSpecific;
  const sectorClear = sector === "none";
  if (!locations.length) unresolved.add("Record the provinces or territories where personal information is handled.");
  if (rawLocations.some((value) => !PROVINCES.has(value))) unresolved.add("Review operations outside the supported Canadian provinces and territories.");
  if (federal !== "yes" && federal !== "no") unresolved.add("Determine whether the activity is a federal work, undertaking or business; federal incorporation alone does not establish this.");
  if (!sectorClear) unresolved.add(sector === "health" || sector === "public" ? "Assess the applicable health or public-sector regime and its interaction with private-sector law." : "Determine whether health or public-sector privacy legislation governs these records.");
  const conflictingActivity = isNo(commercial) && isYes(crossBorder);
  if (conflictingActivity) unresolved.add("Resolve the conflicting answers: cross-border commercial handling is marked yes while commercial activity is marked no.");
  const base = isNo(federal) && sectorClear ? "applies" : "possible";
  // BC PIPA is presumed for a BC-home workspace unless the assessment records
  // federal-work status, a health/public-sector regime, or operations without BC.
  const bcHome = organization ? organizationRuleScope(organization).isBcHome : false;
  const sectorExcluded = sector === "health" || sector === "public";
  const presumeBcPipa = bcHome && !isYes(federal) && !sectorExcluded && (!locations.length || locations.includes("CA-BC")) && base !== "applies";
  if (presumeBcPipa) {
    add("bc_pipa", "applies", `${PRESUMED_PRIVACY_LAW_LABEL}. BC PIPA applies to every organization, including a not-for-profit, unless federal privacy law governs the handling (for example, a federal work, undertaking or business, or interprovincial or international commercial transfers). Record operating locations and federal-work status to confirm or displace this presumption.`, "presumed");
  }
  if (isYes(federal)) {
    add("pipeda", sectorClear ? "applies" : "possible", "Federal-work status is recorded: PIPEDA covers commercial handling and qualifying employee/applicant information. Assess the specific records.");
  } else {
    if (locations.includes("CA-BC")) add("bc_pipa", base, organization && organizationRuleScope(organization).isSociety
      ? "BC operations are recorded. BC PIPA generally covers private organizations, including noncommercial society member information, subject to exclusions."
      : "BC operations are recorded. BC PIPA generally covers private organizations, subject to exclusions.");
    if (locations.includes("CA-AB")) {
      const category = org.privacyAlbertaNonprofitClass;
      if (isYes(commercial) || category === "other") add("ab_pipa", base, "Alberta operations and commercial activity, or an organization outside the defined s. 56 nonprofit class, are recorded.");
      else if (!(category === "section-56" && isNo(commercial))) {
        add("ab_pipa", "possible", "Determine whether the organization belongs to Alberta PIPA's defined s. 56 nonprofit class and whether the handling is connected to commercial activity.");
        unresolved.add("Record Alberta s. 56 nonprofit classification and the commercial nature of the relevant activity.");
      }
    }
    if (locations.includes("CA-QC")) {
      if (isYes(org.privacyQuebecEnterprise)) add("qc_private", base, "An enterprise operating in Québec is recorded. The enterprise test can include noncommercial organized economic activity.");
      else if (!isNo(org.privacyQuebecEnterprise)) {
        add("qc_private", "possible", "Confirm the Civil Code enterprise test; being small or nonprofit does not itself exclude the Québec law.");
        unresolved.add("Determine whether the Québec activities constitute an enterprise under Civil Code art. 1525.");
      }
    }
    const otherProvince = locations.some((code) => !["CA-BC", "CA-AB", "CA-QC"].includes(code));
    if (otherProvince && isYes(commercial)) add("pipeda", sectorClear ? "applies" : "possible", "Commercial handling in a jurisdiction without a general substantially similar private-sector Act is recorded; assess any specific exemption.");
    else if (otherProvince && !isNo(commercial)) {
      add("pipeda", "possible", "PIPEDA generally requires commercial activity for these records; incorporation form alone is insufficient.");
      unresolved.add("Determine whether the personal-information handling is a commercial activity.");
    }
    if (locations.some((code) => TERRITORIES.has(code)) && !isYes(commercial)) {
      add("pipeda", "possible", "Territorial organizations can fall within the federal framework, including employee information. Confirm federal-work status and the particular records; territorial location alone does not establish commercial membership handling.");
      unresolved.add("Review the territorial federal-work and employment-information context before treating noncommercial records as covered by PIPEDA.");
    }
    if (!isNo(federal)) add("pipeda", "possible", "Federal-work status has not been determined.");
  }
  if (isYes(crossBorder)) add("pipeda", sectorClear && !conflictingActivity ? "applies" : "possible", "Interprovincial or international personal-information handling in commercial activity is recorded. PIPEDA can coexist with the provincial profile.");
  else if (!isNo(crossBorder) && !isNo(commercial)) {
    add("pipeda", "possible", "Determine whether personal information crosses provincial or national borders in commercial activity.");
    unresolved.add("Record whether commercial personal information crosses provincial or national borders.");
  }
  if (!locations.length && !isYes(federal) && !presumeBcPipa) {
    for (const lawId of ["bc_pipa", "ab_pipa", "qc_private"] as const) add(lawId, "possible", "Operating jurisdictions and statutory applicability have not been assessed.");
  }
  const assessments = [...results.values()];
  const applicableLawIds = assessments.filter((item) => item.applicability === "applies").map((item) => item.lawId);
  const presumedLawIds = assessments.filter((item) => item.basis === "presumed").map((item) => item.lawId);
  const possibleLawIds = assessments.filter((item) => item.applicability === "possible").map((item) => item.lawId);
  const status = !locations.length && !isYes(federal) ? (presumedLawIds.length ? "presumed" : "unassessed") : unresolved.size || possibleLawIds.length ? "conditional" : applicableLawIds.length ? "assessed" : "no-general-law-identified";
  const lawLabels = applicableLawIds.map((id) => PRIVACY_LAWS[id].label).join(" + ");
  const label = applicableLawIds.length ? `Privacy (${lawLabels}${presumedLawIds.length ? ` — ${PRESUMED_PRIVACY_LAW_LABEL.toLowerCase()}` : ""})` : status === "no-general-law-identified" ? "Privacy — general-law scope assessed" : "Privacy — applicability needs assessment";
  return { status, label, applicableLawIds, presumedLawIds, possibleLawIds, assessments, unresolvedFacts: [...unresolved], operatingJurisdictions: locations, assessCommunicationsSeparately: true };
}

export function hasApplicablePrivacyLaw(organization: PrivacyAssessmentInput | null | undefined, lawId: PrivacyLawId): boolean {
  return resolvePrivacyProfile(organization).applicableLawIds.includes(lawId);
}
export function privacyCitationIdsFor(organization: PrivacyAssessmentInput | null | undefined, key: PrivacyRule["key"]): string[] {
  return [...new Set(resolvePrivacyProfile(organization).applicableLawIds.flatMap((id) => PRIVACY_LAWS[id].rules.filter((item) => item.key === key).flatMap((item) => item.citationIds)))];
}

/** Proposed reforms are deliberately separate from in-force rule profiles. */
export const PRIVACY_REFORM_WATCH = {
  reviewedOn: PRIVACY_REVIEWED_ON,
  currentLaw: "PIPEDA",
  formerBill: { number: "C-27 (44-1)", status: "Did not complete passage before the session ended on 2025-01-06", url: "https://www.parl.ca/legisinfo/en/bill/44-1/c-27" },
  proposedBill: { number: "C-36 (45-1)", name: "Protecting Privacy and Consumer Data Act", status: "At second reading in the House of Commons; first reading 2026-06-15", url: "https://www.parl.ca/legisinfo/en/bill/45-1/c-36", inForce: false },
} as const;
