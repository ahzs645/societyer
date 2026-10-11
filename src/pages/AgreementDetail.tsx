import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, FileSignature, FileText, GitBranch, Pencil, RefreshCcw, Trash2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../convex/_generated/dataModel";
import { useRecordQuery } from "../hooks/useRecordQuery";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Field } from "../components/ui";
import { Modal, useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { RecordNotFound } from "../components/RecordNotFound";
import { UnsupportedDetailsBadge } from "../components/UnsupportedDetailsBadge";
import { SourceProvenanceButton } from "../components/SourceProvenanceButton";
import { MoreActionsMenu } from "../components/MoreActionsMenu";
import { dollarInputToCents, formatDate, money, relative } from "../lib/format";
import { todayDateOnly } from "../../shared/dateOnly";
import {
  AGREEMENT_KIND_LABELS,
  AGREEMENT_STATUS_LABELS,
  DELIVERABLE_STATUSES,
  DELIVERABLE_STATUS_LABELS,
  PARTY_ROLE_LABELS,
  RENEWAL_DECISIONS,
  RENEWAL_DECISION_LABELS,
  REPORTING_RECURRENCE_LABELS,
  type AgreementKind,
  type AgreementStatus,
  type PartyRole,
  type RenewalDecision,
  type ReportingRecurrence,
} from "../../shared/agreements";
import { AgreementFormDrawer, agreementToForm, formToPayload, type AgreementFormValue } from "../features/agreements/AgreementFormDrawer";
import { agreementStatusTone } from "./Agreements";

function Rows({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="agreement-detail__rows">
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: "contents" }}>
          <dt>{label}</dt>
          <dd>{value === undefined || value === null || value === "" ? <span className="muted">Not recorded</span> : value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AgreementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const society = useSociety();
  const { can } = usePermissions();
  const canWrite = can("agreements:write");
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const data = useRecordQuery<any>(api.agreements.get, id ? { id: id as Id<"agreements"> } : "skip");
  const update = usePermissionedMutation(api.agreements.update, canWrite);
  const terminate = usePermissionedMutation(api.agreements.terminate, canWrite);
  const renew = usePermissionedMutation(api.agreements.renew, canWrite);
  const remove = usePermissionedMutation(api.agreements.remove, canWrite);
  const setDecision = usePermissionedMutation(api.agreements.setRenewalDecision, canWrite);
  const setObligation = usePermissionedMutation(api.agreements.setObligationStatus, canWrite);
  const syncObligations = usePermissionedMutation(api.agreements.syncObligations, canWrite);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState("");
  const [renewForm, setRenewForm] = useState<null | { mode: "renew" | "supersede"; title: string; effectiveDate: string; endDate: string; valueDollars: string; carry: boolean; error?: string }>(null);
  const [terminateForm, setTerminateForm] = useState<null | { date: string; reason: string; error?: string }>(null);
  const initialForm = useMemo(() => (data?.agreement ? agreementToForm(data.agreement) : null), [data?.agreement]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;
  if (data === undefined) return <PageLoading />;
  if (data === null) return <RecordNotFound recordLabel="Agreement" backTo="/app/agreements" backLabel="All agreements" icon={<FileSignature size={18} />} />;

  const agreement = data.agreement;
  const status = agreement.effectiveStatus as AgreementStatus;
  const closed = ["terminated", "superseded"].includes(status);
  const signing = agreement.signing;

  const run = async (label: string, action: () => Promise<unknown>) => {
    try {
      await action();
      toast.success(label);
    } catch (error) {
      toast.error("Could not save", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const saveEdit = async (form: AgreementFormValue) => {
    setSaving(true);
    setServerError("");
    try {
      const { payload, cleared } = formToPayload(form);
      await update({ id: agreement._id, patch: payload, clear: cleared } as any);
      toast.success("Agreement saved");
      setEditing(false);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Could not save the agreement.");
    } finally {
      setSaving(false);
    }
  };

  const openDeadlines = (data.deadlines ?? []).filter((row: any) => (row.status ?? (row.done ? "complete" : "open")) === "open");

  const deleteAgreement = async () => {
    const ok = await confirm({
      title: `Delete "${agreement.title}"?`,
      message: `The agreement record, its ${openDeadlines.length} open generated deadline${openDeadlines.length === 1 ? "" : "s"} and its links to the version chain are removed. Completed deadlines and source documents are kept${agreement.representationGapIds?.length ? "; the system gaps it resolved reopen" : ""}. To end an agreement that was in force, terminate it instead.`,
      confirmLabel: "Delete agreement",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await remove({ id: agreement._id });
      toast.success("Agreement deleted");
      navigate("/app/agreements");
    } catch (error) {
      toast.error("Could not delete", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const submitTerminate = async () => {
    if (!terminateForm) return;
    if (!terminateForm.date || !terminateForm.reason.trim()) { setTerminateForm({ ...terminateForm, error: "Give the termination date and the reason." }); return; }
    const ok = await confirm({
      title: "Terminate this agreement?",
      message: `"${agreement.title}" becomes terminated on ${formatDate(terminateForm.date)}. Its ${openDeadlines.length} open deadline${openDeadlines.length === 1 ? "" : "s"} are removed and no further obligations are tracked. This is recorded in the agreement's history.`,
      confirmLabel: "Terminate",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await terminate({ id: agreement._id, terminatedAtISO: terminateForm.date, reason: terminateForm.reason.trim() });
      toast.success("Agreement terminated");
      setTerminateForm(null);
    } catch (error) {
      setTerminateForm({ ...terminateForm, error: error instanceof Error ? error.message : "Could not terminate." });
    }
  };

  const submitRenew = async () => {
    if (!renewForm) return;
    if (renewForm.effectiveDate && renewForm.endDate && renewForm.endDate < renewForm.effectiveDate) { setRenewForm({ ...renewForm, error: "The end date must be on or after the effective date." }); return; }
    const cents = renewForm.valueDollars.trim() ? dollarInputToCents(renewForm.valueDollars) : undefined;
    if (renewForm.valueDollars.trim() && (cents === undefined || cents < 0)) { setRenewForm({ ...renewForm, error: "Enter a value of zero or more." }); return; }
    if (renewForm.mode === "supersede") {
      const ok = await confirm({
        title: "Replace this agreement?",
        message: `"${agreement.title}" becomes superseded now and its ${openDeadlines.length} open deadline${openDeadlines.length === 1 ? "" : "s"} are removed. The replacement starts as a draft.`,
        confirmLabel: "Create replacement",
        tone: "warn",
      });
      if (!ok) return;
    }
    try {
      const newId = await renew({
        id: agreement._id, mode: renewForm.mode, title: renewForm.title.trim() || undefined,
        ...(renewForm.effectiveDate ? { effectiveDate: renewForm.effectiveDate } : {}), ...(renewForm.endDate ? { endDate: renewForm.endDate } : {}),
        ...(cents !== undefined ? { valueCents: cents } : {}), carryObligations: renewForm.carry,
      });
      toast.success(renewForm.mode === "renew" ? "Renewal created as a draft" : "Replacement created as a draft");
      setRenewForm(null);
      navigate(`/app/agreements/${newId}`);
    } catch (error) {
      setRenewForm({ ...renewForm, error: error instanceof Error ? error.message : "Could not create the new version." });
    }
  };

  const decision = (agreement.renewalDecision?.decision ?? "undecided") as RenewalDecision;
  const obligations = (list: "deliverables" | "reportingObligations") => (agreement[list] ?? []) as any[];
  const today = todayDateOnly();

  return (
    <div className="page">
      <Link to="/app/agreements" className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
        <ArrowLeft size={12} /> All agreements
      </Link>
      <PageHeader
        title={agreement.title}
        icon={<FileSignature size={16} />}
        iconColor="turquoise"
        subtitle={[AGREEMENT_KIND_LABELS[agreement.kind as AgreementKind] ?? agreement.kind, (agreement.counterparties ?? []).join("; "), agreement.agreementNumber].filter(Boolean).join(" · ")}
        actions={
          <>
            <UnsupportedDetailsBadge table="agreements" id={agreement._id} />
            <SourceProvenanceButton table="agreements" id={agreement._id} />
            <MoreActionsMenu
              items={[
                ...(canWrite && agreement.reviewStatus === "NeedsReview"
                  ? [{ id: "reviewed", label: "Mark reviewed", icon: <CheckCircle2 size={14} />, onSelect: () => { void run("Marked as reviewed", () => update({ id: agreement._id, patch: { reviewStatus: "Verified" } })); } }]
                  : []),
                { id: "renew", label: "Renew", icon: <RefreshCcw size={14} />, disabled: !canWrite || closed, onSelect: () => setRenewForm({ mode: "renew", title: agreement.title, effectiveDate: agreement.currentTermEnd ?? agreement.endDate ?? "", endDate: "", valueDollars: "", carry: true }) },
                { id: "replace", label: "Replace", icon: <GitBranch size={14} />, disabled: !canWrite || closed, onSelect: () => setRenewForm({ mode: "supersede", title: agreement.title, effectiveDate: today, endDate: "", valueDollars: "", carry: true }) },
                { id: "terminate", label: "Terminate", icon: <Ban size={14} />, disabled: !canWrite || closed, onSelect: () => setTerminateForm({ date: today, reason: "" }) },
                { id: "delete", label: "Delete agreement", icon: <Trash2 size={14} />, destructive: true, disabled: !canWrite, onSelect: () => { void deleteAgreement(); } },
              ]}
            />
            <button type="button" className="btn-action btn-action--primary" disabled={!canWrite} onClick={() => { setServerError(""); setEditing(true); }}><Pencil size={12} /> Edit</button>
          </>
        }
      />
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: -4, marginBottom: 12 }}>
        <Badge tone={agreementStatusTone(status)}>{AGREEMENT_STATUS_LABELS[status] ?? status}</Badge>
        {agreement.reviewStatus === "NeedsReview" && <Badge tone="warn">Needs review</Badge>}
        {agreement.confidential && <Badge tone="neutral">Confidential</Badge>}
      </div>

      {signing?.status === "warning" && (
        <div className="banner banner--warn" role="alert" style={{ marginBottom: 12 }}>
          <AlertTriangle size={14} aria-hidden="true" />
          <div>
            <strong>Signing authority not satisfied</strong>
            {signing.tier && <span className="muted"> — tier: {signing.tier.notes ?? `${signing.tier.signaturesRequired} signature(s)`}</span>}
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{signing.issues.map((issue: string) => <li key={issue}>{issue}</li>)}</ul>
          </div>
        </div>
      )}
      {agreement.reviewStatus === "NeedsReview" && agreement.notes && (
        <div className="banner banner--info" role="status" style={{ marginBottom: 12 }}>
          <FileText size={14} aria-hidden="true" />
          <div style={{ whiteSpace: "pre-wrap" }}>{agreement.notes}</div>
        </div>
      )}

      <div className="agreement-detail__grid">
        <section className="card" aria-labelledby="agreement-parties">
          <div className="card__head"><h2 className="card__title" id="agreement-parties">Parties</h2></div>
          <div className="card__body col" style={{ gap: 10 }}>
            {!(agreement.parties ?? []).length && <div className="muted">No parties recorded. Edit the agreement to add the counterparty.</div>}
            {(agreement.parties ?? []).map((party: any, index: number) => (
              <div key={index} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <strong>{party.name}</strong>
                <Badge tone={party.role === "us" ? "info" : "neutral"}>{PARTY_ROLE_LABELS[party.role as PartyRole] ?? party.role}</Badge>
                {party.contact && <span className="muted">{party.contact}</span>}
              </div>
            ))}
            <Rows rows={[
              ["Our signatories", (agreement.ourSignatories ?? []).map((row: any) => [row.name, row.title].filter(Boolean).join(", ")).join("; ")],
              ["Their signatories", (agreement.counterpartySignatories ?? []).map((row: any) => [row.name, row.title].filter(Boolean).join(", ")).join("; ")],
              ["Signed", agreement.signedDate ? formatDate(agreement.signedDate) : ""],
              ["Signing authority", signing ? (signing.status === "ok" ? <Badge tone="success">Satisfied{signing.tier ? ` (${signing.signaturesRequired} required)` : ""}</Badge> : signing.status === "warning" ? <Badge tone="warn">Not satisfied</Badge> : <span className="muted">{signing.status === "no_tiers" ? "No signing tiers on record" : "No value to check"}</span>) : <span className="muted">Not visible to you</span>],
            ]} />
          </div>
        </section>

        <section className="card" aria-labelledby="agreement-term">
          <div className="card__head"><h2 className="card__title" id="agreement-term">Term and renewal</h2></div>
          <div className="card__body col" style={{ gap: 10 }}>
            <Rows rows={[
              ["Effective", agreement.effectiveDate ? formatDate(agreement.effectiveDate) : ""],
              ["Ends", agreement.endDate ? `${formatDate(agreement.endDate)}${agreement.currentTermEnd && agreement.currentTermEnd !== agreement.endDate ? ` (current term to ${formatDate(agreement.currentTermEnd)})` : ""}` : ""],
              ["Renewal", agreement.autoRenew ? `Renews automatically${agreement.renewalTermMonths ? ` for ${agreement.renewalTermMonths} months` : ""}` : "Does not renew automatically"],
              ["Renewal notice", agreement.renewalNoticeDays !== undefined ? `${agreement.renewalNoticeDays} days before the end${agreement.renewalNoticeDate ? ` (by ${formatDate(agreement.renewalNoticeDate)}, ${relative(agreement.renewalNoticeDate)})` : ""}` : ""],
              ["Termination notice", agreement.terminationNoticeDays !== undefined ? `${agreement.terminationNoticeDays} days` : ""],
              ["Termination terms", agreement.terminationTerms],
              ...(status === "terminated" ? [["Terminated", `${formatDate(agreement.terminatedAtISO)}${agreement.terminationReason ? ` — ${agreement.terminationReason}` : ""}`] as [string, string]] : []),
              ["Governing law", agreement.governingLaw],
            ]} />
            <Field label="Renewal decision" hint={agreement.renewalDecision?.decidedAtISO ? `Recorded ${formatDate(agreement.renewalDecision.decidedAtISO)}` : "Record the decision before the notice date"}>
              <Select
                value={decision}
                onChange={(value) => run("Renewal decision saved", () => setDecision({ id: agreement._id, decision: value }))}
                options={RENEWAL_DECISIONS.map((value) => ({ value, label: RENEWAL_DECISION_LABELS[value] }))}
                disabled={!canWrite || closed}
                aria-label="Renewal decision"
              />
            </Field>
          </div>
        </section>

        <section className="card" aria-labelledby="agreement-money">
          <div className="card__head"><h2 className="card__title" id="agreement-money">Money</h2></div>
          <div className="card__body col" style={{ gap: 10 }}>
            <Rows rows={[
              ["Value", agreement.valueCents !== undefined ? `${money(agreement.valueCents)}${agreement.currency && agreement.currency !== "CAD" ? ` ${agreement.currency}` : ""}` : ""],
              ["Payment terms", agreement.paymentTerms],
            ]} />
            {(agreement.paymentSchedule ?? []).length > 0 && (
              <table className="table">
                <thead><tr><th>Payment</th><th>Due</th><th>Amount</th></tr></thead>
                <tbody>{agreement.paymentSchedule.map((row: any, index: number) => <tr key={index}><td>{row.label}</td><td>{row.dueDate ? formatDate(row.dueDate) : "—"}</td><td style={{ fontVariantNumeric: "tabular-nums" }}>{money(row.amountCents)}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        </section>

        <section className="card" aria-labelledby="agreement-obligations" style={{ gridColumn: "1 / -1" }}>
          <div className="card__head">
            <h2 className="card__title" id="agreement-obligations">Deliverables and reporting</h2>
            <span className="card__subtitle">{agreement.openObligations} open · {agreement.overdueObligations} overdue</span>
          </div>
          <div className="card__body">
            {(["deliverables", "reportingObligations"] as const).map((list) => (
              <div key={list} style={{ marginBottom: 12 }}>
                <h3 className="agreement-form__heading">{list === "deliverables" ? "Deliverables" : "Reports"}</h3>
                {!obligations(list).length && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>None recorded.</div>}
                {obligations(list).map((row: any) => {
                  const overdue = row.dueDate && row.dueDate < today && !["submitted", "accepted", "waived"].includes(String(row.status));
                  return (
                    <div key={row.id} className="agreement-obligation">
                      <div>
                        <div>{row.text}</div>
                        <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                          {[row.dueDate ? `Due ${formatDate(row.dueDate)}` : "No due date", row.recurrence && row.recurrence !== "once" ? REPORTING_RECURRENCE_LABELS[row.recurrence as ReportingRecurrence] : "", row.owner ? `Owner: ${row.owner}` : "", row.recipient ? `To: ${row.recipient}` : "", row.completedAtISO || row.submittedAtISO ? `Done ${formatDate(row.completedAtISO ?? row.submittedAtISO)}` : ""].filter(Boolean).join(" · ")}
                          {overdue && <> · <Badge tone="danger">Overdue</Badge></>}
                        </div>
                      </div>
                      <Select
                        value={row.status ?? "not_started"}
                        onChange={(value) => run("Status saved", () => setObligation({ id: agreement._id, list, rowKey: row.id, status: value }))}
                        options={DELIVERABLE_STATUSES.map((value) => ({ value, label: DELIVERABLE_STATUS_LABELS[value] }))}
                        disabled={!canWrite}
                        size="sm"
                        aria-label={`Status of ${row.text}`}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
            {data.deadlines && (
              <>
                <div className="row" style={{ gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
                  <h3 className="agreement-form__heading">Deadlines generated</h3>
                  {canWrite && <button type="button" className="btn btn--ghost btn--sm" onClick={() => run("Deadlines brought up to date", () => syncObligations({ societyId: society._id }))}><RefreshCcw size={12} /> Update deadlines</button>}
                </div>
                {!data.deadlines.length && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>No deadlines: add due dates, a renewal notice period or an end date.</div>}
                <ul className="agreement-versions">
                  {data.deadlines.map((row: any) => (
                    <li key={row._id}>
                      <Link to={`/app/deadlines?record=${encodeURIComponent(String(row._id))}`}>{row.title}</Link>
                      <span className="muted">{formatDate(row.dueDate)}</span>
                      <Badge tone={(row.status ?? (row.done ? "complete" : "open")) === "open" ? (row.dueDate < today ? "danger" : "info") : "success"}>{(row.status ?? (row.done ? "complete" : "open")) === "open" ? (row.dueDate < today ? "Overdue" : "Open") : "Done"}</Badge>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>

        <section className="card" aria-labelledby="agreement-documents">
          <div className="card__head"><h2 className="card__title" id="agreement-documents">Documents</h2></div>
          <div className="card__body col" style={{ gap: 8 }}>
            {!(data.documents ?? []).length && !agreement.intakeExtractionId && <div className="muted">No documents linked. Edit the agreement to choose the signed copy.</div>}
            {(data.documents ?? []).map((doc: any) => (
              <div key={doc._id} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <FileText size={12} aria-hidden="true" />
                <Link to={`/app/documents/${doc._id}`}>{doc.title}</Link>
                <Badge tone={doc.role === "signed" ? "success" : "neutral"}>{doc.role === "signed" ? "Signed copy" : doc.role === "source" ? "Source" : "Related"}</Badge>
                {doc.sourceVersionStatus && <span className="muted">{doc.sourceVersionStatus}</span>}
              </div>
            ))}
            {agreement.signedDocumentVersionId && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>A specific version of the signed copy is linked.</div>}
            {agreement.intakeExtractionId && agreement.intakeRunId && (
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <span className="muted">Extracted from an intake source file.</span>
                <Link className="btn btn--sm" to={`/app/intake/${agreement.intakeRunId}/review?e=${agreement.intakeExtractionId}`}>Open in intake review</Link>
              </div>
            )}
            {(agreement.sourceExternalIds ?? []).length > 0 && <div className="muted mono" style={{ fontSize: "var(--fs-xs, 11px)", overflowWrap: "anywhere" }}>Source id: {agreement.sourceExternalIds.join(", ")}</div>}
          </div>
        </section>

        <section className="card" aria-labelledby="agreement-links">
          <div className="card__head"><h2 className="card__title" id="agreement-links">Links and approval</h2></div>
          <div className="card__body">
            <Rows rows={[
              ["Grant", data.links.grant ? <Link to={`/app/grants/${data.links.grant.id}`}>{data.links.grant.label}</Link> : ""],
              ["Service provider", data.links.serviceProvider ? <Link to="/app/service-providers">{data.links.serviceProvider.label}</Link> : ""],
              ["Committee", data.links.committee ? <Link to={`/app/committees/${data.links.committee.id}`}>{data.links.committee.label}</Link> : ""],
              ["Approved at", data.links.meeting ? <Link to={`/app/meetings/${data.links.meeting.id}`}>{data.links.meeting.label}</Link> : ""],
              ["Authorizing motion", data.links.motion ? <Link to={`/app/motions?record=${encodeURIComponent(data.links.motion.id)}`}>{data.links.motion.label}</Link> : (signing?.boardApprovalRequired ? <span className="muted">Required for this amount — edit to link it</span> : "")],
              ["Approval note", agreement.approvalNote],
            ]} />
          </div>
        </section>

        <section className="card" aria-labelledby="agreement-history">
          <div className="card__head"><h2 className="card__title" id="agreement-history">Versions and history</h2></div>
          <div className="card__body">
            <ul className="agreement-versions">
              {(data.versions ?? []).map((version: any) => (
                <li key={version._id}>
                  {String(version._id) === String(agreement._id) ? <strong>{version.title}</strong> : <Link to={`/app/agreements/${version._id}`}>{version.title}</Link>}
                  <Badge tone={agreementStatusTone(version.status)}>{AGREEMENT_STATUS_LABELS[version.status as AgreementStatus] ?? version.status}</Badge>
                  <span className="muted">{[version.effectiveDate ? formatDate(version.effectiveDate) : "?", version.endDate ? formatDate(version.endDate) : "open"].join(" – ")}</span>
                  <span className="muted">· {version.relation}</span>
                </li>
              ))}
            </ul>
            <Rows rows={[
              ["Created", formatDate(agreement.createdAtISO)],
              ["Updated", formatDate(agreement.updatedAtISO)],
              ["Origin", agreement.importedFrom ?? "Entered in Societyer"],
            ]} />
          </div>
        </section>

        {(agreement.summary || (agreement.notes && agreement.reviewStatus !== "NeedsReview")) && (
          <section className="card" aria-labelledby="agreement-notes">
            <div className="card__head"><h2 className="card__title" id="agreement-notes">Summary and notes</h2></div>
            <div className="card__body" style={{ whiteSpace: "pre-wrap" }}>
              {agreement.summary && <p style={{ marginTop: 0 }}>{agreement.summary}</p>}
              {agreement.reviewStatus !== "NeedsReview" && agreement.notes && <p className="muted">{agreement.notes}</p>}
            </div>
          </section>
        )}
      </div>

      {initialForm && (
        <AgreementFormDrawer
          open={editing}
          title="Edit agreement"
          societyId={society._id}
          initial={initialForm}
          saving={saving}
          serverError={serverError}
          onClose={() => setEditing(false)}
          onSubmit={saveEdit}
        />
      )}

      <Modal
        open={Boolean(renewForm)}
        onClose={() => setRenewForm(null)}
        title={renewForm?.mode === "supersede" ? "Replace with a new agreement" : "Renew for a new term"}
        footer={<>
          <button type="button" className="btn" onClick={() => setRenewForm(null)}>Cancel</button>
          <button type="button" className="btn btn--accent" onClick={submitRenew}>{renewForm?.mode === "supersede" ? "Create replacement" : "Create renewal"}</button>
        </>}
      >
        {renewForm && (
          <div className="col" style={{ gap: 8 }}>
            <p className="muted" style={{ marginTop: 0 }}>
              {renewForm.mode === "renew"
                ? "The current term runs to its end; the renewal is a new linked version that starts as a draft. Parties, kind and links are carried over."
                : "The current agreement becomes superseded now; the replacement is a new linked version that starts as a draft."}
            </p>
            <Field label="Title"><input className="input" value={renewForm.title} onChange={(event) => setRenewForm({ ...renewForm, title: event.target.value })} /></Field>
            <Field label="Effective date"><DatePicker id="renewal-effective-date" value={renewForm.effectiveDate} onChange={(effectiveDate) => setRenewForm({ ...renewForm, effectiveDate })} /></Field>
            <Field label="End date"><DatePicker id="renewal-end-date" value={renewForm.endDate} onChange={(endDate) => setRenewForm({ ...renewForm, endDate })} /></Field>
            <Field label="Value (dollars)" hint="Leave blank to keep the current value"><input className="input" inputMode="decimal" value={renewForm.valueDollars} onChange={(event) => setRenewForm({ ...renewForm, valueDollars: event.target.value })} /></Field>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={renewForm.carry} onChange={(event) => setRenewForm({ ...renewForm, carry: event.target.checked })} /> Carry open deliverables and reports forward</label>
            {renewForm.error && <div className="field__error" role="alert">{renewForm.error}</div>}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(terminateForm)}
        onClose={() => setTerminateForm(null)}
        title="Terminate agreement"
        footer={<>
          <button type="button" className="btn" onClick={() => setTerminateForm(null)}>Cancel</button>
          <button type="button" className="btn btn--danger" onClick={submitTerminate}>Terminate</button>
        </>}
      >
        {terminateForm && (
          <div className="col" style={{ gap: 8 }}>
            <Field label="Termination date" required><DatePicker id="termination-date" value={terminateForm.date} onChange={(date) => setTerminateForm({ ...terminateForm, date })} /></Field>
            <Field label="Reason" required><textarea className="textarea" rows={3} value={terminateForm.reason} onChange={(event) => setTerminateForm({ ...terminateForm, reason: event.target.value })} placeholder="For example: ended by mutual agreement; notice given on …" /></Field>
            {terminateForm.error && <div className="field__error" role="alert">{terminateForm.error}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
