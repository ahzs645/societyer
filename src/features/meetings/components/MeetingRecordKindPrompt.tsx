/**
 * Overview line for a meeting that keeps no write-up (`recordKind:
 * "meeting"`): an unobtrusive way to start notes or formal minutes later.
 */
import { useState } from "react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useToast } from "@/components/Toast";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";

export function MeetingRecordKindPrompt({
  meetingId,
  canWrite,
  canStartMinutes,
  onSwitched,
}: {
  meetingId: Id<"meetings">;
  /** meetings:write */
  canWrite: boolean;
  /** meetings:write and minutes:write */
  canStartMinutes: boolean;
  onSwitched: (tab: "notes" | "minutes") => void;
}) {
  const toast = useToast();
  const update = usePermissionedMutation(api.meetings.update, canWrite);
  const startMinutesFromNotes = usePermissionedMutation(api.meetings.startMinutesFromNotes, canStartMinutes);
  const [busy, setBusy] = useState(false);

  const switchTo = async (kind: "notes" | "minutes") => {
    if (!canWrite || busy) return;
    setBusy(true);
    try {
      // Notes kept earlier (before this meeting dropped its write-up) go into the
      // minutes draft, and the template's recurring motions are added.
      if (kind === "minutes" && canStartMinutes) {
        await startMinutesFromNotes({ id: meetingId });
      } else {
        await update({ id: meetingId, patch: { recordKind: kind } });
      }
      onSwitched(kind);
    } catch (error) {
      toast.error("Could not change what this meeting keeps", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="record-kind-prompt">
      <span className="record-kind-prompt__text">This meeting keeps no write-up.</span>
      {canWrite && (
        <span className="record-kind-prompt__actions">
          <button type="button" className="btn-action" onClick={() => { void switchTo("notes"); }} disabled={busy}>
            Add notes
          </button>
          <button type="button" className="btn-action" onClick={() => { void switchTo("minutes"); }} disabled={busy}>
            Start minutes
          </button>
        </span>
      )}
    </div>
  );
}
