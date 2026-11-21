import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Banner, Field } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { Checkbox, RadioGroup } from "../../components/Controls";
import { DatePicker } from "../../components/DatePicker";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import { todayDateOnly } from "../../../shared/dateOnly";
import {
  attestationLine,
  EVIDENCE_KIND_LABELS,
  heldElsewhereEntry,
  type EvidenceFacts,
  type EvidenceField,
  type HeldElsewhereKind,
} from "../../../shared/governingDocumentEvidence";

/**
 * The three small forms behind "Held elsewhere", "Verify current" and
 * "Record review" on the organization profile (and the privacy page). Each
 * records who did it and when; none of them is an automated conclusion.
 */

type SocietyRef = EvidenceFacts & { _id: string };

const errorMessage = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback);

export function HeldElsewhereDialog({
  open,
  onClose,
  society,
  field,
  title,
  phrase,
}: {
  open: boolean;
  onClose: () => void;
  society: SocietyRef;
  field: EvidenceField;
  /** "Constitution", "Privacy policy". */
  title: string;
  /** "the constitution". */
  phrase: string;
}) {
  const save = useMutation(api.society.setGoverningDocumentEvidence);
  const toast = useToast();
  const existing = heldElsewhereEntry(society, field);
  const [kind, setKind] = useState<HeldElsewhereKind>("external");
  const [reference, setReference] = useState("");
  const [custodian, setCustodian] = useState("");
  const [version, setVersion] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setKind(existing?.kind ?? "external");
    setReference(existing?.reference ?? "");
    setCustodian(existing?.custodian ?? "");
    setVersion(existing?.version ?? "");
    setEffectiveDate(existing?.effectiveDate ?? "");
    setBusy(false);
    setError("");
    // Reset only when the dialog opens or switches document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, field]);

  const submit = async () => {
    if (busy || !reference.trim()) return;
    setBusy(true);
    setError("");
    try {
      await save({
        societyId: society._id,
        field,
        evidence: {
          kind,
          reference: reference.trim(),
          ...(custodian.trim() ? { custodian: custodian.trim() } : {}),
          ...(version.trim() ? { version: version.trim() } : {}),
          ...(effectiveDate ? { effectiveDate } : {}),
        },
      });
      toast.success(`${title} recorded as held elsewhere`, EVIDENCE_KIND_LABELS[kind]);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, "Could not save where it is held."));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await save({ societyId: society._id, field, evidence: null });
      toast.success(`Removed where ${phrase} is held`);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, "Could not remove it."));
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${title}: held elsewhere`}
      resizeKey="governing-document-held-elsewhere"
      footer={
        <>
          {existing && <button type="button" className="btn btn--ghost evidence-dialog__remove" onClick={remove} disabled={busy}>Remove</button>}
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn--accent" onClick={submit} disabled={busy || !reference.trim()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="evidence-dialog">
        <p className="evidence-dialog__intro">
          Record where the authoritative copy of {phrase} is kept when it isn&rsquo;t uploaded here. It counts as {phrase} being on record.
        </p>
        {error && <Banner tone="danger">{error}</Banner>}
        <RadioGroup<HeldElsewhereKind>
          value={kind}
          onChange={setKind}
          options={[
            { value: "external", label: EVIDENCE_KIND_LABELS.external, hint: "A registry filing, records portal, shared drive or other system." },
            { value: "physical", label: EVIDENCE_KIND_LABELS.physical, hint: "A paper copy, such as the records binder at the registered office." },
          ]}
        />
        <Field label={kind === "external" ? "Reference or URL" : "Location"} required>
          <input
            className="input"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder={kind === "external" ? "BC Registry filing history, https://…" : "Records binder, registered office"}
            autoFocus
          />
        </Field>
        <Field label="Custodian" hint="Who holds it or can produce it.">
          <input className="input" value={custodian} onChange={(event) => setCustodian(event.target.value)} placeholder="Secretary" />
        </Field>
        <div className="evidence-dialog__pair">
          <Field label="Version">
            <input className="input" value={version} onChange={(event) => setVersion(event.target.value)} placeholder="Consolidated 2024" />
          </Field>
          <Field label="Effective date">
            <DatePicker value={effectiveDate} clearable max={todayDateOnly()} onChange={setEffectiveDate} />
          </Field>
        </div>
        {existing && (
          <p className="evidence-dialog__meta">
            {attestationLine("Recorded", existing.recordedByName, formatDate(existing.recordedAtISO))}
          </p>
        )}
      </div>
    </Modal>
  );
}

export function VerifyCurrentDialog({
  open,
  onClose,
  society,
  field,
  title,
  phrase,
  copyLabel,
}: {
  open: boolean;
  onClose: () => void;
  society: SocietyRef;
  field: EvidenceField;
  title: string;
  phrase: string;
  /** What is being verified: the document title, or where it is held. */
  copyLabel: string;
}) {
  const verify = useMutation(api.society.verifyGoverningDocumentCurrent);
  const toast = useToast();
  const [verifiedAsOf, setVerifiedAsOf] = useState(todayDateOnly());
  const [versionReference, setVersionReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setVerifiedAsOf(todayDateOnly());
    setVersionReference("");
    setNotes("");
    setBusy(false);
    setError("");
  }, [open, field]);

  const submit = async () => {
    if (busy || !verifiedAsOf) return;
    setBusy(true);
    setError("");
    try {
      await verify({
        societyId: society._id,
        field,
        verifiedAsOf,
        ...(versionReference.trim() ? { versionReference: versionReference.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      toast.success(`${title} verified current`, `As of ${formatDate(verifiedAsOf)}`);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, "Could not record the verification."));
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Verify ${phrase} is current`}
      resizeKey="governing-document-verify-current"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn--accent" onClick={submit} disabled={busy || !verifiedAsOf}>
            {busy ? "Saving…" : "Record verification"}
          </button>
        </>
      }
    >
      <div className="evidence-dialog">
        <p className="evidence-dialog__intro">
          Confirm that <strong>{copyLabel}</strong> is the current version of {phrase}, including any amendments filed with the registrar. This is recorded with your name; attaching a file doesn&rsquo;t do this on its own.
        </p>
        {error && <Banner tone="danger">{error}</Banner>}
        <Field label="Verified current as of" required>
          <DatePicker value={verifiedAsOf} clearable={false} max={todayDateOnly()} onChange={setVerifiedAsOf} />
        </Field>
        <Field label="Version or filing reference" hint="The consolidation date, amendment or registry filing you checked against.">
          <input className="input" value={versionReference} onChange={(event) => setVersionReference(event.target.value)} placeholder="Bylaw amendment filed 2023-06-14" />
        </Field>
        <Field label="Notes">
          <textarea className="textarea" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function PrivacyReviewDialog({
  open,
  onClose,
  society,
  defaultLocation,
}: {
  open: boolean;
  onClose: () => void;
  society: SocietyRef;
  /** Prefilled "where maintained": the linked policy or where it is held. */
  defaultLocation?: string;
}) {
  const record = useMutation(api.society.recordPrivacyReview);
  const toast = useToast();
  const previous = society.privacyProgramReview ?? undefined;
  const [policiesReviewed, setPoliciesReviewed] = useState("");
  const [versionOrEffectiveDate, setVersionOrEffectiveDate] = useState("");
  const [maintainedAt, setMaintainedAt] = useState("");
  const [reviewedOn, setReviewedOn] = useState(todayDateOnly());
  const [unresolvedFindings, setUnresolvedFindings] = useState("");
  // Unchecked by default: findings block the program unless the reviewer says otherwise.
  const [minorFollowUps, setMinorFollowUps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setPoliciesReviewed(previous?.policiesReviewed ?? "");
    setVersionOrEffectiveDate(previous?.versionOrEffectiveDate ?? "");
    setMaintainedAt(previous?.maintainedAt ?? defaultLocation ?? "");
    setReviewedOn(todayDateOnly());
    // Findings carry over until a review says they are resolved.
    setUnresolvedFindings(previous?.unresolvedFindings ?? "");
    // Carried-over findings keep the earlier judgement; new findings start blocking.
    setMinorFollowUps(Boolean(previous?.unresolvedFindings) && previous?.findingsBlocking === false);
    setBusy(false);
    setError("");
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    if (busy || !policiesReviewed.trim() || !reviewedOn) return;
    setBusy(true);
    setError("");
    try {
      const result = await record({
        societyId: society._id,
        policiesReviewed: policiesReviewed.trim(),
        reviewedOn,
        ...(versionOrEffectiveDate.trim() ? { versionOrEffectiveDate: versionOrEffectiveDate.trim() } : {}),
        ...(maintainedAt.trim() ? { maintainedAt: maintainedAt.trim() } : {}),
        ...(unresolvedFindings.trim() ? { unresolvedFindings: unresolvedFindings.trim(), findingsBlocking: !minorFollowUps } : {}),
      }) as { documented?: boolean; missingLocation?: boolean };
      if (result?.documented) toast.success("Privacy review recorded", unresolvedFindings.trim() ? "The privacy program is marked documented, with follow-ups noted." : "The privacy program is marked documented.");
      else toast.warn("Privacy review recorded", result?.missingLocation ? "Add where the policy is maintained to mark the program documented." : "The program stays outstanding until the findings are resolved.");
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, "Could not record the review."));
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record privacy review"
      resizeKey="privacy-program-review"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn--accent" onClick={submit} disabled={busy || !policiesReviewed.trim() || !reviewedOn}>
            {busy ? "Saving…" : "Record review"}
          </button>
        </>
      }
    >
      <div className="evidence-dialog">
        <p className="evidence-dialog__intro">
          Your attestation of what you reviewed, recorded with your name. The program is marked documented only when you record where the policy is maintained and leave no unresolved findings, or say the findings are minor follow-ups.
        </p>
        {error && <Banner tone="danger">{error}</Banner>}
        <Field label="Policies and practices reviewed" required>
          <textarea
            className="textarea"
            rows={2}
            value={policiesReviewed}
            onChange={(event) => setPoliciesReviewed(event.target.value)}
            placeholder="Privacy policy, complaint process, access and correction procedure, retention schedule"
            autoFocus
          />
        </Field>
        <div className="evidence-dialog__pair">
          <Field label="Version or effective date">
            <input className="input" value={versionOrEffectiveDate} onChange={(event) => setVersionOrEffectiveDate(event.target.value)} placeholder="v3, effective 2025-09-01" />
          </Field>
          <Field label="Reviewed on" required>
            <DatePicker value={reviewedOn} clearable={false} max={todayDateOnly()} onChange={setReviewedOn} />
          </Field>
        </div>
        <Field label="Where they are maintained" hint="A document in Societyer, a system, or a physical location.">
          <input className="input" value={maintainedAt} onChange={(event) => setMaintainedAt(event.target.value)} placeholder="Documents > Policies, or the staff handbook site" />
        </Field>
        <Field label="Unresolved findings" hint="Anything still to fix. Leave empty only when nothing is outstanding.">
          <textarea className="textarea" rows={3} value={unresolvedFindings} onChange={(event) => setUnresolvedFindings(event.target.value)} />
        </Field>
        {unresolvedFindings.trim() && (
          <Checkbox
            checked={minorFollowUps}
            onChange={setMinorFollowUps}
            label="These are minor follow-ups — the program is in place"
            hint="Leave unchecked if any finding means the policy or practices aren't in place yet."
          />
        )}
        {previous && (
          <p className="evidence-dialog__meta">Last review: {attestationLine("Reviewed", previous.reviewedByName, formatDate(previous.reviewedOn))}</p>
        )}
      </div>
    </Modal>
  );
}
