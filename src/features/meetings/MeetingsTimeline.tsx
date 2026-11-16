/**
 * The Meetings page's Timeline layout: meetings grouped by day, what's
 * coming up first, then today and earlier days, the way a notepad lists
 * them. Each row says what the meeting keeps and how far along it is.
 */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mic, NotebookPen, Sparkles, Video } from "lucide-react";
import { meetingBodyLabel } from "../../../shared/meetingBodyPicker";
import { meetingRecordKind } from "../../../shared/meetingRecordKind";
import { groupMeetingsByDay } from "../../../shared/meetingTimeline";
import { startMeetingRecording, recordingSupported, sharedAudioSupported, useMeetingRecorder } from "./recorder/meetingRecorder";

type Row = {
  _id: string;
  title: string;
  scheduledAt: string;
  scheduledAtPrecision?: string;
  status?: string;
  type?: string;
  committeeId?: string;
  hostBody?: string;
  externalOrganization?: string;
  recordKind?: string;
  remoteUrl?: string;
  hasNotesDraft?: boolean;
  noteActionItems?: Array<{ done?: boolean }>;
  location?: string;
};

function timeOf(row: Row) {
  if (row.scheduledAtPrecision === "date") return "";
  const date = new Date(row.scheduledAt);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function MeetingsTimeline({
  meetings,
  committees,
  canRecord,
  minutesStarted,
}: {
  meetings: readonly Row[];
  committees: ReadonlyArray<{ _id: string; name: string }>;
  canRecord: boolean;
  /** Meetings whose minutes have content. */
  minutesStarted: (meetingId: string) => boolean;
}) {
  const navigate = useNavigate();
  const recorder = useMeetingRecorder();
  const [pastDays, setPastDays] = useState(60);
  const live = meetings.filter((row) => row.status !== "Cancelled");
  const { groups, hasEarlier, laterCount } = useMemo(() => groupMeetingsByDay(live, new Date(), { pastDays }), [live, pastDays]);
  const recordingNow = recorder.phase === "recording" || recorder.phase === "starting";

  const joinAndRecord = async (row: Row) => {
    if (row.remoteUrl) window.open(row.remoteUrl, "_blank", "noopener,noreferrer");
    try {
      await startMeetingRecording({ meetingId: row._id, meetingTitle: row.title, sharedAudio: sharedAudioSupported() });
    } catch {
      /* The recording bar shows why. */
    }
    navigate(`/app/meetings/${row._id}?tab=notes&view=notes`);
  };

  if (!groups.length) {
    return (
      <p className="muted meetings-timeline__empty">
        No meetings in the next 30 days or the last {pastDays} days.
        {hasEarlier && <button type="button" className="btn-action" onClick={() => setPastDays((days) => days + 180)}>Show earlier</button>}
      </p>
    );
  }
  return (
    <div className="meetings-timeline" aria-label="Meetings by day">
      {laterCount > 0 && <p className="muted meetings-timeline__later">{laterCount} more scheduled after the next 30 days.</p>}
      {groups.map((group) => (
        <section key={group.key} className={`meetings-timeline__day is-${group.when}`} aria-label={group.label}>
          <h3 className="meetings-timeline__label">{group.label}{group.when === "today" && <span className="meetings-timeline__now">Today</span>}</h3>
          <ul>
            {group.meetings.map((row) => {
              const kind = meetingRecordKind(row);
              const open = (row.noteActionItems ?? []).filter((item) => !item.done).length;
              const upcomingOrToday = group.when !== "past";
              const href = `/app/meetings/${row._id}${kind === "notes" ? "?tab=notes" : kind === "minutes" ? "?tab=minutes" : ""}`;
              return (
                <li key={row._id} className="meetings-timeline__row">
                  <span className="meetings-timeline__time">{timeOf(row) || "—"}</span>
                  <span className="meetings-timeline__main">
                    <Link to={href} className="meetings-timeline__title">{row.title}</Link>
                    <span className="meetings-timeline__meta">
                      {meetingBodyLabel(row as any, committees as any)}
                      {" · "}
                      {kind === "notes" ? "Notes" : kind === "minutes" ? (minutesStarted(row._id) ? "Minutes started" : "Minutes") : "No write-up"}
                      {row.hasNotesDraft ? <span className="meetings-timeline__chip"><Sparkles size={10} aria-hidden="true" /> AI notes</span> : null}
                      {open > 0 && <span className="meetings-timeline__chip">{open} open action{open === 1 ? "" : "s"}</span>}
                    </span>
                  </span>
                  <span className="meetings-timeline__actions">
                    {upcomingOrToday && row.remoteUrl && canRecord && recordingSupported() && !recordingNow && (
                      <button type="button" className="btn-action" onClick={() => { void joinAndRecord(row); }}>
                        <Video size={12} aria-hidden="true" /> Join & record
                      </button>
                    )}
                    {kind === "notes" && (
                      <Link className="btn-action" to={`/app/meetings/${row._id}?tab=notes&view=notes`} aria-label={`Open notes: ${row.title}`}>
                        <NotebookPen size={12} aria-hidden="true" /> Notes
                      </Link>
                    )}
                    {recorder.meetingId === row._id && recordingNow && <span className="meetings-timeline__chip is-recording"><Mic size={10} aria-hidden="true" /> Recording</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {hasEarlier && (
        <button type="button" className="btn-action meetings-timeline__more" onClick={() => setPastDays((days) => days + 180)}>
          Show earlier meetings
        </button>
      )}
    </div>
  );
}
