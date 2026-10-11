import { legalGovernanceProfile } from "../../shared/legalGovernanceProfiles";
import { resolvePrivacyProfile, privacyCitationIdsFor, PRIVACY_LAWS } from "../../shared/privacyRuleProfiles";
import type { LegalEntityLike } from "../../shared/organizationDomain";
import { organizationRuleScope } from "../../shared/entityRuleScope";

// When this copy was last checked against the legislation (maintainers only; not shown to users).
export const LEGAL_COPY_REVIEWED = "Reviewed 11 October 2026";

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
    title: "Federal OPC privacy compliance and training tools",
    body:
      "PIPEDA guides, self-assessment materials, privacy management guidance and training resources. Use the materials for the assessed activities and applicable law.",
    href: "https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda-compliance-help/pipeda-compliance-and-training-tools/",
    citationIds: ["OPC-PRIVACY-PLAN-TOOL"],
  },
];

export const RECORDS_INSPECTION_GUIDANCE = [
  "Members inspect s. 20(1) records without charge. Directors may inspect all required records without charge (s. 24).",
  "Bylaws may restrict members’ access to board minutes and accounting records, but not protected conflict-disclosure portions. Member-register restrictions follow s. 25; the public cannot inspect that register.",
  "Public inspection of other records requires bylaw permission. The fee must be reasonable and no more than $10 per day (Regulation s. 4).",
  "Copy charges are capped at $0.50 per page, or $0.10 per page by email. Directors receive required-record copies free; members receive one free copy of current governing documents and latest financial statements (s. 27; Regulation s. 5).",
  "Provide requested copies promptly and within 14 days after the request and applicable payment. Public financial-statement requests have separate s. 28 and Regulation s. 6 rules; s. 195 modifies member-funded societies’ public access.",
];

export const DIRECTOR_ATTESTATION_COPY = {
  subtitle: "Optional annual confirmation of continuing director qualifications.",
  info:
    "The qualification rules apply continuously. The Act does not require an annual attestation; the organization may use one as a governance practice. For BC societies, s. 44(2) concerns the youth-director exception, while disqualifications are in s. 44(3).",
  note:
    "Select only statements the director confirms as accurate today. Signing records the selections and notes; unconfirmed statements need review. The society should keep this response with its governance records and review the wording when laws or governing documents change.",
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
  /** Assessed privacy laws, or an explicit applicability-review label. */
  privacyLawLabel: string;
  intakeNotice: typeof PIPA_INTAKE_NOTICE;
  policyRequirements: string[];
  /** Drafting resources selected from assessed activities; no incorporation-based defaults. */
  templateResources: typeof PIPA_TEMPLATE_RESOURCES;
  /** Records-inspection guidance from the reviewed governing-Act profile. */
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
  const profile = legalGovernanceProfile(organization);
  const privacy = resolvePrivacyProfile(organization);
  const entityNoun = scope.isCorporation ? "corporation" : scope.isSociety ? "society" : "organization";
  // Describe the records relevant to the selected entity; other entities
  // retain neutral wording until their constituency is established.
  const holderData = scope.isSociety
    ? "member-data situation"
    : scope.isCorporation
      ? "personal information it holds (including the shareholder register)"
      : "personal information it holds";
  const noun = (text: string) => text.replace(/\bsociety\b/g, entityNoun).replace(/member-data situation/g, holderData);
  return {
    entityNoun,
    privacyLawLabel: privacy.label,
    intakeNotice: { ...PIPA_INTAKE_NOTICE, body: noun(PIPA_INTAKE_NOTICE.body) },
    policyRequirements: PIPA_POLICY_REQUIREMENTS.map((item) =>
      scope.isSociety ? item : item.replace(/^Member notice preferences:/, "Notice preferences:"),
    ),
    templateResources: [
      {
        title: "Societyer starter policy draft",
        body: noun("A shared draft built from the saved scope assessment. Tailor it to the society's actual records, systems, roles, complaint process, retention rules, and member-data situation before adoption."),
        citationIds: privacyCitationIdsFor(organization, "policy"),
      },
      ...[...new Map(privacy.applicableLawIds.flatMap((id) => PRIVACY_LAWS[id].resources).map((resource) => [resource.href, resource])).values()]
        .map((resource) => ({ ...resource, citationIds: [] as string[] })),
      ...(privacy.status === "unassessed" || privacy.status === "conditional" ? [{
        title: "OPC: identify applicable privacy laws",
        body: "Use this scope guide to assess activities and provincial interaction. A possible law is not treated as an applicable policy requirement until the facts are recorded.",
        href: "https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/02_05_d_15/",
        citationIds: [] as string[],
      }] : []),
    ],
    recordsInspectionGuidance: scope.isBcSociety ? RECORDS_INSPECTION_GUIDANCE : profile ? profile.records.map(record => `${record.label}: ${record.access}`) : [],
    directorAttestation: {
      ...DIRECTOR_ATTESTATION_COPY,
      info: scope.isBcSociety ? DIRECTOR_ATTESTATION_COPY.info : "Record continuing qualifications and any requirements of the governing documents. An annual attestation is a governance practice; no general annual statutory renewal is asserted.",
      note: DIRECTOR_ATTESTATION_COPY.note.replace(/\bThe society\b/, `The ${entityNoun}`),
    },
  };
}
