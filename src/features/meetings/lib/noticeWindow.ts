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
  const date = value instanceof Date ? value : new Date(value);
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

export function meetsNoticeWindow(value: string, minDays: number, maxDays: number) {
  const days = daysUntil(value);
  return days != null && days >= minDays && days <= maxDays;
}
