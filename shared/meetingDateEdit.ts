/**
 * Editing a meeting's date without inventing a time (A13, ui-meetings F3/F14).
 *
 * A meeting is either date-only (stored at the noon-UTC placeholder, so the
 * day never shifts in any zone) or has a real start instant computed from a
 * local wall-clock time in the meeting's time zone. Source time text
 * ("6:00 PM – 7:00 PM", "noon") is kept separately as written.
 *
 * Pure module.
 */
import { DATE_ONLY_PLACEHOLDER_SUFFIX, meetingCalendarDate, meetingDatePrecision, type MeetingDateLike } from "./meetingDates";

export type MeetingDateDraft = {
  date: string; // YYYY-MM-DD
  precision: "date" | "datetime";
  time: string; // HH:MM (24h), used when precision is datetime
  timeZone: string; // IANA zone ("" = viewer's zone)
  localStartText: string;
  localEndText: string;
};

function partsInZone(date: Date, timeZone?: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || undefined,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const get = (type: string) => Number(formatter.formatToParts(date).find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

/** Offset (ms) of a zone from UTC at an instant. */
function zoneOffsetMs(instant: Date, timeZone?: string): number {
  const p = partsInZone(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Local wall-clock date + time in `timeZone` → UTC ISO string. */
export function zonedLocalToUtcISO(date: string, time: string, timeZone?: string): string | undefined {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? "").trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? "").trim());
  if (!d || !t) return undefined;
  const guess = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  if (!Number.isFinite(guess)) return undefined;
  try {
    let instant = guess - zoneOffsetMs(new Date(guess), timeZone);
    // Second pass settles DST transitions.
    instant = guess - zoneOffsetMs(new Date(instant), timeZone);
    return new Date(instant).toISOString();
  } catch {
    return undefined;
  }
}

/** Draft fields for the edit form from a stored meeting. */
export function meetingDateDraftFrom(meeting: MeetingDateLike, viewerTimeZone?: string): MeetingDateDraft {
  const precision = meetingDatePrecision(meeting);
  const timeZone = String(meeting?.timeZone ?? "");
  const date = meetingCalendarDate(meeting, viewerTimeZone) ?? "";
  let time = "";
  if (precision === "datetime" && meeting?.scheduledAt) {
    const instant = new Date(meeting.scheduledAt);
    if (Number.isFinite(instant.getTime())) {
      try {
        const p = partsInZone(instant, timeZone || viewerTimeZone);
        time = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
      } catch {
        time = "";
      }
    }
  }
  return {
    date,
    precision,
    time,
    timeZone,
    localStartText: String(meeting?.localStartText ?? ""),
    localEndText: String(meeting?.localEndText ?? ""),
  };
}

export type MeetingDatePatch = {
  scheduledAt: string;
  scheduledAtPrecision: "date" | "datetime";
  localStartText?: string;
  localEndText?: string;
  timeZone?: string;
};

/** Validate a draft; returns an error message or null. */
export function meetingDateDraftIssue(draft: MeetingDateDraft): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return "Enter the meeting date.";
  if (draft.precision === "datetime" && !/^\d{1,2}:\d{2}$/.test(draft.time)) return "Enter the start time, or mark the meeting as date only.";
  if (draft.timeZone) {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: draft.timeZone });
    } catch {
      return `“${draft.timeZone}” is not a recognised time zone (use e.g. America/Vancouver).`;
    }
  }
  return null;
}

/** Stored fields for a draft (date-only → noon-UTC placeholder). */
export function meetingDatePatchFromDraft(draft: MeetingDateDraft, viewerTimeZone?: string): MeetingDatePatch | null {
  if (meetingDateDraftIssue(draft)) return null;
  const scheduledAt = draft.precision === "date"
    ? `${draft.date}${DATE_ONLY_PLACEHOLDER_SUFFIX}`
    : zonedLocalToUtcISO(draft.date, draft.time, draft.timeZone || viewerTimeZone);
  if (!scheduledAt) return null;
  return {
    scheduledAt,
    scheduledAtPrecision: draft.precision,
    localStartText: draft.localStartText.trim(),
    localEndText: draft.localEndText.trim(),
    timeZone: draft.timeZone.trim(),
  };
}
