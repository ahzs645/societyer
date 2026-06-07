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
} from "./GrantPanels.internal";
import type {
  SourceExternalIdRow,
  GrantDossierTabId,
} from "./GrantPanels.internal";

export function GrantReadPanel({
  grant,
  documents,
  reports,
  committee,
  owner,
  account,
  employees = [],
  employeeLinks = [],
  secretVaultItems = [],
  onLinkEmployee,
  onUnlinkEmployee,
  onCreateEmployee,
  onQueueEmployeeOrientationEmail,
  onCreateSinVaultRecord,
  editorPanel,
  editable = false,
  viewMode = "drawer",
}: {
  grant: any;
  documents: any[];
  reports: any[];
  committee?: any;
  owner?: any;
  account?: any;
  employees?: any[];
  employeeLinks?: any[];
  secretVaultItems?: any[];
  onLinkEmployee?: (employeeId: string, patch?: Record<string, unknown>) => void | Promise<void>;
  onUnlinkEmployee?: (linkId: string) => void | Promise<void>;
  onCreateEmployee?: (draft: Record<string, unknown>) => Promise<string | void>;
  onQueueEmployeeOrientationEmail?: (employee: any, grant: any) => void | Promise<void>;
  onCreateSinVaultRecord?: (draft: Record<string, unknown>) => Promise<string | void>;
  editorPanel?: ReactNode;
  editable?: boolean;
  viewMode?: "drawer" | "page";
}) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <GrantDossierStack
        grant={grant}
        documents={documents}
        reports={reports}
        committee={committee}
        owner={owner}
        account={account}
        employees={employees}
        employeeLinks={employeeLinks}
        secretVaultItems={secretVaultItems}
        onLinkEmployee={editable ? onLinkEmployee : undefined}
        onUnlinkEmployee={editable ? onUnlinkEmployee : undefined}
        onCreateEmployee={editable ? onCreateEmployee : undefined}
        onQueueEmployeeOrientationEmail={editable ? onQueueEmployeeOrientationEmail : undefined}
        onCreateSinVaultRecord={editable ? onCreateSinVaultRecord : undefined}
        editorPanel={editorPanel}
        layout="tabs"
      />
      {grant.restrictedPurpose && (
        <DossierSection title="Restricted Purpose">
          <div style={{ whiteSpace: "pre-wrap" }}>{grant.restrictedPurpose}</div>
        </DossierSection>
      )}
      {(grant.publicDescription || grant.applicationInstructions) && (
        <DossierSection title="Public Intake Copy">
          {grant.publicDescription && (
            <div style={{ marginBottom: grant.applicationInstructions ? 12 : 0 }}>
              <div className="stat__label">Public description</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{grant.publicDescription}</div>
            </div>
          )}
          {grant.applicationInstructions && (
            <div>
              <div className="stat__label">Application instructions</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{grant.applicationInstructions}</div>
            </div>
          )}
        </DossierSection>
      )}
    </div>
  );
}


export function GrantEditorForm({
  grantDraft,
  setGrantDraft,
  committees,
  users,
  accounts,
  documents,
  reports,
  accountById,
  layout = "drawer",
}: {
  grantDraft: any;
  setGrantDraft: (draft: any) => void;
  committees: any[];
  users: any[];
  accounts: any[];
  documents: any[];
  reports: any[];
  accountById: Map<string, any>;
  layout?: "drawer" | "page";
}) {
  if (layout === "page") {
    return (
      <GrantEditorPageLayout
        grantDraft={grantDraft}
        setGrantDraft={setGrantDraft}
        committees={committees}
        users={users}
        accounts={accounts}
        documents={documents}
        reports={reports}
        accountById={accountById}
      />
    );
  }
  return (
    <div>
      <InspectorNote title="Public intake">
        Turn on public applications only when the opportunity is actually open. Submitted requests will land in the intake queue above.
      </InspectorNote>
      <GrantDossierStack
        grant={grantDraft}
        documents={documents}
        reports={reports}
      />
      <Field label="Title"><input className="input" value={grantDraft.title} onChange={(e) => setGrantDraft({ ...grantDraft, title: e.target.value })} /></Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Funder"><input className="input" value={grantDraft.funder} onChange={(e) => setGrantDraft({ ...grantDraft, funder: e.target.value })} /></Field>
        <Field label="Program"><input className="input" value={grantDraft.program ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, program: e.target.value })} /></Field>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Opportunity type">
          <select className="input" value={grantDraft.opportunityType ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, opportunityType: e.target.value })}>
            <option value="">Unspecified</option>
            <option>Government</option>
            <option>Foundation</option>
            <option>Corporate</option>
            <option>Internal</option>
            <option>Other</option>
          </select>
        </Field>
        <Field label="Priority">
          <select className="input" value={grantDraft.priority ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, priority: e.target.value })}>
            <option value="">Unspecified</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
        </Field>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Fit score" hint="0 to 100"><input className="input" type="number" inputMode="numeric" min="0" max="100" step="1" value={grantDraft.fitScore ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, fitScore: e.target.value })} /></Field>
        <Field label="Opportunity URL"><input className="input" type="url" value={grantDraft.opportunityUrl ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, opportunityUrl: e.target.value })} /></Field>
      </div>
      <Field label="Next action"><input className="input" value={grantDraft.nextAction ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, nextAction: e.target.value })} /></Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Status">
          <select className="input" value={grantDraft.status} onChange={(e) => setGrantDraft({ ...grantDraft, status: e.target.value })}>
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
          <select className="input" value={grantDraft.committeeId ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, committeeId: e.target.value })}>
            <option value="">None</option>
            {committees.map((committee) => <option key={committee._id} value={committee._id}>{committee.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Requested" hint="Dollars"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={grantDraft.amountRequestedDollars ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, amountRequestedDollars: e.target.value })} /></Field>
        <Field label="Awarded" hint="Dollars"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={grantDraft.amountAwardedDollars ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, amountAwardedDollars: e.target.value })} /></Field>
      </div>
      <Field label="Restricted purpose"><MarkdownEditor rows={4} value={grantDraft.restrictedPurpose ?? ""} onChange={(markdown) => setGrantDraft({ ...grantDraft, restrictedPurpose: markdown })} /></Field>
      <GrantRequirementsEditor
        draft={grantDraft}
        documents={documents}
        onChange={setGrantDraft}
      />
      <label className="checkbox"><input type="checkbox" checked={!!grantDraft.allowPublicApplications} onChange={(e) => setGrantDraft({ ...grantDraft, allowPublicApplications: e.target.checked })} /> Accept public applications</label>
      <Field label="Public description"><MarkdownEditor rows={4} value={grantDraft.publicDescription ?? ""} onChange={(markdown) => setGrantDraft({ ...grantDraft, publicDescription: markdown })} /></Field>
      <Field label="Application instructions"><MarkdownEditor rows={4} value={grantDraft.applicationInstructions ?? ""} onChange={(markdown) => setGrantDraft({ ...grantDraft, applicationInstructions: markdown })} /></Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Application due"><input className="input" type="date" value={grantDraft.applicationDueDate ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, applicationDueDate: e.target.value })} /></Field>
        <Field label="Next report"><input className="input" type="date" value={grantDraft.nextReportDueAtISO ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, nextReportDueAtISO: e.target.value })} /></Field>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Start"><input className="input" type="date" value={grantDraft.startDate ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, startDate: e.target.value })} /></Field>
        <Field label="End"><input className="input" type="date" value={grantDraft.endDate ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, endDate: e.target.value })} /></Field>
      </div>
      <Field label="Board owner">
        <select className="input" value={grantDraft.boardOwnerUserId ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, boardOwnerUserId: e.target.value })}>
          <option value="">None</option>
          {users.map((user) => <option key={user._id} value={user._id}>{user.displayName}</option>)}
        </select>
      </Field>
      <Field label="Linked financial account">
        <select className="input" value={grantDraft.linkedFinancialAccountId ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, linkedFinancialAccountId: e.target.value })}>
          <option value="">None</option>
          {accounts.map((account) => <option key={account._id} value={account._id}>{account.name}</option>)}
        </select>
      </Field>
      {grantDraft.linkedFinancialAccountId && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Current linked balance: {money(accountById.get(String(grantDraft.linkedFinancialAccountId))?.balanceCents ?? 0)}
        </div>
      )}
      <SourceExternalIdsField
        value={grantDraft.sourceExternalIdsInput ?? ""}
        onChange={(sourceExternalIdsInput) => setGrantDraft({ ...grantDraft, sourceExternalIdsInput })}
      />
      <div className="row" style={{ gap: 12 }}>
        <Field label="Confidence">
          <select className="input" value={grantDraft.confidence ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, confidence: e.target.value })}>
            <option value="">Unspecified</option>
            <option>High</option>
            <option>Medium</option>
            <option>Review</option>
          </select>
        </Field>
        <Field label="Sensitivity">
          <select className="input" value={grantDraft.sensitivity ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, sensitivity: e.target.value })}>
            <option value="">Standard</option>
            <option value="restricted">Restricted</option>
          </select>
        </Field>
      </div>
      <Field label="Risk flags" hint="Comma-separated review markers.">
        <input className="input" value={grantDraft.riskFlagsInput ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, riskFlagsInput: e.target.value })} />
      </Field>
      <Field label="Source notes">
        <MarkdownEditor rows={3} value={grantDraft.sourceNotes ?? ""} onChange={(markdown) => setGrantDraft({ ...grantDraft, sourceNotes: markdown })} />
      </Field>
      <Field label="Notes"><MarkdownEditor rows={4} value={grantDraft.notes ?? ""} onChange={(markdown) => setGrantDraft({ ...grantDraft, notes: markdown })} /></Field>
    </div>
  );
}


export function GrantDossierStack({
  grant,
  documents,
  reports,
  committee,
  owner,
  account,
  employees = [],
  employeeLinks = [],
  secretVaultItems = [],
  onLinkEmployee,
  onUnlinkEmployee,
  onCreateEmployee,
  onQueueEmployeeOrientationEmail,
  onCreateSinVaultRecord,
  editorPanel,
  layout = "stack",
}: {
  grant: any;
  documents: any[];
  reports: any[];
  committee?: any;
  owner?: any;
  account?: any;
  employees?: any[];
  employeeLinks?: any[];
  secretVaultItems?: any[];
  onLinkEmployee?: (employeeId: string, patch?: Record<string, unknown>) => void | Promise<void>;
  onUnlinkEmployee?: (linkId: string) => void | Promise<void>;
  onCreateEmployee?: (draft: Record<string, unknown>) => Promise<string | void>;
  onQueueEmployeeOrientationEmail?: (employee: any, grant: any) => void | Promise<void>;
  onCreateSinVaultRecord?: (draft: Record<string, unknown>) => Promise<string | void>;
  editorPanel?: ReactNode;
  layout?: "stack" | "tabs" | "compact";
}) {
  const [activeTab, setActiveTab] = useState<GrantDossierTabId>("overview");
  useEffect(() => {
    const syncHashToTab = () => {
      if (window.location.hash === "#funded-employees") setActiveTab("people");
      if (editorPanel && window.location.hash.startsWith("#grant-edit-")) setActiveTab("edit");
    };
    syncHashToTab();
    window.addEventListener("hashchange", syncHashToTab);
    return () => window.removeEventListener("hashchange", syncHashToTab);
  }, [editorPanel]);
  const hasDossierData =
    !!(grant.id ?? grant._id) ||
    !!grant.confirmationCode ||
    asUseOfFunds(grant.useOfFunds).length > 0 ||
    asTimelineEvents(grant.timelineEvents).length > 0 ||
    asComplianceFlags(grant.complianceFlags).length > 0 ||
    asNextSteps(grant.nextSteps).length > 0 ||
    employeeLinks.some((link) => String(link.grantId) === String(grant._id ?? grant.id)) ||
    asContacts(grant.contacts).length > 0 ||
    asAnswerLibrary(grant.answerLibrary).length > 0 ||
    cleanStringList(grant.keyFacts).length > 0 ||
    cleanStringList(grant.sourceExternalIds).length > 0;

  if (!hasDossierData) return null;

  const fundedEmployeesPanel = (
    <GrantFundedEmployeesPanel
      grant={grant}
      employees={employees}
      employeeLinks={employeeLinks}
      secretVaultItems={secretVaultItems}
      onLinkEmployee={onLinkEmployee}
      onUnlinkEmployee={onUnlinkEmployee}
      onCreateEmployee={onCreateEmployee}
      onQueueEmployeeOrientationEmail={onQueueEmployeeOrientationEmail}
      onCreateSinVaultRecord={onCreateSinVaultRecord}
    />
  );
  const overviewPanels = (
    <>
      <GrantDossierSummary grant={grant} committee={committee} owner={owner} account={account} />
      <GrantNextStepsPanel grant={grant} />
      <GrantRequiredFormsPanel grant={grant} />
      <GrantOperationalWorkflowsPanel grant={grant} />
    </>
  );
  const timelinePanels = (
    <>
      <GrantProjectLifecyclePanel grant={grant} reports={reports} />
      <GrantDeadlineTimeline grant={grant} reports={reports} />
    </>
  );
  const financialPanels = (
    <>
      <GrantFundingDeltaPanel grant={grant} />
      <GrantUseOfFundsPanel grant={grant} />
    </>
  );
  const evidencePanels = (
    <>
      <GrantEvidencePacketMap grant={grant} documents={documents} />
      <GrantComplianceFlagsPanel grant={grant} />
      <GrantContactsPanel grant={grant} />
      <GrantAnswerLibraryPanel grant={grant} />
    </>
  );
  const sourcePanels = <GrantSourceNotesPanel grant={grant} />;

  if (layout === "compact") {
    return (
      <div className="grant-dossier-stack grant-dossier-stack--compact">
        <GrantDossierSummary grant={grant} committee={committee} owner={owner} account={account} />
        <GrantNextStepsPanel grant={grant} />
        <GrantProjectLifecyclePanel grant={grant} reports={reports} compact />
        <GrantFundingDeltaPanel grant={grant} />
        <GrantOperationalWorkflowsPanel grant={grant} />
        <GrantSourceNotesPanel grant={grant} />
      </div>
    );
  }

  if (layout === "tabs") {
    const tabs: Array<{ id: GrantDossierTabId; label: string; count?: number }> = [
      { id: "overview", label: "Overview", count: asNextSteps(grant.nextSteps).length },
      { id: "timeline", label: "Timeline", count: buildGrantTimeline(grant, reports).length },
      { id: "people", label: "People", count: employeeLinks.filter((link) => String(link.grantId) === String(grant._id ?? grant.id)).length },
      { id: "evidence", label: "Evidence", count: grantRelatedDocuments(grant, documents).length },
      { id: "financials", label: "Financials", count: asUseOfFunds(grant.useOfFunds).length },
      { id: "source", label: "Source", count: cleanSourceKeyFacts(grant.keyFacts).length },
      ...(editorPanel ? [{ id: "edit" as const, label: "Edit" }] : []),
    ];
    const renderTab = () => {
      if (activeTab === "timeline") return timelinePanels;
      if (activeTab === "people") return fundedEmployeesPanel;
      if (activeTab === "evidence") return evidencePanels;
      if (activeTab === "financials") return financialPanels;
      if (activeTab === "source") return sourcePanels;
      if (activeTab === "edit" && editorPanel) return editorPanel;
      return overviewPanels;
    };

    return (
      <div className="grant-dossier-tabs">
        <div className="tabs grant-dossier-tabs__nav" role="tablist" aria-label="Grant sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "tab is-active" : "tab"}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="tab__label">{tab.label}</span>
              {tab.count ? <Badge tone="neutral">{tab.count}</Badge> : null}
            </button>
          ))}
        </div>
        <div className="grant-dossier-stack">{renderTab()}</div>
      </div>
    );
  }

  return (
    <div className="grant-dossier-stack">
      {overviewPanels}
      {fundedEmployeesPanel}
      {financialPanels}
      {evidencePanels}
      {timelinePanels}
      {sourcePanels}
    </div>
  );
}

