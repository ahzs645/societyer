import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../hooks/usePermissions";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Field } from "../components/ui";
import { InfoPopover } from "../components/InfoPopover";
import { Select } from "../components/Select";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/Modal";
import { isLocalDataRuntime } from "../lib/staticRuntime";
import { convexSiteUrl } from "../lib/convexSite";
import { CalendarClock, UploadCloud, Rss, Copy, RefreshCw } from "lucide-react";
import { formatIcsWhen, parseIcs as parseIcsEvents } from "../../shared/icsCalendar";

const VIEWER_TIME_ZONE = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })();
const parseIcs = (text: string) => parseIcsEvents(text, { displayTimeZone: VIEWER_TIME_ZONE });

/** Explain why pasted text produced no events (L19), or null when it did. */
function icsProblem(text: string, parsedCount: number): string | null {
  if (!text.trim() || parsedCount > 0) return null;
  const upper = text.toUpperCase();
  if (!upper.includes("BEGIN:VCALENDAR")) {
    return "This doesn't look like an iCalendar (.ics) file: it has no BEGIN:VCALENDAR line. Export the calendar as .ics and paste or upload that file.";
  }
  const begins = (upper.match(/BEGIN:VEVENT/g) ?? []).length;
  const ends = (upper.match(/END:VEVENT/g) ?? []).length;
  if (begins === 0) return "The calendar has no events (no BEGIN:VEVENT blocks).";
  if (ends < begins) return `${begins - ends} event block${begins - ends === 1 ? " is" : "s are"} missing END:VEVENT, so the file looks truncated.`;
  return `${begins} event block${begins === 1 ? "" : "s"} found, but none has a SUMMARY or DTSTART line, so nothing can be staged.`;
}

export function CalendarSyncPage() {
  const society = useSociety();
  const { can } = usePermissions();
  const canManageFeed = can("settings:write");
  const canStage = can("settings:write") && can("meetings:write");
  const feedAvailable = !isLocalDataRuntime() && Boolean(convexSiteUrl());
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const stage = useMutation(api.calendarSync.stageCalendarEvents);
  const setFeedToken = useMutation(api.calendarFeed.setFeedToken);
  const feedToken = useQuery(api.calendarFeed.getFeedToken, society && canManageFeed ? { societyId: society._id } : "skip");
  const [provider, setProvider] = useState("ics");
  const [calendarName, setCalendarName] = useState("");
  const [icsText, setIcsText] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedBusy, setFeedBusy] = useState(false);

  const parsed = useMemo(() => (icsText.trim() ? parseIcs(icsText) : []), [icsText]);
  const parseProblem = useMemo(() => icsProblem(icsText, parsed.length), [icsText, parsed.length]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const onFile = async (file?: File) => {
    if (!file) return;
    setIcsText(await file.text());
  };

  const feedUrl = feedAvailable && feedToken ? `${convexSiteUrl()}/calendar/feed?token=${feedToken}` : null;
  const webcalUrl = feedUrl ? feedUrl.replace(/^https?:\/\//, "webcal://") : null;

  const enableFeed = async () => {
    if (!feedAvailable || !canManageFeed) return;
    if (feedToken && !(await confirm({
      title: "Regenerate the calendar feed link?",
      message: "The current subscribe URL stops working immediately. Every calendar subscribed to it must be re-subscribed with the new link.",
      confirmLabel: "Regenerate link",
      tone: "warn",
    }))) return;
    setFeedBusy(true);
    try {
      // Token is generated client-side (128 bits) and stored by the mutation,
      // mirroring apiPlatform's client-hash model. Regenerating rotates it.
      const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
      await setFeedToken({ societyId: society._id, token });
      toast.success(feedToken ? "Calendar feed link rotated" : "Calendar feed enabled");
    } catch (err: any) {
      toast.error(err?.message ?? "Could not enable the feed");
    } finally {
      setFeedBusy(false);
    }
  };

  const disableFeed = async () => {
    if (!canManageFeed) return;
    if (!(await confirm({
      title: "Disable the calendar feed?",
      message: "The subscribe URL stops working and subscribed calendars stop receiving these dates. Enabling the feed again creates a new link.",
      confirmLabel: "Disable feed",
      tone: "danger",
    }))) return;
    setFeedBusy(true);
    try {
      await setFeedToken({ societyId: society._id, token: null });
      toast.success("Calendar feed disabled");
    } catch (err: any) {
      toast.error(err?.message ?? "Could not disable the feed");
    } finally {
      setFeedBusy(false);
    }
  };

  const copyFeed = async () => {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      toast.success("Feed URL copied");
    } catch {
      toast.error("Could not copy the URL");
    }
  };

  const submit = async () => {
    if (!canStage) return;
    if (parsed.length === 0) {
      toast.warn("No calendar events found", parseProblem ?? "Paste an .ics feed or upload a file.");
      return;
    }
    setBusy(true);
    try {
      const events = parsed.map((e) => ({
        summary: e.summary,
        start: e.start,
        end: e.end,
        ...(e.startTimeZone ? { startTimeZone: e.startTimeZone } : {}),
        ...(e.allDay !== undefined ? { allDay: e.allDay } : {}),
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
      // The import session also lists the calendar itself as a source record,
      // so its candidate count is one more than the number of events.
      toast.success(`Staged ${events.length} event${events.length === 1 ? "" : "s"} for review`, "The import session also includes 1 calendar source record.");
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
        subtitle="Import events from Google, Outlook or any .ics feed for review."
        info={
          <p>Imported events land in a reviewable import session as candidate deadlines and source evidence you can apply to governance records.</p>
        }
        actions={
          <button className="btn-action btn-action--primary" disabled={!canStage || busy || parsed.length === 0} onClick={submit}>
            <UploadCloud size={12} /> Stage {parsed.length || ""} event{parsed.length === 1 ? "" : "s"}
          </button>
        }
      />

      {!canStage && <p className="muted">You can preview calendar events. Staging imports requires workspace settings and meeting write access.</p>}
      <div className="card">
        <div className="card__head">
          <h2 className="card__title">
            <Rss size={14} style={{ display: "inline-block", marginRight: 6, verticalAlign: -2 }} />
            Subscribe (outbound feed)
          </h2>
          <InfoPopover label="About the outbound feed">
            <p>
              A read-only iCalendar feed of this entity's deadlines, filings, and meetings. Add the URL to Google
              Calendar, Outlook, or Apple Calendar to keep governance dates in your everyday calendar — it refreshes
              automatically.
            </p>
          </InfoPopover>
          <span style={{ marginLeft: "auto" }}>
            {feedAvailable && feedToken ? <Badge tone="success">On</Badge> : <Badge tone="neutral">Off</Badge>}
          </span>
        </div>
        <div className="card__body col" style={{ gap: 12 }}>
          {!canManageFeed ? (
            <p className="muted">Managing outbound calendar subscriptions requires workspace settings write access.</p>
          ) : !feedAvailable ? (
            <p className="muted" style={{ margin: 0 }}>Outbound calendar subscriptions require a connected server; import .ics events below.</p>
          ) : feedToken === undefined ? (
            <div className="muted">Loading…</div>
          ) : feedToken ? (
            <>
              <Field label="Subscribe URL">
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <input
                    className="input mono input--compact"
                    readOnly
                    aria-label="Subscribe URL"
                    value={feedUrl ?? ""}
                    style={{ flex: "1 1 180px", minWidth: 0 }}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button className="btn" onClick={copyFeed}><Copy size={12} /> Copy</button>
                  <a className="btn" href={webcalUrl ?? "#"}><CalendarClock size={12} /> Subscribe</a>
                </div>
              </Field>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn--ghost btn--sm" disabled={!canManageFeed || feedBusy} onClick={enableFeed}>
                  <RefreshCw size={12} /> Regenerate link
                </button>
                <button className="btn btn--ghost btn--sm" disabled={!canManageFeed || feedBusy} onClick={disableFeed}>
                  Disable feed
                </button>
              </div>
              <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                Anyone with this URL can read these dates. Regenerate to revoke the old link.
              </div>
            </>
          ) : (
            <div>
              <button className="btn-action btn-action--primary" disabled={!canManageFeed || feedBusy} onClick={enableFeed}>
                <Rss size={12} /> Enable calendar feed
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="card">
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
          <div className="field">
            <div className="field__label">Upload .ics file</div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <label className="btn calendar-sync__file-button">
                <UploadCloud size={12} /> Choose file
                <input
                  type="file"
                  className="calendar-sync__file-input"
                  accept=".ics,text/calendar"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    setFileName(file?.name ?? "");
                    onFile(file);
                  }}
                />
              </label>
              <span className="muted" style={{ overflowWrap: "anywhere" }}>{fileName || "No file chosen"}</span>
            </div>
          </div>
          <Field label="…or paste .ics content">
            <textarea
              className="textarea"
              rows={4}
              value={icsText}
              onChange={(e) => setIcsText(e.target.value)}
              placeholder="BEGIN:VCALENDAR…"
              style={{ fontFamily: "var(--font-mono)" }}
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
                <td className="mono">{formatIcsWhen(e.start, e.startTimeZone, VIEWER_TIME_ZONE)}</td>
                <td className="mono">{formatIcsWhen(e.end, e.endTimeZone, VIEWER_TIME_ZONE)}</td>
                <td className="muted">{e.location ?? "—"}</td>
              </tr>
            ))}
            {parsed.length === 0 && (
              <tr>
                <td colSpan={4} className="muted" style={{ textAlign: "center", padding: 24 }}>
                  {parseProblem ? <span role="alert" style={{ color: "var(--danger)" }}>{parseProblem}</span> : "No events parsed yet. Paste or upload an .ics calendar above."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
