import type { CorporationDocumentPacket } from "./corporationDocumentPackets";

/**
 * Society document packets — the BC Societies Act analog of
 * shared/corporationDocumentPackets.ts. Reuses the same packet shape and the
 * same grammar-aware DOCX renderer (shared/corporationPacketDocx.ts); the only
 * differences are society vocabulary (members, not shareholders), society
 * instruments (special resolutions, AGM, bylaw amendments), and entity typing.
 *
 * Section bodies use the template tokens the renderer binds against a society
 * RenderContext: {org.shortName}, {org.legislation} (→ "Societies Act"),
 * {dir.*} for directors and {members.*} for the membership.
 */
const SOCIETY_ENTITY_TYPES = ["society", "society__bc_"];
const SOCIETY_JURISDICTIONS = ["CA-BC", "british_columbia"];
const COMMON_REVIEW_FIELDS = ["SocietyName", "Bylaws", "Constitution", "Directors", "Members", "RegisteredOffice"];

/** Entity types a society document packet applies to (for the legal catalog). */
export function societyPacketEntityTypes() {
  return SOCIETY_ENTITY_TYPES;
}

export const SOCIETY_DOCUMENT_PACKETS: CorporationDocumentPacket[] = [
  {
    key: "society-incorporation-constitution", templateName: "BC society constitution — preparation draft", packageName: "BC society constitution preparation",
    preparationOnly: true, summary: "Original constitution drafting worksheet with the proposed name, lawful purposes and a separate member-funded eligibility review.",
    documentTag: "incorporation_preparation", partType: "document", signatureRequired: false, requiredSigners: [],
    requiredDataFields: ["SocietyName", "Purposes", "SocietyClassification"], optionalDataFields: ["NameApproval", "CharitablePurposesReview"],
    reviewDataFields: ["LawfulPurposes", "MemberFundedEligibility", "PrescribedStatement", "CRACharityApplication"], jurisdictions: SOCIETY_JURISDICTIONS,
    sourceUrls: ["https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/15018_01", "https://www2.gov.bc.ca/gov/content/employment-business/business/not-for-profit-organizations/societies/incorporate"],
    timeline: "Complete the constitution before submitting the society incorporation application.", deliverable: "Editable original constitution draft and classification review worksheet.",
    terms: "Requires tailored legal review. The constitution contains the name and purposes. A member-funded society must meet statutory eligibility and include the exact prescribed statement from the official regulation. That statement is linked, not reproduced in this draft. Incorporation does not confer CRA charitable status.",
    sections: [
      { heading: "Draft constitution", body: ["1. Name: The name of the society is {org.name}.", "2. Purposes: {org.purposes}", "[Review that every purpose is lawful and that operating a business for profit or gain is not a purpose; incidental business activities require separate assessment.]" ] },
      { heading: "Classification review before submission", body: ["[Confirm ordinary or member-funded society status. For a member-funded society, document eligibility, exclusions, public funding/donation limits and the exact prescribed constitution statement from the official regulation.]", "[Assess charitable purposes separately if a CRA application is intended. Obtain organization-specific review before adopting the constitution.]", "Official Act: https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/15018_01. Official incorporation guidance: https://www2.gov.bc.ca/gov/content/employment-business/business/not-for-profit-organizations/societies/incorporate." ] },
    ],
  },
  {
    key: "society-incorporation-bylaws", templateName: "BC society bylaws — preparation draft", packageName: "BC society bylaws preparation",
    preparationOnly: true, summary: "Original bylaw drafting worksheet for membership, meetings, directors, finance and records; does not reproduce prescribed model bylaws.",
    documentTag: "incorporation_preparation", partType: "document", signatureRequired: false, requiredSigners: [],
    requiredDataFields: ["SocietyName", "MembershipRules", "MeetingRules", "DirectorRules"], optionalDataFields: ["MemberClasses", "Dues", "Auditor", "Officers"],
    reviewDataFields: COMMON_REVIEW_FIELDS, jurisdictions: SOCIETY_JURISDICTIONS,
    sourceUrls: ["https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/15018_01", "https://www2.gov.bc.ca/gov/content/employment-business/business/not-for-profit-organizations/societies/incorporate"],
    timeline: "Review and adopt a complete bylaw instrument before submitting incorporation.", deliverable: "Editable bylaw drafting worksheet with unresolved clause decisions clearly marked.",
    terms: "Requires tailored legal review. These are original drafting prompts, not the prescribed Schedule 1 model bylaws. Use the official regulation for model wording and verify any legislation reproduction terms before embedding it.",
    sections: [
      { heading: "Bylaws drafting worksheet for {org.name}", body: ["Membership: [draft admission criteria, membership classes and voting rights, dues, termination, discipline and appeals].", "General meetings: [draft notices, AGM timing, member requisitions, participation methods, quorum, chair, voting, proxies if allowed, minutes and adjournments].", "Directors: [draft number, eligibility, election or appointment, term, vacancies, removal and board procedure; confirm ordinary/member-funded statutory minima].", "Officers and authority: [draft appointment, duties, delegated powers and signing authority].", "Finance: [draft fiscal year, financial reporting, auditor appointment or applicable waiver, borrowing and spending controls].", "Records and amendments: [draft custody and inspection arrangements, access safeguards and amendment procedures consistent with the Act]." ] },
      { heading: "Review and adoption evidence", body: ["[Check every clause against the governing Act, current regulation and intended society classification. Remove unresolved prompts after approval of the complete instrument.]", "Retain the approved bylaws and the certified registry version as separate records. Official originals: https://www2.gov.bc.ca/gov/content/employment-business/business/not-for-profit-organizations/societies/incorporate." ] },
    ],
  },
  {
    key: "society-annual-general-meeting",
    templateName: "Annual general meeting resolutions",
    packageName: "Society AGM resolutions packet",
    summary: "Annual general meeting business: receive financial statements, elect directors, appoint or waive an auditor.",
    documentTag: "society_meetings_and_resolutions",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["SocietyName", "FinancialYearEnd", "Directors", "Members"],
    optionalDataFields: ["Auditor", "MeetingDate"],
    reviewDataFields: COMMON_REVIEW_FIELDS,
    jurisdictions: SOCIETY_JURISDICTIONS,
    timeline: "Hold within the period required by the Societies Act and the society's bylaws after the financial year end.",
    deliverable: "AGM resolutions covering financial statements, director elections, and auditor appointment or waiver.",
    terms: "Confirm bylaw requirements for notice, quorum, and the order of business before relying on the packet.",
    sections: [
      {
        heading: "Annual General Meeting",
        body: [
          "The member{members.plural} of {org.shortName} held an annual general meeting pursuant to the {org.legislation} and the bylaws of the society.",
          "The financial statements for the most recently completed financial year were presented to the member{members.plural} and {members.isAre} received.",
          "{#if dir.isSole}The director{/if}{#if dir.isMultiple}The directors{/if} of the society {dir.isAre} confirmed in office for the ensuing year.",
        ],
      },
    ],
  },
  {
    key: "society-directors-resolution",
    templateName: "Directors' resolution (society)",
    packageName: "Society directors' resolution",
    summary: "A general resolution of the directors of a society for ordinary board business.",
    documentTag: "society_meetings_and_resolutions",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["SocietyName", "Directors"],
    optionalDataFields: ["ResolutionText", "EffectiveDate"],
    reviewDataFields: COMMON_REVIEW_FIELDS,
    jurisdictions: SOCIETY_JURISDICTIONS,
    timeline: "Use whenever the board resolves ordinary business between meetings or by consent resolution.",
    deliverable: "A signed directors' resolution.",
    terms: "Confirm the board has authority for the matter under the bylaws and the Societies Act.",
    sections: [
      {
        heading: "Resolution of the Directors",
        body: [
          "The undersigned being {#if dir.isSole}the sole director{/if}{#if dir.isMultiple}all the directors{/if} of {org.shortName} hereby adopt{dir.verbS} the following resolution pursuant to the {org.legislation}.",
        ],
      },
    ],
  },
  {
    key: "society-special-resolution",
    templateName: "Special resolution of the members",
    packageName: "Society special resolution packet",
    summary: "A special resolution of the members — e.g. to alter the bylaws or constitution, or change the society's name.",
    documentTag: "society_members_resolutions",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_members"],
    requiredDataFields: ["SocietyName", "Members", "ResolutionText"],
    optionalDataFields: ["EffectiveDate"],
    reviewDataFields: COMMON_REVIEW_FIELDS,
    jurisdictions: SOCIETY_JURISDICTIONS,
    timeline: "Pass at a general meeting (or by consent) with the special-resolution threshold set by the Societies Act and bylaws.",
    deliverable: "A special resolution suitable for filing with the registrar where required.",
    terms: "Confirm the special-resolution threshold (commonly 2/3) and notice requirements in the bylaws.",
    sections: [
      {
        heading: "Special Resolution",
        body: [
          "The member{members.plural} of {org.shortName}, by special resolution passed in accordance with the {org.legislation} and the bylaws, resolved as set out below.",
          "{#if members.isMultiple}The members{/if}{#if members.isSole}The member{/if} {members.isAre} entitled to vote on this special resolution.",
        ],
      },
    ],
  },
  {
    key: "society-appoint-directors",
    templateName: "Election / appointment of directors (society)",
    packageName: "Society director appointment packet",
    summary: "Elect or appoint directors of the society and record their consent to act.",
    documentTag: "society_directors_register",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["SocietyName", "Directors"],
    optionalDataFields: ["EffectiveDate"],
    reviewDataFields: COMMON_REVIEW_FIELDS,
    jurisdictions: SOCIETY_JURISDICTIONS,
    timeline: "On election at a general meeting, or on appointment by the board to fill a vacancy.",
    deliverable: "Director appointment resolution and consents.",
    terms: "Confirm eligibility and the minimum number of directors required by the Societies Act and bylaws.",
    sections: [
      {
        heading: "Appointment of Directors",
        body: [
          "The following person{dir.plural} {dir.isAre} appointed as director{dir.plural} of {org.shortName} pursuant to the {org.legislation}:",
          "{#each dir.list}  - {this.name}\n{/each}",
        ],
      },
    ],
  },
  {
    key: "society-change-registered-office",
    templateName: "Change of registered office (society)",
    packageName: "Society registered-office change packet",
    summary: "Resolve to change the society's registered office address and record the change for filing.",
    documentTag: "society_meetings_and_resolutions",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["SocietyName", "RegisteredOffice"],
    optionalDataFields: ["EffectiveDate"],
    reviewDataFields: COMMON_REVIEW_FIELDS,
    jurisdictions: SOCIETY_JURISDICTIONS,
    timeline: "When the registered office moves; a notice of change is then filed with the registrar.",
    deliverable: "Registered-office change resolution.",
    terms: "File the change with the registrar within the time required by the Societies Act.",
    sections: [
      {
        heading: "Change of Registered Office",
        body: [
          "{#if dir.isSole}The director{/if}{#if dir.isMultiple}The directors{/if} of {org.shortName} resolved to change the registered office of the society, and authorized the filing of a notice of change under the {org.legislation}.",
        ],
      },
    ],
  },
];
