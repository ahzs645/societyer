/**
 * The director drawer's review step for a "Consent to act" entry: Mark
 * reviewed / Mark disputed write a new version of the entry, and the server
 * records who and when (`businessEvidence:reviewDirectorConsent`). Recording
 * and reviewing your own entry is allowed (a small organization may have one
 * secretary) but stamped; the form says so before you confirm.
 */
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useCurrentUserId } from "@/hooks/useCurrentUser";
import { Banner, Field } from "../../components/ui";
import { useToast } from "../../components/Toast";

/** Marks the entry in effect Reviewed or Disputed; the server records who and when. */
export function ConsentReviewForm({ organizationId, consentId, decision, readiness, enteredBy, onDone }: {
  organizationId: string;
  consentId: string;
  decision: "Reviewed" | "Disputed";
  /** Why the entry can't be marked reviewed yet, when known. */
  readiness: string | undefined;
  /** Who recorded the entry's particulars. */
  enteredBy: string | undefined;
  onDone: () => void;
}) {
  const toast = useToast();
  const userId = useCurrentUserId();
  const ownEntry = Boolean(userId && enteredBy && String(userId) === String(enteredBy));
  const review = useMutation(api.businessEvidence.reviewDirectorConsent);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const blocked = decision === "Reviewed" ? readiness : undefined;

  const submit = async () => {
    if (saving || blocked) return;
    if (decision === "Disputed" && !note.trim()) return setError("Say what is wrong with the recorded basis.");
    setSaving(true);
    setError("");
    try {
      await review({ societyId: organizationId, consentId, decision, ...(note.trim() ? { note: note.trim() } : {}) });
      toast.success(decision === "Reviewed" ? "Consent basis verified" : "Consent basis marked disputed");
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record the review.");
      setSaving(false);
    }
  };

  return (
    <div className="director-consent__form">
      {error && <Banner tone="danger">{error}</Banner>}
      {blocked && <Banner tone="warn">{blocked}</Banner>}
      <p className="director-consent__note">
        {decision === "Reviewed"
          ? "You're confirming that you checked the evidence and it supports this basis. Your name and today's date are recorded with the entry."
          : "The entry stays in the history, marked disputed with your name, today's date and your note."}
        {ownEntry && " You recorded this entry, so the review will show it was recorded and reviewed by the same person."}
      </p>
      <Field label={decision === "Reviewed" ? "Review note" : "What is wrong"} required={decision === "Disputed"}>
        <textarea className="input" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <div className="director-consent__actions">
        <button type="button" className={decision === "Reviewed" ? "btn btn--accent btn--sm" : "btn btn--danger btn--sm"} disabled={saving || Boolean(blocked)} onClick={submit}>
          {saving ? "Saving…" : decision === "Reviewed" ? "Mark reviewed" : "Mark disputed"}
        </button>
        <button type="button" className="btn btn--sm" disabled={saving} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
