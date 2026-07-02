/** Notice-window helpers for general meetings (AGM/SGM), shared by the
 *  Meetings page drawer and the schedule-from-template modal. */

export function isGeneralMeeting(type: string) {
  return type === "AGM" || type === "SGM";
}

/** Whole days from today (local midnight) to the given date value, or null if
 *  unparseable. Day granularity so a suggested default of "now + minDays"
 *  passes its own check after datetime-local truncates the seconds. */
export function daysUntil(value: string) {
  const scheduled = new Date(value);
  if (!Number.isFinite(scheduled.getTime())) return null;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOfDay(scheduled) - startOfDay(new Date())) / 864e5);
}

export function meetsNoticeWindow(value: string, minDays: number, maxDays: number) {
  const days = daysUntil(value);
  return days != null && days >= minDays && days <= maxDays;
}
