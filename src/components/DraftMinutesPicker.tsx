/**
 * Quick-action picker triggered by the "Draft minutes" command. Opens when
 * any caller dispatches the `quickaction:draft-minutes` window event (the
 * static-commands `run` is the canonical caller). Lists past meetings that
 * don't yet have a minutes record so the user picks which one to draft for —
 * one click and they land in that meeting's Minutes tab.
 *
 * Lives in the Layout tree alongside the command palette so it's always
 * available regardless of which page is mounted.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { Calendar } from "lucide-react";
import { api } from "../lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { Modal } from "./Modal";
import { Tooltip } from "./Tooltip";
import { Badge } from "./ui";
import { formatDateTime } from "../lib/format";
import { hasStartedMinutesDraft } from "../features/meetings/lib/meetingDetailHelpers";

/**
 * Title for a picker row. Renders the meeting name with ellipsis truncation
 * and shows the full name in a styled tooltip when the visible text gets cut
 * off. The tooltip is suppressed for short titles so we don't echo back text
 * the user can already read in full.
 */
function PickerItemTitle({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setTruncated(el.scrollWidth > el.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);
  return (
    <Tooltip content={text} disabled={!truncated}>
      <span ref={ref} className="quick-action-picker__item-title">{text}</span>
    </Tooltip>
  );
}

export function DraftMinutesPicker() {
  const [open, setOpen] = useState(false);
  const society = useSociety();
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip");
  const minutes = useQuery(api.minutes.list, society ? { societyId: society._id } : "skip");
  const navigate = useNavigate();

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("quickaction:draft-minutes", handler);
    return () => window.removeEventListener("quickaction:draft-minutes", handler);
  }, []);

  // All meetings, with their minutes status surfaced as a badge so the user
  // can decide whether they're starting fresh, continuing a draft, or just
  // wanting to revisit something already approved. Past meetings sort first
  // (newest first — those are the most likely draft targets), then upcoming
  // meetings sort by soonest-first. Capped at 8 so the picker stays focused;
  // the user can still go to /app/meetings for the full list.
  const minutesByMeetingId = useMemo(() => {
    const map = new Map<string, any>();
    for (const m of (minutes ?? []) as any[]) {
      map.set(String(m.meetingId), m);
    }
    return map;
  }, [minutes]);
  const candidates = useMemo(() => {
    if (!meetings || !minutes) return [];
    const now = Date.now();
    return (meetings as any[])
      .filter((m) => m.scheduledAt)
      .sort((a, b) => {
        const ta = new Date(a.scheduledAt).getTime();
        const tb = new Date(b.scheduledAt).getTime();
        const aPast = ta <= now;
        const bPast = tb <= now;
        if (aPast !== bPast) return aPast ? -1 : 1;
        return aPast ? tb - ta : ta - tb;
      })
      .slice(0, 8);
  }, [meetings, minutes]);

  const now = Date.now();

  const isLoading = open && (meetings === undefined || minutes === undefined);

  const handlePick = (meetingId: string) => {
    setOpen(false);
    navigate(`/app/meetings/${meetingId}?tab=minutes&intent=draft-minutes`);
  };

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Draft minutes for…"
      size="sm"
    >
      {isLoading && <div className="muted">Loading meetings…</div>}
      {!isLoading && candidates.length === 0 && (
        <div className="muted">
          No meetings yet. Create a meeting first, then come back here to draft its minutes.
        </div>
      )}
      {!isLoading && candidates.length > 0 && (
        <div className="col" style={{ gap: 4 }}>
          <p className="muted" style={{ fontSize: "var(--fs-sm)", margin: "0 0 8px" }}>
            Pick a meeting to draft or edit its minutes.
          </p>
          {candidates.map((meeting) => {
            const isUpcoming = new Date(meeting.scheduledAt).getTime() > now;
            const meetingMinutes = minutesByMeetingId.get(String(meeting._id));
            const isApproved = !!meetingMinutes?.approvedAt;
            const isDrafted = !isApproved && hasStartedMinutesDraft(meetingMinutes);
            return (
              <button
                key={meeting._id}
                type="button"
                className="quick-action-picker__item"
                onClick={() => handlePick(meeting._id)}
              >
                <Calendar size={14} aria-hidden="true" />
                <span className="quick-action-picker__item-main">
                  <PickerItemTitle text={meeting.title || "Untitled meeting"} />
                  <span className="quick-action-picker__item-meta">
                    {formatDateTime(meeting.scheduledAt)}
                    {meeting.location ? ` · ${meeting.location}` : ""}
                  </span>
                </span>
                {isApproved && <Badge tone="success">Approved</Badge>}
                {isDrafted && <Badge tone="info">Drafted</Badge>}
                {isUpcoming && <Badge tone="warn">Upcoming</Badge>}
                <Badge tone={meeting.type === "AGM" ? "accent" : "info"}>{meeting.type}</Badge>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
