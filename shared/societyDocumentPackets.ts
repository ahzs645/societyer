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

export const SOCIETY_DOCUMENT_PACKETS: CorporationDocumentPacket[] = [
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
