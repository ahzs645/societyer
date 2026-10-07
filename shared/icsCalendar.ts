/**
 * Minimal ICS (RFC 5545) VEVENT parser used by Calendar sync to stage events
 * for review. Dates keep their kind:
 *  - `DTSTART;VALUE=DATE:20261112`            → "2026-11-12" (all-day)
 *  - `DTSTART;TZID=America/Vancouver:20261112T180000` → "2026-11-12T18:00" (wall clock in that zone)
 *  - `DTSTART:20261112T180000Z`                → wall clock in `displayTimeZone` (the viewer's zone)
 *  - `DTSTART:20261112T180000` (floating)      → "2026-11-12T18:00"
 * A timed value is a naive local "YYYY-MM-DDTHH:mm", so its first ten
 * characters are the event's local calendar day (staging keys on that), and
 * `startTimeZone` records the zone when the source named one.
 */

export type ParsedIcsEvent = {
  summary: string;
  start?: string;
  end?: string;
  startTimeZone?: string;
  endTimeZone?: string;
  allDay?: boolean;
  location?: string;
  iCalUID?: string;
  description?: string;
};

function wallClockIn(instant: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Parse one DTSTART/DTEND value (with its parameters) into a date or a local wall-clock time. */
export function icsDateValue(params: string, raw: string, displayTimeZone?: string): { value?: string; timeZone?: string; allDay: boolean } {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(raw.trim());
  if (!match) return { allDay: false };
  const [, year, month, day, hour, minute, second, utc] = match;
  const date = `${year}-${month}-${day}`;
  if (hour === undefined || /VALUE=DATE(?!-)/i.test(params)) return { value: date, allDay: true };
  if (utc) {
    const instant = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second ?? 0)));
    try {
      return { value: wallClockIn(instant, displayTimeZone), ...(displayTimeZone ? { timeZone: displayTimeZone } : {}), allDay: false };
    } catch {
      return { value: wallClockIn(instant), allDay: false };
    }
  }
  const tzid = /(?:^|;)TZID=("?)([^;:"]+)\1/i.exec(params)?.[2];
  return { value: `${date}T${hour}:${minute}`, ...(tzid ? { timeZone: tzid } : {}), allDay: false };
}

export function parseIcs(text: string, options: { displayTimeZone?: string } = {}): ParsedIcsEvent[] {
  // Unfold folded lines (continuation lines begin with a space/tab).
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);
  const events: ParsedIcsEvent[] = [];
  let current: ParsedIcsEvent | null = null;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VEVENT")) current = { summary: "" };
    else if (upper.startsWith("END:VEVENT")) {
      if (current && (current.summary || current.start)) events.push({ ...current, summary: current.summary || "Calendar event" });
      current = null;
    } else if (current) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const [rawKey, ...paramParts] = line.slice(0, idx).split(";");
      const key = rawKey.toUpperCase();
      const params = paramParts.join(";");
      const value = line.slice(idx + 1).trim();
      if (key === "SUMMARY") current.summary = value;
      else if (key === "DTSTART" || key === "DTEND") {
        const parsed = icsDateValue(params, value, options.displayTimeZone);
        if (key === "DTSTART") {
          current.start = parsed.value;
          if (parsed.timeZone) current.startTimeZone = parsed.timeZone;
          current.allDay = parsed.allDay;
        } else {
          current.end = parsed.value;
          if (parsed.timeZone) current.endTimeZone = parsed.timeZone;
        }
      } else if (key === "LOCATION") current.location = value;
      else if (key === "UID") current.iCalUID = value;
      else if (key === "DESCRIPTION") current.description = value;
    }
  }
  return events;
}

/** "2026-11-12" or "2026-11-12 18:00" (with the zone's short name when it differs from the viewer's). */
export function formatIcsWhen(value: string | undefined, timeZone?: string, viewerTimeZone?: string): string {
  if (!value) return "—";
  const timed = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (!timed) return value;
  return `${timed[1]} ${timed[2]}${timeZone && viewerTimeZone && timeZone !== viewerTimeZone ? ` (${timeZone})` : ""}`;
}
