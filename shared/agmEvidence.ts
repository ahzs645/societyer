import { legalGovernanceProfile } from "./legalGovernanceProfiles";
import { canonicalizeJurisdictionCode } from "./organizationDomain";

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
  reportingYear?: number;
  reportingPeriodEnd?: string;
  contextKind?: string;
  jurisdictionCode?: string;
};

/** Filing kinds that discharge the BC society annual report duty (s.73). */
export const ANNUAL_REPORT_FILING_KINDS: ReadonlySet<string> = new Set([
  "AnnualReport",
  "BCSocietyAnnualReport",
]);

const HELD_STATUSES = new Set(["held", "completed", "complete", "closed", "minuted", "approved", "adjourned", "heldminutesmissing"]);
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

/** An explicit held/completed state or actual held date is evidence. A past
 * scheduled date alone never proves that a meeting took place. */
export function isHeldMeeting(meeting: AgmMeetingLike, today: string): boolean {
  const status = String(meeting.status ?? "").trim().toLowerCase();
  const date = dateOnly(meeting.heldAt ?? meeting.scheduledAt);
  if (!date) return false;
  if (HELD_STATUSES.has(status)) return date <= today;
  if (NOT_HELD_STATUSES.has(status)) return false;
  return Boolean(dateOnly(meeting.heldAt)) && date <= today;
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
  const organization = organizationInput as { annualMeetingDate?: string | null; annualMeetingYear?: number | null; agmExtensionDate?: string; agmExtensionEvidence?: string } | null | undefined;
  const meetingDates = heldAgmDates(meetings, today);
  const profileDate = dateOnly(organization?.annualMeetingDate ?? undefined);
  const dates = new Set(meetingDates);
  if (profileDate && profileDate <= today) dates.add(profileDate);
  const agmDates = [...dates].sort();
  const latest = agmDates[agmDates.length - 1];
  const years = new Set(agmDates.map((date) => Number(date.slice(0, 4))));
  const profileYear = Number(organization?.annualMeetingYear);
  // An authorized postponed AGM counts for its attributed year only. A year
  // with no actual meeting date does not establish completed annual business.
  const extension = dateOnly(organization?.agmExtensionDate);
  if (legalGovernanceProfile(organizationInput ?? undefined)?.id === "bc_society" && profileDate && profileDate <= today && organization?.agmExtensionEvidence?.trim() && extension &&
    profileYear === Number(profileDate.slice(0, 4)) - 1 && Number(extension.slice(0, 4)) === profileYear + 1 && profileDate <= extension) {
    if (!agmDates.some(date => date !== profileDate && Number(date.slice(0, 4)) === profileYear + 1)) years.delete(profileYear + 1);
    years.add(profileYear);
  }
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
  /** Nominal Act arithmetic; holiday/office adjustments are reviewed separately. */
  dueDate: string;
  filed: boolean;
  /** Only false is inferred here; a later filing requires calendar review. */
  late?: boolean;
  nominalDaysPastDue: number;
  timingReviewRequired: boolean;
};

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

/** A unique stated year or explicit field identifies a reporting cycle. */
export function statedReportingYear(filing: AnnualReportFilingLike): number | undefined {
  if (Number.isInteger(filing.reportingYear) && filing.reportingYear! >= 1 && filing.reportingYear! <= 9999) return filing.reportingYear;
  const label = String(filing.periodLabel ?? "");
  // Financial ranges, including shortened FY2025-26, are ambiguous AGM years.
  if (/\d{4}\s*[-–/]\s*\d{2,4}(?!\d)/.test(label) && !/^\d{4}-\d{2}-\d{2}$/.test(label.trim())) return undefined;
  const years = [...new Set([...label.matchAll(/(?:^|[^\d])((?:19|20)\d{2})(?!\d)/g)].map(match => match[1]))];
  return years.length === 1 ? Number(years[0]) : undefined;
}

function belongsToYear(filing: AnnualReportFilingLike, year: number, dueDate: string): boolean {
  const stated = statedReportingYear(filing);
  if (stated !== undefined) return stated === year;
  // A dated, exact statutory due date is a usable legacy cycle anchor only
  // when no conflicting or ambiguous year label is present.
  return !/\b\d{4}\b/.test(String(filing.periodLabel ?? "")) && dateOnly(filing.dueDate) === dueDate;
}

function isHomeBcAnnualReport(filing: AnnualReportFilingLike): boolean {
  const context = String(filing.contextKind ?? '').trim().toLowerCase();
  return ANNUAL_REPORT_FILING_KINDS.has(String(filing.kind ?? '')) && (!context || context === 'home') &&
    (!String(filing.jurisdictionCode ?? '').trim() || canonicalizeJurisdictionCode(filing.jurisdictionCode) === 'CA-BC');
}

function reportMatch(filing: AnnualReportFilingLike, dueDate: string, filed: boolean): AnnualReportMatch {
  const nominalDaysPastDue = filed ? Math.max(0, daysBetween(dueDate, dateOnly(filing.filedAt))) : 0;
  return { filing, dueDate, filed, late: nominalDaysPastDue ? undefined : false, nominalDaysPastDue, timingReviewRequired: nominalDaysPastDue > 0 };
}

/**
 * Find the annual report filing that belongs to the AGM held on `agmDate`.
 *
 * The stated reporting year or exact nominal due-date anchor must identify the
 * cycle. Filed dates must also be on/after `agmDate` and before the next
 * evidenced AGM; a filed date alone cannot identify the cycle. Filings listed
 * in `claimed` (already attributed to another cycle) are skipped, so one filing
 * is never counted in two cycles.
 */
export function annualReportForAgm(
  filings: readonly AnnualReportFilingLike[] | null | undefined,
  agmDate: string,
  options: { nextAgmDate?: string; dueDays?: number; cycleYear?: number; asOfISO?: string; claimed?: ReadonlySet<string> } = {},
): AnnualReportMatch | null {
  const agm = dateOnly(agmDate);
  if (!agm) return null;
  const dueDate = addDaysToDate(agm, options.dueDays ?? 30);
  const nextAgm = dateOnly(options.nextAgmDate);
  const year = options.cycleYear ?? Number(agm.slice(0, 4));
  const candidates = (filings ?? []).filter((filing) =>
    isHomeBcAnnualReport(filing) &&
    !(filing._id && options.claimed?.has(String(filing._id))) && belongsToYear(filing, year, dueDate),
  );
  const filed = candidates
    .filter((filing) => /^(filed|accepted)$/i.test(String(filing.status ?? "")) && dateOnly(filing.filedAt))
    .filter((filing) => {
      const filedAt = dateOnly(filing.filedAt);
      return filedAt >= agm && (!nextAgm || filedAt < nextAgm) && (!options.asOfISO || filedAt <= options.asOfISO);
    })
    .sort((a, b) => dateOnly(a.filedAt).localeCompare(dateOnly(b.filedAt)))[0];
  if (filed) return reportMatch(filed, dueDate, true);
  const tracked = candidates
    .filter((filing) => !/^(filed|accepted)$/i.test(String(filing.status ?? "")))
    .sort((a, b) => dateOnly(a.dueDate).localeCompare(dateOnly(b.dueDate)))[0];
  if (tracked) return reportMatch(tracked, dueDate, false);
  return null;
}

/**
 * The no-AGM annual report (s.73(2)): when no AGM was held in calendar year
 * `year`, the report for that year is due January 31 of the next year. Returns
 * the matching reporting-year filing, including a later filing, or null.
 * A matching filed date does not alone establish timeliness.
 */
export function noAgmAnnualReportForYear(
  filings: readonly AnnualReportFilingLike[] | null | undefined,
  year: number,
  options: { claimed?: ReadonlySet<string>; extensionDate?: string; asOfISO?: string } = {},
): AnnualReportMatch | null {
  const extension = dateOnly(options.extensionDate);
  const earliestFiling = extension || `${year + 1}-01-01`;
  const dueDate = extension ? addDaysToDate(extension, 30) : `${year + 1}-01-31`;
  const candidates = (filings ?? []).filter((filing) =>
    isHomeBcAnnualReport(filing) &&
    !(filing._id && options.claimed?.has(String(filing._id))) && belongsToYear(filing, year, dueDate),
  );
  const filed = candidates.find((filing) => {
    const filedAt = dateOnly(filing.filedAt);
    return /^(filed|accepted)$/i.test(String(filing.status ?? "")) && Boolean(filedAt) && filedAt >= earliestFiling && (!options.asOfISO || filedAt <= options.asOfISO) && !/\bAGM\b/i.test(String(filing.periodLabel ?? "").replace(/no[ -]?AGM/gi, ""));
  });
  if (filed) return reportMatch(filed, dueDate, true);
  const tracked = candidates.find((filing) => !/^(filed|accepted)$/i.test(String(filing.status ?? "")));
  return tracked ? reportMatch(tracked, dueDate, false) : null;
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
