/**
 * Minimal RFC 5545 iCalendar serializer (framework-free, deterministic).
 *
 * Produces a read-only VCALENDAR feed from Societyer governance dates so a user
 * can subscribe to deadlines/filings/meetings from Google Calendar, Outlook, or
 * Apple Calendar before full OAuth sync exists (the `export_ics` action in the
 * integration catalog). Pure: the caller passes `dtstamp` so output is stable
 * and testable — no clock reads here.
 */

export interface ICalEvent {
  /** Stable unique id; reused so a re-fetch updates rather than duplicates. */
  uid: string;
  /** ISO date ("2026-01-31") for all-day, or ISO datetime for a timed event. */
  start: string;
  /** Optional ISO datetime end for timed events. */
  end?: string;
  /** All-day (date-only) event when true. */
  allDay?: boolean;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
}

export interface ICalOptions {
  /** X-WR-CALNAME shown as the calendar's title in most clients. */
  calendarName: string;
  /** ISO timestamp stamped on every event (DTSTAMP). Pass new Date().toISOString(). */
  dtstamp: string;
  /** PRODID; defaults to Societyer. */
  prodId?: string;
}

/** Escape a TEXT value per RFC 5545 §3.3.11 (backslash first). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** "2026-01-31..." → "20260131" (date-only form for all-day events). */
function toICalDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, "");
}

/** Any ISO instant → "20260131T140000Z" (UTC, RFC 5545 UTC form). */
function toICalDateTimeUTC(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    // Fall back to a date-only midnight UTC so a malformed value never throws.
    return `${toICalDate(iso)}T000000Z`;
  }
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/** Fold a content line to ≤75 octets with CRLF + space continuation (§3.1). */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  chunks.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    chunks.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return chunks.join("\r\n");
}

export function buildICalendar(events: readonly ICalEvent[], opts: ICalOptions): string {
  const stamp = toICalDateTimeUTC(opts.dtstamp);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${escapeText(opts.prodId ?? "-//Societyer//Calendar Feed//EN")}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.calendarName)}`,
  ];

  for (const event of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${escapeText(event.uid)}`);
    lines.push(`DTSTAMP:${stamp}`);
    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${toICalDate(event.start)}`);
    } else {
      lines.push(`DTSTART:${toICalDateTimeUTC(event.start)}`);
      if (event.end) lines.push(`DTEND:${toICalDateTimeUTC(event.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(event.summary)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.url) lines.push(`URL:${escapeText(event.url)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
