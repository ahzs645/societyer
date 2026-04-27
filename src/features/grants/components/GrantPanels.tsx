import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink, ListChecks, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, Field, InspectorNote } from "../../../components/ui";
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
  mergeTemplateRequirements,
  optionalString,
  requirementStatusTone,
  requirementSummary,
} from "../lib/grantDrafts";

const EMP5616_DETAIL_URL = "https://catalogue.servicecanada.gc.ca/content/EForms/en/Detail.html?Form=EMP5616";
const EMP5616_FORM_URL = "https://catalogue.servicecanada.gc.ca/content/EForms/en/CallForm.html?Lang=en&PDF=ESDC-EMP5616.pdf";
const GCOS_EED_ADD_URL = "https://srv136.services.gc.ca/OSR/pro/EED/EED/Add";
const GCOS_EED_MANAGE_URL = "https://srv136.services.gc.ca/OSR/pro/EED";

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
}) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <GrantDossierStack
        grant={grant}
        documents={documents}
        reports={reports}
        employees={employees}
        employeeLinks={employeeLinks}
        secretVaultItems={secretVaultItems}
        onLinkEmployee={onLinkEmployee}
        onUnlinkEmployee={onUnlinkEmployee}
        onCreateEmployee={onCreateEmployee}
        onQueueEmployeeOrientationEmail={onQueueEmployeeOrientationEmail}
      />
      <DossierSection title="Administrative Details">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: 8 }}>
          <DossierFact label="Status">
            <Badge tone={grantStatusTone(grant.status)}>{grant.status ?? "Not set"}</Badge>
          </DossierFact>
          <DossierFact label="Opportunity type" value={grant.opportunityType} />
          <DossierFact label="Priority" value={grant.priority} />
          <DossierFact label="Fit score" value={grant.fitScore == null ? undefined : `${grant.fitScore}/100`} />
          <DossierFact label="Committee" value={committee?.name} />
          <DossierFact label="Board owner" value={owner?.displayName} />
          <DossierFact label="Requested" value={grant.amountRequestedCents == null ? undefined : money(grant.amountRequestedCents)} />
          <DossierFact label="Awarded" value={grant.amountAwardedCents == null ? undefined : money(grant.amountAwardedCents)} />
          <DossierFact label="Application due" value={grant.applicationDueDate ? formatDate(grant.applicationDueDate) : undefined} />
          <DossierFact label="Submitted" value={grant.submittedAtISO ? formatDate(grant.submittedAtISO) : undefined} />
          <DossierFact label="Decision" value={grant.decisionAtISO ? formatDate(grant.decisionAtISO) : undefined} />
          <DossierFact label="Next report" value={grant.nextReportDueAtISO ? formatDate(grant.nextReportDueAtISO) : undefined} />
          <DossierFact label="Project start" value={grant.startDate ? formatDate(grant.startDate) : undefined} />
          <DossierFact label="Project end" value={grant.endDate ? formatDate(grant.endDate) : undefined} />
          <DossierFact label="Public intake">
            <Badge tone={grant.allowPublicApplications ? "success" : "info"}>{grant.allowPublicApplications ? "Open" : "Internal"}</Badge>
          </DossierFact>
          <DossierFact label="Linked account" value={account ? `${account.name} · ${money(account.balanceCents ?? 0)}` : undefined} />
        </div>
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
      {grant.notes && (
        <DossierSection title="Notes">
          <div style={{ whiteSpace: "pre-wrap" }}>{grant.notes}</div>
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
      <Field label="Restricted purpose"><textarea className="textarea" value={grantDraft.restrictedPurpose ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, restrictedPurpose: e.target.value })} /></Field>
      <GrantRequirementsEditor
        draft={grantDraft}
        documents={documents}
        onChange={setGrantDraft}
      />
      <label className="checkbox"><input type="checkbox" checked={!!grantDraft.allowPublicApplications} onChange={(e) => setGrantDraft({ ...grantDraft, allowPublicApplications: e.target.checked })} /> Accept public applications</label>
      <Field label="Public description"><textarea className="textarea" rows={4} value={grantDraft.publicDescription ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, publicDescription: e.target.value })} /></Field>
      <Field label="Application instructions"><textarea className="textarea" rows={4} value={grantDraft.applicationInstructions ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, applicationInstructions: e.target.value })} /></Field>
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
      <Field label="Source external IDs" hint="Comma-separated Paperless, local, or external IDs used for provenance.">
        <input className="input" value={grantDraft.sourceExternalIdsInput ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, sourceExternalIdsInput: e.target.value })} />
      </Field>
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
        <textarea className="textarea" rows={3} value={grantDraft.sourceNotes ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, sourceNotes: e.target.value })} />
      </Field>
      <Field label="Notes"><textarea className="textarea" value={grantDraft.notes ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, notes: e.target.value })} /></Field>
    </div>
  );
}

function EditSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="grant-edit-section">
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
        <EditSection title="Overview" description="Funder, program, and high-level positioning.">
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

        <EditSection title="Status & amounts" description="Pipeline stage, committee, and the money that goes with it.">
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
            <textarea className="textarea" value={grantDraft.restrictedPurpose ?? ""} onChange={(e) => update({ restrictedPurpose: e.target.value })} />
          </Field>
        </EditSection>

        <EditSection title="Readiness checklist" description="Documents, financials, confirmations, and post-award obligations.">
          <GrantRequirementsEditor
            draft={grantDraft}
            documents={documents}
            onChange={setGrantDraft}
          />
        </EditSection>

        <EditSection title="Public intake" description="Only enable when the opportunity is open to outside applicants.">
          <label className="checkbox">
            <input type="checkbox" checked={!!grantDraft.allowPublicApplications} onChange={(e) => update({ allowPublicApplications: e.target.checked })} /> Accept public applications
          </label>
          <Field label="Public description">
            <textarea className="textarea" rows={4} value={grantDraft.publicDescription ?? ""} onChange={(e) => update({ publicDescription: e.target.value })} />
          </Field>
          <Field label="Application instructions">
            <textarea className="textarea" rows={4} value={grantDraft.applicationInstructions ?? ""} onChange={(e) => update({ applicationInstructions: e.target.value })} />
          </Field>
        </EditSection>

        <EditSection title="Timeline & ownership" description="Deadlines, project window, and who's accountable.">
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

        <EditSection title="Provenance & notes" description="Import IDs, review markers, and free-form notes.">
          <Field label="Source external IDs" hint="Comma-separated Paperless, local, or external IDs used for provenance.">
            <input className="input" value={grantDraft.sourceExternalIdsInput ?? ""} onChange={(e) => update({ sourceExternalIdsInput: e.target.value })} />
          </Field>
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
            <textarea className="textarea" rows={3} value={grantDraft.sourceNotes ?? ""} onChange={(e) => update({ sourceNotes: e.target.value })} />
          </Field>
          <Field label="Notes">
            <textarea className="textarea" value={grantDraft.notes ?? ""} onChange={(e) => update({ notes: e.target.value })} />
          </Field>
        </EditSection>
      </div>

      <aside className="grant-edit-layout__aside">
        <div className="grant-edit-layout__aside-inner">
          <div className="grant-edit-aside__label">Reference dossier</div>
          <GrantDossierStack
            grant={grantDraft}
            documents={documents}
            reports={reports}
          />
        </div>
      </aside>
    </div>
  );
}

export function GrantDossierStack({
  grant,
  documents,
  reports,
  employees = [],
  employeeLinks = [],
  secretVaultItems = [],
  onLinkEmployee,
  onUnlinkEmployee,
  onCreateEmployee,
  onQueueEmployeeOrientationEmail,
}: {
  grant: any;
  documents: any[];
  reports: any[];
  employees?: any[];
  employeeLinks?: any[];
  secretVaultItems?: any[];
  onLinkEmployee?: (employeeId: string, patch?: Record<string, unknown>) => void | Promise<void>;
  onUnlinkEmployee?: (linkId: string) => void | Promise<void>;
  onCreateEmployee?: (draft: Record<string, unknown>) => Promise<string | void>;
  onQueueEmployeeOrientationEmail?: (employee: any, grant: any) => void | Promise<void>;
}) {
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

  return (
    <div style={{ display: "grid", gap: 12, margin: "0 0 16px" }}>
      <GrantDossierSummary grant={grant} />
      <GrantNextStepsPanel grant={grant} />
      <GrantRequiredFormsPanel grant={grant} />
      <GrantOperationalWorkflowsPanel grant={grant} />
      <GrantFundedEmployeesPanel
        grant={grant}
        employees={employees}
        employeeLinks={employeeLinks}
        secretVaultItems={secretVaultItems}
        onLinkEmployee={onLinkEmployee}
        onUnlinkEmployee={onUnlinkEmployee}
        onCreateEmployee={onCreateEmployee}
        onQueueEmployeeOrientationEmail={onQueueEmployeeOrientationEmail}
      />
      <GrantFundingDeltaPanel grant={grant} />
      <GrantEvidencePacketMap grant={grant} documents={documents} />
      <GrantDeadlineTimeline grant={grant} reports={reports} />
      <GrantUseOfFundsPanel grant={grant} />
      <GrantComplianceFlagsPanel grant={grant} />
      <GrantContactsPanel grant={grant} />
      <GrantAnswerLibraryPanel grant={grant} />
      <GrantSourceNotesPanel grant={grant} />
    </div>
  );
}

function GrantDossierSummary({ grant }: { grant: any }) {
  const readiness = requirementSummary(grant.requirements);
  const keyDates = [
    grant.applicationDueDate ? `Due ${formatDate(grant.applicationDueDate)}` : undefined,
    grant.submittedAtISO ? `Submitted ${formatDate(grant.submittedAtISO)}` : undefined,
    grant.startDate ? `Starts ${formatDate(grant.startDate)}` : undefined,
    grant.endDate ? `Ends ${formatDate(grant.endDate)}` : undefined,
    grant.nextReportDueAtISO ? `Report ${formatDate(grant.nextReportDueAtISO)}` : undefined,
  ].filter(Boolean);

  return (
    <DossierSection title="Grant Dossier Summary">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: 8 }}>
        <DossierFact label="Funder" value={grant.funder ?? grant.funderName} />
        <DossierFact label="Program" value={grant.program} />
        <DossierFact label="Requested" value={grant.amountRequestedCents ? money(grant.amountRequestedCents) : undefined} />
        <DossierFact label="Submitted" value={grant.submittedAtISO ? formatDate(grant.submittedAtISO) : undefined} />
        <DossierFact label="Confirmation" value={grant.confirmationCode} />
        <DossierFact label="Status">
          <Badge tone={grantStatusTone(grant.status)}>{grant.status ?? "Not set"}</Badge>
        </DossierFact>
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
        <DossierFact label="Key dates" value={keyDates.length ? keyDates.join(" · ") : undefined} />
      </div>
      {grant.nextAction && (
        <div style={{ marginTop: 10 }}>
          <div className="stat__label">Next action</div>
          <div>{grant.nextAction}</div>
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
}: {
  grant: any;
  employees: any[];
  employeeLinks: any[];
  secretVaultItems?: any[];
  onLinkEmployee?: (employeeId: string, patch?: Record<string, unknown>) => void | Promise<void>;
  onUnlinkEmployee?: (linkId: string) => void | Promise<void>;
  onCreateEmployee?: (draft: Record<string, unknown>) => Promise<string | void>;
  onQueueEmployeeOrientationEmail?: (employee: any, grant: any) => void | Promise<void>;
}) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [showNewEmployee, setShowNewEmployee] = useState(false);
  const [employeeDraft, setEmployeeDraft] = useState(() => defaultGrantEmployeeDraft(grant));
  const grantId = String(grant._id ?? grant.id ?? "");
  const grantAssignmentKey = grantFundedAssignmentKey(grant);
  const links = employeeLinks.filter((link) => String(link.grantId) === grantId);
  const linkedEmployeeIds = new Set(links.map((link) => String(link.employeeId)));
  const availableEmployees = employees.filter((employee) => !linkedEmployeeIds.has(String(employee._id)));
  const approvedParticipants = findKeyFactNumber(grant.keyFacts, /approved participants:\s*(\d+(?:\.\d+)?)/i);
  const remaining = approvedParticipants === undefined ? undefined : Math.max(0, approvedParticipants - links.length);
  const lockedAssignment = grantFundedAssignment(grant);

  useEffect(() => {
    setEmployeeDraft((current) => ({
      ...current,
      role: lockedAssignment.role ?? current.role,
      employmentType: lockedAssignment.employmentType ?? current.employmentType,
      hoursPerWeek: lockedAssignment.hoursPerWeek ?? current.hoursPerWeek,
      hourlyWageDollars: lockedAssignment.hourlyWageDollars ?? current.hourlyWageDollars,
    }));
  }, [grantAssignmentKey]);

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
      setShowNewEmployee(false);
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
        {onLinkEmployee && availableEmployees.length > 0 && (
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
        {onCreateEmployee && onLinkEmployee && (
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
                <Field label="Home address line 1"><input className="input" value={employeeDraft.addressLine1} onChange={(event) => setEmployeeDraft({ ...employeeDraft, addressLine1: event.target.value })} /></Field>
                <Field label="Home address line 2"><input className="input" value={employeeDraft.addressLine2} onChange={(event) => setEmployeeDraft({ ...employeeDraft, addressLine2: event.target.value })} /></Field>
                <div className="row" style={{ gap: 8 }}>
                  <Field label="City"><input className="input" value={employeeDraft.city} onChange={(event) => setEmployeeDraft({ ...employeeDraft, city: event.target.value })} /></Field>
                  <Field label="Province"><input className="input" value={employeeDraft.province} onChange={(event) => setEmployeeDraft({ ...employeeDraft, province: event.target.value })} /></Field>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <Field label="Postal code"><input className="input" value={employeeDraft.postalCode} onChange={(event) => setEmployeeDraft({ ...employeeDraft, postalCode: event.target.value })} /></Field>
                  <Field label="Country"><input className="input" value={employeeDraft.country} onChange={(event) => setEmployeeDraft({ ...employeeDraft, country: event.target.value })} /></Field>
                </div>
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
                <div className="muted" style={{ fontSize: 12 }}>
                  Need a SIN vault record? Add it in <Link to="/app/secrets">Secrets</Link>, then return here and select it.
                </div>
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
                  <Field label="Start"><input className="input" type="date" value={employeeDraft.startDate} onChange={(event) => setEmployeeDraft({ ...employeeDraft, startDate: event.target.value })} /></Field>
                  <Field label="End"><input className="input" type="date" value={employeeDraft.endDate} onChange={(event) => setEmployeeDraft({ ...employeeDraft, endDate: event.target.value })} /></Field>
                </div>
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
            <a className="btn btn--accent btn--sm" href="#funded-employees">Queue for employee</a>
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
  const actions: Array<{ label: string; href: string; external?: boolean; primary?: boolean }> = [];

  if (step.id === "gcos-prepare-eed") {
    const emp5616 = findRequirementById(grant.requirements, "gcos-emp5616-consent");
    actions.push(
      { label: "Link employees", href: "#funded-employees", primary: true },
      { label: "Open EMP5616", href: emp5616?.documentUrl ?? EMP5616_FORM_URL, external: true },
      { label: "Add EED in GCOS", href: step.actionUrl ?? GCOS_EED_ADD_URL, external: true },
      { label: "Track checklist", href: editHref },
    );
    actions.push({ label: "View EED list", href: GCOS_EED_MANAGE_URL, external: true });
  } else if (step.id === "gcos-complete-emp5616") {
    actions.push({ label: step.actionLabel ?? "Open EMP5616", href: step.actionUrl ?? EMP5616_FORM_URL, external: true, primary: true });
    actions.push(
      { label: "Link employee record", href: "#funded-employees" },
      { label: "Mark consent retained", href: editHref },
    );
  } else if (step.id === "gcos-review-award-delta") {
    actions.push(
      { label: "Review funding delta", href: editHref, primary: true },
      { label: "Update budget notes", href: editHref },
    );
  } else if (step.id === "gcos-plan-payment-claim") {
    actions.push(
      { label: "Create reporting plan", href: editHref, primary: true },
      { label: "Review evidence checklist", href: editHref },
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
    endDate: grant.endDate ?? "",
    hoursPerWeek: assignment.hoursPerWeek ?? "35",
    hourlyWageDollars: assignment.hourlyWageDollars ?? "",
  };
}

function grantFundedAssignment(grant: any) {
  const role = approvedJobTitle(grant);
  const isCanadaSummerJobs = /canada summer jobs|csj/i.test(`${grant.program ?? ""} ${cleanStringList(grant.keyFacts).join(" ")}`);
  return {
    role,
    employmentType: isCanadaSummerJobs ? "FullTime" : undefined,
    hoursPerWeek: grantHoursPerWeek(grant) ?? (isCanadaSummerJobs ? "35" : undefined),
    hourlyWageDollars: grantHourlyWageDollars(grant),
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
  return (
    <div style={factBoxStyle}>
      <div className="stat__label">{label}</div>
      <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{children ?? value ?? "—"}</div>
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
    <div style={{ display: "grid", gap: 12, margin: "12px 0" }}>
      <InspectorNote title="Readiness checklist">
        Track the documents, financials, confirmations, and post-award obligations that make a grant file auditable.
      </InspectorNote>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Badge tone={summary.percent === 100 && summary.total > 0 ? "success" : "info"}>
          {summary.total > 0 ? `${summary.percent}% ready` : "No checklist"}
        </Badge>
        <Badge tone="info">{summary.attached} docs linked</Badge>
        {(Object.keys(GRANT_REQUIREMENT_TEMPLATES) as RequirementTemplateKey[]).map((key) => (
          <button
            key={key}
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setRequirements(mergeTemplateRequirements(requirements, key))}
          >
            <ListChecks size={12} /> {GRANT_REQUIREMENT_TEMPLATES[key].label}
          </button>
        ))}
        <button
          type="button"
          className="btn btn--ghost btn--sm"
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
          <Plus size={12} /> Add item
        </button>
      </div>

      {requirements.length > 0 && (
        <div style={{ display: "grid", gap: 10 }}>
          {requirements.map((item, index) => (
            <div
              key={item.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--r-sm)",
                padding: 12,
                background: "var(--bg-base)",
              }}
            >
              <div className="row" style={{ justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                <Badge tone={requirementStatusTone(item.status)}>{item.status}</Badge>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Remove requirement ${item.label}`}
                  onClick={() => setRequirements(requirements.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="row" style={{ gap: 12 }}>
                <Field label="Status">
                  <select
                    className="input"
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
                </Field>
                <Field label="Category">
                  <input
                    className="input"
                    value={item.category}
                    onChange={(event) => updateRequirement(index, { category: event.target.value })}
                  />
                </Field>
              </div>
              <Field label="Requirement">
                <input
                  className="input"
                  value={item.label}
                  onChange={(event) => updateRequirement(index, { label: event.target.value })}
                />
              </Field>
              <div className="row" style={{ gap: 12 }}>
                <Field label="Due">
                  <input
                    className="input"
                    type="date"
                    value={item.dueDate ?? ""}
                    onChange={(event) => updateRequirement(index, { dueDate: event.target.value || undefined })}
                  />
                </Field>
                <Field label="Document">
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
                </Field>
              </div>
              <Field label="Notes">
                <textarea
                  className="textarea"
                  rows={2}
                  value={item.notes ?? ""}
                  onChange={(event) => updateRequirement(index, { notes: event.target.value })}
                />
              </Field>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
