// GrantPanels: interactive grant requirements checklist editor.
import { type ReactNode, useEffect, useState } from "react";
import { ExternalLink, ListChecks, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, Field, InspectorNote } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { DatePicker } from "../../../components/DatePicker";
import { MarkdownEditor } from "../../../components/MarkdownEditor";
import { StructuredAddressFields } from "../../../components/StructuredAddressFields";
import { formatDate, money } from "../../../lib/format";
import {
  asAnswerLibrary,
  asComplianceFlags,
  asContacts,
  asNextSteps,
  asRequirements,
  asTimelineEvents,
  asUseOfFunds,
  cleanStringList,
  detectRequirementTemplateKey,
  GRANT_REQUIREMENT_TEMPLATES,
  type GrantRequirement,
  type GrantRequirementStatus,
  mergeTemplateRequirements,
  optionalString,
  REQUIREMENT_STATUSES,
  requirementStatusTone,
  requirementSummary,
  requirementTemplateCoverage,
  type RequirementTemplateKey,
} from "../lib/grantDrafts";

import {
  cleanDocumentTitle,
} from "./GrantPanels.internal.documentLookup";

export function GrantRequirementsEditor({
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
                  <Select
                    className="grant-requirement-card__status"
                    aria-label={`Status for ${item.label}`}
                    value={item.status}
                    onChange={(value) =>
                      updateRequirement(index, {
                        status: value as GrantRequirementStatus,
                      })
                    }
                    options={REQUIREMENT_STATUSES.map((status) => ({
                      value: status,
                      label: status,
                    }))}
                  />
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
                    <DatePicker
                      value={item.dueDate ?? ""}
                      onChange={(value) => updateRequirement(index, { dueDate: value || undefined })}
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
                      <Select
                        value={item.documentId ?? ""}
                        onChange={(value) => updateRequirement(index, { documentId: value || undefined })}
                        options={[
                          { value: "", label: "None" },
                          ...documents.map((document) => ({
                            value: document._id,
                            label: document.title,
                          })),
                        ]}
                      />
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
