import { followUpMotionFingerprint, followUpMotionSelection } from "../../../../shared/followUpScheduling";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../convex/_generated/dataModel";
import { formatMeetingDate } from "../../../../shared/meetingDates";
import { Modal } from "../../../components/Modal";
import { Field } from "../../../components/ui";
import { DateTimeInput } from "../../../components/DateTimeInput";
import { useToast } from "../../../components/Toast";
import { usePermissionedMutation } from "../../../hooks/usePermissionedMutation";
import { toDateTimeLocalValue } from "../../../lib/format";
import { useMeetingFormDraft } from "../useMeetingFormDraft";
import { MeetingDraftRecovery } from "../useMeetingDraft";
import { useDirtyCloseGuard } from "../lib/useDirtyCloseGuard";

type Draft = {
  title: string; type: string; scheduledAt: string; location: string; carryForward: boolean;
  requestId: string; sourceMeetingId: string; sourceMinutesId?: string; motionIndexes: number[];
  electronic: boolean; agendaJson: string;
  sourceMotions: ReturnType<typeof followUpMotionSelection>;
};
function validDraft(value: unknown): value is Draft {
  if (!value || typeof value !== "object") return false;
  const row = value as Draft;
  return ["title", "type", "scheduledAt", "location", "requestId", "sourceMeetingId", "agendaJson"].every((key) => typeof row[key as keyof Draft] === "string")
    && typeof row.carryForward === "boolean" && typeof row.electronic === "boolean"
    && (row.sourceMinutesId === undefined || typeof row.sourceMinutesId === "string")
    && Array.isArray(row.sourceMotions)
    && Array.isArray(row.motionIndexes) && row.motionIndexes.every((index) => Number.isSafeInteger(index) && index >= 0);
}

/** One mutation and one durable request ID, including after reload or an ambiguous response. */
export function ScheduleNextMeetingModal({ societyId, meeting, minutes, sourceMotions, motionIndexes, canSchedule, canCarry, onClose }: {
  societyId: Id<"societies">; meeting: any; minutes: any; sourceMotions: readonly any[]; motionIndexes: number[];
  canSchedule: boolean; canCarry: boolean; onClose: () => void;
}) {
  const create = usePermissionedMutation(api.meetings.create, canSchedule);
  const toast = useToast();
  const navigate = useNavigate();
  const form = useMeetingFormDraft<Draft, null>("next-meeting", validDraft, (value): value is null => value === null);
  const controller = form.controller;
  const draft = form.value;
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    if (controller.getSnapshot()) return;
    controller.begin({
      title: meeting.title, type: meeting.type,
      scheduledAt: minutes?.nextMeetingAt ? toDateTimeLocalValue(new Date(minutes.nextMeetingAt)) : toDateTimeLocalValue(new Date(Date.now() + 28 * 864e5)),
      location: minutes?.nextMeetingLocation ?? meeting.location ?? "",
      carryForward: canCarry && motionIndexes.length > 0,
      requestId: crypto.randomUUID(), sourceMeetingId: String(meeting._id),
      sourceMinutesId: minutes?._id ? String(minutes._id) : undefined,
      motionIndexes, sourceMotions: followUpMotionSelection(sourceMotions, motionIndexes), electronic: !!meeting.electronic,
      agendaJson: JSON.stringify([{
        title: `Approval of minutes — ${meeting.title}`, type: "motion",
        motionText: `BE IT RESOLVED THAT the minutes of ${meeting.title} held ${formatMeetingDate(meeting, { withTime: false })} be approved as circulated.`,
        adoptsMinutesId: minutes?._id ? String(minutes._id) : undefined,
      }]),
    }, null);
    // Only opening this editor seeds a draft. Live query refreshes never replace typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);
  const close = useDirtyCloseGuard(controller.dirty(), () => { controller.discard(); onClose(); }, "next-meeting details");
  const guardedClose = () => { if (!inFlight.current) void close(); };
  const patch = (changes: Partial<Draft>) => controller.change((current) => ({ ...current, ...changes }));
  const save = async () => {
    const snapshot = controller.getSnapshot();
    if (!snapshot || !canSchedule || inFlight.current) return;
    const value = snapshot.value;
    if (!value.title.trim() || !value.scheduledAt || !Number.isFinite(new Date(value.scheduledAt).getTime())) { toast.error("Enter a title and valid meeting date."); return; }
    if (value.carryForward && !canCarry) { toast.error("Motion editing permission is required to carry forward business."); return; }
    if (value.sourceMeetingId !== String(meeting._id)) { toast.error("This draft belongs to a different source meeting."); return; }
    inFlight.current = true; setBusy(true);
    try {
      // Persist the request even when no field has changed from its defaults.
      // Do not start a write that would lose its replay key if this tab closes.
      controller.restore({ ...snapshot, requiresSave: true });
      if (!form.recovery.journal?.getSnapshot().savedOnDevice) throw new Error("Could not save scheduling recovery on this device. No meeting was created.");
      const submitted = controller.capture();
      if (!submitted) return;
      const id = await create({
        societyId, title: value.title.trim(), type: value.type, scheduledAt: value.scheduledAt,
        location: value.location.trim() || undefined, electronic: value.electronic, status: "Scheduled", attendeeIds: [], agendaJson: value.agendaJson,
        followUp: { requestId: value.requestId, sourceMeetingId: value.sourceMeetingId as Id<"meetings">,
          sourceMinutesId: value.sourceMinutesId as Id<"minutes"> | undefined,
          motionIndexes: value.carryForward ? value.motionIndexes : [],
          sourceMotionFingerprint: value.carryForward ? await followUpMotionFingerprint(value.sourceMotions) : undefined,
        },
      });
      if (!controller.isCurrent(submitted)) { controller.complete(submitted, null); return; }
      if (controller.complete(submitted, null)) {
        toast.success("Next meeting scheduled", "The meeting, minutes approval and selected carried-forward business were saved together.");
        onClose(); navigate(`/app/meetings/${id}`);
      }
    } catch (error) {
      if (form.recovery.journal?.isActive()) toast.error("Next meeting was not confirmed", `${error instanceof Error ? error.message : "Please try again."} Your draft and retry key are kept.`);
    } finally { inFlight.current = false; setBusy(false); }
  };
  return <Modal open onClose={guardedClose} title="Schedule next meeting" size="md" footer={<>
    <button type="button" className="btn" disabled={busy} onClick={guardedClose}>Cancel</button>
    <button type="button" className="btn btn--accent" disabled={!canSchedule || busy || !draft?.title.trim()} onClick={() => void save()}>{busy ? "Scheduling…" : "Schedule meeting"}</button>
  </>}>
    <MeetingDraftRecovery draft={form.recovery} label="next-meeting" disabled={controller.dirty() || busy || !canSchedule} onRestore={controller.restore} />
    <p className="muted">Creates the meeting and its agenda in one transaction. Retrying this draft uses the same request, not a second meeting.</p>
    {draft && <fieldset disabled={busy || !canSchedule} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <Field label="Meeting title"><input className="input" value={draft.title} onChange={(event) => patch({ title: event.target.value })} /></Field>
      <Field label="Type"><input className="input" value={draft.type} onChange={(event) => patch({ type: event.target.value })} /></Field>
      <Field label="Date & time"><DateTimeInput value={draft.scheduledAt} onChange={(scheduledAt) => patch({ scheduledAt })} /></Field>
      <Field label="Location"><input className="input" value={draft.location} placeholder="Venue or join link" onChange={(event) => patch({ location: event.target.value })} /></Field>
      {draft.motionIndexes.length > 0 && <label className="checkbox"><input type="checkbox" checked={draft.carryForward} disabled={!canCarry} onChange={(event) => patch({ carryForward: event.target.checked })} />
        Carry forward {draft.motionIndexes.length} tabled/deferred motions onto the agenda and motion backlog
      </label>}
    </fieldset>}
  </Modal>;
}
