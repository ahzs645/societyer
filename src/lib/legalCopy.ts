import type { LegalEntityLike } from "../../shared/organizationDomain";
import { organizationRuleScope } from "../../shared/entityRuleScope";
import { citationIdsForOrganization } from "./regulatoryCitations";

export const LEGAL_COPY_REVIEWED = "Reviewed April 2026";

export const PIPA_INTAKE_NOTICE = {
  title: "Personal information notice",
  body:
    "This form collects contact details and application notes so the society can review the request, contact you, and keep an intake record. Access should be limited to authorized society workers, and retention should follow the society's privacy and records policies.",
};

export const PIPA_POLICY_REQUIREMENTS = [
  "Purpose: why personal information is collected and how it will be used or disclosed.",
  "Safeguards: how information is stored and who can access it.",
  "Access and correction: how individuals can request their own information or corrections.",
  "Retention and disposal: how long records are kept and how they are securely disposed of.",
  "Privacy officer: who answers privacy questions or complaints.",
  "Electronic communications: consent, sender identification, and unsubscribe handling.",
  "Member notice preferences: how consent and communication preferences are recorded.",
];

export const PIPA_TEMPLATE_RESOURCES = [
  {
    title: "Societyer starter policy draft",
    body:
      "Use this as drafting language only. Tailor it to the society's real records, systems, roles, complaint process, retention rules, and member-data situation before adoption.",
    citationIds: ["PIPA-POLICY", "OIPC-PIPA-PRIVACY-POLICY-GUIDE"],
  },
  {
    title: "BC OIPC privacy policy guidance",
    body:
      "BC-specific guidance for what a PIPA privacy policy should cover. This is the authoritative drafting reference, not a fill-in-the-blanks template.",
    href: "https://www.oipc.bc.ca/documents/guidance-documents/2164",
    citationIds: ["OIPC-PIPA-PRIVACY-POLICY-GUIDE"],
  },
  {
    title: "BC OIPC PrivacyRight policy webinar",
    body:
      "Plain-language training on how to write a privacy policy for an organization.",
    href: "https://www.oipc.bc.ca/privacyright/webinars/webinar-2b/",
    citationIds: ["OIPC-PRIVACYRIGHT-WRITE-POLICY"],
  },
  {
    title: "Federal OPC privacy plan tool",
    body:
      "Interactive tool with sample privacy-policy and privacy-plan outputs. Useful for drafting ideas, but supplemental because it is PIPEDA-oriented rather than BC PIPA-specific.",
    href: "https://services.priv.gc.ca/outil-tool",
    citationIds: ["OPC-PRIVACY-PLAN-TOOL"],
  },
];

export const RECORDS_INSPECTION_GUIDANCE = [
  "Members and directors may inspect most society records; bylaws can restrict accounting records and directors' minutes.",
  "Public inspection of member registers depends on the active bylaw and statutory access rules.",
  "Public requests for financial statements and auditor reports should be routed through the society's records process.",
  "Inspection fees and copy fees should be checked against the current rules before charging a requester.",
  "Keep communication consent and records-request logs with the same care as other governance records.",
];

export const DIRECTOR_ATTESTATION_COPY = {
  subtitle:
    "Annual renewal confirming each director still meets the active qualification rules. Review qualification wording before relying on it for a new jurisdiction or bylaw template.",
  note:
    "By signing, the director confirms each statement is accurate as of today. The society should keep this attestation with its governance records and review the wording when laws or bylaws change.",
  statements: {
    age: "I meet the minimum age requirement for directors under the active rules.",
    bankruptcy: "I am not an undischarged bankrupt.",
    disqualification: "I am not disqualified from acting as a director under the active rules.",
    residency: "My residency and other eligibility criteria remain accurate.",
  },
};

export type OrganizationLegalCopy = {
  /** "society", "corporation" or "organization" — for sentence copy. */
  entityNoun: string;
  /** "PIPA" for BC-home organizations; otherwise a neutral label. */
  privacyLawLabel: string;
  intakeNotice: typeof PIPA_INTAKE_NOTICE;
  policyRequirements: string[];
  /** Drafting resources whose citations apply to this organization (BC OIPC sources only for BC). */
  templateResources: typeof PIPA_TEMPLATE_RESOURCES;
  /** Societies Act records-inspection guidance; empty unless the workspace is a BC society. */
  recordsInspectionGuidance: string[];
  directorAttestation: typeof DIRECTOR_ATTESTATION_COPY;
};

/**
 * Entity-aware versions of the copy above. The constants are written for a BC
 * society; pages showing a corporation or another entity should read this
 * instead so society wording, Societies Act guidance and BC-only resources do
 * not leak. Empty arrays mean "hide the section", not "nothing is required".
 */
export function legalCopyForOrganization(organization: LegalEntityLike | null | undefined): OrganizationLegalCopy {
  const scope = organizationRuleScope(organization);
  const entityNoun = scope.isCorporation ? "corporation" : scope.isSociety ? "society" : "organization";
  const noun = (text: string) => text.replace(/\bsociety\b/g, entityNoun);
  return {
    entityNoun,
    privacyLawLabel: scope.isBcHome ? "PIPA" : "applicable privacy law",
    intakeNotice: { ...PIPA_INTAKE_NOTICE, body: noun(PIPA_INTAKE_NOTICE.body) },
    policyRequirements: PIPA_POLICY_REQUIREMENTS.map((item) =>
      scope.isSociety ? item : item.replace(/^Member notice preferences:/, "Notice preferences:"),
    ),
    templateResources: PIPA_TEMPLATE_RESOURCES
      .filter((resource) => citationIdsForOrganization(resource.citationIds, organization).length > 0)
      .map((resource) => ({ ...resource, body: noun(resource.body) })),
    recordsInspectionGuidance: scope.isBcSociety ? RECORDS_INSPECTION_GUIDANCE : [],
    directorAttestation: {
      ...DIRECTOR_ATTESTATION_COPY,
      note: DIRECTOR_ATTESTATION_COPY.note.replace(/\bThe society\b/, `The ${entityNoun}`),
    },
  };
}
