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
 *
 * Recurring events (RRULE) are expanded into one event per occurrence within a
 * bounded window: FREQ DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL,
 * BYDAY (weekdays; ordinal weekdays such as `2TU` monthly), BYMONTHDAY and
 * BYMONTH, minus EXDATE and the instances a RECURRENCE-ID event replaces.
 * Occurrences are computed on the source's own clock (its TZID wall clock, or
 * UTC for a `Z` time), then shown like DTSTART. A rule with other parts
 * (BYSETPOS, BYWEEKNO, BYHOUR, …) keeps only its first occurrence and carries
 * `recurrenceRule`, so a reviewer still sees that it repeats.
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
  /** The RRULE as written, on every occurrence of a recurring event. */
  recurrenceRule?: string;
  /** The occurrence's original start (same format as `start`) for expanded or overriding instances. */
  recurrenceId?: string;
};

export type ParseIcsOptions = {
  displayTimeZone?: string;
  /** Last day (YYYY-MM-DD) an open-ended rule is expanded to. Default: one year from today. */
  expandUntil?: string;
};

/** At most this many occurrences per recurring event (the latest are kept). */
export const MAX_ICS_OCCURRENCES = 100;

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

type RawDate = { params: string; value: string };
type IcsComponent = ParsedIcsEvent & { rawStart?: RawDate; rawEnd?: RawDate; rrule?: string; exdates: RawDate[]; rawRecurrenceId?: RawDate };

export function parseIcs(text: string, options: ParseIcsOptions = {}): ParsedIcsEvent[] {
  // Unfold folded lines (continuation lines begin with a space/tab).
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);
  const components: IcsComponent[] = [];
  let current: IcsComponent | null = null;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VEVENT")) current = { summary: "", exdates: [] };
    else if (upper.startsWith("END:VEVENT")) {
      if (current && (current.summary || current.start)) components.push({ ...current, summary: current.summary || "Calendar event" });
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
          current.rawStart = { params, value };
        } else {
          current.end = parsed.value;
          if (parsed.timeZone) current.endTimeZone = parsed.timeZone;
          current.rawEnd = { params, value };
        }
      } else if (key === "LOCATION") current.location = value;
      else if (key === "UID") current.iCalUID = value;
      else if (key === "DESCRIPTION") current.description = value;
      else if (key === "RRULE") current.rrule = value;
      else if (key === "EXDATE") for (const item of value.split(",")) current.exdates.push({ params, value: item.trim() });
      else if (key === "RECURRENCE-ID") current.rawRecurrenceId = { params, value };
    }
  }
  // Instances a RECURRENCE-ID event replaces, per UID: the series skips them.
  const replaced = new Map<string, Set<string>>();
  for (const component of components) {
    if (!component.rawRecurrenceId) continue;
    const id = icsDateValue(component.rawRecurrenceId.params, component.rawRecurrenceId.value, options.displayTimeZone).value;
    if (!id) continue;
    component.recurrenceId = id;
    if (!component.iCalUID) continue;
    const set = replaced.get(component.iCalUID) ?? new Set<string>();
    set.add(id);
    replaced.set(component.iCalUID, set);
  }
  const events: ParsedIcsEvent[] = [];
  for (const component of components) {
    const { rawStart, rawEnd, rrule, exdates, rawRecurrenceId, ...event } = component;
    if (!rrule || !rawStart || rawRecurrenceId) {
      events.push(event);
      continue;
    }
    const skip = new Set(component.iCalUID ? replaced.get(component.iCalUID) ?? [] : []);
    for (const ex of exdates) {
      const value = icsDateValue(ex.params, ex.value, options.displayTimeZone).value;
      if (value) skip.add(value);
    }
    events.push(...expandRecurrence(event, rawStart, rawEnd, rrule, skip, options));
  }
  return events;
}

/* ----------------------------- RRULE expansion ----------------------------- */

const DAY_MS = 86_400_000;
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const FREQUENCIES = new Set(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);
/** Rule parts honoured for each frequency; any other part keeps the first occurrence only. */
const SUPPORTED_PARTS: Record<string, string[]> = {
  DAILY: ["BYDAY", "BYMONTH", "BYMONTHDAY"],
  WEEKLY: ["BYDAY", "BYMONTH"],
  MONTHLY: ["BYDAY", "BYMONTH", "BYMONTHDAY"],
  YEARLY: ["BYMONTH", "BYDAY", "BYMONTHDAY"],
};
const COMMON_PARTS = ["FREQ", "INTERVAL", "COUNT", "UNTIL", "WKST"];
/** Upper bound on periods walked for one rule, whatever its window. */
const MAX_PERIODS = 20_000;

/** A source clock value as UTC-field milliseconds (naive calendar arithmetic, no zone). */
type Naive = { ms: number; hasTime: boolean; utc: boolean };

function naiveFrom(raw: string): Naive | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(raw.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, sec, z] = match;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0), Number(sec ?? 0));
  return Number.isFinite(ms) ? { ms, hasTime: h !== undefined, utc: Boolean(z) } : null;
}

function naiveText(ms: number, like: Naive): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  if (!like.hasTime) return day;
  return `${day}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}${like.utc ? "Z" : ""}`;
}

function parseRule(rule: string): Map<string, string> {
  const parts = new Map<string, string>();
  for (const part of rule.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) parts.set(part.slice(0, eq).trim().toUpperCase(), part.slice(eq + 1).trim().toUpperCase());
  }
  return parts;
}

function weekdayOf(code: string): number {
  return WEEKDAYS.indexOf(code.replace(/^[+-]?\d+/, ""));
}

/** Days (UTC-midnight ms) of `year`/`month` matching BYDAY / BYMONTHDAY, else the start's own day of month. */
function monthDays(year: number, month: number, startDay: number, byDay: string[], byMonthDay: number[]): number[] {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const days = new Set<number>();
  if (!byDay.length && !byMonthDay.length) {
    // A day the month lacks (the 31st, Feb 29) is skipped, not moved.
    if (startDay <= lastDay) days.add(Date.UTC(year, month, startDay));
  }
  for (const value of byMonthDay) {
    const day = value > 0 ? value : lastDay + value + 1;
    if (day >= 1 && day <= lastDay) days.add(Date.UTC(year, month, day));
  }
  for (const entry of byDay) {
    const match = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(entry);
    if (!match) continue;
    const weekday = WEEKDAYS.indexOf(match[2]);
    const matching: number[] = [];
    for (let day = 1; day <= lastDay; day += 1) {
      const ms = Date.UTC(year, month, day);
      if (new Date(ms).getUTCDay() === weekday) matching.push(ms);
    }
    if (!match[1]) matching.forEach((ms) => days.add(ms));
    else {
      const nth = Number(match[1]);
      const pick = nth > 0 ? matching[nth - 1] : matching[matching.length + nth];
      if (pick !== undefined) days.add(pick);
    }
  }
  return [...days].sort((a, b) => a - b);
}

function expandRecurrence(event: ParsedIcsEvent, rawStart: RawDate, rawEnd: RawDate | undefined, rule: string, skip: Set<string>, options: ParseIcsOptions): ParsedIcsEvent[] {
  const parts = parseRule(rule);
  const freq = parts.get("FREQ") ?? "";
  const start = naiveFrom(rawStart.value);
  const first: ParsedIcsEvent = { ...event, recurrenceRule: rule };
  const byDay = (parts.get("BYDAY") ?? "").split(",").filter(Boolean);
  const byMonthDay = (parts.get("BYMONTHDAY") ?? "").split(",").filter(Boolean).map(Number);
  const byMonth = (parts.get("BYMONTH") ?? "").split(",").filter(Boolean).map(Number).sort((a, b) => a - b);
  const supported = FREQUENCIES.has(freq)
    && [...parts.keys()].every((key) => COMMON_PARTS.includes(key) || SUPPORTED_PARTS[freq].includes(key))
    && byDay.every((code) => /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.test(code) && (freq === "MONTHLY" || freq === "YEARLY" || /^[A-Z]{2}$/.test(code)))
    && byMonthDay.every((n) => Number.isInteger(n) && n !== 0 && Math.abs(n) <= 31)
    && byMonth.every((n) => Number.isInteger(n) && n >= 1 && n <= 12)
    // A yearly BYDAY / BYMONTHDAY counts across the whole year without BYMONTH.
    && !(freq === "YEARLY" && !byMonth.length && (byDay.length || byMonthDay.length));
  if (!start || !supported) return [first];

  const interval = Math.max(1, Math.floor(Number(parts.get("INTERVAL") ?? 1)) || 1);
  const countValue = Math.floor(Number(parts.get("COUNT")));
  const count = Number.isFinite(countValue) && countValue > 0 ? countValue : undefined;
  const untilRaw = parts.get("UNTIL");
  const until = untilRaw ? icsDateValue(untilRaw.includes("T") ? "" : "VALUE=DATE", untilRaw, options.displayTimeZone).value : undefined;
  // The window never cuts off the first instance of a series that starts after it.
  const windowEnd = options.expandUntil ?? new Date(Date.now() + 366 * DAY_MS).toISOString().slice(0, 10);
  const firstDay = event.start?.slice(0, 10) ?? "";
  const horizon = firstDay > windowEnd ? firstDay : windowEnd;
  const end = rawEnd ? naiveFrom(rawEnd.value) : null;
  const duration = end ? end.ms - start.ms : undefined;
  const timeOfDay = ((start.ms % DAY_MS) + DAY_MS) % DAY_MS;
  const startDate = new Date(start.ms);
  const startYear = startDate.getUTCFullYear();
  const startMonth = startDate.getUTCMonth();
  const startDay = startDate.getUTCDate();
  const wkst = Math.max(0, WEEKDAYS.indexOf(parts.get("WKST") ?? "MO"));
  const inMonth = (ms: number) => !byMonth.length || byMonth.includes(new Date(ms).getUTCMonth() + 1);

  /** Candidate occurrence starts (source-clock ms) for period `k`, ascending. */
  const period = (k: number): number[] => {
    const step = k * interval;
    if (freq === "DAILY") {
      const ms = start.ms + step * DAY_MS;
      const date = new Date(ms);
      const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
      const dayOk = !byDay.length || byDay.some((code) => weekdayOf(code) === date.getUTCDay());
      const monthDayOk = !byMonthDay.length || byMonthDay.some((n) => (n > 0 ? n : lastDay + n + 1) === date.getUTCDate());
      return dayOk && monthDayOk && inMonth(ms) ? [ms] : [];
    }
    if (freq === "WEEKLY") {
      if (!byDay.length) return [start.ms + step * 7 * DAY_MS].filter(inMonth);
      const dayStart = start.ms - timeOfDay;
      const weekStart = dayStart - ((new Date(dayStart).getUTCDay() - wkst + 7) % 7) * DAY_MS + step * 7 * DAY_MS;
      return byDay
        .map((code) => weekStart + ((weekdayOf(code) - wkst + 7) % 7) * DAY_MS + timeOfDay)
        .filter(inMonth)
        .sort((a, b) => a - b);
    }
    if (freq === "MONTHLY") {
      const month = startMonth + step;
      const year = startYear + Math.floor(month / 12);
      const monthIndex = ((month % 12) + 12) % 12;
      if (byMonth.length && !byMonth.includes(monthIndex + 1)) return [];
      return monthDays(year, monthIndex, startDay, byDay, byMonthDay).map((ms) => ms + timeOfDay);
    }
    const year = startYear + step;
    const months = byMonth.length ? byMonth.map((m) => m - 1) : [startMonth];
    return months.flatMap((month) => monthDays(year, month, startDay, byDay, byMonthDay)).map((ms) => ms + timeOfDay);
  };

  const occurrences: ParsedIcsEvent[] = [];
  let generated = 0;
  /** Adds one instance; false once the series is over (UNTIL, COUNT or the window). */
  const emit = (ms: number): boolean => {
    const shown = icsDateValue(rawStart.params, naiveText(ms, start), options.displayTimeZone).value;
    if (!shown) return false;
    const day = shown.slice(0, 10);
    if (until && (until.length === 10 ? day > until : shown > until)) return false;
    if (day > horizon) return false;
    // COUNT includes instances EXDATE removes (RFC 5545 §3.8.5.1).
    generated += 1;
    if (!skip.has(shown)) {
      const endShown = rawEnd && end && duration !== undefined
        ? icsDateValue(rawEnd.params, naiveText(ms + duration, end), options.displayTimeZone).value
        : undefined;
      occurrences.push({ ...first, start: shown, ...(endShown ? { end: endShown } : {}), recurrenceId: shown });
      if (occurrences.length > MAX_ICS_OCCURRENCES) occurrences.shift();
    }
    return count === undefined || generated < count;
  };
  // DTSTART is always the first instance.
  if (!emit(start.ms)) return generated ? occurrences : [first];
  for (let k = 0; k < MAX_PERIODS; k += 1) {
    for (const ms of period(k)) {
      if (ms <= start.ms) continue;
      if (!emit(ms)) return occurrences;
    }
  }
  return occurrences;
}

/** "2026-11-12" or "2026-11-12 18:00" (with the zone's short name when it differs from the viewer's). */
export function formatIcsWhen(value: string | undefined, timeZone?: string, viewerTimeZone?: string): string {
  if (!value) return "—";
  const timed = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (!timed) return value;
  return `${timed[1]} ${timed[2]}${timeZone && viewerTimeZone && timeZone !== viewerTimeZone ? ` (${timeZone})` : ""}`;
}
