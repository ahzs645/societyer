export type CorporationDocumentPacket = {
  key: string;
  templateName: string;
  packageName: string;
  summary: string;
  documentTag: string;
  partType: "document" | "filing" | "registration";
  filingType?: string;
  signatureRequired: boolean;
  requiredSigners: string[];
  requiredDataFields: string[];
  optionalDataFields: string[];
  reviewDataFields: string[];
  jurisdictions: string[];
  timeline: string;
  deliverable: string;
  terms: string;
  requiresAmendmentRecord?: boolean;
  requiresAnnualMaintenanceRecord?: boolean;
  templateFilingNames?: string[];
  templateRegistrationNames?: string[];
  sections: Array<{ heading: string; body: string[] }>;
};

const COMMON_ENTITY_TYPES = ["corporation__business_"];
const COMMON_JURISDICTIONS = ["federal__canada_", "CA-FED-CBCA", "CA-ON-OBCA"];
const COMMON_REVIEW_FIELDS = ["CorporationName", "Jurisdiction", "Articles", "Bylaws", "MinuteBook", "Directors", "Officers", "Shareholders", "ISCRegister"];

export const CORPORATION_DOCUMENT_PACKETS: CorporationDocumentPacket[] = [
  {
    key: "organize-corporation",
    templateName: "Organize corporation / initial resolutions",
    packageName: "Organize corporation minute book packet",
    summary: "Initial director and shareholder resolutions to organize a corporation after incorporation.",
    documentTag: "5___directors_meetings_and_resolutions",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["CorporationName", "IncorporationDate", "InitialDirectors", "InitialOfficers", "RegisteredOffice", "ShareClasses"],
    optionalDataFields: ["BankingAuthorities", "FiscalYearEnd", "MinuteBookLocation", "AuditorAppointment"],
    reviewDataFields: COMMON_REVIEW_FIELDS,
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare immediately after incorporation and before first operating decisions are made.",
    deliverable: "Initial director resolutions, officer appointments, banking authority, share class confirmation, and minute book index.",
    terms: "Review articles, bylaws, share structure, director consents, and local law before relying on the packet.",
    sections: [
      {
        heading: "Organization Resolutions",
        body: [
          "The directors confirm the corporation's organization records, registered office, records office, officers, fiscal year end, and banking authority.",
          "The secretary is authorized to place the signed resolutions and supporting records in the minute book.",
        ],
      },
      {
        heading: "Initial Registers",
        body: [
          "Create or confirm the directors register, officers register, securities register, transfer register, and individuals with significant control register.",
        ],
      },
    ],
  },
  {
    key: "appoint-director",
    templateName: "Appoint director",
    packageName: "Director appointment packet",
    summary: "Director consent, appointment resolution, register update, and filing prompt.",
    documentTag: "6___directors_register_and_consents",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["directors___entering", "all_directors"],
    requiredDataFields: ["CorporationName", "DirectorName", "AppointmentDate", "DirectorAddress", "AgeOver18"],
    optionalDataFields: ["DirectorTerm", "Occupation", "Residency", "ConsentDocument"],
    reviewDataFields: ["Articles", "Bylaws", "DirectorRegister", "RegistryProfile"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare before or at the approving meeting and update filings promptly where required.",
    deliverable: "Director appointment resolution, written consent, register update checklist, and notice-of-change prompt.",
    terms: "Confirm eligibility, consent, quorum, and any residency or securities-law constraints before appointment.",
    requiresAmendmentRecord: true,
    templateFilingNames: ["Notice of change - directors"],
    sections: [
      {
        heading: "Director Appointment",
        body: [
          "The corporation records the appointment or election of the director and confirms the effective date.",
          "The entering director consents to act and provides required service and residential address information.",
        ],
      },
    ],
  },
  {
    key: "appoint-officer",
    templateName: "Appoint officer",
    packageName: "Officer appointment packet",
    summary: "Officer appointment, consent, register update, and signing authority confirmation.",
    documentTag: "7___officers_register_and_consents",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["officer___entering", "officer___president"],
    requiredDataFields: ["CorporationName", "OfficerName", "OfficerTitle", "AppointmentDate"],
    optionalDataFields: ["SigningAuthority", "BankingAuthority", "Email", "Phone"],
    reviewDataFields: ["Bylaws", "OfficerRegister", "SigningAuthorities"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare when the board appoints or changes an officer.",
    deliverable: "Officer appointment resolution, consent, officer register update, and signing authority update checklist.",
    terms: "Confirm the appointing body and title authority under the bylaws or prior delegation.",
    sections: [
      {
        heading: "Officer Appointment",
        body: [
          "The board appoints the officer to the stated title and confirms any authority attached to that office.",
          "The officer register and signing authority schedule are updated with the effective date.",
        ],
      },
    ],
  },
  {
    key: "issue-shares",
    templateName: "Issue shares",
    packageName: "Share issuance packet",
    summary: "Director approval, subscription terms, consideration evidence, securities register update, and transfer register entry.",
    documentTag: "9___transfer_register",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors", "shareholder___entering", "transfer_participants"],
    requiredDataFields: ["CorporationName", "ShareClass", "SubscriberName", "Quantity", "Consideration", "IssueDate"],
    optionalDataFields: ["CertificateNumber", "ExemptionLegend", "SubscriptionAgreement", "BoardApprovalDate"],
    reviewDataFields: ["Articles", "ShareClasses", "SecuritiesRegister", "TransferRegister", "ConsiderationEvidence"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare before issuing securities and post the ledger event after approval and payment/equivalent consideration.",
    deliverable: "Share issuance resolutions, subscription evidence, register update checklist, and ledger posting instructions.",
    terms: "Confirm authorized share classes, consideration, securities-law exemptions, pre-emptive rights, and unanimous shareholder agreement restrictions.",
    sections: [
      {
        heading: "Share Issuance",
        body: [
          "The directors approve the issuance of the stated number and class of shares to the subscriber for the stated consideration.",
          "The securities register and transfer register are updated after the corporation receives the consideration or other approved issuance evidence.",
        ],
      },
    ],
  },
  {
    key: "annual-resolutions",
    templateName: "Annual resolutions",
    packageName: "Annual resolutions and return packet",
    summary: "Annual shareholder/director resolutions, financial statement approval, director/officer confirmation, and annual return evidence.",
    documentTag: "13___annual_return_filings",
    partType: "filing",
    filingType: "annual_return",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["CorporationName", "FiscalYearEndDate", "AnnualMeetingDate", "DirectorSlate", "FinancialStatements"],
    optionalDataFields: ["AuditorStatus", "ShareholderResolutionDate", "AnnualReturnConfirmation"],
    reviewDataFields: ["FinancialStatements", "AnnualReturn", "DirectorsRegister", "OfficersRegister", "ShareholdersRegister"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare with the annual meeting/approval cycle and retain with the annual return confirmation.",
    deliverable: "Annual resolutions, register confirmation checklist, financial statement approval evidence, and annual return filing prompt.",
    terms: "Confirm meeting timing, financial statement delivery, filing window, and jurisdiction-specific annual return requirements.",
    requiresAnnualMaintenanceRecord: true,
    templateFilingNames: ["Annual return", "Annual resolutions"],
    sections: [
      {
        heading: "Annual Approvals",
        body: [
          "The corporation records annual approvals, confirms directors and officers, and retains financial statement approval evidence.",
          "The annual return filing evidence is linked once submitted.",
        ],
      },
    ],
  },
  {
    key: "isc-register-update",
    templateName: "ISC register update",
    packageName: "Individuals with significant control register packet",
    summary: "Transparency register update workflow tied to shareholders, controllers, notices, and annual review.",
    documentTag: "12___shareholder_agreements",
    partType: "document",
    signatureRequired: false,
    requiredSigners: [],
    requiredDataFields: ["CorporationName", "ControlPersonName", "NatureOfControl", "EffectiveDate"],
    optionalDataFields: ["ResidentialAddress", "ServiceAddress", "DateOfBirth", "TaxResidence", "ControlThresholdEvidence"],
    reviewDataFields: ["ShareholdersRegister", "ControlLedger", "NoticesSent", "AnnualISCReview"],
    jurisdictions: ["federal__canada_", "CA-FED-CBCA"],
    timeline: "Update when control changes and during the annual transparency-register review.",
    deliverable: "ISC register entry/update checklist, notice evidence, controller link, and review notes.",
    terms: "Confirm whether the corporation is subject to ISC register requirements and whether public filing obligations apply.",
    templateFilingNames: ["Transparency register change"],
    sections: [
      {
        heading: "Control Register Update",
        body: [
          "The corporation records the individual, nature of control, effective date, and evidence source for the control determination.",
          "Notices, confirmations, and review notes are retained with the transparency register.",
        ],
      },
    ],
  },
  {
    key: "extra-provincial-registration-evidence",
    templateName: "Extra-provincial registration evidence packet",
    packageName: "Extra-provincial registration evidence packet",
    summary: "Evidence packet for registration, renewal, agent/attorney for service, identifier, and province-specific filing prompts.",
    documentTag: "extra_provincial_registrations",
    partType: "registration",
    filingType: "extra_provincial_registration",
    signatureRequired: true,
    requiredSigners: ["officer___president", "authorized_filer"],
    requiredDataFields: ["CorporationName", "HomeJurisdiction", "TargetJurisdiction", "RegistrationNumber", "AttorneyForService"],
    optionalDataFields: ["CertificateOfStatus", "BusinessNumber", "RegisteredOffice", "RenewalDate", "ProfileReport"],
    reviewDataFields: ["HomeRegistryProfile", "ForeignRegistration", "AttorneyForServiceConsent", "FilingEvidence"],
    jurisdictions: ["CA-ON-OBCA"],
    timeline: "Prepare before filing in the target jurisdiction and refresh when registration details change.",
    deliverable: "Registration evidence checklist, attorney/agent evidence, identifier capture, and ongoing filing prompt.",
    terms: "Confirm the extra-provincial trigger, exact local filing, agent/attorney requirements, and renewal or annual return obligations.",
    templateRegistrationNames: ["Ontario extra-provincial registration"],
    sections: [
      {
        heading: "Registration Evidence",
        body: [
          "The corporation records the target jurisdiction, registration status, registration number, local representative, and evidence source.",
          "The registration packet is linked to local annual return or notice-of-change obligations where applicable.",
        ],
      },
    ],
  },
];

export function corporationPacketTemplateMarker(packet: CorporationDocumentPacket) {
  return `societyer:corporation-packet-template:${packet.key}`;
}

export function corporationPacketPrecedentMarker(packet: CorporationDocumentPacket) {
  return `societyer:corporation-packet-precedent:${packet.key}`;
}

export function corporationPacketTemplateHtml(packet: CorporationDocumentPacket) {
  const sections = packet.sections
    .map((section) => [
      `<h2>${escapeHtml(section.heading)}</h2>`,
      ...section.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    ].join("\n"))
    .join("\n");
  return [
    `<h1>${escapeHtml(packet.templateName)}</h1>`,
    `<p>${escapeHtml(packet.summary)}</p>`,
    sections,
    "<h2>Data Fields</h2>",
    `<p>Required: ${escapeHtml(packet.requiredDataFields.join(", "))}</p>`,
    `<p>Review: ${escapeHtml(packet.reviewDataFields.join(", "))}</p>`,
  ].join("\n");
}

export function corporationPacketEntityTypes() {
  return COMMON_ENTITY_TYPES;
}

export function corporationPacketForComplianceObligation(input: {
  filingKind?: string;
  obligationKey?: string;
  ruleId?: string;
}): CorporationDocumentPacket | undefined {
  const key = corporationPacketKeyForComplianceObligation(input);
  return key ? CORPORATION_DOCUMENT_PACKETS.find((packet) => packet.key === key) : undefined;
}

export function corporationPacketKeyForComplianceObligation(input: {
  filingKind?: string;
  obligationKey?: string;
  ruleId?: string;
}): string | undefined {
  const filingKind = input.filingKind ?? "";
  const obligationKey = input.obligationKey ?? "";
  const ruleId = input.ruleId ?? "";

  if (filingKind === "FederalAnnualReturn" || filingKind === "OntarioAnnualReturn") {
    return "annual-resolutions";
  }
  if (filingKind === "FederalIscUpdate" || /isc|significant_control|transparency/i.test(obligationKey) || /isc|significant-control|transparency/i.test(ruleId)) {
    return "isc-register-update";
  }
  if (
    filingKind === "OntarioInitialReturn" ||
    filingKind === "OntarioNoticeOfChange" ||
    filingKind === "BCExtraProvincialAnnualReport" ||
    /extra_provincial|initial_return|notice_of_change|profile_evidence/i.test(obligationKey)
  ) {
    return "extra-provincial-registration-evidence";
  }
  if (/annual_financials|agm\.annual_meeting/i.test(obligationKey)) {
    return "annual-resolutions";
  }
  if (/agm\.first_meeting/i.test(obligationKey)) {
    return "organize-corporation";
  }
  return undefined;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
