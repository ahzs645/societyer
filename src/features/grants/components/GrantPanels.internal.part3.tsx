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


function timelineTone(status: unknown, date: string) {
  const text = String(status ?? "").toLowerCase();
  if (/(submitted|complete|attached|ready|saved|done)/.test(text)) return "success";
  if (/(overdue|missing|not)/.test(text)) return "danger";
  const dueTime = new Date(date).getTime();
  if (Number.isFinite(dueTime) && dueTime < Date.now() && !/(conditional|expected)/.test(text)) return "danger";
  if (/(due|requested|conditional|expected|watch)/.test(text)) return "warn";
  return "info";
}


function nextStepTone(status: unknown) {
  const text = String(status ?? "").toLowerCase();
  if (/(done|complete|ready)/.test(text)) return "success";
  if (/(need|missing|overdue)/.test(text)) return "danger";
  if (/(review|upcoming|scheduled)/.test(text)) return "warn";
  return "info";
}


function priorityTone(priority: unknown) {
  const text = String(priority ?? "").toLowerCase();
  if (text === "high") return "danger";
  if (text === "medium") return "warn";
  return "info";
}


function findKeyFactNumber(value: unknown, pattern: RegExp) {
  for (const fact of cleanStringList(value)) {
    const match = fact.match(pattern);
    if (match?.[1]) return Number(match[1]);
  }
  return undefined;
}


function grantPacketKey(grant: any) {
  const title = String(grant.title ?? "").toLowerCase();
  if (title.includes("canada summer jobs")) return "canada summer jobs";
  if (title.includes("bc community gaming") || title.includes("gaming grant")) return "bc gaming grant";
  return "";
}


function grantRelatedDocuments(grant: any, documents: any[]) {
  const linkedIds = new Set(
    [
      ...asRequirements(grant.requirements).map((requirement) => requirement.documentId),
      ...cleanStringList(grant.sourceDocumentIds),
    ]
      .filter(Boolean)
      .map(String),
  );
  const packetKey = grantPacketKey(grant);
  return documents.filter((document) => {
    if (linkedIds.has(String(document._id))) return true;
    if (!packetKey) return false;
    return evidenceDocumentText(document).includes(packetKey);
  });
}


const EVIDENCE_GROUPS = [
  {
    label: "Application / confirmation",
    patterns: [/application|confirmation|summary|online version|main application|review purposes/i],
  },
  {
    label: "Bylaws and registry evidence",
    patterns: [/bylaws|constitution|registry|society|annual report|certified/i],
  },
  {
    label: "AGM / board evidence",
    patterns: [/annual general meeting|agm|directors|office|officer|authority to act|primary officer/i],
  },
  {
    label: "Financials and budgets",
    patterns: [/budget|financial|fin312|statement|screenshot|revenue|expenses|balance|2024-2025|simplified_program_financials/i],
  },
  {
    label: "Program narrative",
    patterns: [/program information|program|narrative|job details/i],
  },
  {
    label: "Government guides / conditions",
    patterns: [/guide|conditions|cond|checklist|faq|tutorial|canada\.ca|common hosted/i],
  },
  {
    label: "Follow-up documents",
    patterns: [/follow.?up|direct deposit|email/i],
  },
];


function groupEvidenceDocuments(documents: any[]) {
  const groups = EVIDENCE_GROUPS.map((group) => ({ label: group.label, documents: [] as any[] }));
  const other = { label: "Other packet files", documents: [] as any[] };

  for (const document of documents) {
    const text = evidenceDocumentText(document);
    const index = EVIDENCE_GROUPS.findIndex((group) =>
      group.patterns.some((pattern) => pattern.test(text)),
    );
    if (index >= 0) groups[index].documents.push(document);
    else other.documents.push(document);
  }

  return [...groups, other];
}


function evidenceDocumentText(document: any) {
  return [
    document.title,
    document.fileName,
    document.category,
    ...(Array.isArray(document.tags) ? document.tags : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}


function cleanDocumentTitle(document: any) {
  return String(document.title ?? document.fileName ?? "Document")
    .replace(/^Grant packet — /, "")
    .replace(/\s+/g, " ")
    .trim();
}


function buildGrantTimeline(grant: any, reports: any[]) {
  const grantId = String(grant.id ?? grant._id ?? "");
  const items: { date: string; label: string; status?: string; notes?: string }[] = [];
  const add = (date: unknown, label: string, status?: string, notes?: string) => {
    const text = optionalString(date);
    if (!text) return;
    items.push({ date: text, label, status, notes });
  };

  add(grant.applicationDueDate, "Application due", "Due");
  add(grant.submittedAtISO, "Application submitted", "Submitted", grant.confirmationCode ? `Confirmation ${grant.confirmationCode}` : undefined);
  add(grant.decisionAtISO, "Decision expected / recorded", "Expected");
  add(grant.startDate, "Project start", "Scheduled");
  add(grant.endDate, "Project end", "Scheduled");
  add(grant.nextReportDueAtISO, "Next report due", "Due");

  for (const requirement of asRequirements(grant.requirements)) {
    add(requirement.dueDate, requirement.label, requirement.status, requirement.notes);
  }
  for (const event of asTimelineEvents(grant.timelineEvents)) {
    add(event.date, event.label, event.status, event.notes);
  }
  for (const report of reports.filter((report) => String(report.grantId) === grantId)) {
    add(report.dueAtISO, report.title, report.status, report.notes);
    add(report.submittedAtISO, `${report.title} submitted`, "Submitted");
  }

  const deduped = new Map<string, { date: string; label: string; status?: string; notes?: string }>();
  for (const item of items) {
    deduped.set(`${item.date}-${item.label}`, item);
  }
  return Array.from(deduped.values()).sort((a, b) => a.date.localeCompare(b.date));
}


const dossierSectionStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  background: "var(--bg-panel)",
  padding: 12,
};


const factBoxStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  background: "var(--bg-base)",
  padding: 10,
  minWidth: 0,
};


const nextStepStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  background: "var(--bg-base)",
  padding: 10,
};


const workflowActionBarStyle = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap" as const,
  marginTop: 10,
};


const employeeLinkStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  background: "var(--bg-base)",
  padding: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
};


const detailPanelStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  background: "var(--bg-base)",
  padding: "8px 10px",
};


const detailSummaryStyle = {
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  fontWeight: 600,
};


const documentListStyle = {
  margin: "8px 0 0",
  paddingLeft: 18,
  display: "grid",
  gap: 6,
};


const documentListItemStyle = {
  color: "var(--text-secondary)",
  lineHeight: 1.35,
};


const timelineItemStyle = {
  display: "flex",
  gap: 12,
  alignItems: "flex-start",
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  background: "var(--bg-base)",
  padding: 10,
};


const fundLineStyle = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
};


const flagChipStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  padding: "6px 8px",
  background: "var(--bg-base)",
};


const contactRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  background: "var(--bg-base)",
  padding: 10,
};


function GrantRequirementsEditor({
  draft,
  documents,
  onChange,
}: {
  draft: any;
  documents: any[];
  onChange: (draft: any) => void;
}) {
  const requirements = asRequirements(draft.requirements);
  const summary = requirementSummary(requirements);
  const detectedTemplateKey = detectRequirementTemplateKey(draft);
  const [openDocumentPickers, setOpenDocumentPickers] = useState<Record<string, boolean>>({});
  const [expandedRequirements, setExpandedRequirements] = useState<Record<string, boolean>>({});

  const setRequirements = (next: GrantRequirement[]) => {
    onChange({ ...draft, requirements: next });
  };

  const updateRequirement = (index: number, patch: Partial<GrantRequirement>) => {
    setRequirements(
      requirements.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  };

  return (
    <div className="grant-requirements-editor">
      <div className="grant-format-library">
        <div className="grant-format-library__head">
          <div>
            <div className="grant-format-library__label">Format library</div>
            <strong>{GRANT_REQUIREMENT_TEMPLATES[detectedTemplateKey].label}</strong>
            <p>{GRANT_REQUIREMENT_TEMPLATES[detectedTemplateKey].description}</p>
          </div>
          <div className="grant-format-library__badges">
            <Badge tone={detectedTemplateKey === "core" ? "info" : "success"}>
              {detectedTemplateKey === "core" ? "Generic" : "Auto-detected"}
            </Badge>
            <Badge tone={summary.percent === 100 && summary.total > 0 ? "success" : "info"}>
              {summary.total > 0 ? `${summary.percent}% ready` : "No checklist"}
            </Badge>
            <Badge tone="info">{summary.attached} docs linked</Badge>
          </div>
        </div>
        <div className="grant-format-library__grid">
          {(Object.keys(GRANT_REQUIREMENT_TEMPLATES) as RequirementTemplateKey[]).map((key) => {
            const template = GRANT_REQUIREMENT_TEMPLATES[key];
            const coverage = requirementTemplateCoverage(requirements, key);
            const active = key === detectedTemplateKey;
            return (
              <button
                key={key}
                type="button"
                className={active ? "grant-format-card is-active" : "grant-format-card"}
                onClick={() => setRequirements(mergeTemplateRequirements(requirements, key))}
              >
                <span>
                  <ListChecks size={13} />
                  <strong>{template.label}</strong>
                </span>
                <small>{coverage.matched}/{coverage.total} in file</small>
              </button>
            );
          })}
          <button
            type="button"
            className="grant-format-card grant-format-card--custom"
            onClick={() =>
              setRequirements([
                ...requirements,
                {
                  id: `custom-${Date.now()}`,
                  category: "Custom",
                  label: "New requirement",
                  status: "Needed",
                },
              ])
            }
          >
            <span>
              <Plus size={13} />
              <strong>Custom item</strong>
            </span>
            <small>Add one-off evidence</small>
          </button>
        </div>
      </div>

      {requirements.length > 0 && (
        <div className="grant-requirement-list">
          {requirements.map((item, index) => {
            const selectedDocument = documents.find((document) => String(document._id) === String(item.documentId));
            const pickerOpen = Boolean(openDocumentPickers[item.id]);
            const expanded = Boolean(expandedRequirements[item.id]);
            return (
              <div key={item.id} className="grant-requirement-card">
                <div className="grant-requirement-card__summary">
                  <select
                    className="input grant-requirement-card__status"
                    aria-label={`Status for ${item.label}`}
                    value={item.status}
                    onChange={(event) =>
                      updateRequirement(index, {
                        status: event.target.value as GrantRequirementStatus,
                      })
                    }
                  >
                    {REQUIREMENT_STATUSES.map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                  <input
                    className="input grant-requirement-card__title"
                    aria-label="Requirement"
                    value={item.label}
                    onChange={(event) => updateRequirement(index, { label: event.target.value })}
                  />
                  <input
                    className="input grant-requirement-card__category"
                    aria-label="Category"
                    value={item.category}
                    onChange={(event) => updateRequirement(index, { category: event.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() =>
                      setExpandedRequirements({
                        ...expandedRequirements,
                        [item.id]: !expandedRequirements[item.id],
                      })
                    }
                  >
                    {expanded ? "Less" : "Details"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm btn--icon"
                    aria-label={`Remove requirement ${item.label}`}
                    onClick={() => setRequirements(requirements.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                <div className="grant-requirement-card__meta">
                  <Badge tone={requirementStatusTone(item.status)}>{item.status}</Badge>
                  {item.dueDate && <span>Due {formatDate(item.dueDate)}</span>}
                  <span className={selectedDocument ? "" : "muted"}>
                    {selectedDocument ? cleanDocumentTitle(selectedDocument) : "No evidence linked"}
                  </span>
                </div>

                {expanded && (
                  <div className="grant-requirement-card__details">
                  <Field label="Due">
                    <input
                      className="input"
                      type="date"
                      value={item.dueDate ?? ""}
                      onChange={(event) => updateRequirement(index, { dueDate: event.target.value || undefined })}
                    />
                  </Field>
                  <div className="grant-requirement-evidence">
                    <div className="field__label">Evidence document</div>
                    <div className="grant-requirement-evidence__summary">
                      <span title={selectedDocument?.title} className={selectedDocument ? "" : "muted"}>
                        {selectedDocument ? cleanDocumentTitle(selectedDocument) : "No document linked"}
                      </span>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() =>
                          setOpenDocumentPickers({
                            ...openDocumentPickers,
                            [item.id]: !openDocumentPickers[item.id],
                          })
                        }
                      >
                        {pickerOpen ? "Hide picker" : "Link evidence"}
                      </button>
                    </div>
                    {pickerOpen && (
                      <select
                        className="input"
                        value={item.documentId ?? ""}
                        onChange={(event) => updateRequirement(index, { documentId: event.target.value || undefined })}
                      >
                        <option value="">None</option>
                        {documents.map((document) => (
                          <option key={document._id} value={document._id}>
                            {document.title}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <Field label="Notes">
                    <MarkdownEditor
                      rows={2}
                      value={item.notes ?? ""}
                      onChange={(markdown) => updateRequirement(index, { notes: markdown })}
                    />
                  </Field>
                  {(item.sourceUrl || item.documentUrl || item.formNumber) && (
                    <div className="grant-requirement-card__links">
                      {item.formNumber && <Badge tone="info">{item.formNumber}</Badge>}
                      {item.documentUrl && (
                        <a className="cell-tag" href={item.documentUrl} target="_blank" rel="noreferrer">
                          Open form
                          <ExternalLink size={11} />
                        </a>
                      )}
                      {item.sourceUrl && (
                        <a className="muted" href={item.sourceUrl} target="_blank" rel="noreferrer">
                          Source
                          <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  )}
                </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}



export {
  timelineTone,
  nextStepTone,
  priorityTone,
  findKeyFactNumber,
  grantPacketKey,
  grantRelatedDocuments,
  EVIDENCE_GROUPS,
  groupEvidenceDocuments,
  evidenceDocumentText,
  cleanDocumentTitle,
  buildGrantTimeline,
  dossierSectionStyle,
  factBoxStyle,
  nextStepStyle,
  workflowActionBarStyle,
  employeeLinkStyle,
  detailPanelStyle,
  detailSummaryStyle,
  documentListStyle,
  documentListItemStyle,
  timelineItemStyle,
  fundLineStyle,
  flagChipStyle,
  contactRowStyle,
  GrantRequirementsEditor,
};
