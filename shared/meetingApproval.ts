/**
 * Minutes approval date checks (ui-meetings F8).
 *
 * Minutes are adopted at a later meeting. An approval is consistent when:
 *  - it is not before the meeting the minutes record;
 *  - the approving meeting is not this meeting and took place after it;
 *  - the approval date is the approving meeting's date (same calendar day,
 *    allowing one day either side for time-zone drift of date-only records);
 *  - it is not in the future.
 *
 * Pure module. Dates are compared as calendar days (YYYY-MM-DD).
 */
import { meetingCalendarDate, type MeetingDateLike } from "./meetingDates";
import { todayDateOnly } from "./dateOnly";

export type ApprovalCheckInput = {
  approvedOn: string; // YYYY-MM-DD or ISO
  meeting: MeetingDateLike & { _id?: string };
  approvingMeeting?: (MeetingDateLike & { _id?: string; title?: string }) | null;
  today?: string; // YYYY-MM-DD (tests)
};

function day(value: unknown): string | undefined {
  const text = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : undefined;
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

export function minutesApprovalIssues(input: ApprovalCheckInput): string[] {
  const issues: string[] = [];
  const approvedOn = day(input.approvedOn);
  if (!approvedOn) return ["Enter the date the minutes were approved."];
  const meetingDay = meetingCalendarDate(input.meeting);
  // The reviewer's local calendar day: the UTC day is already tomorrow on a
  // BC evening, which let a future approval date through.
  const today = input.today ?? todayDateOnly();
  if (meetingDay && dayDiff(approvedOn, meetingDay) < 0) {
    issues.push(`Approval (${approvedOn}) is before the meeting itself (${meetingDay}).`);
  }
  if (dayDiff(approvedOn, today) > 0) issues.push("Approval date is in the future.");
  const approving = input.approvingMeeting;
  if (approving) {
    if (approving._id && input.meeting._id && String(approving._id) === String(input.meeting._id)) {
      issues.push("Minutes cannot be approved at the meeting they record.");
    } else {
      const approvingDay = meetingCalendarDate(approving);
      if (approvingDay && meetingDay && dayDiff(approvingDay, meetingDay) <= 0) {
        issues.push(`The approving meeting (${approvingDay}) must be after this meeting (${meetingDay}).`);
      }
      if (approvingDay && Math.abs(dayDiff(approvedOn, approvingDay)) > 1) {
        issues.push(`Approval date ${approvedOn} does not match the approving meeting's date (${approvingDay}).`);
      }
    }
  }
  return issues;
}

/** Meetings that could have approved these minutes: later ones, nearest first. */
export function approvingMeetingCandidates<T extends MeetingDateLike & { _id?: string; status?: string }>(meeting: MeetingDateLike & { _id?: string }, meetings: readonly T[]): T[] {
  const meetingDay = meetingCalendarDate(meeting) ?? "";
  return meetings
    .filter((row) => String(row._id) !== String(meeting._id) && row.status !== "Cancelled")
    .filter((row) => (meetingCalendarDate(row) ?? "") > meetingDay)
    .sort((a, b) => String(meetingCalendarDate(a)).localeCompare(String(meetingCalendarDate(b))));
}
