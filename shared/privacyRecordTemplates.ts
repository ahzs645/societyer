import { organizationLabel } from "./organizationDomain";
import { PRIVACY_CITATIONS, PRIVACY_LAWS, resolvePrivacyProfile, type PrivacyAssessmentInput } from "./privacyRuleProfiles";

export type PrivacyRecordTemplateKind = "incidentRegister" | "privacyAssessment" | "accessLog";

export function privacyRecordTemplate(kind: PrivacyRecordTemplateKind, organization: PrivacyAssessmentInput) {
  const profile = resolvePrivacyProfile(organization);
  const names = { incidentRegister: "Privacy incident register", privacyAssessment: "Privacy impact assessment", accessLog: "Privacy access and correction log" };
  const ruleKey = kind === "incidentRegister" ? "breach" : kind === "privacyAssessment" ? "pia" : "access";
  const rules = profile.applicableLawIds.flatMap((id) => PRIVACY_LAWS[id].rules.filter((rule) => rule.key === ruleKey).map((rule) => ({ ...rule, law: PRIVACY_LAWS[id].label })));
  const scopedRules = rules.map((rule) => `- **${rule.law}:** ${rule.body} ${rule.citationIds.map((id) => `[${PRIVACY_CITATIONS[id].fullCitation}](${PRIVACY_CITATIONS[id].url})`).join("; ")}`).join("\n");
  const scopeNote = `Scope status: ${profile.status}.\n${scopedRules || "[Confirm scope and applicable requirements before relying on this template.]"}`;
  const common = `# ${names[kind]} — ${organizationLabel(organization)}\n\nDraft template. Complete the facts, assign responsibility and choose appropriate restricted access before recording sensitive details.\n\n${scopeNote}\n\n`;
  const body = kind === "incidentRegister" ? `## Register

Use a separate numbered entry for every suspected or confirmed incident. In regimes requiring all-incident records, record incidents below the notification threshold too. A blank template is not evidence that incidents have been investigated or notifications made.

## Incident [identifier]

- Date or period of the incident: [date / approximate period / unknown and reason]
- Date or period first known: [date]
- Date the organization determined a breach occurred: [date]
- Record owner and review date: [role and date]
- Description of circumstances and cause if known: [facts]
- Information categories and sensitivity: [categories; avoid unnecessary identifying details]
- Affected people: [count / estimate and how estimated]
- Custody, control and service providers: [facts]
- Containment and immediate measures: [actions, owners and dates]
- Anticipated consequences and likelihood of misuse: [reasoned assessment]
- Harm threshold for each applicable law: [finding, evidence and reviewer]
- Regulator reporting decision, statutory basis, date and reference: [decision]
- Individual notice decision, recipients, channel and date: [decision]
- Any delayed or indirect notice, statutory basis and review: [decision]
- Other harm-reducing notifications and any disclosures: [record]
- Updates supplied to regulators: [date and reference]
- Prevention, corrective actions and follow-up: [actions and completion evidence]
- Retention trigger, minimum end date and legal holds: [record for each applicable regime]

## Retention

For PIPEDA-covered records, the minimum is 24 months after determining that the breach occurred. For Québec-covered records, retain incident-register information at least five years after awareness of the incident. BC and Alberta general private-sector rules do not supply either of those fixed periods automatically. Apply longer justified retention or holds when needed; do not delete solely because a minimum elapsed.
` : kind === "privacyAssessment" ? `## Project and responsibility

- Project name, sponsor and accountable privacy person: [record]
- Planned decision and implementation dates: [dates]
- Trigger for assessment: [system acquisition/development/overhaul; transfer or handling outside Québec; research disclosure; voluntary risk assessment]
- Assessment started and privacy person consulted: [date and evidence]
- Project purpose and necessity: [purpose and alternatives]

## Information flows and risks

- People, information categories and sensitivity: [inventory]
- Collection, use, disclosure, storage and destruction: [flow and locations]
- Systems, vendors, subcontractors and access roles: [inventory]
- Legal authority and consent: [basis for each activity]
- Cross-border legal framework and safeguards: [assessment]
- Security and minimization measures: [controls]
- Access, correction, portability and disposal design: [method and verification]
- Risks, likelihood, impact and mitigating measures: [assessment]
- Proportionality to information, volume, purpose and medium: [reasoning]

## Decision

- Adequate protection established for any covered Québec external handling: [finding and evidence]
- Required written agreements and mitigation conditions: [links]
- Privacy review, residual issues, conditions and owner: [record]
- Authorized decision and review date: [record]

For Québec-covered projects the assessment is mandatory at the statutory triggers, including small enterprises. This template also supports voluntary assessments elsewhere without presenting them as a universal legal duty.
` : `## Request log

Create an entry for each request and restrict access to request-handling staff.

| Request ID | Received | Applicable law and records | Response deadline and day basis | Assigned role | Status | Response / review reference |
| --- | --- | --- | --- | --- | --- | --- |
| [ID] | [date] | [scope] | [date; calendar / BC business days] | [role] | [open] | [reference] |

## Request [identifier]

- Identity and authority verified proportionately: [method and date]
- Request type: [access / correction / portability]
- Records and systems searched: [scope and evidence]
- Service-provider requests and replies: [log]
- Response deadline calculation: [law, receipt date and excluded days]
- Any extension or pause: [legal ground, permitted period and required notice]
- Information supplied and delivery method: [record]
- Withheld information: [specific exception, severance and reasons]
- Corrections and downstream notices: [record]
- Portability scope and format: [applicant-supplied computerized data; exclusions and reasons]
- Fees and advance estimate if lawful: [record]
- Response, complaint or review instructions and date: [record]
- Retention and any continuing request/appeal hold: [record]

BC PIPA ordinarily uses 30 business days, Alberta PIPA 45 calendar days, and PIPEDA and Québec private-sector law 30 calendar days. Extensions and pauses differ. Only apply a deadline after identifying the governing rule for the requested records.
`;
  return { title: `Draft ${names[kind].toLowerCase()} - ${organizationLabel(organization)}`, category: "Policy", content: common + body, tags: ["privacy", "draft", "societyer-template", "scope-aware-v2", kind], fileName: `${kind}-draft.md`, mimeType: "text/markdown" };
}
