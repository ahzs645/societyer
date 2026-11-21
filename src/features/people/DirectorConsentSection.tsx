/**
 * The director drawer's "Consent to act" section. It reads the consent
 * register (`directorConsents`, shown in full at /app/business-records), not
 * the bare `consentOnFile` flag: the latest "Consent to act" entry is shown,
 * a new one is recorded through the register's own write path, and the server
 * keeps `directors.consentOnFile` in step with it. Directors flagged before the
 * register existed show "Marked on file" until their details are recorded.
 *
 * The consent form itself is the "Consent to act as director" packet
 * (shared/corporationReportPackets.ts, shared/societyDocumentPackets.ts),
 * generated pre-filled for the chosen directors.
 */
import { useId, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { FileSignature } from "lucide-react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge, Banner, Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import { todayDateOnly } from "../../../shared/dateOnly";
import { businessRegisters } from "../../../shared/businessEvidence";
import { evidenceRules } from "../../../shared/businessEvidenceRules";
import type { GovernanceOrganization } from "../../../shared/legalGovernanceProfiles";
import { CORPORATION_DOCUMENT_PACKETS } from "../../../shared/corporationDocumentPackets";
import { SOCIETY_DOCUMENT_PACKETS } from "../../../shared/societyDocumentPackets";
import { directorConsentPacketKey } from "../../../shared/corporationReportPackets";
import { pathwayForPacket } from "../../../shared/pathways/registry";
import { CONSENT_TO_ACT_SCOPE, latestConsentToAct, type DirectorConsentRow } from "../../../shared/directorConsentRecords";

export const DIRECTOR_CONSENT_HISTORY_HREF = "/app/business-records?register=directorConsents";

const CONSENT_REGISTER = businessRegisters.find((register) => register.table === "directorConsents");
const optionsFor = (key: string) => CONSENT_REGISTER?.fields.find((field) => field.key === key)?.options ?? [];

/** A consent register row as `businessEvidence.list` returns it. */
export type ConsentRegisterRow = DirectorConsentRow & { historical?: boolean };

type ConsentOrganization = GovernanceOrganization & { _id: string };

/** Whether the viewer can read the consent register for this organization. */
export function useConsentRegisterReadable(organization: GovernanceOrganization | null | undefined) {
  const { loaded, can } = usePermissions();
  return Boolean(organization && CONSENT_REGISTER && loaded && can("directors:read") && evidenceRules(organization, CONSENT_REGISTER).available);
}

/**
 * Generates the "Consent to act as director" form for chosen directors: one
 * draft document, one consent per director, each effective from their term start.
 */
export function useDirectorConsentForms(organization: ConsentOrganization | null | undefined) {
  const { loaded, can } = usePermissions();
  const generate = useMutation(api.legalOperations.generateDocumentFromCatalog);
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const packetKey = directorConsentPacketKey(organization);
  const packet = [...CORPORATION_DOCUMENT_PACKETS, ...SOCIETY_DOCUMENT_PACKETS].find((candidate) => candidate.key === packetKey);
  let applies = false;
  if (organization && packet) {
    try {
      pathwayForPacket(organization, packet);
      applies = true;
    } catch {
      applies = false;
    }
  }
  const available = applies && loaded && can("documents:write");
  const unavailableReason = !applies
    ? "The consent form isn't available for this organization's governing Act yet."
    : "Document editing permission is required";

  const prepare = async (directorIds: string[], effectiveDate: string) => {
    if (!organization || !available || !directorIds.length || busy) return;
    setBusy(true);
    try {
      const result = (await generate({ societyId: organization._id, packetKey, effectiveDate, transactionIds: directorIds })) as { draftDocumentId?: string } | null;
      const documentId = result?.draftDocumentId;
      toast.success(directorIds.length === 1 ? "Consent form prepared" : `${directorIds.length} consent forms prepared`, {
        description: directorIds.length === 1
          ? "An editable draft to review before the director signs it."
          : "One editable draft to review; each director signs their own form.",
        ...(documentId ? { action: { label: "Open", onClick: () => navigate(`/app/documents/${documentId}`) } } : {}),
      });
    } catch (error) {
      toast.error("Could not prepare the consent form", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return { available, unavailableReason, busy, prepare };
}

type ConsentDirector = {
  _id: string;
  firstName?: string;
  lastName?: string;
  termStart?: string;
  consentOnFile?: boolean;
};

type Draft = { event: string; basis: string; effectiveDate: string; signedOn: string; documentId: string };

type DocumentSummary = { _id: string; title: string };

function eventTone(event: string | undefined) {
  return event === "Withdrawn" ? "warn" : "success";
}

function eventLabel(event: string | undefined) {
  if (event === "Withdrawn") return "Consent withdrawn";
  if (event === "Corrected") return "Consent given (corrected)";
  return "Consent given";
}

function directorName(director: ConsentDirector) {
  return `${director.firstName ?? ""} ${director.lastName ?? ""}`.trim() || "this director";
}

export function DirectorConsentSection({
  organization,
  director,
  consentRows,
  registerReadable,
  canManage,
}: {
  organization: ConsentOrganization;
  /** The saved director as the register holds it now (not the drawer's unsaved copy). */
  director: ConsentDirector;
  consentRows: ConsentRegisterRow[] | undefined;
  registerReadable: boolean;
  canManage: boolean;
}) {
  const titleId = useId();
  const toast = useToast();
  const confirm = useConfirm();
  const updateDirector = useMutation(api.directors.update);
  const forms = useDirectorConsentForms(organization);
  const [recording, setRecording] = useState(false);

  const latest = consentRows ? latestConsentToAct(consentRows, String(director._id)) : undefined;
  const legacyFlag = Boolean(director.consentOnFile) && consentRows !== undefined && !latest;
  const name = directorName(director);

  const clearLegacyFlag = async () => {
    const ok = await confirm({
      title: "Clear the consent flag?",
      message: `${name} is marked as having consent on file, but no consent is recorded. Clear the mark if it was set by mistake; if a consent exists, record its details instead.`,
      confirmLabel: "Clear flag",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await updateDirector({ id: director._id, patch: { consentOnFile: false } });
      toast.success("Consent flag cleared");
    } catch (cause) {
      toast.error("Could not clear the flag", cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="director-consent" aria-labelledby={titleId}>
      <div className="director-consent__head">
        <h3 className="director-consent__title" id={titleId}>Consent to act</h3>
        {latest ? <Badge tone={eventTone(latest.event)}>{eventLabel(latest.event)}</Badge> : null}
      </div>

      <ConsentSummary
        organizationId={organization._id}
        director={director}
        latest={latest}
        legacyFlag={legacyFlag}
        loading={registerReadable && consentRows === undefined}
        registerReadable={registerReadable}
      />

      {recording ? (
        <ConsentRecordForm organizationId={organization._id} director={director} onDone={() => setRecording(false)} />
      ) : (
        <div className="director-consent__actions">
          <button
            type="button"
            className="btn btn--sm"
            disabled={!forms.available || forms.busy}
            title={forms.available ? `Prepare a consent form for ${name}, effective from the term start` : forms.unavailableReason}
            onClick={() => void forms.prepare([String(director._id)], director.termStart || todayDateOnly())}
          >
            <FileSignature size={12} /> {forms.busy ? "Preparing…" : "Generate consent form"}
          </button>
          {canManage && registerReadable && (
            <button type="button" className="btn btn--sm" onClick={() => setRecording(true)}>
              {legacyFlag ? "Record details" : "Record consent"}
            </button>
          )}
          {canManage && legacyFlag && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={clearLegacyFlag}>Clear flag</button>
          )}
          {registerReadable && <Link className="director-consent__history" to={DIRECTOR_CONSENT_HISTORY_HREF}>Consent history</Link>}
        </div>
      )}
    </section>
  );
}

/** The latest "Consent to act" entry, or why there is none. */
function ConsentSummary({ organizationId, director, latest, legacyFlag, loading, registerReadable }: {
  organizationId: string;
  director: ConsentDirector;
  latest: ConsentRegisterRow | undefined;
  legacyFlag: boolean;
  loading: boolean;
  registerReadable: boolean;
}) {
  const { can } = usePermissions();
  const linkedDocuments = useQuery(
    api.documents.listSummaries,
    can("documents:read") && latest?.documentId && !latest.documentMissing ? { societyId: organizationId } : "skip",
  ) as DocumentSummary[] | undefined;

  if (!registerReadable) {
    return (
      <p className="muted director-consent__empty">
        {director.consentOnFile ? "Marked on file." : "No consent recorded."} Your role can't read the consent history.
      </p>
    );
  }
  if (loading) return <p className="muted director-consent__empty">Loading consent records…</p>;
  if (legacyFlag) {
    return (
      <p className="director-consent__empty">
        <strong>Marked on file</strong> <span className="muted">— no consent record linked.</span>
      </p>
    );
  }
  if (!latest) return <p className="muted director-consent__empty">No consent recorded.</p>;

  const documentTitle = linkedDocuments?.find((doc) => doc._id === latest.documentId)?.title ?? "Supporting document";
  return (
    <dl className="director-consent__facts">
      <div><dt>Basis</dt><dd>{latest.basis ?? "Not recorded"}</dd></div>
      <div><dt>Effective</dt><dd>{latest.effectiveDate ? formatDate(latest.effectiveDate) : "Not recorded"}</dd></div>
      <div><dt>Signed</dt><dd>{latest.signedOn ? formatDate(latest.signedOn) : "Not recorded"}</dd></div>
      <div><dt>Review</dt><dd>{latest.reviewStatus ?? "Not reviewed"}</dd></div>
      <div className="director-consent__fact--wide">
        <dt>Document</dt>
        <dd>
          {latest.documentMissing
            ? <span className="muted">Supporting document deleted</span>
            : latest.documentId
              ? <Link to={`/app/documents/${latest.documentId}`}>{documentTitle}</Link>
              : <span className="muted">None linked</span>}
        </dd>
      </div>
    </dl>
  );
}

/** Records a "Consent to act" entry in the consent register for this director. */
function ConsentRecordForm({ organizationId, director, onDone }: { organizationId: string; director: ConsentDirector; onDone: () => void }) {
  const { can } = usePermissions();
  const toast = useToast();
  const save = useMutation(api.businessEvidence.save);
  const canReadDocuments = can("documents:read");
  const documents = useQuery(api.documents.listSummaries, canReadDocuments ? { societyId: organizationId } : "skip") as DocumentSummary[] | undefined;
  const [draft, setDraft] = useState<Draft>(() => ({ event: "Given", basis: "Written consent", effectiveDate: director.termStart ?? "", signedOn: "", documentId: "" }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving) return;
    if (!draft.effectiveDate) {
      setError("Effective date is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await save({
        societyId: organizationId,
        register: "directorConsents",
        values: {
          directorId: director._id,
          scope: CONSENT_TO_ACT_SCOPE,
          event: draft.event,
          effectiveDate: draft.effectiveDate,
          ...(draft.basis ? { basis: draft.basis } : {}),
          ...(draft.signedOn ? { signedOn: draft.signedOn } : {}),
        },
        documentId: draft.documentId || undefined,
      });
      toast.success(draft.event === "Withdrawn" ? "Consent withdrawal recorded" : "Consent recorded", `Saved to the consent history for ${directorName(director)}.`);
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the consent record.");
      setSaving(false);
    }
  };

  return (
    <div className="director-consent__form">
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="row director-consent__pair">
        <Field label="Event">
          <Select value={draft.event} onChange={(value) => setDraft({ ...draft, event: value })} options={optionsFor("event").map((value) => ({ value, label: value }))} />
        </Field>
        <Field label="Basis">
          <Select value={draft.basis} placeholder="Choose…" clearable clearLabel="Not recorded" onChange={(value) => setDraft({ ...draft, basis: value })} options={optionsFor("basis").map((value) => ({ value, label: value }))} />
        </Field>
      </div>
      <div className="row director-consent__pair">
        <Field label="Effective date" required>
          <DatePicker value={draft.effectiveDate} onChange={(value) => setDraft({ ...draft, effectiveDate: value })} />
        </Field>
        <Field label="Signed on">
          <DatePicker value={draft.signedOn} clearable max={todayDateOnly()} onChange={(value) => setDraft({ ...draft, signedOn: value })} />
        </Field>
      </div>
      {canReadDocuments && (
        <Field label="Signed consent document" hint="Optional. Add the signed form to Documents first, then choose it here.">
          <Select
            value={draft.documentId}
            placeholder={documents === undefined ? "Loading documents…" : "None"}
            clearable
            clearLabel="None"
            searchable
            options={(documents ?? []).map((doc) => ({ value: doc._id, label: doc.title }))}
            onChange={(value) => setDraft({ ...draft, documentId: value })}
          />
        </Field>
      )}
      <div className="director-consent__actions">
        <button type="button" className="btn btn--accent btn--sm" disabled={saving} onClick={submit}>
          {saving ? "Saving…" : "Save consent record"}
        </button>
        <button type="button" className="btn btn--sm" disabled={saving} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
