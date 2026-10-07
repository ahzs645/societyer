/**
 * AGM EVIDENCE — one source of truth for "when did this organization actually
 * hold its annual general meetings, and which annual report belongs to which
 * AGM".
 *
 * Before this module the compliance engine only read the profile fields
 * `annualMeetingDate` / `annualMeetingYear`, the derived AGM deadline only read
 * the planned AGM month/day, and the annual cycle matched filings to a year by
 * substring. Meeting records were never consulted, so a society that held its
 * AGM (and recorded it as a meeting) was still told it had missed it, and a
 * single annual report could be counted in two cycles.
 *
 * Statutory anchors (BC Societies Act, SBC 2015, c. 18):
 *  - s.71: an AGM must be held in each calendar year after the year of
 *    incorporation (by December 31), unless the registrar extends the time;
 *  - s.73: the annual report is due within 30 days after the AGM, or — when no
 *    AGM is held in the calendar year — by January 31 of the following year.
 *
 * Framework-free and date-only ("YYYY-MM-DD" strings) so it runs in the
 * browser, the local runtime, hosted Convex and plain Node gate scripts.
 */

export type AgmMeetingLike = {
  _id?: string;
  type?: string | null;
  status?: string | null;
  title?: string | null;
  scheduledAt?: string | null;
  heldAt?: string | null;
  minutesId?: string | null;
};

export type AnnualReportFilingLike = {
  _id?: string;
  kind?: string | null;
  status?: string | null;
  dueDate?: string | null;
  filedAt?: string | null;
  periodLabel?: string | null;
  title?: string | null;
};

/** Filing kinds that discharge the BC society annual report duty (s.73). */
export const ANNUAL_REPORT_FILING_KINDS: ReadonlySet<string> = new Set([
  "AnnualReport",
  "BCSocietyAnnualReport",
]);

const HELD_STATUSES = new Set(["held", "completed", "complete", "closed", "minuted", "approved", "adjourned"]);
const NOT_HELD_STATUSES = new Set(["draft", "cancelled", "canceled", "postponed", "scheduled", "planned", "proposed"]);

/** Strict YYYY-MM-DD prefix of an ISO date/datetime, or "" when unparseable. */
export function dateOnly(value?: string | null): string {
  if (!value) return "";
  const raw = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const parsed = Date.parse(`${raw}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== raw) return "";
  return raw;
}

export function addDaysToDate(value: string, days: number): string {
  const raw = dateOnly(value);
  if (!raw) return "";
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** True for an annual general meeting record (by type, or a titled AGM that
 *  was imported without a type). Board/committee meetings never count. */
export function isAgmMeeting(meeting: AgmMeetingLike): boolean {
  const type = String(meeting.type ?? "").trim().toLowerCase();
  if (type === "agm" || type === "annual general meeting" || type === "annual") return true;
  if (type && type !== "general") return false;
  return /\b(annual general meeting|agm)\b/i.test(String(meeting.title ?? ""));
}

/** Whether a meeting record is evidence that the meeting actually took place.
 *  A meeting explicitly marked Held/Completed counts; so does a past meeting
 *  whose status is not one of the "not held" states. Draft/Scheduled/Cancelled
 *  rows never count, even when dated in the past. */
export function isHeldMeeting(meeting: AgmMeetingLike, today: string): boolean {
  const status = String(meeting.status ?? "").trim().toLowerCase();
  const date = dateOnly(meeting.heldAt ?? meeting.scheduledAt);
  if (!date) return false;
  if (HELD_STATUSES.has(status)) return date <= today;
  if (NOT_HELD_STATUSES.has(status)) return false;
  return date < today;
}

/** Held AGM dates (YYYY-MM-DD, ascending, de-duplicated). */
export function heldAgmDates(meetings: readonly AgmMeetingLike[] | null | undefined, today: string): string[] {
  const dates = new Set<string>();
  for (const meeting of meetings ?? []) {
    if (!isAgmMeeting(meeting) || !isHeldMeeting(meeting, today)) continue;
    const date = dateOnly(meeting.heldAt ?? meeting.scheduledAt);
    if (date) dates.add(date);
  }
  return [...dates].sort();
}

export type AgmFacts = {
  /** Latest held AGM date (profile field or meeting record, whichever is later). */
  annualMeetingDate?: string;
  annualMeetingYear?: number;
  /** Every calendar year in which an AGM is evidenced. */
  agmYears: number[];
  /** All evidenced AGM dates, ascending. */
  agmDates: string[];
  /** Earliest held meeting of any kind; proves the organization was operating. */
  operatingSinceDate?: string;
  /** Where the latest AGM date came from. */
  source: "profile" | "meetings" | "none";
};

/**
 * Merge the profile's AGM fields with held AGM meeting records. The latest
 * evidenced AGM wins; every evidenced year is kept so "was an AGM held in Y?"
 * can be answered for any year, not just the latest.
 */
export function deriveAgmFacts(
  organizationInput: object | null | undefined,
  meetings: readonly AgmMeetingLike[] | null | undefined,
  today: string,
): AgmFacts {
  const organization = organizationInput as { annualMeetingDate?: string | null; annualMeetingYear?: number | null } | null | undefined;
  const meetingDates = heldAgmDates(meetings, today);
  const profileDate = dateOnly(organization?.annualMeetingDate ?? undefined);
  const dates = new Set(meetingDates);
  if (profileDate && profileDate <= today) dates.add(profileDate);
  const agmDates = [...dates].sort();
  const latest = agmDates[agmDates.length - 1];
  const years = new Set(agmDates.map((date) => Number(date.slice(0, 4))));
  const profileYear = Number(organization?.annualMeetingYear);
  if (Number.isInteger(profileYear) && profileYear > 0) years.add(profileYear);
  const agmYears = [...years].sort((a, b) => a - b);
  let operatingSinceDate: string | undefined;
  for (const meeting of meetings ?? []) {
    if (!isHeldMeeting(meeting, today)) continue;
    const date = dateOnly(meeting.heldAt ?? meeting.scheduledAt);
    if (date && (!operatingSinceDate || date < operatingSinceDate)) operatingSinceDate = date;
  }
  const latestYear = latest ? Number(latest.slice(0, 4)) : undefined;
  const maxYear = agmYears.length ? agmYears[agmYears.length - 1] : undefined;
  return {
    annualMeetingDate: latest,
    annualMeetingYear: maxYear ?? latestYear,
    agmYears,
    agmDates,
    operatingSinceDate,
    source: !latest ? (agmYears.length ? "profile" : "none") : meetingDates.includes(latest) && latest !== profileDate ? "meetings" : "profile",
  };
}

/** Whether an AGM is evidenced for a calendar year. */
export function agmHeldInYear(facts: Pick<AgmFacts, "agmYears">, year: number): boolean {
  return facts.agmYears.includes(year);
}

export type AnnualReportMatch = {
  filing: AnnualReportFilingLike;
  /** The statutory due date this filing is measured against. */
  dueDate: string;
  filed: boolean;
  /** Filed after the statutory due date. */
  late: boolean;
  /** Days late (0 when on time or not filed). */
  daysLate: number;
};

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

/**
 * Find the annual report filing that belongs to the AGM held on `agmDate`.
 *
 * A filed report belongs to the AGM it follows: filed on/after `agmDate` and
 * before the next evidenced AGM. An unfiled (tracked) report belongs to the
 * AGM whose 30-day deadline it carries, or whose year it names. Filings listed
 * in `claimed` (already attributed to another cycle) are skipped, so one filing
 * is never counted in two cycles.
 */
export function annualReportForAgm(
  filings: readonly AnnualReportFilingLike[] | null | undefined,
  agmDate: string,
  options: { nextAgmDate?: string; dueDays?: number; claimed?: ReadonlySet<string> } = {},
): AnnualReportMatch | null {
  const agm = dateOnly(agmDate);
  if (!agm) return null;
  const dueDate = addDaysToDate(agm, options.dueDays ?? 30);
  const nextAgm = dateOnly(options.nextAgmDate);
  const year = agm.slice(0, 4);
  const candidates = (filings ?? []).filter((filing) =>
    ANNUAL_REPORT_FILING_KINDS.has(String(filing.kind ?? "")) &&
    !(filing._id && options.claimed?.has(String(filing._id))),
  );
  const filed = candidates
    .filter((filing) => String(filing.status ?? "") === "Filed" && dateOnly(filing.filedAt))
    .filter((filing) => {
      const filedAt = dateOnly(filing.filedAt);
      return filedAt >= agm && (!nextAgm || filedAt < nextAgm);
    })
    .sort((a, b) => dateOnly(a.filedAt).localeCompare(dateOnly(b.filedAt)))[0];
  if (filed) {
    const filedAt = dateOnly(filed.filedAt);
    const daysLate = Math.max(0, daysBetween(dueDate, filedAt));
    return { filing: filed, dueDate, filed: true, late: daysLate > 0, daysLate };
  }
  const tracked = candidates
    .filter((filing) => String(filing.status ?? "") !== "Filed")
    .filter((filing) => {
      const due = dateOnly(filing.dueDate);
      if (due && due >= agm && due <= addDaysToDate(agm, 90)) return true;
      return /\b\d{4}\b/.test(String(filing.periodLabel ?? "")) && String(filing.periodLabel).match(/\b\d{4}\b/g)?.at(-1) === year;
    })
    .sort((a, b) => dateOnly(a.dueDate).localeCompare(dateOnly(b.dueDate)))[0];
  if (tracked) return { filing: tracked, dueDate, filed: false, late: false, daysLate: 0 };
  return null;
}

/**
 * The no-AGM annual report (s.73(1)(b)): when no AGM was held in calendar year
 * `year`, the report for that year is due January 31 of the next year. Returns
 * the matching filing (filed in the following January window or tracked with
 * that due date), or null.
 */
export function noAgmAnnualReportForYear(
  filings: readonly AnnualReportFilingLike[] | null | undefined,
  year: number,
  options: { claimed?: ReadonlySet<string> } = {},
): AnnualReportMatch | null {
  const dueDate = `${year + 1}-01-31`;
  const candidates = (filings ?? []).filter((filing) =>
    ANNUAL_REPORT_FILING_KINDS.has(String(filing.kind ?? "")) &&
    !(filing._id && options.claimed?.has(String(filing._id))),
  );
  const filed = candidates.find((filing) => {
    const filedAt = dateOnly(filing.filedAt);
    return String(filing.status ?? "") === "Filed" && filedAt >= `${year + 1}-01-01` && filedAt <= `${year + 1}-12-31` && !/\bAGM\b/i.test(String(filing.periodLabel ?? ""));
  });
  if (filed) {
    const daysLate = Math.max(0, daysBetween(dueDate, dateOnly(filed.filedAt)));
    return { filing: filed, dueDate, filed: true, late: daysLate > 0, daysLate };
  }
  const tracked = candidates.find((filing) => String(filing.status ?? "") !== "Filed" && dateOnly(filing.dueDate) === dueDate);
  return tracked ? { filing: tracked, dueDate, filed: false, late: false, daysLate: 0 } : null;
}

/**
 * BC Societies Act s.71 AGM deadline for the cycle containing `today`.
 * Returns the current calendar year's December 31 when no AGM is evidenced in
 * the current year (even if a planned month/day already passed — that AGM is
 * overdue against the plan but still statutorily possible until Dec 31), and
 * otherwise the next year's deadline. `plannedMonthDay` refines the target to
 * the planned date when it is still ahead in the target year.
 */
export function nextBcSocietyAgmDeadline(
  agmYears: readonly number[],
  today: string,
  plannedMonthDay?: { month: number; day: number } | null,
): { dueDate: string; targetYear: number; plannedDate?: string; overdueAgainstPlan: boolean } {
  const year = Number(today.slice(0, 4));
  const targetYear = agmYears.includes(year) ? year + 1 : year;
  const statutory = `${targetYear}-12-31`;
  if (!plannedMonthDay) return { dueDate: statutory, targetYear, overdueAgainstPlan: false };
  const maxDay = new Date(Date.UTC(targetYear, plannedMonthDay.month, 0)).getUTCDate();
  const plannedDate = `${targetYear}-${String(plannedMonthDay.month).padStart(2, "0")}-${String(Math.min(plannedMonthDay.day, maxDay)).padStart(2, "0")}`;
  if (plannedDate >= today) return { dueDate: plannedDate, targetYear, plannedDate, overdueAgainstPlan: false };
  return { dueDate: statutory, targetYear, plannedDate, overdueAgainstPlan: true };
}
