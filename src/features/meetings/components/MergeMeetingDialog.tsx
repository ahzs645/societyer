/**
 * Merge a duplicate meeting (ui-meetings F17). Imports created one meeting per
 * source variant (draft/approved, .doc/.pdf, "copy"); this folds one into the
 * other with a preview of exactly what moves, then a confirmation.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { ArrowRight, Merge } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { Checkbox } from "@/components/Controls";
import { Badge, Field } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { usePermissions } from "@/hooks/usePermissions";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";
import { formatMeetingDate } from "../../../../shared/meetingDates";
import { meetingBodyLabel } from "../../../../shared/meetingBodyPicker";

const REFERENCE_LABELS: Record<string, string> = {
  tasks: "tasks",
  meetingAttendanceRecords: "attendance register rows",
  motionEvidence: "motion evidence rows",
  meetingMaterials: "meeting materials",
  documents: "documents",
  motions: "motions (adoption / backlog links)",
  personOccurrences: "person occurrences",
  minutes: "minutes approval links",
  transcripts: "transcripts",
  conflicts: "conflict declarations",
  proxies: "proxies",
  policies: "policies",
  financials: "financial statements",
};

export function MergeMeetingDialog({
  meeting,
  meetings,
  committees,
  suggestedIds,
  onClose,
}: {
  meeting: any;
  meetings: any[];
  committees: any[];
  suggestedIds: string[];
  onClose: () => void;
}) {
  const { can } = usePermissions();
  const canMerge = can("meetings:write") && can("minutes:write") && can("motions:write") && can("agendas:write");
  const merge = usePermissionedMutation(api.meetings.merge, canMerge);
  const toast = useToast();
  const navigate = useNavigate();
  const [otherId, setOtherId] = useState<string>(suggestedIds[0] ?? "");
  const [keepThis, setKeepThis] = useState(true);
  const [addMissingAttendees, setAddMissingAttendees] = useState(false);
  const [busy, setBusy] = useState(false);
  const targetId = keepThis ? String(meeting._id) : otherId;
  const duplicateId = keepThis ? otherId : String(meeting._id);
  const preview = useQuery(api.meetings.mergePreview, otherId && canMerge && !busy ? { targetId: targetId as any, duplicateId: duplicateId as any, addMissingAttendees } : "skip") as any;

  const options = useMemo(() => {
    const suggested = new Set(suggestedIds);
    const describe = (row: any) => `${formatMeetingDate(row, { withTime: false })} · ${meetingBodyLabel(row, committees)} · ${row.title}`;
    const rows = meetings.filter((row) => String(row._id) !== String(meeting._id));
    return [
      ...rows.filter((row) => suggested.has(String(row._id))).map((row) => ({ value: String(row._id), label: describe(row), hint: "Same day and body" })),
      ...rows.filter((row) => !suggested.has(String(row._id))).map((row) => ({ value: String(row._id), label: describe(row) })),
    ];
  }, [meetings, meeting._id, suggestedIds, committees]);

  const run = async () => {
    if (!preview || preview.blockers?.length || !canMerge) return;
    setBusy(true);
    try {
      const result: any = await merge({ targetId: targetId as any, duplicateId: duplicateId as any, addMissingAttendees });
      toast.success("Meetings merged", `${result.motionsMoved} motion(s) moved, ${result.referencesMoved} linked record(s) re-pointed.`);
      onClose();
      if (!keepThis) navigate(`/app/meetings/${targetId}`);
    } catch (error: any) {
      toast.error("Merge failed", error?.message ?? String(error));
    } finally {
      setBusy(false);
    }
  };

  const refs = Object.entries(preview?.references ?? {}) as Array<[string, number]>;
  return (
    <Modal
      open
      onClose={onClose}
      title="Merge duplicate meeting"
      size="lg"
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn--danger" type="button" disabled={!preview || preview.blockers?.length > 0 || busy || !canMerge} onClick={() => { void run(); }} data-testid="merge-confirm">
            <Merge size={12} /> {busy ? "Merging…" : "Merge and delete duplicate"}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        The duplicate's minutes are kept as an imported source version on the meeting you keep (with a snapshot of
        its content). Motions the kept meeting lacks move over; identical motions are dropped. Tasks, attendance
        rows, materials and other links are re-pointed. The duplicate meeting is then deleted.
      </p>
      <Field label="Other meeting" hint={suggestedIds.length ? `${suggestedIds.length} meeting(s) of the same body on the same day are listed first.` : "No same-day duplicate was found automatically."}>
        <Select value={otherId} onChange={setOtherId} options={options} searchable placeholder="Choose the duplicate…" aria-label="Duplicate meeting" />
      </Field>
      {otherId && (
        <>
          <div className="merge-direction" role="radiogroup" aria-label="Which meeting to keep">
            <label className={`merge-direction__option${keepThis ? " is-active" : ""}`}>
              <input type="radio" checked={keepThis} onChange={() => setKeepThis(true)} /> Keep this meeting
            </label>
            <label className={`merge-direction__option${!keepThis ? " is-active" : ""}`}>
              <input type="radio" checked={!keepThis} onChange={() => setKeepThis(false)} /> Keep the other meeting
            </label>
          </div>
          {preview === undefined ? (
            <p className="muted">Preparing preview…</p>
          ) : (
            <div className="merge-preview" data-testid="merge-preview">
              <div className="merge-preview__pair">
                <div><span className="muted">Duplicate (deleted)</span><strong>{preview.duplicate.title}</strong><span>{preview.duplicate.date}</span></div>
                <ArrowRight size={16} aria-hidden="true" />
                <div><span className="muted">Kept</span><strong>{preview.target.title}</strong><span>{preview.target.date}</span></div>
              </div>
              {preview.blockers?.map((blocker: string) => <div key={blocker} className="flag flag--err" role="alert">{blocker}</div>)}
              {preview.warnings?.map((warning: string) => <div key={warning} className="flag flag--warn">{warning}</div>)}
              <ul className="merge-preview__list">
                <li>
                  {preview.moveMinutesWhole
                    ? "The kept meeting has no minutes: the duplicate's minutes move over unchanged."
                    : preview.duplicateHasMinutes
                      ? <>Duplicate minutes ({preview.duplicateSectionCount} sections) saved as source version <Badge tone={preview.versionStatus === "draft" ? "warn" : "neutral"}>{preview.versionStatus}</Badge> “{preview.versionLabel}”</>
                      : "The duplicate has no minutes."}
                </li>
                <li>{preview.sourceExternalIdsAdded.length} source file link(s) and {preview.sourceDocumentIdsAdded.length} source document(s) added</li>
                <li>{preview.motionsToMove.length} motion(s) moved · {preview.motionsDuplicate.length} identical motion(s) dropped</li>
                {refs.length > 0 && <li>Re-pointed: {refs.map(([table, count]) => `${count} ${REFERENCE_LABELS[table] ?? table}`).join(", ")}</li>}
              </ul>
              {preview.attendeesOnlyInDuplicate.length > 0 && !preview.moveMinutesWhole && (
                <Checkbox
                  checked={addMissingAttendees}
                  onChange={setAddMissingAttendees}
                  label={`Also add ${preview.attendeesOnlyInDuplicate.length} attendee(s) only listed in the duplicate: ${preview.attendeesOnlyInDuplicate.slice(0, 8).join(", ")}${preview.attendeesOnlyInDuplicate.length > 8 ? "…" : ""}`}
                />
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
