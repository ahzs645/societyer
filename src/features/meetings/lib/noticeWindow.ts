import { earliestPermittedNoticeDate, NOTICE_CALENDAR_REVIEW_CAVEAT } from "../../../../shared/legalMeetingNotice";

/** Notice-window helpers for general meetings (AGM/SGM), shared by the
 *  Meetings page drawer and the schedule-from-template modal. */

export function isGeneralMeeting(type: string) {
  return type === "AGM" || type === "SGM";
}

export const OVERLAP_WINDOW_MS = 2 * 60 * 60 * 1000;

export function meetingScheduleConflicts<T extends {
  _id: string;
  status: string;
  scheduledAt: string;
}>(
  meetings: T[] | undefined,
  scheduledAt: string,
  editingId: string | null = null,
): T[] {
  const draftTs = scheduledAt ? new Date(scheduledAt).getTime() : NaN;
  if (!Number.isFinite(draftTs)) return [];
  return (meetings ?? []).filter(
    (meeting) =>
      String(meeting._id) !== String(editingId ?? "") &&
      meeting.status !== "Cancelled" &&
      Math.abs(new Date(meeting.scheduledAt).getTime() - draftTs) <= OVERLAP_WINDOW_MS,
  );
}

/** Whole days from today (local midnight) to the given date value, or null if
 *  unparseable. Day granularity so a suggested default of "now + minDays"
 *  passes its own check after datetime-local truncates the seconds. */
function localDayNumber(value: string | Date) {
  const date = value instanceof Date ? value : /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))) : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 864e5);
}

/** Calendar days between two local dates. This deliberately ignores clock time
 * and DST so an AGM on July 27 is 14 days from July 13 even when the current
 * time is later than the meeting's scheduled time. */
export function calendarDaysBetween(later: string | Date, earlier: string | Date) {
  const laterDay = localDayNumber(later);
  const earlierDay = localDayNumber(earlier);
  if (laterDay == null || earlierDay == null) return null;
  return laterDay - earlierDay;
}

export function daysUntil(value: string, now: string | Date = new Date()) {
  const scheduled = new Date(value);
  if (!Number.isFinite(scheduled.getTime())) return null;
  return calendarDaysBetween(scheduled, now);
}

export type NoticeRules = { noticeRequiresClearDays?: boolean; noticeUsesCalendarMonthsMaximum?: boolean; governanceAutomationBlocked?: boolean };

export function noticeDaysUntil(value: string, rules?: NoticeRules, now: string | Date = new Date()) {
  const days = daysUntil(value, now);
  return days == null ? null : days - (rules?.noticeRequiresClearDays ? 1 : 0);
}

/** Compare nominal calendar arithmetic only. This does not establish that
 * notice was legally sufficient after holiday, office or delivery review. */
export function withinNominalNoticeWindow(notice: string | Date, meeting: string, minDays: number, maxDays: number, rules?: NoticeRules) {
  if (rules?.governanceAutomationBlocked) return false;
  const calendarDays = calendarDaysBetween(meeting, notice);
  if (calendarDays == null || calendarDays - (rules?.noticeRequiresClearDays ? 1 : 0) < minDays) return false;
  if (!rules?.noticeUsesCalendarMonthsMaximum) return calendarDays <= maxDays;
  const dateOnly = (value: string | Date) => {
    const day = localDayNumber(value);
    return day == null ? "" : new Date(day * 864e5).toISOString().slice(0, 10);
  };
  const earliest = earliestPermittedNoticeDate(dateOnly(meeting), maxDays, 2);
  return !!earliest && dateOnly(notice) >= earliest;
}

/** @deprecated Use withinNominalNoticeWindow for planning or assessNoticeWindow
 * for a displayed posture. A true result is not verified legal notice timing. */
export const noticeWindowSatisfied = withinNominalNoticeWindow;

/** A successful raw date comparison must not become a green legal conclusion.
 * There is deliberately no guessed holiday calendar or automatic adjustment. */
export function assessNoticeWindow(notice: string | Date, meeting: string, minDays: number, maxDays: number, rules?: NoticeRules) {
  const unavailable = rules?.governanceAutomationBlocked || calendarDaysBetween(meeting, notice) == null;
  const within = !unavailable && withinNominalNoticeWindow(notice, meeting, minDays, maxDays, rules);
  return {
    position: unavailable ? "not_assessed" as const : within ? "within_nominal_window" as const : "outside_nominal_window" as const,
    calendarReviewStatus: "required" as const,
    legallyVerified: false as const,
    tone: within ? "info" as const : "warn" as const,
    caveat: NOTICE_CALENDAR_REVIEW_CAVEAT,
  };
}

export function noticeWindowLabel(minDays: number, maxDays: number, rules?: NoticeRules) {
  const minimum = `${minDays}${rules?.noticeRequiresClearDays ? " clear" : ""} days`;
  const period = rules?.noticeUsesCalendarMonthsMaximum ? `at least ${minimum}, no earlier than 2 calendar months before the meeting` : `${minimum} minimum, ${maxDays} days maximum`;
  return `nominal ${period}; holiday/office calendar review required`;
}

export function meetsNominalNoticeWindow(value: string, minDays: number, maxDays: number, rules?: NoticeRules) {
  return withinNominalNoticeWindow(new Date(), value, minDays, maxDays, rules);
}

/** @deprecated This is only a nominal planning comparison. */
export const meetsNoticeWindow = meetsNominalNoticeWindow;

/**
 * Nominal planning start for a new meeting at 6:00 PM local time. Actual
 * notice timing still needs the applicable holiday/office and delivery review.
 */
export function defaultNewMeetingStart(noticeDays: number, now: Date = new Date()): Date {
  const start = new Date(now);
  start.setDate(start.getDate() + Math.max(0, noticeDays));
  start.setHours(18, 0, 0, 0);
  return start;
}

/** Create-form wording: recording a meeting that already happened vs scheduling one. */
export function meetingCreateLabels(scheduledAt: string, now: string | Date = new Date()) {
  const past = isPastMeeting(scheduledAt, now);
  return past
    ? { title: "Record a held meeting", action: "Record meeting", busy: "Recording…" }
    : { title: "Schedule meeting", action: "Schedule", busy: "Scheduling…" };
}

/** True when the meeting's calendar day is before today: the form records a meeting already held. */
/**
 * A scheduled meeting on a later calendar day has not happened yet: its
 * attendance list is who is *expected* (often pre-filled from a template) and
 * quorum cannot be determined (MA-8). A meeting dated today may be running
 * now, so attendance recorded on the day counts as present.
 */
export function meetingNotYetHeld(
  meeting: { status?: string | null; scheduledAt?: string | null } | null | undefined,
  now: string | Date = new Date(),
) {
  if (!meeting?.scheduledAt) return false;
  const status = String(meeting.status ?? "").trim().toLowerCase();
  if (status && status !== "scheduled" && status !== "draft" && status !== "planned") return false;
  const days = daysUntil(meeting.scheduledAt, now);
  return days != null && days > 0;
}

export function isPastMeeting(value: string, now: string | Date = new Date()) {
  const days = daysUntil(value, now);
  return days != null && days < 0;
}

/**
 * The minimum-notice check for a new general meeting. A meeting dated before
 * today is a record of one already held (setting up an existing organization),
 * so notice cannot be checked from today; the form's own advisory already
 * skips past dates.
 */
export function newGeneralMeetingNoticeProblem(value: string, minDays: number, rules?: NoticeRules, now: string | Date = new Date()) {
  if (isPastMeeting(value, now)) return null;
  const days = noticeDaysUntil(value, rules, now);
  return days == null || days < minDays ? `General meetings need at least ${minDays} days of notice under the nominal calendar calculation. Review the applicable holiday and office-opening rules.` : null;
}

/** New meetings dated before today are recorded as held, not scheduled. */
export function statusForNewMeeting(value: string, status: string, now: string | Date = new Date()) {
  return isPastMeeting(value, now) && (!status || status === "Scheduled") ? "Held" : status;
}

/**
 * A notice date typed for a meeting that already happened: YYYY-MM-DD, not
 * after the meeting. Returns the stored ISO value (local noon, so the day
 * cannot shift) or an error message.
 */
export function pastNoticeDateValue(text: string, meetingScheduledAt: string): { iso?: string; error?: string } {
  const value = String(text ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return { error: "Enter the date as YYYY-MM-DD." };
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  if (Number.isNaN(date.getTime()) || date.getDate() !== Number(match[3])) return { error: "Enter a real calendar date." };
  if (value > String(meetingScheduledAt ?? "").slice(0, 10)) return { error: "Notice must be sent on or before the meeting date." };
  return { iso: date.toISOString() };
}
