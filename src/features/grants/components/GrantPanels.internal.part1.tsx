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
  grantFundedAssignment,
  grantFundedAssignmentKey,
  calculatedGrantEndDate,
  canCreateGrantEmployee,
  dollarsToCents,
  draftAmountCents,
  patchFromEmployee,
  eedPrepReadiness,
  cleanSourceKeyFacts,
  DossierSection,
  DossierFact,
  grantStatusTone,
} from "./GrantPanels.internal.part2";
import {
  nextStepTone,
  priorityTone,
  findKeyFactNumber,
  grantRelatedDocuments,
  buildGrantTimeline,
  nextStepStyle,
  workflowActionBarStyle,
  employeeLinkStyle,
  detailPanelStyle,
  GrantRequirementsEditor,
} from "./GrantPanels.internal.part3";

const EMP5616_DETAIL_URL = "https://catalogue.servicecanada.gc.ca/content/EForms/en/Detail.html?Form=EMP5616";

const EMP5616_FORM_URL = "https://catalogue.servicecanada.gc.ca/content/EForms/en/CallForm.html?Lang=en&PDF=ESDC-EMP5616.pdf";

const GCOS_EED_ADD_URL = "https://srv136.services.gc.ca/OSR/pro/EED/EED/Add";

const GCOS_EED_MANAGE_URL = "https://srv136.services.gc.ca/OSR/pro/EED";


function EditSection({
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


function GrantEditorPageLayout({
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
              <select className="input" value={grantDraft.opportunityType ?? ""} onChange={(e) => update({ opportunityType: e.target.value })}>
                <option value="">Unspecified</option>
                <option>Government</option>
                <option>Foundation</option>
                <option>Corporate</option>
                <option>Internal</option>
                <option>Other</option>
              </select>
            </Field>
            <Field label="Priority">
              <select className="input" value={grantDraft.priority ?? ""} onChange={(e) => update({ priority: e.target.value })}>
                <option value="">Unspecified</option>
                <option>High</option>
                <option>Medium</option>
                <option>Low</option>
              </select>
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
              <select className="input" value={grantDraft.status} onChange={(e) => update({ status: e.target.value })}>
                <option>Prospecting</option>
                <option>Drafting</option>
                <option>Submitted</option>
                <option>Awarded</option>
                <option>Declined</option>
                <option>Active</option>
                <option>Closed</option>
              </select>
            </Field>
            <Field label="Committee">
              <select className="input" value={grantDraft.committeeId ?? ""} onChange={(e) => update({ committeeId: e.target.value })}>
                <option value="">None</option>
                {committees.map((committee) => <option key={committee._id} value={committee._id}>{committee.name}</option>)}
              </select>
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
              <input className="input" type="date" value={grantDraft.applicationDueDate ?? ""} onChange={(e) => update({ applicationDueDate: e.target.value })} />
            </Field>
            <Field label="Next report">
              <input className="input" type="date" value={grantDraft.nextReportDueAtISO ?? ""} onChange={(e) => update({ nextReportDueAtISO: e.target.value })} />
            </Field>
            <Field label="Start">
              <input className="input" type="date" value={grantDraft.startDate ?? ""} onChange={(e) => update({ startDate: e.target.value })} />
            </Field>
            <Field label="End">
              <input className="input" type="date" value={grantDraft.endDate ?? ""} onChange={(e) => update({ endDate: e.target.value })} />
            </Field>
          </div>
          <div className="grant-edit-grid grant-edit-grid--2">
            <Field label="Board owner">
              <select className="input" value={grantDraft.boardOwnerUserId ?? ""} onChange={(e) => update({ boardOwnerUserId: e.target.value })}>
                <option value="">None</option>
                {users.map((user) => <option key={user._id} value={user._id}>{user.displayName}</option>)}
              </select>
            </Field>
            <Field label="Linked financial account">
              <select className="input" value={grantDraft.linkedFinancialAccountId ?? ""} onChange={(e) => update({ linkedFinancialAccountId: e.target.value })}>
                <option value="">None</option>
                {accounts.map((account) => <option key={account._id} value={account._id}>{account.name}</option>)}
              </select>
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
              <select className="input" value={grantDraft.confidence ?? ""} onChange={(e) => update({ confidence: e.target.value })}>
                <option value="">Unspecified</option>
                <option>High</option>
                <option>Medium</option>
                <option>Review</option>
              </select>
            </Field>
            <Field label="Sensitivity">
              <select className="input" value={grantDraft.sensitivity ?? ""} onChange={(e) => update({ sensitivity: e.target.value })}>
                <option value="">Standard</option>
                <option value="restricted">Restricted</option>
              </select>
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


function GrantEditWorkbench({
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


function SourceExternalIdsField({
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
            <select
              className="input"
              aria-label={`Source ${index + 1}`}
              value={row.source}
              onChange={(event) => {
                const next = [...visibleRows];
                next[index] = { ...row, source: event.target.value };
                commit(next);
              }}
            >
              <option value="gcos">GCOS</option>
              <option value="paperless">Paperless</option>
              <option value="local">Local</option>
              <option value="custom">Other</option>
            </select>
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
            <select
              className="input"
              aria-label={`Source ID type ${index + 1}`}
              value={row.idType}
              onChange={(event) => {
                const next = [...visibleRows];
                next[index] = { ...row, idType: event.target.value };
                commit(next);
              }}
            >
              <option value="project">Project ID</option>
              <option value="project-number">Project number</option>
              <option value="document">Document ID</option>
              <option value="record">Record ID</option>
              <option value="file">File ID</option>
              <option value="custom">Other ID</option>
            </select>
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


type SourceExternalIdRow = {
  source: string;
  customSource: string;
  idType: string;
  customIdType: string;
  idNumber: string;
};


function emptySourceExternalIdRow(): SourceExternalIdRow {
  return {
    source: "gcos",
    customSource: "",
    idType: "project",
    customIdType: "",
    idNumber: "",
  };
}


function parseExternalIdRows(value: unknown): SourceExternalIdRow[] {
  return parseExternalIdInput(value).map(parseExternalIdRow);
}


function parseExternalIdInput(value: unknown) {
  if (Array.isArray(value)) return cleanStringList(value);
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}


function parseExternalIdRow(value: string): SourceExternalIdRow {
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


function sourceOptionValue(value: string) {
  return ["gcos", "paperless", "local"].includes(value) ? value : "custom";
}


function idTypeOptionValue(value: string) {
  return ["project", "project-number", "document", "record", "file"].includes(value) ? value : "custom";
}


function serializeExternalIdRow(row: SourceExternalIdRow) {
  const source = row.source === "custom" ? row.customSource.trim() : row.source;
  const idType = row.idType === "custom" ? row.customIdType.trim() : row.idType;
  const idNumber = row.idNumber.trim();
  if (!source || !idType || !idNumber) return "";
  return `${source}:${idType}:${idNumber}`;
}


function joinExternalIdRows(rows: SourceExternalIdRow[]) {
  return Array.from(new Set(rows.map(serializeExternalIdRow).filter(Boolean))).join(", ");
}


type GrantDossierTabId = "overview" | "timeline" | "people" | "evidence" | "financials" | "source" | "edit";


function GrantDossierSummary({
  grant,
  committee,
  owner,
  account,
}: {
  grant: any;
  committee?: any;
  owner?: any;
  account?: any;
}) {
  const readiness = requirementSummary(grant.requirements);
  const fitScore = grant.fitScore === "" || grant.fitScore == null ? undefined : `${grant.fitScore}/100`;

  return (
    <DossierSection title="Grant Overview">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: 8 }}>
        <DossierFact label="Funder" value={grant.funder ?? grant.funderName} />
        <DossierFact label="Program" value={grant.program} />
        <DossierFact label="Status">
          <Badge tone={grantStatusTone(grant.status)}>{grant.status ?? "Not set"}</Badge>
        </DossierFact>
        <DossierFact label="Opportunity type" value={grant.opportunityType} />
        <DossierFact label="Priority" value={grant.priority} />
        <DossierFact label="Fit score" value={fitScore} />
        <DossierFact label="Requested" value={grant.amountRequestedCents == null ? undefined : money(grant.amountRequestedCents)} />
        <DossierFact label="Awarded" value={grant.amountAwardedCents == null ? undefined : money(grant.amountAwardedCents)} />
        <DossierFact label="Submitted" value={grant.submittedAtISO ? formatDate(grant.submittedAtISO) : undefined} />
        <DossierFact label="Confirmation" value={grant.confirmationCode} />
        <DossierFact label="Readiness">
          {readiness.total > 0 ? (
            <span>
              <Badge tone={readiness.percent === 100 ? "success" : readiness.percent >= 50 ? "warn" : "info"}>
                {readiness.percent}%
              </Badge>{" "}
              <span className="muted">{readiness.complete}/{readiness.total}</span>
            </span>
          ) : (
            "—"
          )}
        </DossierFact>
        <DossierFact label="Application due" value={grant.applicationDueDate ? formatDate(grant.applicationDueDate) : undefined} />
        <DossierFact label="Decision" value={grant.decisionAtISO ? formatDate(grant.decisionAtISO) : undefined} />
        <DossierFact label="Project start" value={grant.startDate ? formatDate(grant.startDate) : undefined} />
        <DossierFact label="Project end" value={grant.endDate ? formatDate(grant.endDate) : undefined} />
        <DossierFact label="Next report" value={grant.nextReportDueAtISO ? formatDate(grant.nextReportDueAtISO) : undefined} />
        <DossierFact label="Committee" value={committee?.name} />
        <DossierFact label="Board owner" value={owner?.displayName} />
        <DossierFact label="Public intake">
          <Badge tone={grant.allowPublicApplications ? "success" : "info"}>{grant.allowPublicApplications ? "Open" : "Internal"}</Badge>
        </DossierFact>
        <DossierFact label="Linked account" value={account ? `${account.name} · ${money(account.balanceCents ?? 0)}` : undefined} />
      </div>
      {grant.nextAction && (
        <div style={{ marginTop: 10 }}>
          <div className="stat__label">Next action</div>
          <div>{grant.nextAction}</div>
        </div>
      )}
      {grant.opportunityUrl && (
        <div style={{ marginTop: 10 }}>
          <div className="stat__label">Opportunity URL</div>
          <a href={grant.opportunityUrl} target="_blank" rel="noreferrer" className="row" style={{ gap: 6, overflowWrap: "anywhere" }}>
            {grant.opportunityUrl}
            <ExternalLink size={12} />
          </a>
        </div>
      )}
    </DossierSection>
  );
}


function GrantFundedEmployeesPanel({
  grant,
  employees,
  employeeLinks,
  secretVaultItems = [],
  onLinkEmployee,
  onUnlinkEmployee,
  onCreateEmployee,
  onQueueEmployeeOrientationEmail,
  onCreateSinVaultRecord,
}: {
  grant: any;
  employees: any[];
  employeeLinks: any[];
  secretVaultItems?: any[];
  onLinkEmployee?: (employeeId: string, patch?: Record<string, unknown>) => void | Promise<void>;
  onUnlinkEmployee?: (linkId: string) => void | Promise<void>;
  onCreateEmployee?: (draft: Record<string, unknown>) => Promise<string | void>;
  onQueueEmployeeOrientationEmail?: (employee: any, grant: any) => void | Promise<void>;
  onCreateSinVaultRecord?: (draft: Record<string, unknown>) => Promise<string | void>;
}) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [showNewEmployee, setShowNewEmployee] = useState(false);
  const [employeeDraft, setEmployeeDraft] = useState(() => defaultGrantEmployeeDraft(grant));
  const [showSinVaultForm, setShowSinVaultForm] = useState(false);
  const [sinVaultDraft, setSinVaultDraft] = useState(() => defaultSinVaultDraft());
  const [endDateOverridden, setEndDateOverridden] = useState(false);
  const grantId = String(grant._id ?? grant.id ?? "");
  const grantAssignmentKey = grantFundedAssignmentKey(grant);
  const links = employeeLinks.filter((link) => String(link.grantId) === grantId);
  const linkedEmployeeIds = new Set(links.map((link) => String(link.employeeId)));
  const availableEmployees = employees.filter((employee) => !linkedEmployeeIds.has(String(employee._id)));
  const approvedParticipants = findKeyFactNumber(grant.keyFacts, /approved participants:\s*(\d+(?:\.\d+)?)/i);
  const remaining = approvedParticipants === undefined ? undefined : Math.max(0, approvedParticipants - links.length);
  const canLinkMoreEmployees = remaining === undefined || remaining > 0;
  const lockedAssignment = grantFundedAssignment(grant);

  useEffect(() => {
    setEmployeeDraft((current) => ({
      ...current,
      role: lockedAssignment.role ?? current.role,
      employmentType: lockedAssignment.employmentType ?? current.employmentType,
      hoursPerWeek: lockedAssignment.hoursPerWeek ?? current.hoursPerWeek,
      hourlyWageDollars: lockedAssignment.hourlyWageDollars ?? current.hourlyWageDollars,
      endDate: !endDateOverridden ? calculatedGrantEndDate(current.startDate, lockedAssignment.weeks) ?? current.endDate : current.endDate,
    }));
  }, [grantAssignmentKey, endDateOverridden]);

  useEffect(() => {
    if (!canLinkMoreEmployees) {
      setSelectedEmployeeId("");
      setShowNewEmployee(false);
    }
  }, [canLinkMoreEmployees]);

  if (!links.length && !onLinkEmployee) return null;

  const linkSelected = async () => {
    if (!selectedEmployeeId || !onLinkEmployee) return;
    const employee = employees.find((item) => String(item._id) === selectedEmployeeId);
    await onLinkEmployee(selectedEmployeeId, patchFromEmployee(employee));
    setSelectedEmployeeId("");
  };

  const createAndLink = async () => {
    if (!onCreateEmployee || !onLinkEmployee || !canCreateGrantEmployee(employeeDraft)) return;
    const employeeId = await onCreateEmployee({
      firstName: employeeDraft.firstName.trim(),
      lastName: employeeDraft.lastName.trim(),
      email: employeeDraft.email.trim() || undefined,
      phone: employeeDraft.phone.trim() || undefined,
      birthDate: employeeDraft.birthDate || undefined,
      addressLine1: employeeDraft.addressLine1.trim() || undefined,
      addressLine2: employeeDraft.addressLine2.trim() || undefined,
      city: employeeDraft.city.trim() || undefined,
      province: employeeDraft.province.trim() || undefined,
      postalCode: employeeDraft.postalCode.trim() || undefined,
      country: employeeDraft.country.trim() || undefined,
      sinSecretVaultItemId: employeeDraft.sinSecretVaultItemId || undefined,
      role: employeeDraft.role.trim(),
      startDate: employeeDraft.startDate,
      endDate: employeeDraft.endDate || undefined,
      employmentType: employeeDraft.employmentType,
      hourlyWageCents: dollarsToCents(employeeDraft.hourlyWageDollars),
      cppExempt: false,
      eiExempt: false,
      notes: "Created from the GCOS grant EED preparation workflow. SIN is stored only through the Secrets vault link; do not place raw SIN in notes.",
    });
    if (employeeId) {
      await onLinkEmployee(String(employeeId), {
        status: "eed_pending",
        source: "gcos",
        role: employeeDraft.role.trim(),
        startDate: employeeDraft.startDate,
        endDate: employeeDraft.endDate || undefined,
        fundedHoursPerWeek: Number(employeeDraft.hoursPerWeek) || undefined,
        fundedHourlyWageCents: dollarsToCents(employeeDraft.hourlyWageDollars),
        notes: "Created from GCOS EED prep. Confirm participant-only sensitive fields in GCOS before submission.",
      });
      setEmployeeDraft(defaultGrantEmployeeDraft(grant));
      setEndDateOverridden(false);
      setShowNewEmployee(false);
    }
  };

  const createSinVaultRecord = async () => {
    if (!onCreateSinVaultRecord || !canCreateSinVaultRecord(sinVaultDraft)) return;
    const firstName = employeeDraft.firstName.trim();
    const lastName = employeeDraft.lastName.trim();
    const employeeName = [firstName, lastName].filter(Boolean).join(" ");
    const id = await onCreateSinVaultRecord({
      name: sinVaultDraft.name.trim() || `SIN - ${employeeName || "funded employee"}`,
      custodianPersonName: sinVaultDraft.custodianPersonName.trim() || undefined,
      custodianEmail: sinVaultDraft.custodianEmail.trim() || undefined,
      externalLocation: sinVaultDraft.externalLocation.trim() || undefined,
      secretValue: sinVaultDraft.secretValue.trim() || undefined,
      notes: [
        `Created from grant ${grant.title ?? "GCOS grant"} funded-employee workflow.`,
        employeeName ? `Employee: ${employeeName}.` : undefined,
        "Raw SIN is retained only in the Secrets vault record.",
      ].filter(Boolean).join(" "),
    });
    if (id) {
      setEmployeeDraft({ ...employeeDraft, sinSecretVaultItemId: String(id) });
      setSinVaultDraft(defaultSinVaultDraft());
      setShowSinVaultForm(false);
    }
  };

  return (
    <DossierSection title="Funded Employees" id="funded-employees">
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Badge tone={links.length ? "success" : "warn"}>{links.length} linked</Badge>
          {approvedParticipants !== undefined && <Badge tone={remaining === 0 ? "success" : "warn"}>{remaining} participant slot{remaining === 1 ? "" : "s"} open</Badge>}
        </div>
        {links.length > 0 ? (
          <div style={{ display: "grid", gap: 8 }}>
            {links.map((link) => {
              const employee = employees.find((item) => String(item._id) === String(link.employeeId));
              const name = employee ? `${employee.firstName} ${employee.lastName}` : "Linked employee";
              const readiness = eedPrepReadiness(employee, link);
              return (
                <div key={String(link._id)} style={{ ...employeeLinkStyle, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <strong>{name}</strong>
                      <Badge tone={readiness.ready ? "success" : "warn"}>{readiness.ready ? "Ready to prepare" : "Missing EED prep fields"}</Badge>
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                      {[link.role ?? employee?.role, link.status, employee?.startDate ? `Starts ${formatDate(link.startDate ?? employee.startDate)}` : undefined].filter(Boolean).join(" · ")}
                    </div>
                    {!readiness.ready && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>Add: {readiness.missing.join(", ")}</div>}
                    <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                      SIN must stay in Secrets. GCOS-only fields still required before submission: citizenship/eligibility and demographic declarations.
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {employee && onQueueEmployeeOrientationEmail && (
                      <button className="btn btn--accent btn--sm" type="button" disabled={!employee.email} onClick={() => onQueueEmployeeOrientationEmail(employee, grant)}>
                        Queue orientation email
                      </button>
                    )}
                    {onUnlinkEmployee && (
                      <button className="btn btn--ghost btn--sm" type="button" onClick={() => onUnlinkEmployee(String(link._id))}>
                        Unlink
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 12 }}>No Societyer employees are linked to this grant yet.</div>
        )}
        {onLinkEmployee && availableEmployees.length > 0 && canLinkMoreEmployees && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select className="input" style={{ flex: "1 1 220px" }} value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)}>
              <option value="">Select an employee to link</option>
              {availableEmployees.map((employee) => (
                <option key={String(employee._id)} value={String(employee._id)}>
                  {employee.firstName} {employee.lastName} · {employee.role}
                </option>
              ))}
            </select>
            <button className="btn btn--accent" type="button" disabled={!selectedEmployeeId} onClick={linkSelected}>
              Link employee
            </button>
          </div>
        )}
        {onCreateEmployee && onLinkEmployee && canLinkMoreEmployees && (
          <div style={{ display: "grid", gap: 8, borderTop: "1px dashed var(--border)", paddingTop: 10 }}>
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => setShowNewEmployee((value) => !value)}>
              {showNewEmployee ? "Cancel new employee" : "Add and link new employee"}
            </button>
            {showNewEmployee && (
              <div style={{ display: "grid", gap: 8 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  Societyer collects EED prep fields here, including birth date and home address. Store SIN only in Access custody, then link the vault record below.
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <Field label="First name"><input className="input" value={employeeDraft.firstName} onChange={(event) => setEmployeeDraft({ ...employeeDraft, firstName: event.target.value })} /></Field>
                  <Field label="Last name"><input className="input" value={employeeDraft.lastName} onChange={(event) => setEmployeeDraft({ ...employeeDraft, lastName: event.target.value })} /></Field>
                </div>
                <Field label="Email"><input className="input" type="email" value={employeeDraft.email} onChange={(event) => setEmployeeDraft({ ...employeeDraft, email: event.target.value })} /></Field>
                <div className="row" style={{ gap: 8 }}>
                  <Field label="Phone"><input className="input" inputMode="tel" value={employeeDraft.phone} onChange={(event) => setEmployeeDraft({ ...employeeDraft, phone: event.target.value })} /></Field>
                  <Field label="Birth date"><input className="input" type="date" value={employeeDraft.birthDate} onChange={(event) => setEmployeeDraft({ ...employeeDraft, birthDate: event.target.value })} /></Field>
                </div>
                <StructuredAddressFields
                  value={{
                    street: employeeDraft.addressLine1,
                    unit: employeeDraft.addressLine2,
                    city: employeeDraft.city,
                    provinceState: employeeDraft.province,
                    postalCode: employeeDraft.postalCode,
                    country: employeeDraft.country,
                  }}
                  onChange={(address) => setEmployeeDraft({
                    ...employeeDraft,
                    addressLine1: address.street ?? "",
                    addressLine2: address.unit ?? "",
                    city: address.city ?? "",
                    province: address.provinceState ?? "",
                    postalCode: address.postalCode ?? "",
                    country: address.country ?? "",
                  })}
                />
                <Field label="SIN vault record" hint="Raw SIN stays in Secrets; this links only the vault metadata record.">
                  <select className="input" value={employeeDraft.sinSecretVaultItemId} onChange={(event) => setEmployeeDraft({ ...employeeDraft, sinSecretVaultItemId: event.target.value })}>
                    <option value="">No SIN vault record linked</option>
                    {secretVaultItems.map((secret) => (
                      <option key={String(secret._id)} value={String(secret._id)}>
                        {[secret.name, secret.service, secret.secretPreview].filter(Boolean).join(" · ")}
                      </option>
                    ))}
                  </select>
                </Field>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {onCreateSinVaultRecord && (
                    <button className="btn btn--ghost btn--sm" type="button" onClick={() => setShowSinVaultForm((value) => !value)}>
                      {showSinVaultForm ? "Cancel SIN vault record" : "Add SIN vault record"}
                    </button>
                  )}
                  <span className="muted" style={{ fontSize: 12 }}>
                    You can also manage access records in <Link to="/app/secrets">Secrets</Link>.
                  </span>
                </div>
                {showSinVaultForm && (
                  <div style={{ ...detailPanelStyle, display: "grid", gap: 8 }}>
                    <div className="muted" style={{ fontSize: 12 }}>
                      This creates a restricted Secrets record. Do not put SIN in employee notes, grant notes, or documents unless the document is intentionally access-controlled.
                    </div>
                    <Field label="Record name"><input className="input" value={sinVaultDraft.name} onChange={(event) => setSinVaultDraft({ ...sinVaultDraft, name: event.target.value })} /></Field>
                    <Field label="SIN" hint="Stored encrypted in Secrets only. Leave blank if the SIN is held externally."><input className="input" type="password" inputMode="numeric" autoComplete="off" value={sinVaultDraft.secretValue} onChange={(event) => setSinVaultDraft({ ...sinVaultDraft, secretValue: event.target.value })} /></Field>
                    <Field label="External custody location" hint="Use when the SIN is stored outside Societyer."><input className="input" value={sinVaultDraft.externalLocation} onChange={(event) => setSinVaultDraft({ ...sinVaultDraft, externalLocation: event.target.value })} /></Field>
                    <div className="row" style={{ gap: 8 }}>
                      <Field label="Custodian name"><input className="input" value={sinVaultDraft.custodianPersonName} onChange={(event) => setSinVaultDraft({ ...sinVaultDraft, custodianPersonName: event.target.value })} /></Field>
                      <Field label="Custodian email"><input className="input" type="email" value={sinVaultDraft.custodianEmail} onChange={(event) => setSinVaultDraft({ ...sinVaultDraft, custodianEmail: event.target.value })} /></Field>
                    </div>
                    <button className="btn btn--accent btn--sm" type="button" disabled={!canCreateSinVaultRecord(sinVaultDraft)} onClick={createSinVaultRecord}>
                      Create and link SIN vault record
                    </button>
                  </div>
                )}
                <div className="row" style={{ gap: 8 }}>
                  <Field label="Job / role" hint={lockedAssignment.role ? "From approved GCOS job" : undefined}>
                    <input className="input" readOnly={Boolean(lockedAssignment.role)} value={employeeDraft.role} onChange={(event) => setEmployeeDraft({ ...employeeDraft, role: event.target.value })} />
                  </Field>
                  <Field label="Type" hint={lockedAssignment.employmentType ? "From grant-funded role" : undefined}>
                    <select className="input" disabled={Boolean(lockedAssignment.employmentType)} value={employeeDraft.employmentType} onChange={(event) => setEmployeeDraft({ ...employeeDraft, employmentType: event.target.value })}>
                      <option>FullTime</option>
                      <option>PartTime</option>
                      <option>Casual</option>
                      <option>Contractor</option>
                    </select>
                  </Field>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <Field label="Start">
                    <input
                      className="input"
                      type="date"
                      value={employeeDraft.startDate}
                      onChange={(event) => {
                        const startDate = event.target.value;
                        setEmployeeDraft({
                          ...employeeDraft,
                          startDate,
                          endDate: !endDateOverridden ? calculatedGrantEndDate(startDate, lockedAssignment.weeks) ?? employeeDraft.endDate : employeeDraft.endDate,
                        });
                      }}
                    />
                  </Field>
                  <Field label="End" hint={endDateOverridden ? "Manual override" : lockedAssignment.weeks ? `${lockedAssignment.weeks} approved weeks from start` : undefined}>
                    <input
                      className="input"
                      type="date"
                      value={employeeDraft.endDate}
                      onChange={(event) => {
                        setEndDateOverridden(true);
                        setEmployeeDraft({ ...employeeDraft, endDate: event.target.value });
                      }}
                    />
                  </Field>
                </div>
                {endDateOverridden && (
                  <button
                    className="btn btn--ghost btn--sm"
                    type="button"
                    onClick={() => {
                      setEndDateOverridden(false);
                      setEmployeeDraft({
                        ...employeeDraft,
                        endDate: calculatedGrantEndDate(employeeDraft.startDate, lockedAssignment.weeks) ?? employeeDraft.endDate,
                      });
                    }}
                  >
                    Use calculated end date
                  </button>
                )}
                <div className="row" style={{ gap: 8 }}>
                  <Field label="Hours/week" hint={lockedAssignment.hoursPerWeek ? "From approved GCOS job" : undefined}>
                    <input className="input" readOnly={Boolean(lockedAssignment.hoursPerWeek)} type="number" inputMode="decimal" min="0" step="0.25" value={employeeDraft.hoursPerWeek} onChange={(event) => setEmployeeDraft({ ...employeeDraft, hoursPerWeek: event.target.value })} />
                  </Field>
                  <Field label="Hourly wage" hint={lockedAssignment.hourlyWageDollars ? "From approved GCOS job" : "Dollars"}>
                    <input className="input" readOnly={Boolean(lockedAssignment.hourlyWageDollars)} type="number" inputMode="decimal" min="0" step="0.01" value={employeeDraft.hourlyWageDollars} onChange={(event) => setEmployeeDraft({ ...employeeDraft, hourlyWageDollars: event.target.value })} />
                  </Field>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button className="btn btn--accent btn--sm" type="button" disabled={!canCreateGrantEmployee(employeeDraft)} onClick={createAndLink}>
                    Create and link employee
                  </button>
                  {!canCreateGrantEmployee(employeeDraft) && <span className="muted" style={{ fontSize: 12 }}>First name, last name, role, start, hourly wage, birth date, home address, phone, and SIN vault record are required.</span>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </DossierSection>
  );
}


function GrantNextStepsPanel({ grant }: { grant: any }) {
  const steps = asNextSteps(grant.nextSteps).filter((step) => step.label.trim());
  if (steps.length === 0) return null;

  return (
    <DossierSection title="Recommended Next Steps">
      <div style={{ display: "grid", gap: 8 }}>
        {steps.map((step) => {
          const actions = workflowActionsForStep(grant, step);
          return (
            <div key={step.id} style={nextStepStyle}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <strong>{step.label}</strong>
                  {step.reason && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{step.reason}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Badge tone={nextStepTone(step.status)}>{step.status}</Badge>
                  <Badge tone={priorityTone(step.priority)}>{step.priority}</Badge>
                </div>
              </div>
              {actions.length > 0 && (
                <div style={workflowActionBarStyle}>
                  {actions.map((action) => action.external ? (
                    <a
                      key={action.label}
                      className={action.primary ? "btn btn--accent btn--sm" : "btn btn--ghost btn--sm"}
                      href={action.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {action.label}
                      <ExternalLink size={11} />
                    </a>
                  ) : action.href.startsWith("#") ? (
                    <a key={action.label} className={action.primary ? "btn btn--accent btn--sm" : "btn btn--ghost btn--sm"} href={action.href}>
                      {action.label}
                    </a>
                  ) : (
                    <Link key={action.label} className={action.primary ? "btn btn--accent btn--sm" : "btn btn--ghost btn--sm"} to={action.href}>
                      {action.label}
                    </Link>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, fontSize: 12 }}>
                {step.dueHint && <span className="muted">{step.dueHint}</span>}
                {step.sourceUrl ? (
                  <a className="muted" href={step.sourceUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Source: {step.source ?? "source"}
                    <ExternalLink size={11} />
                  </a>
                ) : step.source ? (
                  <span className="muted">Source: {step.source}</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </DossierSection>
  );
}


function GrantOperationalWorkflowsPanel({ grant }: { grant: any }) {
  const isCsj = /canada summer jobs|csj/i.test(`${grant.program ?? ""} ${cleanStringList(grant.keyFacts).join(" ")}`);
  if (!isCsj) return null;

  return (
    <DossierSection title="Grant Workflows">
      <div style={{ display: "grid", gap: 8 }}>
        <div style={nextStepStyle}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <strong>CSJ remote worker orientation</strong>
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                System workflow for the Young Workers attestation: queue the resource email, review it during orientation, then retain evidence before submitting EED.
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Badge tone="info">System workflow</Badge>
              <Badge tone="warn">EED evidence</Badge>
            </div>
          </div>
          <div style={workflowActionBarStyle}>
            <Link className="btn btn--accent btn--sm" to={String(grant.id ?? grant._id ?? "") ? `/app/grants/${String(grant.id ?? grant._id)}#funded-employees` : "#funded-employees"}>Queue for employee</Link>
            <Link className="btn btn--ghost btn--sm" to="/app/outbox">Open Outbox</Link>
            <Link className="btn btn--ghost btn--sm" to="/app/workflows">Workflow catalog</Link>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Supports the GCOS checkbox: “I confirm that I have read the information on the Young Workers website and I have provided the link to the employee.”
          </div>
        </div>
      </div>
    </DossierSection>
  );
}


function workflowActionsForStep(grant: any, step: ReturnType<typeof asNextSteps>[number]) {
  const grantId = String(grant.id ?? grant._id ?? "");
  const editHref = grantId ? `/app/grants/${grantId}/edit` : "/app/grants";
  const checklistHref = grantId ? `/app/grants/${grantId}/edit#grant-edit-readiness` : "#grant-edit-readiness";
  const fundingHref = grantId ? `/app/grants/${grantId}/edit#grant-edit-status` : "#grant-edit-status";
  const reportingHref = grantId ? `/app/grants/${grantId}/edit#grant-edit-timeline` : "#grant-edit-timeline";
  const actions: Array<{ label: string; href: string; external?: boolean; primary?: boolean }> = [];

  if (step.id === "gcos-prepare-eed") {
    const emp5616 = findRequirementById(grant.requirements, "gcos-emp5616-consent");
    actions.push(
      { label: "Link employees", href: grantId ? `/app/grants/${grantId}#funded-employees` : "#funded-employees", primary: true },
      { label: "Open EMP5616", href: emp5616?.documentUrl ?? EMP5616_FORM_URL, external: true },
      { label: "Add EED in GCOS", href: step.actionUrl ?? GCOS_EED_ADD_URL, external: true },
      { label: "Track checklist", href: checklistHref },
    );
    actions.push({ label: "View EED list", href: GCOS_EED_MANAGE_URL, external: true });
  } else if (step.id === "gcos-complete-emp5616") {
    actions.push({ label: step.actionLabel ?? "Open EMP5616", href: step.actionUrl ?? EMP5616_FORM_URL, external: true, primary: true });
    actions.push(
      { label: "Link employee record", href: grantId ? `/app/grants/${grantId}#funded-employees` : "#funded-employees" },
      { label: "Mark consent retained", href: checklistHref },
    );
  } else if (step.id === "gcos-review-award-delta") {
    actions.push(
      { label: "Review funding delta", href: fundingHref, primary: true },
      { label: "Update budget notes", href: fundingHref },
    );
  } else if (step.id === "gcos-plan-payment-claim") {
    actions.push(
      { label: "Create reporting plan", href: reportingHref, primary: true },
      { label: "Review evidence checklist", href: checklistHref },
    );
  } else if (step.actionUrl) {
    actions.push({ label: step.actionLabel ?? "Open action", href: step.actionUrl, external: true, primary: true });
  } else if (step.actionLabel) {
    actions.push({ label: step.actionLabel, href: editHref, primary: true });
  }

  return actions;
}


function findRequirementById(value: unknown, id: string) {
  return asRequirements(value).find((requirement) => requirement.id === id);
}


function defaultGrantEmployeeDraft(grant: any) {
  const assignment = grantFundedAssignment(grant);
  return {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    birthDate: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    province: "British Columbia",
    postalCode: "",
    country: "Canada",
    sinSecretVaultItemId: "",
    role: assignment.role ?? "",
    employmentType: assignment.employmentType ?? "FullTime",
    startDate: grant.startDate ?? new Date().toISOString().slice(0, 10),
    endDate: calculatedGrantEndDate(grant.startDate ?? new Date().toISOString().slice(0, 10), assignment.weeks) ?? grant.endDate ?? "",
    hoursPerWeek: assignment.hoursPerWeek ?? "35",
    hourlyWageDollars: assignment.hourlyWageDollars ?? "",
  };
}


function defaultSinVaultDraft() {
  return {
    name: "",
    secretValue: "",
    externalLocation: "",
    custodianPersonName: "",
    custodianEmail: "",
  };
}


function canCreateSinVaultRecord(draft: ReturnType<typeof defaultSinVaultDraft>) {
  return Boolean(draft.name.trim() || draft.secretValue.trim() || draft.externalLocation.trim());
}



export {
  EMP5616_DETAIL_URL,
  EMP5616_FORM_URL,
  GCOS_EED_ADD_URL,
  GCOS_EED_MANAGE_URL,
  EditSection,
  GrantEditorPageLayout,
  GrantEditWorkbench,
  SourceExternalIdsField,
  emptySourceExternalIdRow,
  parseExternalIdRows,
  parseExternalIdInput,
  parseExternalIdRow,
  sourceOptionValue,
  idTypeOptionValue,
  serializeExternalIdRow,
  joinExternalIdRows,
  GrantDossierSummary,
  GrantFundedEmployeesPanel,
  GrantNextStepsPanel,
  GrantOperationalWorkflowsPanel,
  workflowActionsForStep,
  findRequirementById,
  defaultGrantEmployeeDraft,
  defaultSinVaultDraft,
  canCreateSinVaultRecord,
};

export type {
  SourceExternalIdRow,
  GrantDossierTabId,
};
