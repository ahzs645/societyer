// Private sub-components and helpers for GrantPanels.tsx (dossier panels, editor sections, field editors).

import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink, ListChecks, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, Field, InspectorNote } from "../../../components/ui";
import { MarkdownEditor } from "../../../components/MarkdownEditor";
import { StructuredAddressFields } from "../../../components/StructuredAddressFields";
import { formatDate, money } from "../../../lib/format";
import {
  type GrantRequirement,
  type GrantRequirementStatus,
  type RequirementTemplateKey,
  GRANT_REQUIREMENT_TEMPLATES,
  REQUIREMENT_STATUSES,
  asAnswerLibrary,
  asComplianceFlags,
  asContacts,
  asNextSteps,
  asRequirements,
  asTimelineEvents,
  asUseOfFunds,
  cleanStringList,
  detectRequirementTemplateKey,
  mergeTemplateRequirements,
  optionalString,
  requirementStatusTone,
  requirementSummary,
  requirementTemplateCoverage,
} from "../lib/grantDrafts";

import {
  defaultGrantEmployeeDraft,
} from "./GrantPanels.internal.part1";
import {
  timelineTone,
  findKeyFactNumber,
  grantRelatedDocuments,
  groupEvidenceDocuments,
  cleanDocumentTitle,
  buildGrantTimeline,
  dossierSectionStyle,
  factBoxStyle,
  nextStepStyle,
  detailPanelStyle,
  detailSummaryStyle,
  documentListStyle,
  documentListItemStyle,
  timelineItemStyle,
  fundLineStyle,
  flagChipStyle,
  contactRowStyle,
} from "./GrantPanels.internal.part3";

function grantFundedAssignment(grant: any) {
  const role = approvedJobTitle(grant);
  const isCanadaSummerJobs = /canada summer jobs|csj/i.test(`${grant.program ?? ""} ${cleanStringList(grant.keyFacts).join(" ")}`);
  return {
    role,
    employmentType: isCanadaSummerJobs ? "FullTime" : undefined,
    hoursPerWeek: grantHoursPerWeek(grant) ?? (isCanadaSummerJobs ? "35" : undefined),
    hourlyWageDollars: grantHourlyWageDollars(grant),
    weeks: grantApprovedWeeks(grant),
  };
}


function grantFundedAssignmentKey(grant: any) {
  const assignment = grantFundedAssignment(grant);
  return [
    grant._id ?? grant.id ?? "",
    assignment.role ?? "",
    assignment.employmentType ?? "",
    assignment.hoursPerWeek ?? "",
    assignment.hourlyWageDollars ?? "",
  ].join("|");
}


function approvedJobTitle(grant: any) {
  const line = asUseOfFunds(grant.useOfFunds).find((item) => /approved esdc contribution:/i.test(item.label));
  return line?.label.split(":").slice(1).join(":").trim() || undefined;
}


function grantHoursPerWeek(grant: any) {
  const text = cleanStringList(grant.keyFacts).join(" ");
  return text.match(/approved hours\/week:\s*(\d+(?:\.\d+)?)/i)?.[1];
}


function grantHourlyWageDollars(grant: any) {
  const match = cleanStringList(grant.keyFacts).join(" ").match(/(?:approved )?hourly wage:\s*\$?(\d+(?:\.\d{1,2})?)/i);
  return match?.[1];
}


function grantApprovedWeeks(grant: any) {
  return findKeyFactNumber(grant.keyFacts, /approved weeks:\s*(\d+(?:\.\d+)?)/i);
}


function calculatedGrantEndDate(startDate: unknown, weeks: unknown) {
  const start = String(startDate ?? "").trim();
  const parsedWeeks = typeof weeks === "number" ? weeks : Number(weeks);
  if (!start || !Number.isFinite(parsedWeeks) || parsedWeeks <= 0) return undefined;
  const date = new Date(`${start}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setUTCDate(date.getUTCDate() + Math.round(parsedWeeks * 7) - 1);
  return date.toISOString().slice(0, 10);
}


function canCreateGrantEmployee(draft: ReturnType<typeof defaultGrantEmployeeDraft>) {
  return Boolean(
    draft.firstName.trim() &&
    draft.lastName.trim() &&
    draft.role.trim() &&
    draft.startDate &&
    draft.phone.trim() &&
    draft.birthDate &&
    draft.addressLine1.trim() &&
    draft.city.trim() &&
    draft.province.trim() &&
    draft.postalCode.trim() &&
    draft.sinSecretVaultItemId &&
    dollarsToCents(draft.hourlyWageDollars) !== undefined,
  );
}


function dollarsToCents(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : undefined;
}


function draftAmountCents(draft: any, centsKey: string, dollarsKey: string) {
  if (typeof draft[centsKey] === "number") return draft[centsKey];
  return draft[dollarsKey] === "" || draft[dollarsKey] === undefined ? undefined : dollarsToCents(draft[dollarsKey]);
}


function patchFromEmployee(employee: any) {
  return {
    status: "eed_pending",
    source: "manual",
    role: employee?.role,
    startDate: employee?.startDate,
    endDate: employee?.endDate,
    fundedHourlyWageCents: employee?.hourlyWageCents,
  };
}


function eedPrepReadiness(employee: any, link: any) {
  const checks = [
    ["first name", employee?.firstName],
    ["last name", employee?.lastName],
    ["email", employee?.email],
    ["phone", employee?.phone],
    ["birth date", employee?.birthDate],
    ["home address", employee?.addressLine1],
    ["city", employee?.city],
    ["province", employee?.province],
    ["postal code", employee?.postalCode],
    ["SIN vault record", employee?.sinSecretVaultItemId],
    ["job/role", link?.role ?? employee?.role],
    ["start date", link?.startDate ?? employee?.startDate],
    ["end date", link?.endDate ?? employee?.endDate],
    ["hourly wage", link?.fundedHourlyWageCents ?? employee?.hourlyWageCents],
  ] as const;
  const missing = checks
    .filter(([, value]) => value === undefined || value === null || String(value).trim() === "")
    .map(([label]) => label);
  return { ready: missing.length === 0, missing };
}


function GrantRequiredFormsPanel({ grant }: { grant: any }) {
  const forms = asRequirements(grant.requirements).filter((requirement) =>
    requirement.documentUrl || requirement.sourceUrl || /form|consent|EMP\d+/i.test(`${requirement.label} ${requirement.formNumber ?? ""}`),
  );
  if (forms.length === 0) return null;

  return (
    <DossierSection title="Required Forms / Documents">
      <div style={{ display: "grid", gap: 8 }}>
        {forms.map((requirement) => (
          <div key={requirement.id} style={nextStepStyle}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <strong>{requirement.label}</strong>
                {requirement.notes && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{requirement.notes}</div>}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Badge tone={requirementStatusTone(requirement.status)}>{requirement.status}</Badge>
                {requirement.formNumber && <Badge tone="info">{requirement.formNumber}</Badge>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, fontSize: 12 }}>
              {requirement.documentUrl && (
                <a className="cell-tag" href={requirement.documentUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  Open form
                  <ExternalLink size={11} />
                </a>
              )}
              {requirement.sourceUrl && (
                <a className="muted" href={requirement.sourceUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  Service Canada details
                  <ExternalLink size={11} />
                </a>
              )}
              {requirement.dueDate && <span className="muted">Target: {formatDate(requirement.dueDate)}</span>}
            </div>
          </div>
        ))}
      </div>
    </DossierSection>
  );
}


function GrantFundingDeltaPanel({ grant }: { grant: any }) {
  const requested = typeof grant.amountRequestedCents === "number" ? grant.amountRequestedCents : undefined;
  const awarded = typeof grant.amountAwardedCents === "number" ? grant.amountAwardedCents : undefined;
  if (requested === undefined || awarded === undefined) return null;

  const delta = awarded - requested;
  const requestedWeeks = findKeyFactNumber(grant.keyFacts, /requested weeks changed from\s+(\d+(?:\.\d+)?)\s+to/i);
  const approvedWeeks = findKeyFactNumber(grant.keyFacts, /requested weeks changed from\s+\d+(?:\.\d+)?\s+to\s+(\d+(?:\.\d+)?)/i);

  return (
    <DossierSection title="Funding Delta">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))", gap: 8 }}>
        <DossierFact label="Requested" value={money(requested)} />
        <DossierFact label="Approved" value={money(awarded)} />
        <DossierFact label="Difference">
          <span className="mono" style={{ color: delta < 0 ? "var(--danger)" : "var(--success)" }}>
            {money(delta)}
          </span>
        </DossierFact>
        {requestedWeeks !== undefined && approvedWeeks !== undefined && (
          <DossierFact label="Approved duration" value={`${requestedWeeks} weeks requested -> ${approvedWeeks} weeks approved`} />
        )}
      </div>
    </DossierSection>
  );
}


function GrantEvidencePacketMap({ grant, documents }: { grant: any; documents: any[] }) {
  const relatedDocuments = grantRelatedDocuments(grant, documents);
  if (relatedDocuments.length === 0) return null;

  const groups = groupEvidenceDocuments(relatedDocuments);

  return (
    <DossierSection title="Evidence Packet Map">
      <div style={{ display: "grid", gap: 8 }}>
        {groups.map((group, index) => group.documents.length > 0 && (
          <details key={group.label} open={index < 4} style={detailPanelStyle}>
            <summary style={detailSummaryStyle}>
              <span>{group.label}</span>
              <Badge tone="info">{group.documents.length}</Badge>
            </summary>
            <ul style={documentListStyle}>
              {group.documents.map((document) => (
                <li key={String(document._id)} style={documentListItemStyle}>
                  <span>{cleanDocumentTitle(document)}</span>
                  {document.category && <Badge tone="neutral">{document.category}</Badge>}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </DossierSection>
  );
}


function GrantDeadlineTimeline({ grant, reports }: { grant: any; reports: any[] }) {
  const items = buildGrantTimeline(grant, reports);
  if (items.length === 0) return null;

  return (
    <DossierSection title="Deadline + Obligation Timeline">
      <div style={{ display: "grid", gap: 8 }}>
        {items.map((item) => (
          <div key={`${item.date}-${item.label}`} style={timelineItemStyle}>
            <div className="mono" style={{ minWidth: 96 }}>{formatDate(item.date)}</div>
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <strong>{item.label}</strong>
                {item.status && <Badge tone={timelineTone(item.status, item.date)}>{item.status}</Badge>}
              </div>
              {item.notes && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{item.notes}</div>}
            </div>
          </div>
        ))}
      </div>
    </DossierSection>
  );
}


function GrantProjectLifecyclePanel({
  grant,
  reports,
  compact = false,
}: {
  grant: any;
  reports: any[];
  compact?: boolean;
}) {
  const items = buildGrantTimeline(grant, reports);
  if (items.length === 0) return null;

  const today = new Date().toISOString().slice(0, 10);
  const completeStatuses = /(submitted|complete|attached|ready|saved|done)/i;
  const overdueStatuses = /(overdue|missing|not|needed)/i;
  const stages = items.map((item) => {
    const status = String(item.status ?? "");
    const isComplete = completeStatuses.test(status);
    const isOverdue = !isComplete && item.date < today && (overdueStatuses.test(status) || /(due|scheduled|expected)/i.test(status));
    const isCurrent = !isComplete && !isOverdue && item.date >= today;
    return { ...item, isComplete, isOverdue, isCurrent };
  });
  const currentIndex = stages.findIndex((item) => item.isOverdue || item.isCurrent);
  const visibleStages = compact ? stages.slice(0, 4) : stages;

  return (
    <DossierSection title="Project Timeline">
      <div className="grant-project-timeline">
        {visibleStages.map((item, index) => {
          const absoluteIndex = index;
          const tone = item.isComplete ? "success" : item.isOverdue ? "danger" : absoluteIndex === currentIndex ? "warn" : "info";
          return (
            <div key={`${item.date}-${item.label}`} className="grant-project-timeline__item">
              <div className="grant-project-timeline__rail" aria-hidden="true">
                <span className={`grant-project-timeline__dot grant-project-timeline__dot--${tone}`} />
              </div>
              <div className="grant-project-timeline__body">
                <div className="grant-project-timeline__date">{formatDate(item.date)}</div>
                <div className="grant-project-timeline__title-row">
                  <strong>{item.label}</strong>
                  {item.status && <Badge tone={timelineTone(item.status, item.date)}>{item.status}</Badge>}
                </div>
                {item.notes && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{item.notes}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {compact && stages.length > visibleStages.length && (
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {stages.length - visibleStages.length} more timeline item{stages.length - visibleStages.length === 1 ? "" : "s"} in the grant view.
        </div>
      )}
    </DossierSection>
  );
}


function GrantUseOfFundsPanel({ grant }: { grant: any }) {
  const lines = asUseOfFunds(grant.useOfFunds).filter((line) => line.label.trim());
  if (lines.length === 0) return null;

  return (
    <DossierSection title="Use of Funds / Budget Breakdown">
      <div style={{ display: "grid", gap: 8 }}>
        {lines.map((line) => (
          <div key={`${line.label}-${line.amountCents ?? "na"}`} style={fundLineStyle}>
            <div>
              <strong>{line.label}</strong>
              {line.notes && <div className="muted" style={{ fontSize: 12 }}>{line.notes}</div>}
            </div>
            <span className="mono">{line.amountCents === undefined ? "—" : money(line.amountCents)}</span>
          </div>
        ))}
      </div>
    </DossierSection>
  );
}


function GrantComplianceFlagsPanel({ grant }: { grant: any }) {
  const flags = asComplianceFlags(grant.complianceFlags).filter((flag) => flag.label.trim());
  if (flags.length === 0) return null;

  return (
    <DossierSection title="Compliance Flags">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {flags.map((flag) => (
          <span key={`${flag.label}-${flag.status}`} style={flagChipStyle} title={flag.notes}>
            <Badge tone={complianceTone(flag.status)}>{flag.status}</Badge>
            <span>{flag.label}</span>
          </span>
        ))}
      </div>
    </DossierSection>
  );
}


function GrantContactsPanel({ grant }: { grant: any }) {
  const contacts = asContacts(grant.contacts).filter((contact) =>
    [contact.role, contact.name, contact.organization, contact.email, contact.phone, contact.notes]
      .some((part) => String(part ?? "").trim()),
  );
  if (contacts.length === 0) return null;

  return (
    <DossierSection title="Contacts / Signatories">
      <div style={{ display: "grid", gap: 8 }}>
        {contacts.map((contact) => (
          <div key={`${contact.role}-${contact.name ?? contact.organization ?? "contact"}`} style={contactRowStyle}>
            <div>
              <div className="stat__label">{contact.role}</div>
              <strong>{contact.name ?? contact.organization ?? "Unnamed contact"}</strong>
              {contact.organization && contact.name && (
                <div className="muted" style={{ fontSize: 12 }}>{contact.organization}</div>
              )}
            </div>
            <div className="muted" style={{ fontSize: 12, textAlign: "right" }}>
              {[contact.email, contact.phone, contact.notes].filter(Boolean).join(" · ")}
            </div>
          </div>
        ))}
      </div>
    </DossierSection>
  );
}


function GrantAnswerLibraryPanel({ grant }: { grant: any }) {
  const answers = asAnswerLibrary(grant.answerLibrary).filter((answer) => answer.title.trim() && answer.body.trim());
  if (answers.length === 0) return null;

  return (
    <DossierSection title="Application Answer Library">
      <div style={{ display: "grid", gap: 8 }}>
        {answers.map((answer) => (
          <details key={`${answer.section}-${answer.title}`} style={detailPanelStyle}>
            <summary style={detailSummaryStyle}>
              <span>{answer.title}</span>
              <Badge tone="neutral">{answer.section}</Badge>
            </summary>
            <p style={{ margin: "8px 0 0", color: "var(--text-secondary)", lineHeight: 1.45 }}>
              {answer.body}
            </p>
          </details>
        ))}
      </div>
    </DossierSection>
  );
}


function GrantSourceNotesPanel({ grant }: { grant: any }) {
  const keyFacts = cleanSourceKeyFacts(grant.keyFacts);
  const sourceExternalIds = cleanStringList(grant.sourceExternalIds);
  const sourceFacts = [
    grant.sourcePath ? { label: "Imported from", value: grant.sourcePath } : undefined,
    grant.sourceImportedAtISO ? { label: "Import date", value: formatDate(grant.sourceImportedAtISO) } : undefined,
    grant.sourceFileCount ? { label: "Linked files", value: String(grant.sourceFileCount) } : undefined,
    grant.confidence ? { label: "Confidence", value: grant.confidence } : undefined,
    grant.sensitivity ? { label: "Sensitivity", value: grant.sensitivity } : undefined,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
  const hasSource =
    sourceFacts.length > 0 ||
    grant.sourceNotes ||
    sourceExternalIds.length > 0 ||
    keyFacts.length > 0;
  if (!hasSource) return null;

  return (
    <DossierSection title="Imported Source Notes">
      <div style={{ display: "grid", gap: 8 }}>
        {sourceFacts.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: 8 }}>
            {sourceFacts.map((fact) => <DossierFact key={fact.label} label={fact.label} value={fact.value} />)}
          </div>
        )}
        {sourceExternalIds.length > 0 && (
          <div className="muted mono" style={{ fontSize: 12, overflowWrap: "anywhere" }}>
            Sources: {sourceExternalIds.join(", ")}
          </div>
        )}
        {keyFacts.length > 0 && (
          <ul style={{ ...documentListStyle, marginTop: 0 }}>
            {keyFacts.map((fact) => <li key={fact}>{fact}</li>)}
          </ul>
        )}
        <div className="muted" style={{ fontSize: 12 }}>
          {grant.sourceNotes ?? "Review sensitive contact details before public use."}
        </div>
      </div>
    </DossierSection>
  );
}


function cleanSourceKeyFacts(value: unknown) {
  const byKey = new Map<string, string>();
  for (const fact of cleanStringList(value)) {
    const key = /^approved\/requested delta:/i.test(fact) ? "approved-requested-delta" : fact.toLowerCase();
    byKey.set(key, fact);
  }
  return Array.from(byKey.values());
}


function DossierSection({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} style={dossierSectionStyle}>
      <div className="stat__label" style={{ marginBottom: 10 }}>{title}</div>
      {children}
    </section>
  );
}


function DossierFact({
  label,
  value,
  children,
}: {
  label: string;
  value?: ReactNode;
  children?: ReactNode;
}) {
  const displayValue = children ?? (value === "" ? undefined : value) ?? "—";
  return (
    <div style={factBoxStyle}>
      <div className="stat__label">{label}</div>
      <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{displayValue}</div>
    </div>
  );
}


function grantStatusTone(status: unknown) {
  if (status === "Awarded" || status === "Active" || status === "Closed") return "success";
  if (status === "Declined") return "danger";
  if (status === "Submitted" || status === "Drafting") return "warn";
  return "info";
}


function complianceTone(status: unknown) {
  const text = String(status ?? "").toLowerCase();
  if (/(ready|attached|present|saved|linked|waived|complete)/.test(text)) return "success";
  if (/(missing|not|needed|overdue)/.test(text)) return "danger";
  if (/(requested|review|scheduled|watch|conditional)/.test(text)) return "warn";
  return "info";
}



export {
  grantFundedAssignment,
  grantFundedAssignmentKey,
  approvedJobTitle,
  grantHoursPerWeek,
  grantHourlyWageDollars,
  grantApprovedWeeks,
  calculatedGrantEndDate,
  canCreateGrantEmployee,
  dollarsToCents,
  draftAmountCents,
  patchFromEmployee,
  eedPrepReadiness,
  GrantRequiredFormsPanel,
  GrantFundingDeltaPanel,
  GrantEvidencePacketMap,
  GrantDeadlineTimeline,
  GrantProjectLifecyclePanel,
  GrantUseOfFundsPanel,
  GrantComplianceFlagsPanel,
  GrantContactsPanel,
  GrantAnswerLibraryPanel,
  GrantSourceNotesPanel,
  cleanSourceKeyFacts,
  DossierSection,
  DossierFact,
  grantStatusTone,
  complianceTone,
};
