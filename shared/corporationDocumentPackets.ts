export type CorporationDocumentPacket = {
  key: string;
  preparationOnly?: boolean;
  sourceUrls?: string[];
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
const COMMON_JURISDICTIONS = ["federal__canada_", "CA-FED-CBCA", "CA-BC", "british_columbia", "CA-ON-OBCA"];
const COMMON_REVIEW_FIELDS = ["CorporationName", "Jurisdiction", "Articles", "Bylaws", "MinuteBook", "Directors", "Officers", "Shareholders", "ISCRegister"];

export const CORPORATION_DOCUMENT_PACKETS: CorporationDocumentPacket[] = [
  {
    key: "bc-incorporation-agreement", templateName: "BC incorporation agreement — preparation draft",
    packageName: "BC incorporation agreement preparation", preparationOnly: true,
    summary: "An original working draft for the incorporators' agreement; review every subscription and execution detail before signing.",
    documentTag: "incorporation_preparation", partType: "document", signatureRequired: false, requiredSigners: [],
    requiredDataFields: ["CorporationName", "Incorporators", "ShareClasses", "ShareSubscriptions"],
    optionalDataFields: ["AgreementDate", "NumberedCompany"], reviewDataFields: ["ShareRights", "IncorporatorEligibility", "ExecutionAuthority", "Articles", "NameApproval"],
    jurisdictions: ["CA-BC", "british_columbia"],
    sourceUrls: ["https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02057_00", "https://www2.gov.bc.ca/gov/content/employment-business/business/managing-a-business/permits-licences/businesses-incorporated-companies/incorporated-companies"],
    timeline: "Complete and sign a reviewed incorporation agreement before submitting the application.",
    deliverable: "Editable original agreement draft with review prompts; no execution or registry acceptance is asserted.",
    terms: "Ordinary private BC company only. Tailored legal review is required. Each incorporator must agree to take at least one share; a company, society or other authorized entity may be an incorporator. Verify signing authority. This draft does not reproduce a government form.",
    sections: [
      { heading: "Draft incorporation agreement", body: ["Proposed company: {org.name}.", "The incorporators listed below agree to form the company under the Business Corporations Act and agree to take the shares recorded opposite their names, subject to completion and review of this draft.", "[Insert each incorporator's full legal name, address, individual or entity status, and authority of any entity signatory.]", "[For each incorporator, state at least one subscribed share: class and series, number of shares, consideration and payment arrangements. Reconcile this schedule with the reviewed articles.]", "[Insert the agreed incorporation application particulars and the execution date. Obtain each incorporator's signature only after all review prompts are resolved.]" ] },
      { heading: "Review and evidence", body: ["Retain the executed agreement with the articles at the records office. Preserve the incorporation application, certified notice of articles and certificate separately.", "Official statutory source: https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02057_00 (ss. 10–12)." ] },
    ],
  },
  {
    key: "bc-articles-preparation", templateName: "BC articles — preparation draft", packageName: "BC ordinary private company articles preparation",
    preparationOnly: true, summary: "Original articles drafting worksheet for an ordinary private BC company, including a share-rights schedule and governance choices.",
    documentTag: "incorporation_preparation", partType: "document", signatureRequired: false, requiredSigners: [],
    requiredDataFields: ["CorporationName", "ShareClasses", "RegisteredOffice", "RecordsOffice", "Directors"],
    optionalDataFields: ["TransferRestrictions", "BusinessRestrictions", "AnnualReferenceDate"], reviewDataFields: ["Articles", "ShareRights", "SecuritiesExemptions", "Quorum", "DirectorAuthority", "SpecialCompanySubtype"],
    jurisdictions: ["CA-BC", "british_columbia"], sourceUrls: ["https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02057_00"],
    timeline: "Review articles before incorporation and retain the executed version in the records office.",
    deliverable: "Editable articles worksheet; unresolved drafting choices must be completed before execution or filing.",
    terms: "Requires tailored legal review. ULC, community contribution and benefit company provisions are outside this ordinary private route. The articles, notice of articles and incorporation agreement must agree. This is original application-authored guidance, not the prescribed Table 1 articles.",
    sections: [
      { heading: "Proposed articles of {org.name}", body: ["[Record the proposed legal or numbered name and the date/version of these articles.]", "Share structure: [state each class/series, authorized maximum or unlimited number, par value if applicable, and the complete special rights and restrictions].", "Transfer and issuance: [state approved transfer restrictions, pre-emptive rights, subscription/payment terms and the treatment of share certificates]." ] },
      { heading: "Governance clauses for review", body: ["[Draft shareholder and director meeting procedures, notice, quorum, voting, written resolutions, chair, proxies and adjournments consistent with the Act.]", "[Draft director number and qualification provisions, election/removal terms, officer appointment and delegated signing authority.]", "[Draft borrowing, dividends, records inspection, indemnity and amendment provisions within statutory limits.]", "[Record the BC registered and records offices in the notice of articles; confirm director consent and reconcile the notice with these articles.]" ] },
      { heading: "Completion and official originals", body: ["Remove unresolved prompts only after a clause-by-clause legal review. Retain execution evidence independently from registry evidence.", "Official Act and prescribed provisions: https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02057_00. Use official originals for prescribed model wording." ] },
    ],
  },
  {
    key: "federal-articles-preparation", templateName: "Federal CBCA articles — preparation draft", packageName: "Federal CBCA incorporation articles preparation",
    preparationOnly: true, summary: "Original worksheet to prepare the facts and schedules for the official federal business incorporation application.",
    documentTag: "incorporation_preparation", partType: "document", signatureRequired: false, requiredSigners: [],
    requiredDataFields: ["CorporationName", "RegisteredOfficeProvince", "ShareClasses", "Directors", "Incorporators"],
    optionalDataFields: ["ShareTransferRestrictions", "BusinessRestrictions", "OtherProvisions"], reviewDataFields: ["CBCAArticles", "DirectorEligibility", "ShareRights", "NameApproval", "ISCInformation", "SecuritiesExemptions"],
    jurisdictions: ["CA-FED-CBCA", "federal__canada_"], sourceUrls: ["https://laws-lois.justice.gc.ca/eng/acts/C-44/", "https://ised-isde.canada.ca/site/corporations-canada/en/business-corporations/how-incorporate-business"],
    timeline: "Review and complete before submitting the official incorporation application.",
    deliverable: "Editable incorporation facts and schedules worksheet; official filing and certificate evidence remain separate.",
    terms: "Federal CBCA business corporation only; requires tailored legal review. Use the official application for submission. This original worksheet does not reproduce an ISED form layout or model articles.",
    sections: [
      { heading: "Articles preparation for {org.name}", body: ["Proposed corporate name: {org.name}. [Confirm a numbered or approved name and any required name-search evidence.]", "Registered office province/territory: [insert the jurisdiction to be stated in the articles]. Record the full office address separately for the official address notice.", "Share classes: [state authorized classes/series, maximum or unlimited quantities and each class's rights, privileges, restrictions and conditions].", "Transfer restrictions: [insert reviewed restrictions or expressly state none].", "Directors: [state a fixed number or the minimum and maximum number; verify eligibility, consents and applicable residency rules].", "Business restrictions and other provisions: [state reviewed restrictions, or expressly state none, and any additional lawful provisions]." ] },
      { heading: "Application facts and registry evidence", body: ["[Record every incorporator and signing authority, first directors, registered office address and required ISC information in the official application.]", "After acceptance, retain the certificate, articles and official notices. A signed worksheet is not a certificate of incorporation.", "Official incorporation workflow: https://ised-isde.canada.ca/site/corporations-canada/en/business-corporations/how-incorporate-business. Statutory source: https://laws-lois.justice.gc.ca/eng/acts/C-44/." ] },
    ],
  },
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
          "{#if appointment.hasDirectors}The directors of record are:{#each appointment.directors} {.name}{#if .term} ({.term}){/if};{/each}{#else}The entering director consents to act and provides required service and residential address information.{/if}",
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
          "{#if appointment.hasOfficers}The board confirms the following officers:{#each appointment.officers} {.name} as {.title};{/each}{#else}The board appoints the officer to the stated title and confirms any authority attached to that office.{/if}",
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
    requiredSigners: ["all_shareholders"],
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
        heading: "Annual Consent Resolutions",
        body: [
          "BE IT RESOLVED THAT:",
          "1. {#if annual.waivePrepFinancials}The requirement to produce and publish financial statements of {org.shortName} for the most recently completed financial year is waived by the shareholders.{#else}The financial statements of {org.shortName} for the most recently completed financial year, as approved by the directors, are approved.{/if}",
          "2. {#if annual.hasFiscalYearEnd}The next financial year end of {org.shortName} is fixed at {annual.fiscalYearEnd}.{#else}The next financial year end of {org.shortName} is confirmed.{/if}",
          "3. {#if annual.waivePrepFinancials}The appointment of an auditor of {org.shortName} for the current financial year is waived.{#else}The directors are authorized to appoint an auditor of {org.shortName} for the current financial year and to fix the auditor's remuneration.{/if}",
          "4. All lawful contracts, acts, proceedings, appointments and payments made by the directors of {org.shortName} in the preceding 12 months, and previously disclosed to the shareholders, are approved, ratified and confirmed.",
          "5. {#if annual.hasDirectors}The following person{dir.plural} {dir.isAre} appointed as director{dir.plural} of {org.shortName} until their successors are elected or appointed: {annual.directorSlate}.{#else}The directors of {org.shortName} are confirmed.{/if}",
          "6. The annual general meeting of {org.shortName} for the year is deemed to have been held on {date.long}.",
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
  {
    key: "dividend-declaration",
    templateName: "Dividend declaration resolution",
    packageName: "Dividend declaration packet",
    summary: "Director resolution declaring a dividend on a class of shares with a per-share rate and record date.",
    documentTag: "5___directors_meetings_and_resolutions",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["CorporationName", "ShareClass", "DividendPerShare", "RecordDate", "PaymentDate"],
    optionalDataFields: ["DividendType", "TotalDividendAmount", "SolvencyConfirmation", "ResolutionDate"],
    reviewDataFields: ["Articles", "ShareClasses", "SecuritiesRegister", "SolvencyEvidence"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare before the record date and confirm solvency at the declaration and payment dates.",
    deliverable: "Dividend declaration resolution, solvency confirmation prompt, and payment schedule note.",
    terms: "Confirm authorized share classes, dividend entitlements, and the solvency test under the governing legislation before declaring a dividend.",
    sections: [
      {
        heading: "Dividend Declaration",
        body: [
          "BE IT RESOLVED THAT {org.shortName} pay dividends on the issued and outstanding shares of the classes set out below{#if dividend.hasDeclaredDate}, as declared on {dividend.declaredDate}{/if}, subject to the solvency test under the {org.legislation}:",
          "{#if dividend.hasDeclarations}{#each dividend.declarations}Class {.className}: {.perShare} per share — total {.total}. {/each}{#else}Complete the dividend schedule (class, amount per share, and total) before this resolution is signed.{/if}",
          "This resolution is adopted by {#if dir.isSole}the sole director{/if}{#if dir.isMultiple}all the directors{/if} of {org.shortName} effective on {date.long}.",
        ],
      },
    ],
  },
  {
    key: "share-transfer",
    templateName: "Share transfer resolution",
    packageName: "Share transfer packet",
    summary: "Director resolution approving a transfer of shares, cancelling the transferor certificate, and issuing a new certificate to the transferee.",
    documentTag: "9___transfer_register",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors", "transfer_participants"],
    requiredDataFields: ["CorporationName", "TransferorName", "TransfereeName", "ShareClass", "Quantity", "TransferDate"],
    optionalDataFields: ["OldCertificateNumber", "NewCertificateNumber", "Consideration", "TransferRestrictionWaiver"],
    reviewDataFields: ["Articles", "ShareClasses", "SecuritiesRegister", "TransferRegister", "TransferRestrictions"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare before recording the transfer and update the registers after the certificate exchange.",
    deliverable: "Share transfer resolution, certificate cancellation and issuance prompts, and register update checklist.",
    terms: "Confirm transfer restrictions, board consent requirements, and any pre-emptive or unanimous shareholder agreement constraints before approving the transfer.",
    sections: [
      {
        heading: "Share Transfer",
        body: [
          "Being {#if dir.isSole}the sole director{/if}{#if dir.isMultiple}all the directors{/if} of {org.shortName}, the director{dir.plural} approve{dir.verbS} the following share transfer{#if transfer.hasTransfers}s{/if}.",
          "{#if transfer.hasTransfers}{#each transfer.transfers}{.quantityLabel} {.className} share(s) from {.from} to {.to}{#if .date} on {.date}{/if}. {/each}{#else}The stated number of shares are transferred from the transferor to the transferee.{/if}",
          "The certificate previously issued to the transferor is cancelled and a new certificate is issued to the transferee for the transferred shares.",
          "The securities register and transfer register of {org.shortName} are updated to record the transfer effective {date.long}.",
        ],
      },
    ],
  },
  {
    key: "share-certificate",
    templateName: "Share certificate issuance resolution",
    packageName: "Share certificate packet",
    summary: "Director resolution authorizing issuance of a share certificate for previously issued shares.",
    documentTag: "9___transfer_register",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["CorporationName", "ShareholderName", "ShareClass", "Quantity", "CertificateNumber"],
    optionalDataFields: ["IssueDate", "OriginalIssuanceDate", "CertificateLegend"],
    reviewDataFields: ["ShareClasses", "SecuritiesRegister", "TransferRegister"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare when a certificate is required to evidence shares already entered in the securities register.",
    deliverable: "Share certificate issuance resolution and certificate register update prompt.",
    terms: "Confirm that the shares are already recorded in the securities register and that the certificate form matches the share class rights.",
    sections: [
      {
        heading: "Certificate Issuance",
        body: [
          "Being {#if dir.isSole}the sole director{/if}{#if dir.isMultiple}all the directors{/if} of {org.shortName}, the director{dir.plural} authorize{dir.verbS} the issuance of share certificate(s) evidencing the issued shares held by the shareholder(s).",
          "{#if certificate.hasCertificates}Certificates of record:{#each certificate.certificates} No. {.number} — {.sharesLabel} {.className} share(s) to {.holder}{#if .issuedOn} issued {.issuedOn}{/if};{/each}{/if}",
          "The certificate is issued under the stated certificate number and recorded against the securities register of {org.shortName} effective {date.long}.",
        ],
      },
    ],
  },
  {
    key: "share-split",
    templateName: "Share subdivision/consolidation resolution",
    packageName: "Share split or consolidation packet",
    summary: "Director resolution subdividing or consolidating an issued share class at a stated ratio.",
    documentTag: "9___transfer_register",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["CorporationName", "ShareClass", "SplitRatio", "EffectiveDate"],
    optionalDataFields: ["PreSplitCount", "PostSplitCount", "ConsolidationFlag", "FractionalShareTreatment"],
    reviewDataFields: ["Articles", "ShareClasses", "SecuritiesRegister", "TransferRegister"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare before the effective date and update the securities register with the adjusted holdings.",
    deliverable: "Share subdivision/consolidation resolution, ratio confirmation, and register update checklist.",
    terms: "Confirm whether the articles permit the subdivision or consolidation and whether shareholder approval is required before relying on the resolution.",
    sections: [
      {
        heading: "Subdivision or Consolidation",
        body: [
          "Being {#if dir.isSole}the sole director{/if}{#if dir.isMultiple}all the directors{/if} of {org.shortName}, the director{dir.plural} resolve{dir.verbS} to {#if split.kind}effect a {split.ratioLabel} of{/if}{#if split.hasLines}{#else} subdivide or consolidate{/if} the issued {ShareClass} shares of {org.shortName}{#if split.totalBefore}, adjusting the total issued count from {split.totalBefore} to {split.totalAfter} shares{/if}.",
          "{#if split.hasLines}The resulting holdings are:{#each split.lines} {.holderName}: {.before} → {.after} shares.{/each}{/if}",
          "{#if split.hasDroppedShares}Note: {split.sharesDropped} share(s) are dropped to per-holder rounding under the {FractionalShareTreatment} fractional-share treatment; confirm the treatment of fractional entitlements.{/if}",
          "The securities register and transfer register are adjusted to reflect the resulting holdings effective {date.long}, subject to the {org.legislation} and the articles of {org.shortName}.",
        ],
      },
    ],
  },
  {
    key: "change-of-offices",
    templateName: "Change of registered/records office resolution",
    packageName: "Change of office packet",
    summary: "Director resolution setting a new registered office and records office address.",
    documentTag: "5___directors_meetings_and_resolutions",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["CorporationName", "RegisteredOfficeAddress", "RecordsOfficeAddress", "EffectiveDate"],
    optionalDataFields: ["PreviousRegisteredOffice", "PreviousRecordsOffice", "FilingPrompt"],
    reviewDataFields: ["RegistryProfile", "RegisteredOffice", "RecordsOffice", "FilingEvidence"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare before the move and file the resulting notice of change promptly where required.",
    deliverable: "Change of office resolution and notice-of-change filing prompt.",
    terms: "Confirm the new addresses, jurisdiction-specific notice requirements, and any records-office service obligations before relying on the resolution.",
    requiresAmendmentRecord: true,
    templateFilingNames: ["Notice of change - registered office"],
    sections: [
      {
        heading: "Change of Office",
        body: [
          "Being {#if dir.isSole}the sole director{/if}{#if dir.isMultiple}all the directors{/if} of {org.shortName}, the director{dir.plural} resolve{dir.verbS} to record the registered and records offices of {org.shortName}.",
          "{#if offices.hasRegistered}The registered office is{#if offices.hasPriorRegistered} changed from {offices.priorRegistered} to{/if} {offices.registered}. {/if}{#if offices.hasRecords}The records office is{#if offices.hasPriorRecords} changed from {offices.priorRecords} to{/if} {offices.records}.{/if}{#if offices.hasRegistered}{#else}{#if offices.hasRecords}{#else}The registered office and records office are changed to the stated addresses.{/if}{/if}",
          "The change is effective {date.long} and the secretary is authorized to file any notice of change required under the {org.legislation}.",
        ],
      },
    ],
  },
  {
    key: "director-removal",
    templateName: "Director removal/resignation resolution",
    packageName: "Director removal or resignation packet",
    summary: "Resolution recording the removal or resignation of a director and the related register update.",
    documentTag: "6___directors_register_and_consents",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["CorporationName", "DirectorName", "EffectiveDate", "RemovalOrResignation"],
    optionalDataFields: ["ResignationLetter", "RemainingDirectors", "FilingPrompt"],
    reviewDataFields: ["Articles", "Bylaws", "DirectorRegister", "RegistryProfile"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare at or after the departure and update filings promptly where required.",
    deliverable: "Director removal/resignation resolution, register update checklist, and notice-of-change prompt.",
    terms: "Confirm quorum, minimum-director requirements, and any residency or filing constraints before recording the departure.",
    requiresAmendmentRecord: true,
    templateFilingNames: ["Notice of change - directors"],
    sections: [
      {
        heading: "Director Departure",
        body: [
          "{org.shortName} records the removal or resignation of the named director effective {date.long}.",
          "{#if removal.hasRemovals}Departed directors:{#each removal.removals} {.name}{#if .endDate} (effective {.endDate}){/if};{/each}{/if}",
          "Being {#if dir.isSole}the sole director{/if}{#if dir.isMultiple}all the directors{/if} of {org.shortName}, the remaining director{dir.plural} confirm{dir.verbS} the departure and direct{dir.verbS} that the directors register be updated, subject to the {org.legislation}.",
        ],
      },
    ],
  },
  {
    key: "asset-transfer",
    templateName: "Asset acquisition/disposition resolution",
    packageName: "Asset acquisition or disposition packet",
    summary: "Director resolution authorizing the corporation to acquire or dispose of an asset.",
    documentTag: "5___directors_meetings_and_resolutions",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["CorporationName", "AssetDescription", "AcquireOrDispose", "Counterparty", "Consideration"],
    optionalDataFields: ["ClosingDate", "SigningAuthority", "ValuationEvidence", "ResolutionDate"],
    reviewDataFields: ["Articles", "Bylaws", "SigningAuthorities", "BoardApprovalEvidence"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare before signing the acquisition or disposition agreement and retain the approval with the transaction file.",
    deliverable: "Asset acquisition/disposition resolution and signing authority confirmation.",
    terms: "Confirm whether the transaction requires shareholder approval, board authority limits, and any sale-of-substantially-all-assets thresholds before relying on the resolution.",
    sections: [
      {
        heading: "Asset Authorization",
        body: [
          "Being {#if dir.isSole}the sole director{/if}{#if dir.isMultiple}all the directors{/if} of {org.shortName}, the director{dir.plural} authorize{dir.verbS} {org.shortName} to acquire or dispose of the assets described below on the stated terms.",
          "{#if assetTransfer.hasAcquisitions}Acquisitions:{#each assetTransfer.acquisitions} {.name} ({.category}){#if .value} for {.value}{/if}{#if .from} from {.from}{/if};{/each} {/if}{#if assetTransfer.hasDispositions}Dispositions:{#each assetTransfer.dispositions} {.name} ({.category}){#if .notes} — {.notes}{/if};{/each}{/if}{#if assetTransfer.hasAcquisitions}{#else}{#if assetTransfer.hasDispositions}{#else}The described asset is acquired or disposed of on the stated terms.{/if}{/if}",
          "The named officers are authorized to execute and deliver the agreements and documents required to complete the transaction, subject to the {org.legislation}, effective {date.long}.",
        ],
      },
    ],
  },
  {
    key: "all-directors-resolution",
    templateName: "Resolution of all the directors",
    packageName: "Resolution of all the directors packet",
    summary: "Generic blank shell for a resolution signed by all the directors, with grammar-aware signatory plurality.",
    documentTag: "5___directors_meetings_and_resolutions",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["CorporationName", "ResolutionSubject", "EffectiveDate"],
    optionalDataFields: ["ResolutionBody", "WhereasRecitals", "ResolvedClauses"],
    reviewDataFields: ["Articles", "Bylaws", "DirectorsRegister"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare whenever the directors act by written resolution in place of a meeting.",
    deliverable: "Blank directors' resolution shell with signatory block.",
    terms: "Confirm that a written resolution signed by all the directors is permitted under the articles, bylaws, and governing legislation before relying on it.",
    sections: [
      {
        heading: "Resolution",
        body: [
          "The undersigned, being {#if dir.isSole}the sole director{/if}{#if dir.isMultiple}all the directors{/if} of {org.shortName}, hereby sign{dir.verbS} the following resolution in writing in place of a meeting, as permitted under the {org.legislation}.",
          "This resolution is effective {date.long} and is as valid as if passed at a duly called and constituted meeting of the director{dir.plural} of {org.shortName}.",
        ],
      },
    ],
  },
  {
    key: "all-shareholders-resolution",
    templateName: "Resolution of all the shareholders",
    packageName: "Resolution of all the shareholders packet",
    summary: "Generic blank shell for a resolution signed by all the shareholders, with grammar-aware signatory plurality.",
    documentTag: "12___shareholder_agreements",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_shareholders"],
    requiredDataFields: ["CorporationName", "ResolutionSubject", "EffectiveDate"],
    optionalDataFields: ["ResolutionBody", "WhereasRecitals", "ResolvedClauses"],
    reviewDataFields: ["Articles", "Bylaws", "ShareholdersRegister"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare whenever the shareholders act by written resolution in place of a meeting.",
    deliverable: "Blank shareholders' resolution shell with signatory block.",
    terms: "Confirm that a written resolution signed by all the shareholders is permitted under the articles, bylaws, and governing legislation before relying on it.",
    sections: [
      {
        heading: "Resolution",
        body: [
          "The undersigned, being {#if members.isSole}the sole shareholder{/if}{#if members.isMultiple}all the shareholders{/if} of {org.shortName}, hereby sign{members.verbS} the following resolution in writing in place of a meeting, as permitted under the {org.legislation}.",
          "This resolution is effective {date.long} and is as valid as if passed at a duly called and constituted meeting of the shareholders of {org.shortName}.",
        ],
      },
    ],
  },
  {
    key: "all-voting-shareholders-resolution",
    templateName: "Resolution of all the voting shareholders",
    packageName: "Resolution of all the voting shareholders packet",
    summary: "Generic blank shell for a resolution signed by all the voting shareholders, with grammar-aware signatory plurality.",
    documentTag: "12___shareholder_agreements",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_voting_shareholders"],
    requiredDataFields: ["CorporationName", "ResolutionSubject", "VotingShareClass", "EffectiveDate"],
    optionalDataFields: ["ResolutionBody", "WhereasRecitals", "ResolvedClauses"],
    reviewDataFields: ["Articles", "Bylaws", "ShareholdersRegister", "ShareClasses"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare whenever the voting shareholders act by written resolution in place of a meeting.",
    deliverable: "Blank voting shareholders' resolution shell with signatory block.",
    terms: "Confirm which classes carry the vote and that a written resolution signed by all the voting shareholders is permitted under the articles, bylaws, and governing legislation before relying on it.",
    sections: [
      {
        heading: "Resolution",
        body: [
          "The undersigned, being {#if members.isSole}the sole voting shareholder{/if}{#if members.isMultiple}all the voting shareholders{/if} of {org.shortName}, hereby sign{members.verbS} the following resolution in writing in place of a meeting, as permitted under the {org.legislation}.",
          "This resolution is effective {date.long} and is as valid as if passed at a duly called and constituted meeting of the voting shareholders of {org.shortName}.",
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
