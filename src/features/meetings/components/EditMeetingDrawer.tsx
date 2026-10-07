/**
 * "Edit meeting" (ui-meetings F2/F3/F14, schema B8, A13, A18): one drawer for
 * every correction a reviewer makes to a transposed meeting — title, body
 * (board, special meetings, AGM/SGM, each committee, external bodies), date
 * with its precision, local start/end time text and time zone, venue and
 * electronic participation, status (incl. Cancelled and Held — minutes
 * missing) and notes. The source header is shown alongside so corrections can
 * be made against what the document actually says.
 */
import { useEffect, useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Drawer, Field } from "@/components/ui";
import { Select } from "@/components/Select";
import { Toggle } from "@/components/Controls";
import { NameAutocomplete } from "@/components/NameAutocomplete";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { DatePicker } from "@/components/DatePicker";
import { useToast } from "@/components/Toast";
import { usePermissions } from "@/hooks/usePermissions";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";
import { MEETING_STATUS_LABELS, MEETING_STATUS_OPTIONS } from "../../../../shared/meetingStatus";
import { bodyChoiceIssue, bodyPatchForValue, bodyValueForMeeting, meetingBodyOptions } from "../../../../shared/meetingBodyPicker";
import { formatMeetingDate } from "../../../../shared/meetingDates";
import { clockTextTo24h, meetingDateDraftFrom, meetingDateDraftIssue, meetingDatePatchFromDraft, type MeetingDateDraft } from "../../../../shared/meetingDateEdit";
import { normalizedMeetingTitle, titleForChangedDate } from "../lib/meetingDetailHelpers";
import { cleanSourceLocation } from "../../../../shared/meetingSourceHeader";
import { useDirtyCloseGuard } from "../lib/useDirtyCloseGuard";

export const COMMON_TIME_ZONES = [
  "America/Vancouver",
  "America/Edmonton",
  "America/Regina",
  "America/Winnipeg",
  "America/Toronto",
  "America/Halifax",
  "America/St_Johns",
  "America/Whitehorse",
  "UTC",
];

type Draft = {
  title: string;
  body: string;
  externalOrganization: string;
  date: MeetingDateDraft;
  location: string;
  electronic: boolean;
  status: string;
  quorumRequired: string;
  notes: string;
};

function viewerTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function draftFromMeeting(meeting: any): Draft {
  return {
    title: meeting.title ?? "",
    body: bodyValueForMeeting(meeting),
    externalOrganization: meeting.externalOrganization ?? "",
    date: meetingDateDraftFrom(meeting, viewerTimeZone()),
    location: meeting.location ?? "",
    electronic: !!meeting.electronic,
    status: meeting.status ?? "Scheduled",
    quorumRequired: meeting.quorumRequired != null ? String(meeting.quorumRequired) : "",
    notes: meeting.notes ?? "",
  };
}

/** "3:00 PM – 4:00 PM" / "(noon – 1:30 PM)" → start and end text. */
export function splitSourceTimeText(text: unknown): { start: string; end: string } {
  const cleaned = String(text ?? "").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return { start: "", end: "" };
  const parts = cleaned.split(/\s*(?:–|—|-|\bto\b)\s*/i).map((part) => part.trim()).filter(Boolean);
  return { start: parts[0] ?? "", end: parts.slice(1).join(" – ") };
}

export function EditMeetingDrawer({
  open,
  onClose,
  meeting,
  minutes,
  committees,
  recentLocations = [],
}: {
  open: boolean;
  onClose: () => void;
  meeting: any;
  minutes?: any;
  committees: any[] | undefined;
  recentLocations?: string[];
}) {
  const { can } = usePermissions();
  const canWrite = can("meetings:write");
  const update = usePermissionedMutation(api.meetings.update, canWrite);
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [initial, setInitial] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!open || !meeting) {
      setDraft(null);
      return;
    }
    const next = draftFromMeeting(meeting);
    setDraft(next);
    setInitial(JSON.stringify(next));
    setShowErrors(false);
    // Only re-seed when the drawer opens or a different meeting is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, meeting?._id]);

  const dirty = !!draft && JSON.stringify(draft) !== initial;
  const guardedClose = useDirtyCloseGuard(dirty, onClose, "meeting edits");
  const bodyOptions = useMemo(
    () => meetingBodyOptions((committees ?? []).map((row: any) => ({ _id: String(row._id), name: row.name, status: row.status }))).map((option) => ({ value: option.value, label: option.label, hint: option.group })),
    [committees],
  );
  const statusOptions = useMemo(() => {
    const opts = [...MEETING_STATUS_OPTIONS] as Array<{ value: string; label: string }>;
    if (meeting?.status && !opts.some((row) => row.value === meeting.status)) {
      opts.push({ value: meeting.status, label: MEETING_STATUS_LABELS[meeting.status] ?? meeting.status });
    }
    return opts;
  }, [meeting?.status]);

  if (!meeting) return null;
  const header = minutes?.sourceMeetingRecord?.header ?? null;
  const patchDraft = (diff: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...diff } : current));
  const patchDate = (diff: Partial<MeetingDateDraft>) => setDraft((current) => (current ? {
    ...current,
    // "Board meeting — 2026-10-22" follows a changed date.
    title: diff.date !== undefined ? titleForChangedDate(current.title, current.date.date, diff.date) : current.title,
    date: { ...current.date, ...diff },
  } : current));

  const titleIssue = draft && !normalizedMeetingTitle(draft.title) ? "Enter a meeting title." : null;
  const bodyIssue = draft ? bodyChoiceIssue(draft.body, draft.externalOrganization) : null;
  const dateIssue = draft ? meetingDateDraftIssue(draft.date) : null;
  const quorumIssue = draft && draft.quorumRequired.trim() && !(Number(draft.quorumRequired) >= 0 && Number.isInteger(Number(draft.quorumRequired)))
    ? "Quorum must be a whole number." : null;
  const issues = [titleIssue, bodyIssue, dateIssue, quorumIssue].filter(Boolean) as string[];
  const preview = draft ? meetingDatePatchFromDraft(draft.date, viewerTimeZone()) : null;

  const save = async () => {
    if (!draft || !canWrite) return;
    setShowErrors(true);
    if (issues.length || !preview) return;
    setSaving(true);
    try {
      const body = bodyPatchForValue(draft.body);
      const quorum = draft.quorumRequired.trim() ? Number(draft.quorumRequired) : undefined;
      await update({
        id: meeting._id,
        patch: {
          title: normalizedMeetingTitle(draft.title),
          type: body.type,
          ...(body.committeeId ? { committeeId: body.committeeId as any } : {}),
          ...(body.clearCommitteeId ? { clearCommitteeId: true } : {}),
          special: body.special,
          hostBody: body.hostBody,
          externalOrganization: body.hostBody === "external" ? draft.externalOrganization.trim() : "",
          ...preview,
          location: draft.location.trim(),
          electronic: draft.electronic,
          status: draft.status,
          ...(quorum !== undefined ? { quorumRequired: quorum } : {}),
          notes: draft.notes,
        },
      });
      toast.success("Meeting updated", normalizedMeetingTitle(draft.title));
      setInitial(JSON.stringify(draft));
      onClose();
    } catch (error: any) {
      toast.error("Could not save the meeting", error?.message ?? String(error));
    } finally {
      setSaving(false);
    }
  };

  const sourceTime = splitSourceTimeText(header?.timeText);
  const sourceHeading = String(header?.literalTitle ?? "").replace(/\s+/g, " ").trim();

  return (
    <Drawer
      open={open && !!draft}
      onClose={() => { void guardedClose(); }}
      title="Edit meeting"
      footer={
        <>
          <button className="btn" type="button" onClick={() => { void guardedClose(); }}>Cancel</button>
          <button className="btn btn--accent" type="button" onClick={() => { void save(); }} disabled={!canWrite || saving || (showErrors && issues.length > 0)} data-testid="edit-meeting-save">
            {saving ? "Saving…" : "Save meeting"}
          </button>
        </>
      }
    >
      {draft && (
        <div className="meeting-form edit-meeting-form">
          {header && (
            <div className="edit-meeting-form__source" aria-label="As written in source">
              <div className="edit-meeting-form__source-head"><FileText size={12} /> As written in the source</div>
              <dl>
                {header.literalTitle && <><dt>Heading</dt><dd>{header.literalTitle}</dd></>}
                {header.dateText && <><dt>Date</dt><dd>{header.dateText}</dd></>}
                {header.timeText && <><dt>Time</dt><dd>{header.timeText}</dd></>}
                {header.locationText && <><dt>Location</dt><dd>{header.locationText}</dd></>}
              </dl>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {sourceHeading && sourceHeading !== normalizedMeetingTitle(draft.title) && (
                  <button type="button" className="btn-action" onClick={() => patchDraft({ title: sourceHeading })} data-testid="edit-meeting-use-source-heading">
                    Use source heading as title
                  </button>
                )}
                {header.timeText && (
                  <button
                    type="button"
                    className="btn-action"
                    data-testid="edit-meeting-use-source-time"
                    onClick={() => {
                      // A stated start time also becomes the real start instant
                      // (in the meeting's zone, or the viewer's when none is set).
                      const start24 = clockTextTo24h(sourceTime.start);
                      patchDate({
                        localStartText: sourceTime.start,
                        localEndText: sourceTime.end,
                        ...(start24 ? { precision: "datetime" as const, time: start24 } : {}),
                      });
                    }}
                  >
                    Use source time
                  </button>
                )}
                {header.locationText && (
                  <button type="button" className="btn-action" onClick={() => patchDraft({ location: cleanSourceLocation(header.locationText) })}>
                    Use source location
                  </button>
                )}
              </div>
            </div>
          )}
          <Field label="Title" required error={showErrors ? titleIssue : undefined} hint={meeting.sourceTitle && meeting.sourceTitle !== draft.title ? `As imported: ${meeting.sourceTitle}` : undefined}>
            <input className="input" value={draft.title} onChange={(event) => patchDraft({ title: event.target.value })} aria-label="Meeting title" />
          </Field>
          <Field label="Body" error={showErrors ? bodyIssue : undefined} hint="Board, a special meeting, AGM/SGM, a committee, or another organization's meeting you attended.">
            <Select value={draft.body} onChange={(body) => patchDraft({ body })} options={bodyOptions} searchable aria-label="Meeting body" />
          </Field>
          {draft.body === "external" && (
            <Field label="External organization" required>
              <input className="input" value={draft.externalOrganization} onChange={(event) => patchDraft({ externalOrganization: event.target.value })} />
            </Field>
          )}
          <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field label="Date" required error={showErrors ? dateIssue : undefined}>
              <DatePicker value={draft.date.date} onChange={(value) => patchDate({ date: value })} />
            </Field>
            <Field label="Start time known?">
              <Toggle
                checked={draft.date.precision === "datetime"}
                onChange={(on) => patchDate({ precision: on ? "datetime" : "date" })}
                label={draft.date.precision === "datetime" ? "Exact start time" : "Date only"}
              />
            </Field>
            {draft.date.precision === "datetime" && (
              <Field label="Start time">
                <input className="input" type="time" value={draft.date.time} onChange={(event) => patchDate({ time: event.target.value })} aria-label="Start time" />
              </Field>
            )}
          </div>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <Field label="Start (as written)" hint="e.g. 6:00 PM, noon">
              <input className="input" value={draft.date.localStartText} onChange={(event) => patchDate({ localStartText: event.target.value })} aria-label="Start time as written" />
            </Field>
            <Field label="End (as written)">
              <input className="input" value={draft.date.localEndText} onChange={(event) => patchDate({ localEndText: event.target.value })} aria-label="End time as written" />
            </Field>
            <Field label="Time zone">
              <Select
                value={draft.date.timeZone}
                onChange={(timeZone) => patchDate({ timeZone })}
                clearable
                clearLabel="Viewer's time zone"
                searchable
                options={[...new Set([...COMMON_TIME_ZONES, ...(draft.date.timeZone ? [draft.date.timeZone] : [])])].map((zone) => ({ value: zone, label: zone }))}
                aria-label="Time zone"
              />
            </Field>
          </div>
          {preview && (
            <p className="muted edit-meeting-form__preview" data-testid="edit-meeting-date-preview">
              Shown as: <strong>{formatMeetingDate({ ...preview }, { timeZone: viewerTimeZone(), dateStyle: "long" })}</strong>
            </p>
          )}
          <Field label="Venue / link">
            <NameAutocomplete
              value={draft.location}
              onChange={(location) => patchDraft({ location })}
              options={recentLocations}
              placeholder={draft.electronic ? "Zoom, Teams, or join link…" : "Where was it held?"}
              ariaLabel="Venue or join link"
            />
          </Field>
          <Toggle checked={draft.electronic} onChange={(electronic) => patchDraft({ electronic })} label="Electronic participation" />
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <Field label="Status">
              <Select value={draft.status} onChange={(status) => patchDraft({ status })} options={statusOptions} aria-label="Meeting status" />
            </Field>
            <Field label="Quorum required" error={showErrors ? quorumIssue : undefined}>
              <input className="input" type="number" min={0} value={draft.quorumRequired} onChange={(event) => patchDraft({ quorumRequired: event.target.value })} />
            </Field>
          </div>
          <Field label="Notes">
            <MarkdownEditor rows={3} value={draft.notes} onChange={(notes) => patchDraft({ notes })} />
          </Field>
          {showErrors && issues.length > 0 && (
            <div className="flag flag--warn" role="alert">{issues.join(" ")}</div>
          )}
        </div>
      )}
    </Drawer>
  );
}
