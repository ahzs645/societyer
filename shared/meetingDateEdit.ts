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

/**
 * "3:00 PM", "6 p.m.", "noon", "18:30" → "HH:MM" (24h), or undefined when the
 * text is not a single clock time. Used by "Use source time" so a header that
 * states the time also sets the meeting's real start instant.
 */
export function clockTextTo24h(text: unknown): string | undefined {
  const raw = String(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!raw) return undefined;
  if (/^noon$|^12 ?noon$/.test(raw)) return "12:00";
  if (/^midnight$/.test(raw)) return "00:00";
  const match = /^(\d{1,2})(?:[:.h](\d{2}))? ?(a\.?m\.?|p\.?m\.?)?$/.exec(raw);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3]?.replace(/\./g, "");
  if (!meridiem && match[2] === undefined) return undefined; // "6" alone is not a time
  if (minute > 59) return undefined;
  if (meridiem) {
    if (hour < 1 || hour > 12) return undefined;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  } else if (hour > 23) {
    return undefined;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
