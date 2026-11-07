import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { FileCheck2, Plus } from "lucide-react";
import { api } from "../lib/convexApi";
import { usePermissions } from "../hooks/usePermissions";
import { Badge, Drawer, Field } from "./ui";
import { Select } from "./Select";
import { DatePicker } from "./DatePicker";
import { useToast } from "./Toast";
import { OrganizationCapabilities } from "./OrganizationCapabilities";
import { formatDate } from "../lib/format";
import type { CapabilityOrganization } from "../../shared/organizationCapabilities";
import "./organizationRegistrationProfile.css";

type RegistrationStatus = "unknown" | "applied" | "registered" | "inactive";
type EvidenceFingerprint = { documentId: string; fingerprint: string };
type RegistrationDraft = {
  expectedRevisionId?: string;
  status: RegistrationStatus;
  charityNumber: string;
  registeredName: string;
  registeredAddress: string;
  effectiveFrom: string;
  effectiveTo: string;
  evidenceDocumentId: string;
  additionalEvidenceDocumentIds: string[];
  evidenceReviewed: boolean;
  reviewedEvidenceFingerprints?: EvidenceFingerprint[];
  authorityReference: string;
  notes: string;
};

const STATUS_LABELS: Record<RegistrationStatus, string> = {
  unknown: "Not established",
  applied: "Application pending",
  registered: "Registration recorded",
  inactive: "Inactive / ended",
};

const evidenceIdsFor = (draft: RegistrationDraft) => [...new Set([draft.evidenceDocumentId, ...draft.additionalEvidenceDocumentIds].filter(Boolean))];

/** Registration evidence is saved separately from ordinary profile edits. */
export function OrganizationRegistrationProfile({ organization }: {
  organization: CapabilityOrganization & { _id: string; name: string; registeredOfficeAddress?: string; isCharity?: boolean; charityStatus?: string };
}) {
  const permissions = usePermissions();
  const canRead = permissions.loaded && permissions.can("society:read");
  const canWrite = permissions.loaded && permissions.can("society:write");
  const canReadDocuments = permissions.loaded && permissions.can("documents:read");
  const data = useQuery(api.receipts.registrationHistory, canRead ? { societyId: organization._id } : "skip");
  const recordRegistration = useMutation(api.receipts.recordRegistration);
  const [draft, setDraft] = useState<RegistrationDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const documents = useQuery(api.documents.listSummaries, draft && canReadDocuments ? { societyId: organization._id } : "skip");
  const selectedEvidenceIds = draft ? evidenceIdsFor(draft) : [];
  const selectionKey = JSON.stringify(selectedEvidenceIds);
  const evidence = useQuery(api.receipts.evidenceForReview, selectedEvidenceIds.length && canRead && canReadDocuments
    ? { societyId: organization._id, documentIds: selectedEvidenceIds }
    : "skip") as Array<EvidenceFingerprint & { reviewIssue?: string }> | undefined;
  const reviewedSources = selectedEvidenceIds.map((id) => evidence?.find((source) => source.documentId === id));
  const evidenceReady = selectedEvidenceIds.length > 0 && reviewedSources.every((source) => source && !source.reviewIssue && /^[a-f0-9]{64}$/i.test(source.fingerprint));
  const evidenceFingerprints = evidenceReady ? reviewedSources.map((source) => ({ documentId: source!.documentId, fingerprint: source!.fingerprint })) : undefined;
  const evidenceKey = JSON.stringify(evidenceFingerprints ?? null);

  // A checked review applies to the exact source the operator saw. Never
  // substitute a newly arrived fingerprint for an already checked review.
  useEffect(() => {
    setDraft((currentDraft) => {
      if (!currentDraft?.evidenceReviewed) return currentDraft;
      if (canReadDocuments && JSON.stringify(currentDraft.reviewedEvidenceFingerprints ?? null) === evidenceKey) return currentDraft;
      return { ...currentDraft, evidenceReviewed: false, reviewedEvidenceFingerprints: undefined };
    });
  }, [canReadDocuments, evidenceKey]);

  const toast = useToast();
  const current = data?.current;
  const ready = data?.assessment?.readiness === "ready";
  const registrationStatus = current?.status as RegistrationStatus | undefined;
  const statusLabel = registrationStatus ? STATUS_LABELS[registrationStatus] : "Registration evidence not recorded";

  const openEditor = () => {
    setError(null);
    setDraft({
      expectedRevisionId: current?._id,
      status: current?.status ?? "unknown",
      charityNumber: current?.charityNumber ?? "",
      registeredName: current?.registeredName ?? organization.name,
      registeredAddress: current?.registeredAddress ?? organization.registeredOfficeAddress ?? "",
      effectiveFrom: current?.effectiveFrom ?? "",
      effectiveTo: current?.effectiveTo ?? "",
      evidenceDocumentId: current?.evidenceDocumentIds?.[0] ?? "",
      additionalEvidenceDocumentIds: current?.evidenceDocumentIds?.slice(1) ?? [],
      // Every revision needs a deliberate review, including a copied record.
      evidenceReviewed: false,
      authorityReference: current?.authorityReference ?? "",
      notes: "",
    });
  };

  const save = async () => {
    if (!draft || !canWrite || saving) return;
    setSaving(true);
    setError(null);
    try {
      await recordRegistration({
        societyId: organization._id,
        expectedRevisionId: draft.expectedRevisionId,
        status: draft.status,
        evidenceReviewed: draft.evidenceReviewed,
        charityNumber: draft.charityNumber.trim() || undefined,
        registeredName: draft.registeredName.trim() || undefined,
        registeredAddress: draft.registeredAddress.trim() || undefined,
        effectiveFrom: draft.effectiveFrom || undefined,
        effectiveTo: draft.effectiveTo || undefined,
        evidenceDocumentIds: evidenceIdsFor(draft),
        expectedEvidenceFingerprints: draft.evidenceReviewed ? draft.reviewedEvidenceFingerprints : undefined,
        authorityReference: draft.authorityReference.trim() || undefined,
        notes: draft.notes.trim() || undefined,
      });
      setDraft(null);
      toast.success("Registration update recorded", "Earlier revisions and issued documents stay in history.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The registration update could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return <div className="organization-registration-profile">
    <OrganizationCapabilities organization={organization} charityRegistrations={data?.history} assessmentDate={data?.onDate} />
    <section className="card organization-registration-profile__card" id="charity-registration" aria-labelledby="charity-registration-title" data-testid="charity-registration-profile">
      <div className="card__head organization-registration-profile__head">
        <div>
          <h2 className="card__title" id="charity-registration-title"><FileCheck2 size={16} aria-hidden="true" /> Charity registration and evidence</h2>
          <p className="card__subtitle">Record an application, the authority's decision, and the dates it applies.</p>
        </div>
        <button type="button" className="btn btn--accent" onClick={openEditor} disabled={!canWrite || data === undefined}>
          <Plus size={14} aria-hidden="true" /> Record registration update
        </button>
      </div>
      <div className="card__body">
        {!canRead ? <p className="muted">Organization read permission is required to view registration evidence.</p>
          : data === undefined ? <p role="status">Loading registration history…</p>
            : <>
              <div className="organization-registration-profile__status">
                <Badge tone={ready ? "info" : "warn"}>{statusLabel}</Badge>
                <span>{ready ? "Evidence reviewed; each gift and signing action still needs its own checks." : "Donation acknowledgements remain available. Official receipting requires the applicable evidence and gift checks."}</span>
              </div>
              {current?.charityNumber && <p>Registration number: <strong className="mono">{current.charityNumber}</strong></p>}
              {data.assessment?.reasons?.length > 0 && <ul className="organization-registration-profile__reasons">
                {data.assessment.reasons.map((reason: { code: string; message: string }) => <li key={reason.code}>{reason.message}</li>)}
              </ul>}
              {!current && (organization.isCharity || organization.charityStatus === "registered") && <p className="organization-registration-profile__notice">
                The earlier profile reports charitable registration. Add the decision and supporting evidence here before preparing official receipts.
              </p>}
              {organization.isMemberFunded && current?.status === "registered" && <p className="organization-registration-profile__notice">
                The profile also reports member-funded status. Review the classification and governing documents before relying on that status.
              </p>}
              <p className="muted">Evidence review records your organization's review. It does not verify registration with the Canada Revenue Agency.</p>
              <Link className="setup-inline-link" to="/app/receipts">Open donations and receipts</Link>
              <details className="organization-registration-profile__history">
                <summary>Registration history ({data.history.length})</summary>
                {data.history.length === 0 ? <p>No registration revisions have been recorded.</p> : <ol>
                  {data.history.slice().sort((a: any, b: any) => b.revisionNumber - a.revisionNumber).map((revision: any) => <li key={revision._id}>
                    <div><strong>{STATUS_LABELS[revision.status as RegistrationStatus]}</strong> <Badge tone="neutral">Revision {revision.revisionNumber}</Badge></div>
                    <p>Recorded {formatDate(revision.recordedAtISO)} · {revision.evidenceReviewed ? "Evidence reviewed" : "Evidence not reviewed"}</p>
                    {(revision.effectiveFrom || revision.effectiveTo) && <p>Applies {revision.effectiveFrom ? `from ${formatDate(revision.effectiveFrom)}` : "from an unrecorded date"}{revision.effectiveTo ? ` through ${formatDate(revision.effectiveTo)}` : ""}</p>}
                    {revision.authorityReference && <p>Authority reference: {revision.authorityReference}</p>}
                    {revision.notes && <p>{revision.notes}</p>}
                  </li>)}
                </ol>}
              </details>
            </>}
      </div>
    </section>
    <Drawer open={draft !== null} onClose={() => { if (!saving) setDraft(null); }} title="Record charity registration update" footer={<>
      <button type="button" className="btn" onClick={() => setDraft(null)} disabled={saving}>Cancel</button>
      <button type="button" className="btn btn--accent" onClick={() => void save()} disabled={!canWrite || saving}>{saving ? "Recording…" : "Record update"}</button>
    </>}>
      {draft && <div className="organization-registration-profile__form">
        <p>This records a new revision. Use the dates and name in the authority's documents; previous revisions are retained.</p>
        {error && <p className="organization-registration-profile__error" role="alert">{error}</p>}
        <fieldset disabled={saving}>
          <Field label="Reported registration status">
            <Select value={draft.status} onChange={(value) => setDraft({ ...draft, status: value as RegistrationStatus, evidenceReviewed: false })} options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="CRA charity registration number" hint="The complete account number, for example 123456789RR0001.">
            <input className="input" value={draft.charityNumber} onChange={(event) => setDraft({ ...draft, charityNumber: event.target.value, evidenceReviewed: false })} />
          </Field>
          <Field label="Registered charity name">
            <input className="input" value={draft.registeredName} onChange={(event) => setDraft({ ...draft, registeredName: event.target.value, evidenceReviewed: false })} />
          </Field>
          <Field label="Registered charity address">
            <textarea className="input" rows={3} value={draft.registeredAddress} onChange={(event) => setDraft({ ...draft, registeredAddress: event.target.value, evidenceReviewed: false })} />
          </Field>
          <div className="organization-registration-profile__dates">
            <Field label="Registration effective from"><DatePicker value={draft.effectiveFrom} onChange={(value) => setDraft({ ...draft, effectiveFrom: value, evidenceReviewed: false })} /></Field>
            <Field label="Registration effective through" hint="Leave empty when the evidence establishes no end date."><DatePicker value={draft.effectiveTo} onChange={(value) => setDraft({ ...draft, effectiveTo: value, evidenceReviewed: false })} /></Field>
          </div>
          <Field label="Authority reference" hint="Application, decision, or cancellation reference.">
            <input className="input" value={draft.authorityReference} onChange={(event) => setDraft({ ...draft, authorityReference: event.target.value, evidenceReviewed: false })} />
          </Field>
          <Field label="Supporting registration document" hint="Choose evidence already saved in this organization. A reviewed registration needs a supporting document.">
            <Select value={draft.evidenceDocumentId} onChange={(value) => setDraft({ ...draft, evidenceDocumentId: value, additionalEvidenceDocumentIds: draft.additionalEvidenceDocumentIds.filter((id) => id !== value), evidenceReviewed: false })} disabled={!canReadDocuments || documents === undefined} options={[
              { value: "", label: "Select a supporting document" },
              ...(documents ?? []).map((document: any) => ({ value: document._id, label: document.title || "Untitled document" })),
            ]} />
          </Field>
          {draft.additionalEvidenceDocumentIds.length > 0 && <div className="organization-registration-profile__retained-evidence">
            <p>Additional evidence retained from the current revision:</p>
            <ul>{draft.additionalEvidenceDocumentIds.map((id) => {
              const title = documents?.find((document: any) => document._id === id)?.title || "Previously linked evidence";
              return <li key={id}><span>{title}</span> <button type="button" className="btn btn--ghost btn--sm" aria-label={`Remove retained evidence: ${title}`} onClick={() => setDraft({ ...draft, additionalEvidenceDocumentIds: draft.additionalEvidenceDocumentIds.filter((existing) => existing !== id), evidenceReviewed: false })}>Remove</button></li>;
            })}</ul>
          </div>}
          <p><Link to="/app/documents" target="_blank" rel="noopener noreferrer">Open Documents to add evidence</Link></p>
          {!canReadDocuments && <p className="muted">Document read permission is required to review registration evidence.</p>}
          {selectedEvidenceIds.length > 0 && canReadDocuments && evidence === undefined && <p className="muted" role="status">Checking the selected evidence…</p>}
          {reviewedSources.filter((source) => source?.reviewIssue).map((source) => <p key={source!.documentId} className="organization-registration-profile__notice" role="status">{source!.reviewIssue}</p>)}
          <label className="organization-registration-profile__review">
            <input type="checkbox" checked={draft.evidenceReviewed} disabled={!canReadDocuments || !evidenceReady} onChange={(event) => {
              const checked = event.target.checked;
              setDraft((currentDraft) => {
                if (!currentDraft) return null;
                const reviewed = checked && canReadDocuments && evidenceFingerprints && JSON.stringify(evidenceIdsFor(currentDraft)) === selectionKey
                  ? evidenceFingerprints
                  : undefined;
                return { ...currentDraft, evidenceReviewed: Boolean(reviewed), reviewedEvidenceFingerprints: reviewed };
              });
            }} />
            <span>I reviewed the supporting evidence and the reported status, name, number, address, and applicable dates.</span>
          </label>
          <Field label="Reason for this update" hint="Explain the new decision, correction, or unresolved question.">
            <textarea className="input" rows={3} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
          </Field>
        </fieldset>
      </div>}
    </Drawer>
  </div>;
}
