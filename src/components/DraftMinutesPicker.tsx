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
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { Calendar } from "lucide-react";
import { api } from "../lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { Modal } from "./Modal";
import { Badge } from "./ui";
import { formatDateTime } from "../lib/format";

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

  // Past meetings without a minutes record, most-recent first. We don't try
  // to be clever about "scheduled but not yet held" — those wouldn't have
  // anything to draft anyway. Capped at 8 so the picker stays focused; the
  // user can still go to /app/meetings if they want the full list.
  const candidates = useMemo(() => {
    if (!meetings || !minutes) return [];
    const minuteMeetingIds = new Set(minutes.map((m: any) => String(m.meetingId)));
    const now = Date.now();
    return (meetings as any[])
      .filter((m) => !minuteMeetingIds.has(String(m._id)))
      .filter((m) => m.scheduledAt && new Date(m.scheduledAt).getTime() <= now)
      .sort((a, b) => String(b.scheduledAt).localeCompare(String(a.scheduledAt)))
      .slice(0, 8);
  }, [meetings, minutes]);

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
          No past meetings are waiting for minutes. New meetings appear here once their
          scheduled time has passed.
        </div>
      )}
      {!isLoading && candidates.length > 0 && (
        <div className="col" style={{ gap: 4 }}>
          <p className="muted" style={{ fontSize: "var(--fs-sm)", margin: "0 0 8px" }}>
            Past meetings without minutes — pick one to start drafting.
          </p>
          {candidates.map((meeting) => (
            <button
              key={meeting._id}
              type="button"
              className="quick-action-picker__item"
              onClick={() => handlePick(meeting._id)}
            >
              <Calendar size={14} aria-hidden="true" />
              <span className="quick-action-picker__item-main">
                <span className="quick-action-picker__item-title">{meeting.title || "Untitled meeting"}</span>
                <span className="quick-action-picker__item-meta">
                  {formatDateTime(meeting.scheduledAt)}
                  {meeting.location ? ` · ${meeting.location}` : ""}
                </span>
              </span>
              <Badge tone={meeting.type === "AGM" ? "accent" : "info"}>{meeting.type}</Badge>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
