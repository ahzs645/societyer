import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Field } from "../components/ui";
import { Select } from "../components/Select";
import { useToast } from "../components/Toast";
import { CalendarClock, UploadCloud } from "lucide-react";

type ParsedEvent = { summary: string; start?: string; end?: string; location?: string; iCalUID?: string; description?: string };

/** Minimal ICS (RFC 5545) VEVENT parser — enough to stage events for review. */
function parseIcs(text: string): ParsedEvent[] {
  // Unfold folded lines (continuation lines begin with a space/tab).
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);
  const events: ParsedEvent[] = [];
  let current: ParsedEvent | null = null;
  const toIso = (raw: string) => {
    const m = raw.match(/(\d{4})(\d{2})(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
  };
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VEVENT")) current = {} as ParsedEvent;
    else if (upper.startsWith("END:VEVENT")) {
      if (current && (current.summary || current.start)) events.push({ ...current, summary: current.summary || "Calendar event" });
      current = null;
    } else if (current) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const key = line.slice(0, idx).split(";")[0].toUpperCase();
      const value = line.slice(idx + 1).trim();
      if (key === "SUMMARY") current.summary = value;
      else if (key === "DTSTART") current.start = toIso(value);
      else if (key === "DTEND") current.end = toIso(value);
      else if (key === "LOCATION") current.location = value;
      else if (key === "UID") current.iCalUID = value;
      else if (key === "DESCRIPTION") current.description = value;
    }
  }
  return events;
}

export function CalendarSyncPage() {
  const society = useSociety();
  const navigate = useNavigate();
  const toast = useToast();
  const stage = useMutation(api.calendarSync.stageCalendarEvents);
  const [provider, setProvider] = useState("ics");
  const [calendarName, setCalendarName] = useState("");
  const [icsText, setIcsText] = useState("");
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => (icsText.trim() ? parseIcs(icsText) : []), [icsText]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const onFile = async (file?: File) => {
    if (!file) return;
    setIcsText(await file.text());
  };

  const submit = async () => {
    if (parsed.length === 0) {
      toast.warn("No calendar events found. Paste an .ics feed or upload a file.");
      return;
    }
    setBusy(true);
    try {
      const events = parsed.map((e) => ({
        summary: e.summary,
        start: e.start,
        end: e.end,
        location: e.location,
        description: e.description,
        iCalUID: e.iCalUID,
      }));
      const sessionId = await stage({
        societyId: society._id,
        provider,
        calendarId: calendarName.trim() || "primary",
        events,
        name: calendarName.trim() ? `${calendarName.trim()} calendar sync` : undefined,
      } as any);
      toast.success(`Staged ${events.length} event${events.length === 1 ? "" : "s"} for review`);
      navigate(`/app/imports?sessionId=${encodeURIComponent(String(sessionId))}`);
    } catch (err: any) {
      toast.error(err?.message ?? "Could not stage calendar events");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Calendar sync"
        icon={<CalendarClock size={16} />}
        iconColor="purple"
        subtitle="Import events from an external calendar (Google, Outlook, or any .ics feed) into a reviewable import session. Events become candidate deadlines and source evidence you can apply to governance records."
        actions={
          <button className="btn-action btn-action--primary" disabled={busy || parsed.length === 0} onClick={submit}>
            <UploadCloud size={12} /> Stage {parsed.length || ""} event{parsed.length === 1 ? "" : "s"}
          </button>
        }
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head"><h2 className="card__title">Source</h2></div>
        <div className="card__body col" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 12 }}>
            <Field label="Provider">
              <Select
                value={provider}
                onChange={setProvider}
                options={[
                  { value: "ics", label: "ICS feed / file" },
                  { value: "google", label: "Google Calendar" },
                  { value: "outlook", label: "Outlook / Microsoft 365" },
                  { value: "other", label: "Other" },
                ]}
              />
            </Field>
            <Field label="Calendar name (optional)">
              <input className="input" value={calendarName} onChange={(e) => setCalendarName(e.target.value)} placeholder="e.g. Board calendar" />
            </Field>
          </div>
          <Field label="Upload .ics file">
            <input type="file" accept=".ics,text/calendar" onChange={(e) => onFile(e.target.files?.[0])} />
          </Field>
          <Field label="…or paste .ics content">
            <textarea
              className="input"
              rows={8}
              value={icsText}
              onChange={(e) => setIcsText(e.target.value)}
              placeholder="BEGIN:VCALENDAR…"
              style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
            />
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Parsed events</h2>
          <Badge>{parsed.length}</Badge>
        </div>
        <table className="table">
          <thead><tr><th>Title</th><th>Start</th><th>End</th><th>Location</th></tr></thead>
          <tbody>
            {parsed.slice(0, 100).map((e, i) => (
              <tr key={i}>
                <td><strong>{e.summary}</strong></td>
                <td className="mono">{e.start ?? "—"}</td>
                <td className="mono">{e.end ?? "—"}</td>
                <td className="muted">{e.location ?? "—"}</td>
              </tr>
            ))}
            {parsed.length === 0 && (
              <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 24 }}>No events parsed yet. Paste or upload an .ics calendar above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
