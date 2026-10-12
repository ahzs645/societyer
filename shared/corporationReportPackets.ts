/**
 * REPORT-STYLE CORPORATION PACKETS (catalog entries).
 *
 * Printable minute-book outputs generated from the existing registers as of a
 * chosen date: the BC transparency register, a director's consent to act,
 * printed registers (securities, directors, officers), a corporate information
 * summary, a covering letter and an optional Land Owner Transparency Act
 * worksheet. They are concatenated into CORPORATION_DOCUMENT_PACKETS, so they
 * are seeded, generated and gated exactly like the other corporation packets
 * (corporations only; jurisdiction-scoped through the pathway registry).
 *
 * The section bodies below are the fallback text. When a report packet is
 * generated, shared/minuteBookReports.ts builds the real content from the
 * registers and the DOCX renderer prints it instead (see `context.report`).
 */

import type { CorporationDocumentPacket } from "./corporationDocumentPackets";
import { RESTRICTED_REPORT_KINDS, type MinuteBookReportKind } from "./minuteBookReports";

const CORPORATE_JURISDICTIONS = ["federal__canada_", "CA-FED-CBCA", "CA-BC", "british_columbia", "CA-ON-OBCA"];
const BC_ONLY = ["CA-BC", "british_columbia"];
const BC_ACT_URL = "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02057_00";
const LOTA_URL = "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/19023";
const REPORT_TAG = "minute_book_reports";
const FALLBACK = "[Generate this output from the document catalog with an as-of date so it is filled from the registers on that date.]";

/** Packet key → report builder kind. */
export const REPORT_PACKET_KINDS: Readonly<Record<string, MinuteBookReportKind>> = {
  "bc-transparency-register": "bc-transparency-register",
  "director-consent-to-act": "director-consent",
  "securities-register-report": "securities-register",
  "directors-register-report": "directors-register",
  "officers-register-report": "officers-register",
  "corporate-information-summary": "corporate-summary",
  "document-package-cover-letter": "cover-letter",
  "lota-interest-holder-report": "lota-report",
};

export function reportKindForPacket(packetKey: string | null | undefined): MinuteBookReportKind | undefined {
  return packetKey ? REPORT_PACKET_KINDS[packetKey] : undefined;
}

export function isReportPacketKey(packetKey: string | null | undefined): boolean {
  return Boolean(reportKindForPacket(packetKey));
}

/** Reports whose generation and storage are restricted (transparency, LOTA). */
export function isRestrictedReportPacketKey(packetKey: string | null | undefined): boolean {
  const kind = reportKindForPacket(packetKey);
  return Boolean(kind && RESTRICTED_REPORT_KINDS.has(kind));
}

function report(input: {
  key: string;
  templateName: string;
  summary: string;
  jurisdictions: string[];
  requiredDataFields: string[];
  optionalDataFields?: string[];
  reviewDataFields: string[];
  deliverable: string;
  terms: string;
  sectionHeading: string;
  sectionBody: string[];
  signatureRequired?: boolean;
  requiredSigners?: string[];
  sourceUrls?: string[];
}): CorporationDocumentPacket {
  return {
    key: input.key,
    templateName: input.templateName,
    packageName: input.templateName,
    summary: input.summary,
    documentTag: REPORT_TAG,
    partType: "document",
    signatureRequired: input.signatureRequired ?? false,
    requiredSigners: input.requiredSigners ?? [],
    requiredDataFields: input.requiredDataFields,
    optionalDataFields: ["AsOfDate", ...(input.optionalDataFields ?? [])],
    reviewDataFields: input.reviewDataFields,
    jurisdictions: input.jurisdictions,
    ...(input.sourceUrls ? { sourceUrls: input.sourceUrls } : {}),
    timeline: "Generate as of the date the output must speak to; regenerate after the registers change.",
    deliverable: input.deliverable,
    terms: input.terms,
    sections: [{ heading: input.sectionHeading, body: [...input.sectionBody, FALLBACK] }],
  };
}

export const CORPORATION_REPORT_PACKETS: CorporationDocumentPacket[] = [
  report({
    key: "bc-transparency-register",
    templateName: "BC transparency register (as of a date)",
    summary: "Printable transparency register of significant individuals for a BC private company, with the steps-taken log. Restricted access.",
    jurisdictions: BC_ONLY,
    sourceUrls: [BC_ACT_URL],
    requiredDataFields: ["SignificantIndividuals", "AsOfDate"],
    reviewDataFields: ["SignificanceDetermination", "TransparencyStepsLog", "AnnualReview", "RestrictedAccess"],
    deliverable: "Transparency register as at the chosen date, one entry per significant individual, plus the steps-taken log and review notes.",
    terms: "BC private companies only (Business Corporations Act Part 2.1). Only a director of the company or an inspecting official may inspect the register (s. 119.61). Societyer prints recorded entries; it does not decide who is a significant individual. Review with a lawyer.",
    sectionHeading: "Transparency register",
    sectionBody: ["The register lists each significant individual recorded on or before the as-of date, with the particulars required by section 119.2 of the Business Corporations Act (British Columbia)."],
  }),
  report({
    key: "director-consent-to-act",
    templateName: "Director's consent to act",
    summary: "Written consent to act as a director for each director appointed on the chosen date, with the address particulars for the register of directors.",
    jurisdictions: CORPORATE_JURISDICTIONS,
    signatureRequired: true,
    requiredSigners: ["directors___entering"],
    requiredDataFields: ["DirectorName", "AppointmentDate", "DirectorAddress"],
    reviewDataFields: ["DirectorEligibility", "ConsentRoute", "NoticeOfChangeOfDirectors"],
    deliverable: "One consent form per director appointed on the as-of date (or a blank form), each signed by that director.",
    terms: "Wording follows the governing Act (BC ss. 122–124 and 126; CBCA s. 106(9); OBCA s. 119(9)–(11)). A written consent is one statutory route; keep each consent received with the records. Review with a lawyer.",
    sectionHeading: "Consent to act as a director",
    sectionBody: ["Each director signs a separate consent. The form is prepared for every director whose appointment is recorded on the as-of date."],
  }),
  report({
    key: "securities-register-report",
    templateName: "Securities register (as of a date)",
    summary: "Printed securities register by class and holder at the end of the chosen date, with certificate numbers and the ledger entries.",
    jurisdictions: CORPORATE_JURISDICTIONS,
    requiredDataFields: ["ShareClasses", "ShareLedger", "AsOfDate"],
    optionalDataFields: ["ShareCertificates"],
    reviewDataFields: ["HolderAddresses", "CertificateReconciliation", "SecuritiesRegister"],
    deliverable: "Holdings per class and holder with certificate numbers, followed by the issues, transfers and other ledger entries to the date.",
    terms: "Computed from posted ledger entries dated on or before the as-of date. Certificate totals that disagree with the ledger are flagged for review.",
    sectionHeading: "Securities register",
    sectionBody: ["Holdings are shown per class and holder at the end of the as-of date, with each holder's active certificate numbers."],
  }),
  report({
    key: "directors-register-report",
    templateName: "Register of directors (as of a date)",
    summary: "Printed register of directors with addresses, appointment and cessation dates and offices held.",
    jurisdictions: CORPORATE_JURISDICTIONS,
    requiredDataFields: ["Directors", "AsOfDate"],
    reviewDataFields: ["DirectorAddresses", "DirectorConsents"],
    deliverable: "Every director appointed on or before the as-of date, with the dates they became and ceased to be a director and any office held.",
    terms: "Prepared from the recorded director history. Confirm addresses and dates before placing the register in the minute book.",
    sectionHeading: "Register of directors",
    sectionBody: ["The register lists every director appointed on or before the as-of date."],
  }),
  report({
    key: "officers-register-report",
    templateName: "Register of officers (as of a date)",
    summary: "Printed register of officers with offices held and appointment and cessation dates.",
    jurisdictions: CORPORATE_JURISDICTIONS,
    requiredDataFields: ["Officers", "AsOfDate"],
    reviewDataFields: ["OfficerAppointments"],
    deliverable: "Every officer appointed on or before the as-of date, with office titles and dates.",
    terms: "Prepared from the recorded officer history. Confirm titles and dates against the directors' resolutions.",
    sectionHeading: "Register of officers",
    sectionBody: ["The register lists every officer appointed on or before the as-of date."],
  }),
  report({
    key: "corporate-information-summary",
    templateName: "Corporate information summary (as of a date)",
    summary: "One-document summary of the corporation as of a date: name history, incorporation number, jurisdiction, offices, directors, officers, share structure and holdings.",
    jurisdictions: CORPORATE_JURISDICTIONS,
    requiredDataFields: ["CorporationName", "AsOfDate"],
    reviewDataFields: ["Offices", "Directors", "Officers", "ShareStructure", "Shareholdings"],
    deliverable: "Identity, offices, directors, officers, share classes, holdings and voting percentages as at the chosen date.",
    terms: "A summary of the records in Societyer for review; it is not a registry search or a certified copy of the records.",
    sectionHeading: "Corporate information summary",
    sectionBody: ["The summary reads every register as it stood on the as-of date."],
  }),
  report({
    key: "document-package-cover-letter",
    templateName: "Covering letter for a document package",
    summary: "Covering letter listing the documents prepared on the chosen date, for sending a package for review and signature.",
    jurisdictions: CORPORATE_JURISDICTIONS,
    requiredDataFields: ["PrimaryContact", "AsOfDate"],
    reviewDataFields: ["Enclosures", "Addressee"],
    deliverable: "A letter addressed to the primary contact listing the documents generated on the as-of date.",
    terms: "Check the enclosure list and the addressee before sending.",
    sectionHeading: "Covering letter",
    sectionBody: ["The letter lists the documents generated on the as-of date as enclosures."],
  }),
  report({
    key: "lota-interest-holder-report",
    templateName: "Land Owner Transparency Act worksheet (10% holders)",
    summary: "Optional worksheet of individuals holding 10% or more of the shares or votes, with the land recorded in the asset register. Restricted.",
    jurisdictions: BC_ONLY,
    sourceUrls: [LOTA_URL],
    requiredDataFields: ["ShareLedger", "LandAssets", "AsOfDate"],
    reviewDataFields: ["BeneficialAndIndirectInterests", "DirectorControl", "PersonalIdentifiers", "RestrictedAccess"],
    deliverable: "Land parcels, direct registered holders at or above 10% of shares or votes, and fill-in fields for identifiers that must not be stored.",
    terms: "Optional. Counts direct registered holdings only; beneficial, indirect, joint and director-control interests (Land Owner Transparency Act s. 3) need review. Social insurance and tax numbers stay as fill-ins. Not a filed report. Review with a lawyer.",
    sectionHeading: "Land Owner Transparency Act worksheet",
    sectionBody: ["The worksheet lists registered shareholders at or above the 10% threshold on the as-of date."],
  }),
];
