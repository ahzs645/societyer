/**
 * A13: meeting date precision.
 *
 * Imports that only know the calendar day store `scheduledAt` at the noon-UTC
 * placeholder (`YYYY-MM-DDT12:00:00.000Z`) so that the day never shifts in any
 * time zone. That placeholder is not a time: shown with a clock it reads
 * "4:00 AM" in British Columbia. These helpers let every surface present a
 * date-only meeting as a date, with the source's own local time text when one
 * was recorded ("6:00 PM – 7:00 PM").
 *
 * Pure module: safe for the browser, Convex and scripts.
 */

export type MeetingDateLike = {
  scheduledAt?: string | null;
  scheduledAtPrecision?: string | null;
  localStartText?: string | null;
  localEndText?: string | null;
  timeZone?: string | null;
};

export const DATE_ONLY_PLACEHOLDER_SUFFIX = "T12:00:00.000Z";

// Intl.DateTimeFormat construction dominates formatting cost when a page
// labels every meeting (pickers over 100+ meetings); reuse formatters.
const formatterCache = new Map<string, Intl.DateTimeFormat>();
function cachedFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + JSON.stringify(options);
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    if (formatterCache.size > 200) formatterCache.clear();
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/** True when the stored instant is the noon-UTC date-only placeholder. */
export function isDateOnlyPlaceholder(scheduledAt: unknown): boolean {
  return typeof scheduledAt === "string" && /^\d{4}-\d{2}-\d{2}T12:00:00(?:\.000)?Z$/.test(scheduledAt);
}

/** "date" when only the calendar day is known, else "datetime". */
export function meetingDatePrecision(meeting: MeetingDateLike | null | undefined): "date" | "datetime" {
  if (meeting?.scheduledAtPrecision === "date" || meeting?.scheduledAtPrecision === "datetime") return meeting.scheduledAtPrecision;
  return isDateOnlyPlaceholder(meeting?.scheduledAt) ? "date" : "datetime";
}

/** The meeting's calendar day (YYYY-MM-DD) in its own time zone. */
export function meetingCalendarDate(meeting: MeetingDateLike | null | undefined, fallbackTimeZone?: string): string | undefined {
  const value = meeting?.scheduledAt;
  if (!value) return undefined;
  if (meetingDatePrecision(meeting) === "date" || /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10);
  const timeZone = meeting?.timeZone || fallbackTimeZone;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const get = (type: string) => parts.find((part) => part.type === type)?.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return value.slice(0, 10);
  }
}

export type FormatMeetingDateOptions = {
  locale?: string;
  /** Viewer's time zone when the meeting has none. */
  timeZone?: string;
  /** Include the time (or the source's local time text). Default true. */
  withTime?: boolean;
  dateStyle?: "full" | "long" | "medium" | "short";
};

/**
 * Format a meeting's date for display without inventing a time.
 *  - date precision: the calendar day only (never shifted by time zone), then
 *    the source's local time text when present ("May 18, 2021 · 6:00 PM – 7:00 PM");
 *  - datetime precision: date and time in the meeting's time zone.
 */
export function formatMeetingDate(meeting: MeetingDateLike | null | undefined, options: FormatMeetingDateOptions = {}): string {
  const value = meeting?.scheduledAt;
  if (!value) return "";
  const locale = options.locale ?? "en-CA";
  const dateStyle = options.dateStyle ?? "medium";
  const withTime = options.withTime !== false;
  const localTime = [meeting?.localStartText, meeting?.localEndText].map((text) => String(text ?? "").trim()).filter(Boolean).join(" – ");
  if (meetingDatePrecision(meeting) === "date") {
    const day = value.slice(0, 10);
    const date = new Date(`${day}T12:00:00.000Z`);
    if (!Number.isFinite(date.getTime())) return value;
    const text = cachedFormatter(locale, { dateStyle, timeZone: "UTC" }).format(date);
    return withTime && localTime ? `${text} · ${localTime}` : text;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const timeZone = meeting?.timeZone || options.timeZone;
  try {
    if (!withTime) return cachedFormatter(locale, { dateStyle, timeZone }).format(date);
    if (localTime) return `${cachedFormatter(locale, { dateStyle, timeZone }).format(date)} · ${localTime}`;
    return cachedFormatter(locale, { dateStyle, timeStyle: "short", timeZone }).format(date);
  } catch {
    return value;
  }
}

/** Parse "6:00 PM", "18:00", "6 pm" into HH:MM (24h), or undefined. */
export function parseLocalTimeText(text: unknown): string | undefined {
  const match = String(text ?? "").trim().toLowerCase().match(/^(\d{1,2})(?:[:.h](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.replace(/\./g, "");
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
