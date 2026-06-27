// GrantPanels: grant editor page layout, source-external-id editor, and workbench.
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
  grantStatusTone,
} from "./GrantPanels.internal.styles";
import {
  buildGrantTimeline,
  grantRelatedDocuments,
} from "./GrantPanels.internal.documentLookup";
import {
  draftAmountCents,
} from "./GrantPanels.internal.employeeLinking";
import {
  cleanSourceKeyFacts,
} from "./GrantPanels.internal.dossierPanels";
import {
  GrantRequirementsEditor,
} from "./GrantPanels.internal.requirements";

export const EMP5616_DETAIL_URL = "https://catalogue.servicecanada.gc.ca/content/EForms/en/Detail.html?Form=EMP5616";

export const EMP5616_FORM_URL = "https://catalogue.servicecanada.gc.ca/content/EForms/en/CallForm.html?Lang=en&PDF=ESDC-EMP5616.pdf";

export const GCOS_EED_ADD_URL = "https://srv136.services.gc.ca/OSR/pro/EED/EED/Add";

export const GCOS_EED_MANAGE_URL = "https://srv136.services.gc.ca/OSR/pro/EED";

export function EditSection({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="grant-edit-section" id={id}>
      <header className="grant-edit-section__head">
        <h3 className="grant-edit-section__title">{title}</h3>
        {description && <p className="grant-edit-section__desc">{description}</p>}
      </header>
      <div className="grant-edit-section__body">{children}</div>
    </section>
  );
}

export function GrantEditorPageLayout({
  grantDraft,
  setGrantDraft,
  committees,
  users,
  accounts,
  documents,
  reports,
  accountById,
}: {
  grantDraft: any;
  setGrantDraft: (draft: any) => void;
  committees: any[];
  users: any[];
  accounts: any[];
  documents: any[];
  reports: any[];
  accountById: Map<string, any>;
}) {
  const update = (patch: Record<string, any>) => setGrantDraft({ ...grantDraft, ...patch });

  return (
    <div className="grant-edit-layout">
      <div className="grant-edit-layout__main">
        <EditSection id="grant-edit-overview" title="Overview" description="Funder, program, and high-level positioning.">
          <Field label="Title">
            <input className="input" value={grantDraft.title} onChange={(e) => update({ title: e.target.value })} />
          </Field>
          <div className="grant-edit-grid grant-edit-grid--2">
            <Field label="Funder">
              <input className="input" value={grantDraft.funder} onChange={(e) => update({ funder: e.target.value })} />
            </Field>
            <Field label="Program">
              <input className="input" value={grantDraft.program ?? ""} onChange={(e) => update({ program: e.target.value })} />
            </Field>
          </div>
          <div className="grant-edit-grid grant-edit-grid--3">
            <Field label="Opportunity type">
              <Select value={grantDraft.opportunityType ?? ""} onChange={(value) => update({ opportunityType: value })}
                options={[{ value: "", label: "Unspecified" }, { value: "Government", label: "Government" }, { value: "Foundation", label: "Foundation" }, { value: "Corporate", label: "Corporate" }, { value: "Internal", label: "Internal" }, { value: "Other", label: "Other" }]} />
            </Field>
            <Field label="Priority">
              <Select value={grantDraft.priority ?? ""} onChange={(value) => update({ priority: value })}
                options={[{ value: "", label: "Unspecified" }, { value: "High", label: "High" }, { value: "Medium", label: "Medium" }, { value: "Low", label: "Low" }]} />
            </Field>
            <Field label="Fit score" hint="0 to 100">
              <input className="input" type="number" inputMode="numeric" min="0" max="100" step="1" value={grantDraft.fitScore ?? ""} onChange={(e) => update({ fitScore: e.target.value })} />
            </Field>
          </div>
          <Field label="Opportunity URL">
            <input className="input" type="url" value={grantDraft.opportunityUrl ?? ""} onChange={(e) => update({ opportunityUrl: e.target.value })} />
          </Field>
        </EditSection>

        <EditSection id="grant-edit-status" title="Status & amounts" description="Pipeline stage, committee, and the money that goes with it.">
          <div className="grant-edit-grid grant-edit-grid--2">
            <Field label="Status">
              <Select value={grantDraft.status} onChange={(value) => update({ status: value })}
                options={[{ value: "Prospecting", label: "Prospecting" }, { value: "Drafting", label: "Drafting" }, { value: "Submitted", label: "Submitted" }, { value: "Awarded", label: "Awarded" }, { value: "Declined", label: "Declined" }, { value: "Active", label: "Active" }, { value: "Closed", label: "Closed" }]} />
            </Field>
            <Field label="Committee">
              <Select value={grantDraft.committeeId ?? ""} onChange={(value) => update({ committeeId: value })}
                options={[{ value: "", label: "None" }, ...committees.map((committee) => ({ value: committee._id, label: committee.name }))]} />
            </Field>
          </div>
          <div className="grant-edit-grid grant-edit-grid--2">
            <Field label="Requested" hint="Dollars">
              <input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={grantDraft.amountRequestedDollars ?? ""} onChange={(e) => update({ amountRequestedDollars: e.target.value })} />
            </Field>
            <Field label="Awarded" hint="Dollars">
              <input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={grantDraft.amountAwardedDollars ?? ""} onChange={(e) => update({ amountAwardedDollars: e.target.value })} />
            </Field>
          </div>
          <Field label="Next action">
            <input className="input" value={grantDraft.nextAction ?? ""} onChange={(e) => update({ nextAction: e.target.value })} />
          </Field>
          <Field label="Restricted purpose">
            <MarkdownEditor rows={4} value={grantDraft.restrictedPurpose ?? ""} onChange={(markdown) => update({ restrictedPurpose: markdown })} />
          </Field>
        </EditSection>

        <EditSection id="grant-edit-readiness" title="Readiness checklist" description="Documents, financials, confirmations, and post-award obligations.">
          <GrantRequirementsEditor
            draft={grantDraft}
            documents={documents}
            onChange={setGrantDraft}
          />
        </EditSection>

        <EditSection id="grant-edit-public-intake" title="Public intake" description="Only enable when the opportunity is open to outside applicants.">
          <label className="checkbox">
            <input type="checkbox" checked={!!grantDraft.allowPublicApplications} onChange={(e) => update({ allowPublicApplications: e.target.checked })} /> Accept public applications
          </label>
          <Field label="Public description">
            <MarkdownEditor rows={4} value={grantDraft.publicDescription ?? ""} onChange={(markdown) => update({ publicDescription: markdown })} />
          </Field>
          <Field label="Application instructions">
            <MarkdownEditor rows={4} value={grantDraft.applicationInstructions ?? ""} onChange={(markdown) => update({ applicationInstructions: markdown })} />
          </Field>
        </EditSection>

        <EditSection id="grant-edit-timeline" title="Timeline & ownership" description="Deadlines, project window, and who's accountable.">
          <div className="grant-edit-grid grant-edit-grid--4">
            <Field label="Application due">
              <DatePicker value={grantDraft.applicationDueDate ?? ""} onChange={(value) => update({ applicationDueDate: value })} />
            </Field>
            <Field label="Next report">
              <DatePicker value={grantDraft.nextReportDueAtISO ?? ""} onChange={(value) => update({ nextReportDueAtISO: value })} />
            </Field>
            <Field label="Start">
              <DatePicker value={grantDraft.startDate ?? ""} onChange={(value) => update({ startDate: value })} />
            </Field>
            <Field label="End">
              <DatePicker value={grantDraft.endDate ?? ""} onChange={(value) => update({ endDate: value })} />
            </Field>
          </div>
          <div className="grant-edit-grid grant-edit-grid--2">
            <Field label="Board owner">
              <Select value={grantDraft.boardOwnerUserId ?? ""} onChange={(value) => update({ boardOwnerUserId: value })}
                options={[{ value: "", label: "None" }, ...users.map((user) => ({ value: user._id, label: user.displayName }))]} />
            </Field>
            <Field label="Linked financial account">
              <Select value={grantDraft.linkedFinancialAccountId ?? ""} onChange={(value) => update({ linkedFinancialAccountId: value })}
                options={[{ value: "", label: "None" }, ...accounts.map((account) => ({ value: account._id, label: account.name }))]} />
            </Field>
          </div>
          {grantDraft.linkedFinancialAccountId && (
            <div className="muted" style={{ fontSize: 12 }}>
              Current linked balance: {money(accountById.get(String(grantDraft.linkedFinancialAccountId))?.balanceCents ?? 0)}
            </div>
          )}
        </EditSection>

        <EditSection id="grant-edit-provenance" title="Provenance & notes" description="Import IDs, review markers, and free-form notes.">
          <SourceExternalIdsField
            value={grantDraft.sourceExternalIdsInput ?? ""}
            onChange={(sourceExternalIdsInput) => update({ sourceExternalIdsInput })}
          />
          <div className="grant-edit-grid grant-edit-grid--2">
            <Field label="Confidence">
              <Select value={grantDraft.confidence ?? ""} onChange={(value) => update({ confidence: value })}
                options={[{ value: "", label: "Unspecified" }, { value: "High", label: "High" }, { value: "Medium", label: "Medium" }, { value: "Review", label: "Review" }]} />
            </Field>
            <Field label="Sensitivity">
              <Select value={grantDraft.sensitivity ?? ""} onChange={(value) => update({ sensitivity: value })}
                options={[{ value: "", label: "Standard" }, { value: "restricted", label: "Restricted" }]} />
            </Field>
          </div>
          <Field label="Risk flags" hint="Comma-separated review markers.">
            <input className="input" value={grantDraft.riskFlagsInput ?? ""} onChange={(e) => update({ riskFlagsInput: e.target.value })} />
          </Field>
          <Field label="Source notes">
            <MarkdownEditor rows={3} value={grantDraft.sourceNotes ?? ""} onChange={(markdown) => update({ sourceNotes: markdown })} />
          </Field>
          <Field label="Notes">
            <MarkdownEditor rows={4} value={grantDraft.notes ?? ""} onChange={(markdown) => update({ notes: markdown })} />
          </Field>
        </EditSection>
      </div>

      <aside className="grant-edit-layout__aside">
        <div className="grant-edit-layout__aside-inner">
          <GrantEditWorkbench grantDraft={grantDraft} documents={documents} reports={reports} />
        </div>
      </aside>
    </div>
  );
}

export function GrantEditWorkbench({
  grantDraft,
  documents,
  reports,
}: {
  grantDraft: any;
  documents: any[];
  reports: any[];
}) {
  const readiness = requirementSummary(grantDraft.requirements);
  const relatedDocuments = grantRelatedDocuments(grantDraft, documents);
  const timelineItems = buildGrantTimeline(grantDraft, reports);
  const requested = draftAmountCents(grantDraft, "amountRequestedCents", "amountRequestedDollars");
  const awarded = draftAmountCents(grantDraft, "amountAwardedCents", "amountAwardedDollars");
  const delta = requested !== undefined && awarded !== undefined ? awarded - requested : undefined;
  const sourceFacts = cleanSourceKeyFacts(grantDraft.keyFacts).slice(0, 4);

  return (
    <div className="grant-edit-workbench">
      <div className="grant-edit-aside__label">Editing workbench</div>

      <section className="grant-edit-workbench__panel">
        <div className="grant-edit-workbench__heading">File status</div>
        <div className="grant-edit-workbench__badges">
          <Badge tone={grantStatusTone(grantDraft.status)}>{grantDraft.status ?? "Not set"}</Badge>
          {readiness.total > 0 && (
            <Badge tone={readiness.percent === 100 ? "success" : readiness.percent >= 50 ? "warn" : "info"}>
              {readiness.percent}% ready
            </Badge>
          )}
          <Badge tone={relatedDocuments.length ? "success" : "info"}>{relatedDocuments.length} docs</Badge>
        </div>
        {grantDraft.nextAction && (
          <div className="grant-edit-workbench__note">
            <span>Next action</span>
            <strong>{grantDraft.nextAction}</strong>
          </div>
        )}
        <div className="grant-edit-workbench__links">
          <a href="#grant-edit-overview">Overview</a>
          <a href="#grant-edit-status">Status & amounts</a>
          <a href="#grant-edit-readiness">Readiness</a>
          <a href="#grant-edit-timeline">Timeline</a>
          <a href="#grant-edit-provenance">Source notes</a>
        </div>
      </section>

      {(requested !== undefined || awarded !== undefined) && (
        <section className="grant-edit-workbench__panel">
          <div className="grant-edit-workbench__heading">Funding check</div>
          <div className="grant-edit-workbench__metrics">
            <div><span>Requested</span><strong>{requested === undefined ? "—" : money(requested)}</strong></div>
            <div><span>Awarded</span><strong>{awarded === undefined ? "—" : money(awarded)}</strong></div>
            {delta !== undefined && (
              <div><span>Difference</span><strong className={delta < 0 ? "is-danger" : "is-success"}>{money(delta)}</strong></div>
            )}
          </div>
        </section>
      )}

      {(timelineItems.length > 0 || sourceFacts.length > 0) && (
        <section className="grant-edit-workbench__panel">
          <div className="grant-edit-workbench__heading">Reference</div>
          <div className="grant-edit-workbench__metrics">
            <div><span>Timeline</span><strong>{timelineItems.length} items</strong></div>
            <div><span>Source facts</span><strong>{sourceFacts.length}</strong></div>
          </div>
          {sourceFacts.length > 0 && (
            <ul className="grant-edit-workbench__facts">
              {sourceFacts.map((fact) => <li key={fact}>{fact}</li>)}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

export function SourceExternalIdsField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [rows, setRows] = useState<SourceExternalIdRow[]>(() => parseExternalIdRows(value));

  useEffect(() => {
    const incoming = parseExternalIdRows(value);
    setRows((current) => (joinExternalIdRows(current) === joinExternalIdRows(incoming) ? current : incoming));
  }, [value]);

  const visibleRows = rows.length > 0 ? rows : [emptySourceExternalIdRow()];
  const commit = (next: SourceExternalIdRow[]) => {
    setRows(next);
    onChange(joinExternalIdRows(next));
  };

  return (
    <Field label="Source IDs" hint="Track each provenance ID as source, ID type, and number.">
      <div className="source-external-ids-field">
        {visibleRows.map((row, index) => (
          <div className="source-external-ids-field__row" key={`${index}-${rows.length}`}>
            <Select
              aria-label={`Source ${index + 1}`}
              value={row.source}
              onChange={(value) => {
                const next = [...visibleRows];
                next[index] = { ...row, source: value };
                commit(next);
              }}
              options={[
                { value: "gcos", label: "GCOS" },
                { value: "paperless", label: "Paperless" },
                { value: "local", label: "Local" },
                { value: "custom", label: "Other" },
              ]}
            />
            {row.source === "custom" && (
              <input
                className="input"
                aria-label={`Custom source ${index + 1}`}
                placeholder="source"
                value={row.customSource}
                onChange={(event) => {
                  const next = [...visibleRows];
                  next[index] = { ...row, customSource: event.target.value };
                  commit(next);
                }}
              />
            )}
            <Select
              aria-label={`Source ID type ${index + 1}`}
              value={row.idType}
              onChange={(value) => {
                const next = [...visibleRows];
                next[index] = { ...row, idType: value };
                commit(next);
              }}
              options={[
                { value: "project", label: "Project ID" },
                { value: "project-number", label: "Project number" },
                { value: "document", label: "Document ID" },
                { value: "record", label: "Record ID" },
                { value: "file", label: "File ID" },
                { value: "custom", label: "Other ID" },
              ]}
            />
            {row.idType === "custom" && (
              <input
                className="input"
                aria-label={`Custom source ID type ${index + 1}`}
                placeholder="ID type"
                value={row.customIdType}
                onChange={(event) => {
                  const next = [...visibleRows];
                  next[index] = { ...row, customIdType: event.target.value };
                  commit(next);
                }}
              />
            )}
            <input
              className="input"
              aria-label={`Source ID number ${index + 1}`}
              placeholder="1539280"
              value={row.idNumber}
              onChange={(event) => {
                const next = [...visibleRows];
                next[index] = { ...row, idNumber: event.target.value };
                commit(next);
              }}
            />
            <button
              className="btn btn--ghost btn--sm btn--icon"
              type="button"
              aria-label={`Remove source ID ${index + 1}`}
              disabled={visibleRows.length === 1 && !serializeExternalIdRow(row)}
              onClick={() => commit(visibleRows.filter((_, rowIndex) => rowIndex !== index))}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <button
          className="btn btn--ghost btn--sm source-external-ids-field__add"
          type="button"
          onClick={() => commit([...visibleRows, emptySourceExternalIdRow()])}
        >
          <Plus size={12} /> Add source ID
        </button>
      </div>
    </Field>
  );
}

export type SourceExternalIdRow = {
  source: string;
  customSource: string;
  idType: string;
  customIdType: string;
  idNumber: string;
};

export function emptySourceExternalIdRow(): SourceExternalIdRow {
  return {
    source: "gcos",
    customSource: "",
    idType: "project",
    customIdType: "",
    idNumber: "",
  };
}

export function parseExternalIdRows(value: unknown): SourceExternalIdRow[] {
  return parseExternalIdInput(value).map(parseExternalIdRow);
}

export function parseExternalIdInput(value: unknown) {
  if (Array.isArray(value)) return cleanStringList(value);
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseExternalIdRow(value: string): SourceExternalIdRow {
  const parts = value.split(":").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const source = parts[0];
    const idType = parts.slice(1, -1).join(":");
    const idNumber = parts[parts.length - 1];
    return {
      source: sourceOptionValue(source),
      customSource: sourceOptionValue(source) === "custom" ? source : "",
      idType: idTypeOptionValue(idType),
      customIdType: idTypeOptionValue(idType) === "custom" ? idType : "",
      idNumber,
    };
  }
  if (parts.length === 2) {
    const source = parts[0];
    return {
      source: sourceOptionValue(source),
      customSource: sourceOptionValue(source) === "custom" ? source : "",
      idType: "record",
      customIdType: "",
      idNumber: parts[1],
    };
  }
  return {
    source: "custom",
    customSource: "",
    idType: "record",
    customIdType: "",
    idNumber: value,
  };
}

export function sourceOptionValue(value: string) {
  return ["gcos", "paperless", "local"].includes(value) ? value : "custom";
}

export function idTypeOptionValue(value: string) {
  return ["project", "project-number", "document", "record", "file"].includes(value) ? value : "custom";
}

export function serializeExternalIdRow(row: SourceExternalIdRow) {
  const source = row.source === "custom" ? row.customSource.trim() : row.source;
  const idType = row.idType === "custom" ? row.customIdType.trim() : row.idType;
  const idNumber = row.idNumber.trim();
  if (!source || !idType || !idNumber) return "";
  return `${source}:${idType}:${idNumber}`;
}

export function joinExternalIdRows(rows: SourceExternalIdRow[]) {
  return Array.from(new Set(rows.map(serializeExternalIdRow).filter(Boolean))).join(", ");
}
