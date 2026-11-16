/**
 * Meetings as a day-by-day timeline: what's coming up, today, then earlier
 * days. Pure module (src/features/meetings/MeetingsTimeline.tsx renders it).
 *
 * Days are local calendar days of the viewer; a date-only meeting (noon-UTC
 * placeholder, `scheduledAtPrecision: "date"`) keeps its calendar date.
 */
export type TimelineMeeting = {
  _id: string;
  title: string;
  scheduledAt: string;
  scheduledAtPrecision?: string;
  status?: string;
};

export type TimelineGroup<T extends TimelineMeeting> = {
  key: string;
  /** "Today", "Tomorrow", "Yesterday", or "Thursday, November 19". */
  label: string;
  /** "upcoming" groups read oldest first; "past" groups newest first. */
  when: "upcoming" | "today" | "past";
  date: string;
  meetings: T[];
};

const pad = (value: number) => String(value).padStart(2, "0");
const localDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** The calendar day a meeting falls on for this viewer. */
export function meetingDay(meeting: Pick<TimelineMeeting, "scheduledAt" | "scheduledAtPrecision">): string {
  if (meeting.scheduledAtPrecision === "date") return meeting.scheduledAt.slice(0, 10);
  const date = new Date(meeting.scheduledAt);
  return Number.isNaN(date.getTime()) ? meeting.scheduledAt.slice(0, 10) : localDay(date);
}

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return localDay(new Date(year, month - 1, date + days));
}

export function dayLabel(day: string, today: string, locale = "en-CA"): string {
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(year, month - 1, date);
  const sameYear = year === Number(today.slice(0, 4));
  return value.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/**
 * Upcoming days (within `upcomingDays`, soonest first), today, then earlier
 * days back to `pastDays` (most recent first). Meetings in a day read in time
 * order. `hasEarlier` says whether older meetings were left out.
 */
export function groupMeetingsByDay<T extends TimelineMeeting>(
  meetings: readonly T[],
  now: Date,
  options: { upcomingDays?: number; pastDays?: number } = {},
): { groups: TimelineGroup<T>[]; hasEarlier: boolean; laterCount: number } {
  const today = localDay(now);
  const lastUpcoming = addDays(today, options.upcomingDays ?? 30);
  const firstPast = addDays(today, -(options.pastDays ?? 60));
  const byDay = new Map<string, T[]>();
  let hasEarlier = false;
  let laterCount = 0;
  for (const meeting of meetings) {
    const day = meetingDay(meeting);
    if (day > lastUpcoming) { laterCount += 1; continue; }
    if (day < firstPast) { hasEarlier = true; continue; }
    byDay.set(day, [...(byDay.get(day) ?? []), meeting]);
  }
  const days = [...byDay.keys()];
  const order = (day: string) => (day > today ? 0 : day === today ? 1 : 2);
  days.sort((a, b) => order(a) - order(b) || (order(a) === 2 ? b.localeCompare(a) : a.localeCompare(b)));
  return {
    groups: days.map((day) => ({
      key: day,
      date: day,
      label: dayLabel(day, today),
      when: day > today ? "upcoming" : day === today ? "today" : "past",
      meetings: [...byDay.get(day)!].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
    })),
    hasEarlier,
    laterCount,
  };
}
