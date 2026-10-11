import { todayDateOnly } from "./dateOnly";
import { organizationKind, organizationLabel, isMemberBasedCorporation } from "./organizationDomain";
import { PRIVACY_CITATIONS, PRIVACY_LAWS, resolvePrivacyProfile, type PrivacyAssessmentInput } from "./privacyRuleProfiles";

type PolicyOrganization = PrivacyAssessmentInput & {
  privacyOfficerName?: string;
  privacyOfficerEmail?: string;
  mailingAddress?: string;
  registeredOfficeAddress?: string;
  purposes?: string;
};
const textOrPrompt = (value: unknown, prompt: string) => typeof value === "string" && value.trim() ? value.trim() : `[${prompt}]`;

export function privacyPolicyDraftTitle(organization: PolicyOrganization): string {
  return `Draft privacy policy - ${organizationLabel(organization)}`;
}
export function privacyPolicyDraftTags(organization: PolicyOrganization): string[] {
  return ["privacy", "privacy-policy", "draft", "societyer-template", "scope-aware-v2", ...resolvePrivacyProfile(organization).applicableLawIds];
}

/** One source for client rebuilds and hosted/offline draft creation. Generation
 * neither adopts the policy nor replaces a person's edited draft. */
export function buildPrivacyPolicyDraft(organization: PolicyOrganization, createdOn = todayDateOnly()): string {
  const name = organizationLabel(organization);
  const profile = resolvePrivacyProfile(organization);
  const kind = organizationKind(organization);
  const memberBased = kind === "society" || isMemberBasedCorporation(organization) || /co.?operativ/i.test(`${organization.actFormedUnder ?? ""} ${organization.entityType ?? ""}`);
  const constituency = kind === "corporation" ? "shareholders" : memberBased ? "members" : "participants";
  const registerNotes = constituency === "members"
    ? "[Identify the member register and other member records actually held. State whether records are controlled by the organization, partly available, or held by a parent institution. Document any access gap and the request-routing process.]"
    : constituency === "shareholders"
      ? "[Identify the actual shareholder and securities records held, their custodian and the applicable statutory inspection process.]"
      : "[Identify the organization's actual participants, governance records, custodian and governing legal requirements before adopting this section.]";
  const laws = profile.applicableLawIds.map((id) => PRIVACY_LAWS[id]);
  const scope = laws.length
    ? laws.map((law) => `- ${law.label}: ${profile.assessments.find((item) => item.lawId === law.id)?.reason}`).join("\n")
    : "- [Confirm the privacy law for the actual activities and records. No general private-sector Act has been confirmed by this assessment.]";
  const unresolved = profile.unresolvedFacts.length
    ? `\nUnresolved scope questions before adoption:\n${profile.unresolvedFacts.map((item) => `- ${item}`).join("\n")}\n`
    : profile.status === "no-general-law-identified"
      ? "\nThe recorded facts do not identify a general private-sector Act for this noncommercial handling. This is not a blanket exemption from privacy, confidentiality, contractual, sector-specific or records duties.\n"
      : "";
  const rules = laws.map((law) => `### ${law.label}\n\n${law.rules.map((item) => `- **${item.title} (${item.obligation === "statutory" ? "statutory requirement for covered records" : "recommended practice"}):** ${item.body}`).join("\n")}\n`).join("\n");
  const access = laws.length
    ? laws.map((law) => `- ${law.label}: ${law.access.days} ${law.access.basis === "bc-business" ? "business days (excluding Saturdays and holidays)" : "calendar days"}. ${law.access.exceptions}`).join("\n")
    : "- [Record the applicable access and correction response deadline and statutory grounds for extensions or refusal.]";
  const regulators = laws.length
    ? [...new Map(laws.map((law) => [law.regulator, `- [${law.regulator}](${law.regulatorUrl})`])).values()].join("\n")
    : "- [Identify the regulator and complaint route after determining the applicable law.]";
  const citations = [...new Set(laws.flatMap((law) => law.rules.flatMap((item) => item.citationIds)))];
  const sources = citations.map((id) => {
    const item = PRIVACY_CITATIONS[id];
    return `- [${item.fullCitation}](${item.url})${item.sourceCurrentToISO ? ` — consolidation read: ${item.sourceCurrentToISO}` : " — current consolidation date not verified; see research note"}.`;
  }).join("\n");
  return `# ${name} Privacy Policy

**Status: draft for review and adoption.**
Draft created: ${createdOn}
Effective date: [YYYY-MM-DD after approval]
Approval record: [resolution or approval reference]
Scope facts reviewed: ${organization.privacyScopeReviewedAtISO || "[not recorded]"}

## 1. Purpose and scope

${name} protects personal information that it collects, uses, holds or discloses. This policy must describe the organization's actual activities, information, locations, service providers and practices before adoption.

Purpose of the organization: ${textOrPrompt(organization.purposes, "describe actual purposes and services")}.

Recorded private-sector law assessment:
${scope}
${unresolved}
Incorporation jurisdiction alone does not decide privacy-law coverage. Different activities or records may engage different laws. Federal incorporation does not itself make the organization a federal work, undertaking or business. Review health, public-sector and employee-information rules separately where relevant.

## 2. Responsibility and contact

Privacy contact: ${textOrPrompt(organization.privacyOfficerName, "privacy officer or responsible role")}
Email: ${textOrPrompt(organization.privacyOfficerEmail, "monitored privacy email")}
Mailing address: ${textOrPrompt(organization.mailingAddress || organization.registeredOfficeAddress, "mailing address")}

This person coordinates access, correction, complaints, safeguards, incident response and retention. [Record authority, delegates and backup contact.] Where the Québec profile applies, the highest authority holds the responsibility unless delegated in writing; publish the responsible person's title and contact information.

## 3. Information and purposes

[Complete an inventory listing each information category, its source, purpose, authorized users, storage locations, service providers, disclosures and retention period.]

Consider contact details, governance records concerning ${constituency} and directors, payment records, program records and employee or volunteer records actually held. Collect only information needed for identified, appropriate purposes and explain those purposes at collection. Do not assume all categories are collected, that publicly available information is unprotected, or that employment information falls under the same law as customer information.

## 4. Consent and other legal authority

Where consent is required, explain the nature, purpose and consequences clearly and retain evidence appropriate to the information and activity. Identify the specific statutory exception when relying on collection, use or disclosure without consent. Use express consent where required for sensitive information. [Describe how consent can be withdrawn and any actual legal or contractual restrictions.]

A person's agreement to governance notices does not automatically establish marketing consent. A generic preference checkbox does not itself prove that valid consent was obtained.

## 5. Safeguards and service providers

[Describe the actual access controls, authentication, staff responsibilities, secure storage, transmission, backups and disposal measures.]

Give access only to authorized people for the approved purpose. Review service-provider contracts, safeguards, locations and subcontractors. [List international or interprovincial handling.] Where Québec law applies, assess relevant system projects and handling outside Québec before proceeding. Where Alberta PIPA applies, record the required foreign-service-provider policy information and collection/transfer notices.

## 6. Governance records

Maintain required governance records concerning ${constituency}, directors and officers. Assess each request against both the governing statute and applicable privacy law; a right to inspect specified records is not a general entitlement to unrelated personal information.

${registerNotes}

## 7. Individual access, correction and portability

Requests go to the privacy contact. Verify identity proportionately, search relevant records and service providers, record receipt and the due date, and provide the required response. Document any lawful redaction, refusal, extension or pause and the available review route.

Confirmed profile response periods:
${access}

For covered Québec requests, provide eligible computerized information collected from the applicant in a structured, commonly used technological format, subject to the statutory limits. This does not require export of every inferred datum or disclosure of other people's information. [Document export, identity verification and secure delivery steps.]

## 8. Retention and disposal

[Adopt a schedule with a purpose, minimum legal period, trigger date, review date and disposal method for each category.]

Preserve information for statutory governance, tax, employment, access-request, litigation or other valid retention requirements. Resolve overlapping duties before disposal. Retain only as long as justified and securely destroy or anonymize/de-identify in the manner permitted by the applicable law. The app does not automatically delete records merely because a minimum period has elapsed.

## 9. Incidents and complaints

[Record the internal incident-reporting contact and escalation route.] Contain and document incidents; assess sensitivity, probable misuse and harm; reduce ongoing risk; decide and record required regulator and individual notifications. Keep incident and notification records for the applicable minimum and any longer justified period.

Complaints go first to the privacy contact. [Describe acknowledgment, investigation, response, escalation and corrective-action steps.]

Regulator contacts for the confirmed profiles:
${regulators}

## 10. Electronic communications

Classify the actual message before sending. A notice sent to satisfy a legal obligation can fall within the legal-notice exclusion. Commercial newsletters require an applicable consent basis or exemption, identification and an unsubscribe mechanism unless fully exempt. Required governance notices and optional marketing preferences must be managed separately.

Do not infer marketing consent from shareholder status or a nonprofit label. A qualifying club or association may rely on the defined membership relationship within its applicable period; a registered charity's primary-purpose fundraising exclusion is distinct. Record the basis, evidence, scope and expiry where relevant. Honour withdrawals without delay and within the applicable maximum.

CASL sources: [SC 2010, c. 23, ss. 1(2), 6, 10-11](https://laws-lois.justice.gc.ca/eng/acts/E-1.6/FullText.html); [Electronic Commerce Protection Regulations, SOR/2013-221, ss. 3 and 7](https://laws-lois.justice.gc.ca/eng/regulations/SOR-2013-221/FullText.html).

## 11. Requirements for the confirmed profiles

${rules || "[Complete the scope assessment before treating any jurisdiction-specific checklist as applicable.]"}

## 12. Review and adoption

[Set a proportionate review and training schedule.] Review after changes to activities, systems, service providers, law, an incident or a complaint. An annual review can be an organizational choice; it is not represented here as a universal annual statutory attestation.

Approved by: [authorized decision maker]
Date: [YYYY-MM-DD]
Next review: [YYYY-MM-DD]

## Source register

${sources || "No law-specific sources have been assigned until the scope is assessed."}

Research and app rules reviewed 2026-10-11. Proposed federal reform bills are excluded from operative policy requirements.
`;
}
