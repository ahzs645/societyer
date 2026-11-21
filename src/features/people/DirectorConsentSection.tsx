/**
 * The director drawer's "Consent to act" section. It reads the consent
 * register (`directorConsents`, shown in full at /app/business-records), not
 * the bare `consentOnFile` flag. The server derives each director's consent
 * evidence state from the register (`directors.consentStates`,
 * shared/directorConsentRecords.ts): no basis recorded, awaiting review,
 * verified, disputed, not yet in effect, withdrawn, or marked on file only.
 * Only "verified" satisfies the consent requirement.
 *
 * From here a director's consent basis is recorded (written consent, the
 * meeting at which they were elected or appointed, or evidence held
 * elsewhere), and then reviewed (ConsentReviewForm.tsx): "Mark reviewed" /
 * "Mark disputed" write a new version of the entry stamped with the reviewer
 * and date.
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
import type { ToneVariant } from "../../components/ui";
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
import { ConsentReviewForm } from "./ConsentReviewForm";
import {
  CONSENT_STATE_LABELS,
  CONSENT_TO_ACT_SCOPE,
  consentBasisOptions,
  consentReviewProblem,
  consentTimingNote,
  type ConsentBasisOption,
  type DirectorConsentRow,
  type DirectorConsentState,
} from "../../../shared/directorConsentRecords";

export const DIRECTOR_CONSENT_HISTORY_HREF = "/app/business-records?register=directorConsents";

const CONSENT_REGISTER = businessRegisters.find((register) => register.table === "directorConsents");
const optionsFor = (key: string) => CONSENT_REGISTER?.fields.find((field) => field.key === key)?.options ?? [];

/** A consent register row as `businessEvidence.list` returns it. */
export type ConsentRegisterRow = DirectorConsentRow & { historical?: boolean };

/** One director's derived consent state, as `directors.consentStates` returns it. */
export type DirectorConsentStateRow = {
  directorId: string;
  state: DirectorConsentState;
  currentId?: string;
  upcomingId?: string;
  upcomingEffectiveDate?: string;
  basisNotAccepted?: boolean;
  /** Why the basis isn't accepted, when more specific (a CBCA consent signed too late). */
  basisNotAcceptedReason?: string;
};

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

type DocumentSummary = { _id: string; title: string };
type Choice = { id: string; label: string };

/** How the basis is being recorded: each mode asks for its own evidence. */
type RecordMode = "written" | "meeting" | "elsewhere";

type Draft = {
  event: string;
  basis: string;
  effectiveDate: string;
  signedOn: string;
  documentId: string;
  meetingId: string;
  evidenceLocation: string;
  evidenceReference: string;
  custodian: string;
};

const STATE_TONES: Record<DirectorConsentState, ToneVariant> = {
  none: "warn",
  awaiting_review: "info",
  verified: "success",
  disputed: "danger",
  scheduled: "neutral",
  withdrawn: "warn",
  legacy_flag_only: "warn",
};

function directorName(director: ConsentDirector) {
  return `${director.firstName ?? ""} ${director.lastName ?? ""}`.trim() || "this director";
}

function stateLine(state: DirectorConsentState, entry: ConsentRegisterRow | undefined, upcomingDate: string | undefined, notAccepted: { basisNotAccepted?: boolean; basisNotAcceptedReason?: string }): string {
  switch (state) {
    case "none": return "No consent or other basis is recorded. Record how this director consented to act.";
    case "awaiting_review": return notAccepted.basisNotAcceptedReason
      ?? (notAccepted.basisNotAccepted
        ? "The recorded basis isn't one the governing Act accepts. Correct it, then review the evidence."
        : "A basis is recorded but nobody has reviewed its evidence yet.");
    case "verified": return entry?.reviewedAt
      ? `Reviewed by ${entry.reviewedByName ?? "a workspace member"} on ${formatDate(entry.reviewedAt)}.`
      : "Reviewed.";
    case "disputed": return `The recorded basis was disputed on review${entry?.reviewNote ? `: ${entry.reviewNote}` : "."} Correct it or record new evidence.`;
    case "scheduled": return `The recorded consent takes effect ${upcomingDate ? formatDate(upcomingDate) : "later"}; nothing is in effect today.`;
    case "withdrawn": return `Consent was withdrawn${entry?.effectiveDate ? ` effective ${formatDate(entry.effectiveDate)}` : ""}. Reassess whether this director remains in office.`;
    case "legacy_flag_only": return "Marked on file before the consent history was kept. Record the basis and where its evidence is held.";
  }
}

export function DirectorConsentSection({
  organization,
  director,
  consentRows,
  consentState,
  registerReadable,
  canManage,
  onCorrectRecord,
}: {
  organization: ConsentOrganization;
  /** The saved director as the register holds it now (not the drawer's unsaved copy). */
  director: ConsentDirector;
  consentRows: ConsentRegisterRow[] | undefined;
  /** The server-derived state for this director; undefined while loading. */
  consentState: DirectorConsentStateRow | undefined;
  registerReadable: boolean;
  canManage: boolean;
  /** Moves focus to the director's own fields (name, term, status) above. */
  onCorrectRecord?: () => void;
}) {
  const titleId = useId();
  const toast = useToast();
  const confirm = useConfirm();
  const updateDirector = useMutation(api.directors.update);
  const forms = useDirectorConsentForms(organization);
  const [recording, setRecording] = useState<RecordMode | null>(null);
  const [reviewing, setReviewing] = useState<"Reviewed" | "Disputed" | null>(null);

  const bases = consentBasisOptions(organization);
  const meetingBasis = bases.find((option) => option.value === "Meeting record");
  const state = consentState?.state;
  const current = consentState?.currentId ? consentRows?.find((row) => row._id === consentState.currentId) : undefined;
  const upcoming = consentState?.upcomingId ? consentRows?.find((row) => row._id === consentState.upcomingId) : undefined;
  const name = directorName(director);
  const busy = recording !== null || reviewing !== null;
  const canReview = canManage && registerReadable && Boolean(consentState?.currentId) && current?.event !== "Withdrawn";
  // Once a basis is on record, reviewing it is the next step: recording
  // another basis stays available but steps back, and the consent form only
  // shows while there is no usable basis to review.
  const basisOnRecord = state === "verified" || state === "awaiting_review";
  const recordClass = basisOnRecord ? "btn btn--ghost btn--sm" : "btn btn--sm";
  const needsBasis = !basisOnRecord && state !== "scheduled";

  const clearLegacyFlag = async () => {
    const ok = await confirm({
      title: "Clear the consent mark?",
      message: `${name} is marked as having consent on file, but no consent is recorded. Clear the mark if it was set by mistake; if a consent exists, record its basis instead.`,
      confirmLabel: "Clear mark",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await updateDirector({ id: director._id, patch: { consentOnFile: false } });
      toast.success("Consent mark cleared");
    } catch (cause) {
      toast.error("Could not clear the mark", cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="director-consent" aria-labelledby={titleId}>
      <div className="director-consent__head">
        <h3 className="director-consent__title" id={titleId}>Consent to act</h3>
        {state ? <Badge tone={STATE_TONES[state]}>{CONSENT_STATE_LABELS[state]}</Badge> : null}
        {registerReadable && <Link className="director-consent__history" to={DIRECTOR_CONSENT_HISTORY_HREF}>Consent history</Link>}
      </div>

      {!registerReadable ? (
        <p className="muted director-consent__empty">Your role can't read the consent history.</p>
      ) : !consentState || consentRows === undefined ? (
        <p className="muted director-consent__empty">Loading consent records…</p>
      ) : (
        <>
          <p className="director-consent__state">{stateLine(consentState.state, current, consentState.upcomingEffectiveDate, consentState)}</p>
          {consentState.currentId && !current && (
            <p className="muted director-consent__empty">The entry in effect cites a document your role can't open.</p>
          )}
          {current && <ConsentFacts organizationId={organization._id} entry={current} bases={bases} timingNote={consentState.basisNotAcceptedReason ? undefined : consentTimingNote(current, organization)} />}
          {upcoming && consentState.state !== "scheduled" && (
            <p className="muted director-consent__empty">
              {upcoming.event === "Withdrawn" ? "A withdrawal" : "A new entry"} takes effect {upcoming.effectiveDate ? formatDate(upcoming.effectiveDate) : "later"}.
            </p>
          )}
          {consentState.state === "scheduled" && upcoming && <ConsentFacts organizationId={organization._id} entry={upcoming} bases={bases} timingNote={consentTimingNote(upcoming, organization)} />}
        </>
      )}

      {recording ? (
        <ConsentRecordForm
          organizationId={organization._id}
          director={director}
          mode={recording}
          bases={bases}
          onDone={() => setRecording(null)}
        />
      ) : reviewing && consentState?.currentId ? (
        <ConsentReviewForm
          organizationId={organization._id}
          consentId={consentState.currentId}
          decision={reviewing}
          readiness={current ? consentReviewProblem({ ...current, documentId: current.documentMissing ? undefined : current.documentId }, organization) : undefined}
          enteredBy={current ? current.enteredBy ?? current.recordedBy : undefined}
          onDone={() => setReviewing(null)}
        />
      ) : (
        <div className="director-consent__actions">
          {canReview && state !== "verified" && (
            <button type="button" className="btn btn--accent btn--sm" onClick={() => setReviewing("Reviewed")} title="Confirm you checked the evidence for this basis">
              Mark reviewed
            </button>
          )}
          {canReview && state !== "disputed" && (
            <button type="button" className="btn btn--sm" onClick={() => setReviewing("Disputed")}>Mark disputed</button>
          )}
          {canManage && registerReadable && (
            <>
              {bases.some((option) => option.value === "Written consent") && (
                <button type="button" className={recordClass} disabled={busy} onClick={() => setRecording("written")}>Record written consent</button>
              )}
              {meetingBasis && (
                <button type="button" className={recordClass} disabled={busy} onClick={() => setRecording("meeting")}>Record meeting basis</button>
              )}
              <button type="button" className={recordClass} disabled={busy} onClick={() => setRecording("elsewhere")}>Evidence held elsewhere</button>
            </>
          )}
          {needsBasis && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={!forms.available || forms.busy}
              title={forms.available ? `Prepare a consent form for ${name}, effective from the term start` : forms.unavailableReason}
              onClick={() => void forms.prepare([String(director._id)], director.termStart || todayDateOnly())}
            >
              <FileSignature size={12} /> {forms.busy ? "Preparing…" : "Generate consent form"}
            </button>
          )}
          {canManage && onCorrectRecord && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onCorrectRecord} title="Edit the director's name, term or status above">
              Correct director record
            </button>
          )}
          {canManage && state === "legacy_flag_only" && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={clearLegacyFlag}>Clear mark</button>
          )}
        </div>
      )}
    </section>
  );
}

/** The particulars of one register entry: basis, dates, evidence and review. */
function ConsentFacts({ organizationId, entry, bases, timingNote }: {
  organizationId: string;
  entry: ConsentRegisterRow;
  bases: ConsentBasisOption[];
  /** When the consent was signed relative to the appointment, if the Act cares (CBCA, OBCA). */
  timingNote?: string;
}) {
  const { can } = usePermissions();
  const canReadDocuments = can("documents:read");
  const linkedDocuments = useQuery(
    api.documents.listSummaries,
    canReadDocuments && entry.documentId && !entry.documentMissing ? { societyId: organizationId } : "skip",
  ) as DocumentSummary[] | undefined;
  const choices = useQuery(
    api.businessEvidence.choices,
    entry.meetingId ? { societyId: organizationId, register: "directorConsents" } : "skip",
  ) as Record<string, Choice[]> | undefined;

  const basisLabel = bases.find((option) => option.value === entry.basis)?.label ?? entry.basis ?? "Not recorded";
  const documentTitle = linkedDocuments?.find((doc) => doc._id === entry.documentId)?.title ?? "Supporting document";
  const meetingLabel = choices?.meetings?.find((meeting) => meeting.id === entry.meetingId)?.label ?? "Linked meeting";
  const heldElsewhere = [entry.evidenceLocation, entry.evidenceReference && `ref. ${entry.evidenceReference}`, entry.custodian && `custodian ${entry.custodian}`].filter(Boolean).join(" · ");
  return (
    <dl className="director-consent__facts">
      <div className="director-consent__fact--wide"><dt>Basis</dt><dd>{basisLabel}{entry.event === "Withdrawn" ? " (withdrawn)" : entry.event === "Corrected" ? " (corrected)" : ""}</dd></div>
      <div><dt>Effective</dt><dd>{entry.effectiveDate ? formatDate(entry.effectiveDate) : "Not recorded"}</dd></div>
      {entry.signedOn && <div><dt>Signed</dt><dd>{formatDate(entry.signedOn)}</dd></div>}
      {timingNote && <div className="director-consent__fact--wide"><dt>Timing</dt><dd>{timingNote}</dd></div>}
      <div className={entry.selfReviewed ? "director-consent__fact--wide" : undefined}><dt>Review</dt><dd>{entry.reviewStatus === "Reviewed" || entry.reviewStatus === "Disputed"
        ? `${entry.reviewStatus}${entry.reviewedAt ? ` ${formatDate(entry.reviewedAt)}` : ""}`
        : "Awaiting review"}
        {entry.selfReviewed && <span className="muted"> · Recorded and reviewed by the same person</span>}</dd></div>
      {entry.meetingId && (
        <div className="director-consent__fact--wide"><dt>Meeting</dt><dd><Link to={`/app/meetings/${entry.meetingId}`}>{meetingLabel}</Link></dd></div>
      )}
      {heldElsewhere && <div className="director-consent__fact--wide"><dt>Evidence held</dt><dd>{heldElsewhere}</dd></div>}
      {(entry.documentId || (!entry.meetingId && !heldElsewhere)) && (
        <div className="director-consent__fact--wide">
          <dt>Document</dt>
          <dd>
            {entry.documentMissing
              ? <span className="muted">Supporting document deleted</span>
              : entry.documentId
                ? <Link to={`/app/documents/${entry.documentId}`}>{documentTitle}</Link>
                : <span className="muted">None linked</span>}
          </dd>
        </div>
      )}
    </dl>
  );
}

const MODE_COPY: Record<RecordMode, { save: string; done: string }> = {
  written: { save: "Save written consent", done: "Written consent recorded" },
  meeting: { save: "Save meeting basis", done: "Meeting basis recorded" },
  elsewhere: { save: "Save evidence location", done: "Consent basis recorded" },
};

/** Records a "Consent to act" entry (awaiting review) in the consent register. */
function ConsentRecordForm({ organizationId, director, mode, bases, onDone }: {
  organizationId: string;
  director: ConsentDirector;
  mode: RecordMode;
  bases: ConsentBasisOption[];
  onDone: () => void;
}) {
  const { can } = usePermissions();
  const toast = useToast();
  const save = useMutation(api.businessEvidence.save);
  const canReadDocuments = can("documents:read");
  const documents = useQuery(api.documents.listSummaries, canReadDocuments ? { societyId: organizationId } : "skip") as DocumentSummary[] | undefined;
  const choices = useQuery(api.businessEvidence.choices, mode === "meeting" ? { societyId: organizationId, register: "directorConsents" } : "skip") as Record<string, Choice[]> | undefined;
  const initialBasis = mode === "written" ? "Written consent" : mode === "meeting" ? "Meeting record" : bases[0]?.value ?? "";
  const [draft, setDraft] = useState<Draft>(() => ({
    event: "Given", basis: initialBasis, effectiveDate: director.termStart ?? "", signedOn: "", documentId: "",
    meetingId: "", evidenceLocation: "", evidenceReference: "", custodian: "",
  }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const basisOption = bases.find((option) => option.value === draft.basis);
  const writtenBasis = bases.find((option) => option.value === "Written consent");
  const withdrawing = draft.event === "Withdrawn";

  const submit = async () => {
    if (saving) return;
    if (!draft.effectiveDate) return setError("Effective date is required.");
    if (!withdrawing && mode === "meeting" && !draft.meetingId && !draft.evidenceReference.trim()) return setError("Choose the meeting, or give the meeting record's reference.");
    if (!withdrawing && mode === "elsewhere" && !draft.evidenceLocation.trim()) return setError("Say where the evidence is held.");
    setSaving(true);
    setError("");
    const optional = (key: keyof Draft) => (draft[key].trim() ? { [key]: draft[key].trim() } : {});
    try {
      await save({
        societyId: organizationId,
        register: "directorConsents",
        values: {
          directorId: director._id,
          scope: CONSENT_TO_ACT_SCOPE,
          event: draft.event,
          effectiveDate: draft.effectiveDate,
          reviewStatus: "Awaiting review",
          ...(withdrawing ? {} : optional("basis")),
          ...(mode === "written" ? optional("signedOn") : {}),
          ...(mode === "meeting" ? optional("meetingId") : {}),
          ...optional("evidenceReference"),
          ...(mode === "elsewhere" ? { ...optional("evidenceLocation"), ...optional("custodian") } : {}),
        },
        documentId: draft.documentId || undefined,
      });
      toast.success(withdrawing ? "Consent withdrawal recorded" : MODE_COPY[mode].done, withdrawing
        ? `Saved to the consent history for ${directorName(director)}.`
        : `Saved for ${directorName(director)}. It counts once someone reviews the evidence.`);
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
        <Field label="Effective date" required hint={withdrawing ? undefined : "The date they were elected or appointed."}>
          <DatePicker value={draft.effectiveDate} onChange={(value) => setDraft({ ...draft, effectiveDate: value })} />
        </Field>
      </div>
      {mode === "elsewhere" && !withdrawing && (
        <Field label="Basis" hint={basisOption?.evidence}>
          <Select value={draft.basis} onChange={(value) => setDraft({ ...draft, basis: value })} options={bases.map((option) => ({ value: option.value, label: option.label }))} />
        </Field>
      )}
      {mode === "written" && !withdrawing && (
        <Field label="Signed on" hint={writtenBasis?.evidence}>
          <DatePicker value={draft.signedOn} clearable max={todayDateOnly()} onChange={(value) => setDraft({ ...draft, signedOn: value })} />
        </Field>
      )}
      {mode === "meeting" && !withdrawing && (
        <Field label="Meeting" hint={bases.find((option) => option.value === "Meeting record")?.label}>
          <Select
            value={draft.meetingId}
            placeholder={choices === undefined ? "Loading meetings…" : "Choose the meeting"}
            clearable
            clearLabel="None"
            searchable
            options={(choices?.meetings ?? []).map((meeting) => ({ value: meeting.id, label: meeting.label }))}
            onChange={(value) => setDraft({ ...draft, meetingId: value })}
          />
        </Field>
      )}
      {mode === "elsewhere" && (
        <>
          <Field label="Evidence held at" required={!withdrawing} hint="For example: paper minute book at the registered office, or the law firm's records.">
            <input className="input" value={draft.evidenceLocation} onChange={(event) => setDraft({ ...draft, evidenceLocation: event.target.value })} />
          </Field>
          <Field label="Custodian" hint="Who holds it and can produce it.">
            <input className="input" value={draft.custodian} onChange={(event) => setDraft({ ...draft, custodian: event.target.value })} />
          </Field>
        </>
      )}
      <Field label={mode === "meeting" ? "Minutes or attendance reference" : "Reference"} hint={mode === "meeting" ? "Optional when the meeting is chosen; for example, the minutes item recording the election." : "Optional: a file number, page or tab."}>
        <input className="input" value={draft.evidenceReference} onChange={(event) => setDraft({ ...draft, evidenceReference: event.target.value })} />
      </Field>
      {canReadDocuments && (
        <Field label={mode === "meeting" ? "Minutes or record document" : mode === "written" ? "Signed consent document" : "Copy in Documents"} hint="Optional. Add the file to Documents first, then choose it here.">
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
          {saving ? "Saving…" : withdrawing ? "Save withdrawal" : MODE_COPY[mode].save}
        </button>
        <button type="button" className="btn btn--sm" disabled={saving} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
