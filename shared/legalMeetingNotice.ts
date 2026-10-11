/** The arithmetic below returns NOMINAL calendar boundaries, not a finding of
 * legal notice validity. Applicable holidays and office closures need review:
 * BC IA s.25(3) distinguishes forward and backward periods, federal IA s.26
 * addresses holiday expiry, and Ontario Legislation Act ss.88–89 applies its
 * own rules. In particular, a boundary BEFORE a meeting can move earlier. */
export const NOTICE_CALENDAR_REVIEW_CAVEAT = "Calculated notice dates are nominal calendar boundaries. Review the applicable holiday and office-opening rules before relying on them. A boundary before a meeting may move earlier; this calculation does not verify legal notice timing.";

/** BC BCA s.169 and Interpretation Act s.25.3: a period BEFORE a meeting
 * runs backwards from the meeting's calendar date, with month-end clamping.
 * Do not substitute 60/62 days or calculate forwards from the notice date. */
export function calendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export function shiftCalendarMonths(dateISO: string, months: number): string | null {
  const source = calendarDate(dateISO);
  if (!source || !Number.isInteger(months)) return null;
  const target = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(source.getUTCDate(), last));
  return target.toISOString().slice(0, 10);
}

/** Nominal earliest boundary. The legacy API name does not certify permission. */
export function earliestPermittedNoticeDate(meetingDateISO: string, maximumDays: number, maximumCalendarMonths?: number): string | null {
  if (maximumCalendarMonths !== undefined) return shiftCalendarMonths(meetingDateISO, -maximumCalendarMonths);
  const meeting = calendarDate(meetingDateISO);
  if (!meeting || !Number.isInteger(maximumDays) || maximumDays < 0) return null;
  meeting.setUTCDate(meeting.getUTCDate() - maximumDays);
  return meeting.toISOString().slice(0, 10);
}

/** Nominal latest boundary; holiday/office review may require an earlier day. */
export function latestPermittedNoticeDate(meetingDateISO: string, minimumDays: number, clearDays = false): string | null {
  return earliestPermittedNoticeDate(meetingDateISO, minimumDays + (clearDays ? 1 : 0));
}
