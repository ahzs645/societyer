import { nextBcSocietyAgmDeadline } from './agmEvidence';
import { entityMeetingWording } from './entityMeetingWording';
import { legalGovernanceProfile } from './legalGovernanceProfiles';
import { deriveTransparencyDeadlines, type TransparencyEventInput } from './significantIndividuals';

/** A filing discharges only its explicitly identified reporting period. */
export interface AnnualReturnFilingEvidence {
  cycleYear?: number;
  periodEnd?: string;
  filedAt: string;
  status?: 'filed' | 'accepted' | 'draft' | 'planned' | 'Filed' | 'Accepted';
  evidenceRef?: string;
}
export interface AnnualMeetingCompletion {
  date: string;
  kind: 'held' | 'written_annual_business' | 'written_waiver';
  /** Actual covered year, including an authorized postponed BC society AGM. */
  cycleYear?: number;
  annualReferenceDate?: string;
  /** Written alternatives must first be checked against the governing Act. */
  verified?: boolean;
  evidenceRef?: string;
}
export interface AnnualMeetingExtension {
  cycleYear: number;
  dueDate: string;
  authority: 'registrar' | 'court' | 'unanimous_shareholders';
  evidenceRef: string;
  originalDueDate?: string;
}
/** A calendar review is scoped to one calculated boundary, not a reusable
 * exemption. The reviewer must establish the applicable holiday, location and
 * filing-office/channel rules; the date engine does not guess these facts. */
export interface AnnualDeadlineCalendarReview {
  profileId: string;
  obligation: 'annual_meeting' | 'annual_return';
  cycleYear: number;
  nominalDueDate: string;
  reviewedDueDate: string;
  reviewedOn: string;
  verified: boolean;
  evidenceRef: string;
  calendarBasis: string;
}
export interface ComplianceSettings {
  agmMonth?: number;
  agmDay?: number;
  fiscalYearEnd?: string; // recurring MM-DD, not a completed reporting period
  incorporationDate?: string; // strict YYYY-MM-DD
  recognitionDate?: string; // incorporation/amalgamation/continuance
  anniversaryDate?: string;
  waivePrepFinancials?: boolean;
  jurisdictionCode?: string;
  entityType?: string;
  actFormedUnder?: string;
  kind?: string;
  organizationKind?: string;
  /** Legacy factual field: an actual held meeting, never a planned meeting. */
  annualMeetingDate?: string;
  annualMeetingDates?: readonly string[];
  annualMeetingCompletions?: readonly AnnualMeetingCompletion[];
  annualReferenceDate?: string;
  heldAgmYears?: number[];
  annualMeetingAssessmentYear?: number;
  /** Actual financial period to be dealt with at the next CBCA annual meeting. */
  annualMeetingFinancialYearEnd?: string;
  annualMeetingExtension?: AnnualMeetingExtension;
  /** Explicit reporting cycle prevents an unfiled year from rolling over. */
  annualReturnCycleYear?: number;
  annualReturnPeriodEnd?: string;
  annualReturnFilings?: readonly AnnualReturnFilingEvidence[];
  /** Convenience evidence requires both filed date and covered year/period. */
  lastAnnualReturnFiledAt?: string;
  lastAnnualReturnCycleYear?: number;
  lastAnnualReturnPeriodEnd?: string;
  annualDeadlineCalendarReviews?: readonly AnnualDeadlineCalendarReview[];
  /** BC transparency-register steps (annual reviews, changes, entries, notices). */
  transparencyEvents?: readonly TransparencyEventInput[];
}
/** Earlier cycles with no recorded completion or filing evidence. This is an
 * informational evidence gap, never the open deadline: an unrecorded history
 * neither proves non-compliance nor completion. */
export interface HistoryNotVerified {
  obligation: AnnualDeadlineCalendarReview['obligation'];
  cycleYears: readonly number[];
  /** Ontario: the fiscal-calendar taxation-year ends without filing evidence. */
  periodEnds?: readonly string[];
  basis: string;
}
export interface DeadlineAssessment {
  status: 'upcoming' | 'due' | 'overdue' | 'satisfied' | 'not_applicable' | 'review_required';
  dueDate: string | null;
  statutoryDueDate?: string;
  /** Unadjusted Act arithmetic, retained even after an evidenced adjustment. */
  nominalDueDate?: string;
  calendarReviewStatus?: 'unreviewed' | 'reviewed';
  calendarEvidenceRef?: string;
  /** Completion is factual; its timeliness can still require calendar review. */
  timingReviewRequired?: boolean;
  cycleYear?: number;
  anchorDate?: string;
  plannedDate?: string;
  filedAt?: string;
  late?: boolean;
  profileId?: string;
  basis: string;
  sourceIds: readonly string[];
  issues: readonly string[];
  historyNotVerified?: HistoryNotVerified;
}
export interface DerivedDeadline {
  key: string;
  title: string;
  dueDate: string;
  category: string;
  deadlineCategory: 'Governance' | 'Tax' | 'Payroll' | 'Privacy' | 'Other';
  basis?: string;
  sourceIds?: readonly string[];
  cycleYear?: number;
  status?: DeadlineAssessment['status'] | 'planned';
  plannedDate?: string;
}
interface YmdParts { year: number; month: number; day: number }
export function isLeapYear(year: number): boolean { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }
export function daysInMonth(year: number, month: number): number {
  return month === 2 ? isLeapYear(year) ? 29 : 28 : [4, 6, 9, 11].includes(month) ? 30 : 31;
}
/** Reject impossible dates and trailing timestamps/text; normalize evidence explicitly. */
export function parseComplianceDate(value?: string | null): YmdParts | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month) ? { year, month, day } : null;
}
function parseMonthDay(value?: string): { month: number; day: number } | null {
  const m = /^(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!m) return null;
  const month = Number(m[1]), day = Number(m[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(2000, month) ? { month, day } : null;
}
function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function inYear(year: number, month: number, day: number): string { return formatDate(year, month, Math.min(day, daysInMonth(year, month))); }
function validYear(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 9999; }
/** Calendar months: matching numerical date, clamped only when absent. */
export function addCalendarMonths(value: string, months: number): string | null {
  const p = parseComplianceDate(value);
  if (!p || !Number.isInteger(months)) return null;
  const ordinal = p.year * 12 + p.month - 1 + months;
  const year = Math.floor(ordinal / 12), month = ((ordinal % 12) + 12) % 12 + 1;
  return validYear(year) ? inYear(year, month, p.day) : null;
}
/** CRA fiscal-filing convention: a month-end period uses the target month-end. */
export function addFiscalFilingMonths(value: string, months: number): string | null {
  const p = parseComplianceDate(value), generic = addCalendarMonths(value, months);
  if (!p || !generic) return null;
  const target = parseComplianceDate(generic)!;
  return p.day === daysInMonth(p.year, p.month) ? formatDate(target.year, target.month, daysInMonth(target.year, target.month)) : generic;
}
export function addComplianceDays(value: string, days: number): string | null {
  if (!parseComplianceDate(value) || !Number.isInteger(days)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  if (!Number.isFinite(date.getTime())) return null;
  const result = date.toISOString().slice(0, 10);
  return parseComplianceDate(result) ? result : null;
}
function nextOccurrence(month: number, day: number, from: string, strictlyAfter = false): string | null {
  const p = parseComplianceDate(from);
  if (!p) return null;
  const candidate = inYear(p.year, month, day);
  return candidate > from || (!strictlyAfter && candidate === from) ? candidate : p.year < 9999 ? inYear(p.year + 1, month, day) : null;
}
/** Holiday and office-closure adjustments move an annual boundary by a few
 * days at most. Past this margin, an unreviewed calendar cannot make an open
 * cycle timely, and a cycle this far past is no longer the "current" one. */
export const CALENDAR_REVIEW_GRACE_DAYS = 7;
/** Accept a date-only value or an ISO timestamp, using the timestamp's date prefix. */
export function complianceDateFromISO(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(value);
  return m && parseComplianceDate(m[1]) ? m[1] : null;
}
function daysBetweenDates(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000);
}
function currentCycleFloor(today: string): string { return addComplianceDays(today, -CALENDAR_REVIEW_GRACE_DAYS) ?? today; }
function yearRanges(years: readonly number[]): string {
  const sorted = [...new Set(years)].sort((a, b) => a - b), ranges: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    ranges.push(i === j ? String(sorted[i]) : `${sorted[i]}–${sorted[j]}`);
    i = j;
  }
  return ranges.join(', ');
}
function withHistory(result: DeadlineAssessment, obligation: HistoryNotVerified['obligation'], cycleYears: readonly number[], periodEnds?: readonly string[]): DeadlineAssessment {
  if (!cycleYears.length) return result;
  const what = obligation === 'annual_meeting' ? 'annual meeting or written annual business' : 'filing';
  return { ...result, historyNotVerified: { obligation, cycleYears, ...(periodEnds?.length ? { periodEnds } : {}),
    basis: `History not verified: no ${what} evidence is recorded for ${periodEnds?.length ? `the periods ending ${periodEnds.join(', ')}` : `cycle${cycleYears.length === 1 ? '' : 's'} ${yearRanges(cycleYears)}`}. These earlier cycles are not assumed complete or missed; record their evidence, or review them separately. The open deadline starts after the latest recorded evidence.` } };
}
function plannedInYear(s: ComplianceSettings, year: number): string | undefined {
  if (!validYear(year) || !Number.isInteger(s.agmMonth) || !Number.isInteger(s.agmDay) || s.agmMonth! < 1 || s.agmMonth! > 12 || s.agmDay! < 1 || s.agmDay! > 31) return undefined;
  return inYear(year, s.agmMonth!, s.agmDay!);
}
/** Planning API retained for callers; never evidence of statutory completion. */
export function nextAgmDate(s: ComplianceSettings, fromISO: string): string | null {
  const from = parseComplianceDate(fromISO);
  if (!from || !plannedInYear(s, from.year)) return null;
  if (s.heldAgmYears) {
    if (legalGovernanceProfile(s)?.id === 'bc_society') return nextBcSocietyAgmDeadline(s.heldAgmYears, fromISO, { month: s.agmMonth!, day: s.agmDay! }).dueDate;
    return plannedInYear(s, s.heldAgmYears.includes(from.year) ? from.year + 1 : from.year) ?? null;
  }
  return nextOccurrence(s.agmMonth!, s.agmDay!, fromISO);
}
export function nextFiscalYearEnd(s: ComplianceSettings, fromISO: string): string | null {
  const md = parseMonthDay(s.fiscalYearEnd);
  return md ? nextOccurrence(md.month, md.day, fromISO) : null;
}
function review(basis: string, sourceIds: readonly string[] = [], profileId?: string, issues: readonly string[] = []): DeadlineAssessment {
  return { status: 'review_required', dueDate: null, basis, sourceIds, issues, profileId };
}
function timed(dueDate: string, today: string): DeadlineAssessment['status'] { return dueDate < today ? 'overdue' : dueDate === today ? 'due' : 'upcoming'; }
function recognition(s: ComplianceSettings): string | undefined { return s.recognitionDate ?? s.incorporationDate ?? s.anniversaryDate; }
function completions(s: ComplianceSettings, today: string): AnnualMeetingCompletion[] {
  const result: AnnualMeetingCompletion[] = [];
  for (const date of [...(s.annualMeetingDates ?? []), ...(s.annualMeetingDate ? [s.annualMeetingDate] : [])]) {
    if (parseComplianceDate(date) && date <= today) result.push({ date, kind: 'held' });
  }
  for (const item of s.annualMeetingCompletions ?? []) {
    if (!parseComplianceDate(item.date) || item.date > today || (item.cycleYear !== undefined && !validYear(item.cycleYear))) continue;
    if (item.kind !== 'held' && (!item.verified || !item.evidenceRef?.trim())) continue;
    if (item.cycleYear !== undefined && item.cycleYear !== Number(item.date.slice(0, 4)) && (!item.verified || !item.evidenceRef?.trim())) continue;
    result.push(item);
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}
function completionYear(item: AnnualMeetingCompletion): number { return item.cycleYear ?? Number(item.date.slice(0, 4)); }
function extensionFor(s: ComplianceSettings, profileId: string, cycleYear: number, statutory: string): { date?: string; issue?: string } {
  const e = s.annualMeetingExtension;
  if (!e || e.cycleYear !== cycleYear) return {};
  const allowed = profileId === 'bc_society' ? e.authority === 'registrar' : profileId === 'bc_company' ? ['registrar', 'unanimous_shareholders'].includes(e.authority) : profileId === 'federal_cbca' && e.authority === 'court';
  if (!allowed || !e.evidenceRef?.trim() || !parseComplianceDate(e.dueDate) || e.dueDate < statutory || (e.originalDueDate && e.originalDueDate !== statutory)) return { issue: 'The extension authority, evidence, covered cycle or original deadline has not been established.' };
  return { date: e.dueDate };
}
/** Statutory annual-business deadline. A planned date never advances this assessment. */
function nominalAnnualMeetingDeadline(s: ComplianceSettings, today: string): DeadlineAssessment {
  if (!parseComplianceDate(today)) return review('A valid date-only assessment date is required.');
  const p = legalGovernanceProfile(s);
  if (!p) return review('A reviewed governing-Act profile is required for an annual-meeting deadline.');
  const sources = p.annualMeeting.sourceIds, start = recognition(s);
  if (start && (!parseComplianceDate(start) || start > today)) return review('The recognition date must be valid and on or before the assessment date.', sources, p.id);
  const completed = completions(s, today).filter(c => c.kind !== 'written_waiver' || p.id === 'bc_company');
  if ([s.annualMeetingDate, s.annualReferenceDate, ...(s.annualMeetingDates ?? [])].filter(Boolean).some(d => !parseComplianceDate(d))) return review('An annual-meeting/reference date is invalid; correct the source fact.', sources, p.id);
  const latest = completed.at(-1);
  const years = [...new Set([...(s.heldAgmYears ?? []).filter(y => validYear(y) && y <= Number(today.slice(0, 4))), ...completed.map(completionYear)])].sort((a, b) => a - b);
  const explicitYear = s.annualMeetingAssessmentYear;
  if (explicitYear !== undefined && !validYear(explicitYear)) return review('The annual-meeting assessment year is invalid.', sources, p.id);
  const todayYear = Number(today.slice(0, 4));
  if (p.annualMeeting.first === 'following_calendar_year') {
    const first = start ? Number(start.slice(0, 4)) + 1 : undefined;
    const boundary = (year: number) => extensionFor(s, p.id, year, `${year}-12-31`).date ?? `${year}-12-31`;
    let cycleYear = explicitYear;
    const history: number[] = [];
    if (cycleYear === undefined) {
      // Start after the latest evidenced AGM. Without any, use the current
      // cycle: the earliest whose deadline has not passed beyond the
      // calendar-adjustment margin. Earlier unrecorded years are history.
      if (years.length) cycleYear = years.at(-1)! + 1;
      else if (first !== undefined) {
        const floor = currentCycleFloor(today);
        cycleYear = Math.max(first, todayYear - 1);
        while (validYear(cycleYear) && boundary(cycleYear) < floor) cycleYear += 1;
      }
      if (first && validYear(cycleYear)) for (let year = first; year < cycleYear; year++) if (!years.includes(year)) history.push(year);
    }
    if (!validYear(cycleYear)) return review('Supply recognition, completed AGM history or an explicit calendar year.', sources, p.id);
    if (first && cycleYear < first) return { status: 'not_applicable', dueDate: null, cycleYear, profileId: p.id, basis: 'No compulsory AGM in the incorporation year; the first required calendar year follows it.', sourceIds: sources, issues: [] };
    const statutory = `${cycleYear}-12-31`, extended = extensionFor(s, p.id, cycleYear, statutory);
    const dueDate = extended.date ?? statutory, issues = extended.issue ? [extended.issue] : [];
    return withHistory({ status: years.includes(cycleYear) ? 'satisfied' : issues.length ? 'review_required' : timed(dueDate, today), dueDate, statutoryDueDate: statutory, cycleYear, profileId: p.id, plannedDate: plannedInYear(s, cycleYear), sourceIds: sources, issues, basis: extended.date ? 'Registrar-authorized AGM deadline for this calendar year; retain the authorization and attribution conditions.' : 'AGM required by December 31 of this calendar year after incorporation; the planned meeting is separate.' }, 'annual_meeting', history);
  }
  if (!latest && years.length && !s.annualReferenceDate) return review('A held year without an actual meeting/reference date cannot determine the statutory interval.', sources, p.id);
  // The most recent of the profile's annual reference date and each completion's
  // reference or meeting date: a stale profile field never hides a later AGM.
  const reference = (p.id === 'bc_company'
    ? [s.annualReferenceDate, ...completed.map(item => item.annualReferenceDate ?? item.date)]
    : completed.map(item => item.date)).filter((date): date is string => typeof date === 'string' && date.length > 0).sort().at(-1);
  if (reference && (!parseComplianceDate(reference) || reference > today || (start && reference < start))) return review('The annual reference/meeting date requires valid completed-business evidence.', sources, p.id);
  if (latest && latest.kind !== 'held' && p.id === 'bc_company' && !latest.annualReferenceDate && !s.annualReferenceDate) return review('A BC written annual alternative must identify its statutory annual reference date.', sources, p.id);
  const issues: string[] = [];
  let dueDate: string | null, basis: string, cycleYear: number;
  if (!reference) {
    if (!start) return review('Recognition and completed annual-business history are missing.', sources, p.id);
    dueDate = addCalendarMonths(start, p.annualMeeting.firstMonths ?? 18);
    const firstYear = dueDate ? Number(dueDate.slice(0, 4)) : undefined;
    if (explicitYear === undefined && firstYear !== undefined && firstYear < todayYear) {
      // No completion is recorded and the first-meeting deadline belongs to an
      // earlier year: that history is unverified, not the open deadline.
      const history = Array.from({ length: todayYear - firstYear }, (_, index) => firstYear + index);
      const missing = `No annual meeting or written annual business is recorded since recognition on ${start}; the first-meeting deadline (${dueDate}) is in an earlier year. Record the most recent annual meeting or annual reference date to calculate the current statutory deadline.`;
      if (!p.annualMeeting.eachCalendarYear) return withHistory({ ...review(missing, sources, p.id, ['The preceding annual meeting date is required to calculate the current deadline.']), cycleYear: todayYear }, 'annual_meeting', history);
      const calendarLimit = `${todayYear}-12-31`;
      return withHistory({ status: 'review_required', dueDate: calendarLimit, statutoryDueDate: calendarLimit, cycleYear: todayYear, anchorDate: start, plannedDate: plannedInYear(s, todayYear), profileId: p.id, sourceIds: sources,
        basis: `${missing} An annual meeting is required in each calendar year, so this year's meeting is due by ${calendarLimit} at the latest.`,
        issues: ['The 15-month interval from the unrecorded preceding meeting or reference date can require an earlier date.'] }, 'annual_meeting', history);
    }
    basis = `First annual meeting within ${p.annualMeeting.firstMonths ?? 18} calendar months after recognition; no completed annual business is evidenced.`;
    cycleYear = Number(dueDate?.slice(0, 4));
  } else {
    dueDate = addCalendarMonths(reference, p.annualMeeting.subsequentMonths ?? 15);
    cycleYear = Number(reference.slice(0, 4)) + 1;
    basis = `Subsequent annual meeting within ${p.annualMeeting.subsequentMonths ?? 15} calendar months of the actual preceding meeting/reference date.`;
    if (p.annualMeeting.eachCalendarYear) {
      const calendarLimit = `${cycleYear}-12-31`;
      if (dueDate && calendarLimit < dueDate) dueDate = calendarLimit;
      basis = 'Earlier of the next calendar-year deadline and 15 months from the preceding annual reference date.';
    }
    if (p.annualMeeting.afterFiscalYearEndMonths) {
      const md = parseMonthDay(s.fiscalYearEnd);
      const financialEnd = s.annualMeetingFinancialYearEnd ?? (md ? nextOccurrence(md.month, md.day, reference, true) : null);
      if (financialEnd && parseComplianceDate(financialEnd)) {
        const limit = addCalendarMonths(financialEnd, p.annualMeeting.afterFiscalYearEndMonths);
        if (limit && dueDate && limit < dueDate) dueDate = limit;
        basis = 'Earlier of 15 months after the preceding meeting and six calendar months after the financial year-end for the annual business being assessed.';
        if (financialEnd <= reference) issues.push('Confirm that the supplied financial period still requires annual business; it ends on or before the last completed meeting.');
      } else issues.push('The relevant financial year-end is missing/invalid; the six-month constraint may require an earlier deadline.');
    }
  }
  if (!dueDate || !validYear(cycleYear)) return review('The statutory calculation exceeds the supported date range.', sources, p.id);
  const statutory = dueDate, extended = extensionFor(s, p.id, cycleYear, statutory);
  if (extended.issue) issues.push(extended.issue);
  if (extended.date) { dueDate = extended.date; basis += ' An evidenced statutory extension applies.'; }
  return { status: issues.length ? 'review_required' : timed(dueDate, today), dueDate, statutoryDueDate: statutory, cycleYear, anchorDate: reference ?? start, plannedDate: plannedInYear(s, Number(dueDate.slice(0, 4))), profileId: p.id, basis, sourceIds: sources, issues };
}
function filedEvidence(s: ComplianceSettings, today: string): AnnualReturnFilingEvidence[] {
  const result = [...(s.annualReturnFilings ?? [])];
  if (s.lastAnnualReturnFiledAt) result.push({ filedAt: s.lastAnnualReturnFiledAt, cycleYear: s.lastAnnualReturnCycleYear, periodEnd: s.lastAnnualReturnPeriodEnd, status: 'filed' });
  return result.filter(f => ['filed', 'accepted'].includes(String(f.status ?? '').toLowerCase()) && parseComplianceDate(f.filedAt) && f.filedAt <= today && (validYear(f.cycleYear) || Boolean(parseComplianceDate(f.periodEnd))));
}
function returnResult(s: ComplianceSettings, today: string, profileId: string, sourceIds: readonly string[], cycleYear: number, anchorDate: string, dueDate: string, basis: string, options: { periodEnd?: string; earliestFiling?: string; issues?: string[] } = {}): DeadlineAssessment {
  const filed = filedEvidence(s, today).filter(f => options.periodEnd ? f.periodEnd === options.periodEnd : f.cycleYear === cycleYear).filter(f => f.filedAt >= (options.earliestFiling ?? anchorDate)).sort((a, b) => a.filedAt.localeCompare(b.filedAt))[0];
  return { status: filed ? 'satisfied' : options.issues?.length ? 'review_required' : timed(dueDate, today), dueDate, statutoryDueDate: dueDate, cycleYear, anchorDate, profileId, sourceIds, basis, issues: options.issues ?? [], ...(filed ? { filedAt: filed.filedAt, late: filed.filedAt > dueDate } : {}) };
}
/** Year-indexed cycles (anniversary and BC society): start after the latest
 * evidenced filing, or at the current cycle when none is recorded. Earlier
 * unevidenced cycles are reported separately as history, not as the deadline. */
function openYearCycle(today: string, first: number, latestEvidenced: number | undefined, cycle: (year: number) => DeadlineAssessment | null, sources: readonly string[], profileId: string): DeadlineAssessment {
  const floor = currentCycleFloor(today);
  let year = latestEvidenced !== undefined ? latestEvidenced + 1 : Math.max(first, Number(today.slice(0, 4)) - 2);
  if (latestEvidenced === undefined) {
    // The current cycle is the earliest whose deadline has not passed by more
    // than the calendar-adjustment margin.
    while (validYear(year)) {
      const result = cycle(year);
      if (!result?.dueDate || result.dueDate >= floor) break;
      year += 1;
    }
  }
  while (validYear(year)) {
    const result = cycle(year);
    if (!result) break;
    if (result.status !== 'satisfied') {
      const history: number[] = [];
      for (let earlier = first; earlier < year; earlier++) if (cycle(earlier)?.status !== 'satisfied') history.push(earlier);
      return withHistory(result, 'annual_return', history);
    }
    year += 1;
  }
  return review('The reporting cycle exceeds the supported date range.', sources, profileId);
}
/** An explicit cycle, or the open cycle after the latest filing evidence. Only matching filing evidence closes it. */
function nominalAnnualReturnDeadline(s: ComplianceSettings, today: string): DeadlineAssessment {
  if (!parseComplianceDate(today)) return review('A valid date-only assessment date is required.');
  const p = legalGovernanceProfile(s);
  if (!p) return review('A reviewed governing-Act profile is required for a registry deadline.');
  const sources = p.annualReturn.sourceIds, start = recognition(s);
  if (start && (!parseComplianceDate(start) || start > today)) return review('The recognition date must be valid and no later than the assessment date.', sources, p.id);
  const explicit = s.annualReturnCycleYear;
  if (explicit !== undefined && !validYear(explicit)) return review('The annual-return cycle year is invalid.', sources, p.id);
  const filed = filedEvidence(s, today);
  if (p.annualReturn.anchor === 'anniversary') {
    const raw = s.anniversaryDate ?? s.recognitionDate ?? s.incorporationDate, anniversary = parseComplianceDate(raw);
    if (!raw || !anniversary) return review('A valid recognition/anniversary date is needed; an annual meeting is not the filing anchor.', sources, p.id);
    const firstYear = (start ? Number(start.slice(0, 4)) : anniversary.year) + 1;
    const cycle = (year: number): DeadlineAssessment | null => {
      const anchor = inYear(year, anniversary.month, anniversary.day);
      const due = p.annualReturn.months ? addCalendarMonths(anchor, p.annualReturn.months) : addComplianceDays(anchor, p.annualReturn.days ?? 0);
      return due ? returnResult(s, today, p.id, sources, year, anchor, due, `${p.annualReturn.label} for the ${year} anniversary: within ${p.annualReturn.months ? `${p.annualReturn.months} calendar months` : `${p.annualReturn.days} days`} after it. Every cycle requires separate filing evidence.`) : null;
    };
    if (explicit !== undefined) {
      if (explicit < firstYear) return { status: 'not_applicable', dueDate: null, cycleYear: explicit, profileId: p.id, sourceIds: sources, issues: [], basis: 'The first annual filing cycle is the first anniversary after recognition.' };
      return cycle(explicit) ?? review('The reporting cycle exceeds the supported date range.', sources, p.id);
    }
    // A receipt proves only its own covered cycle; it is the checkpoint after
    // which the open cycle starts, and earlier gaps remain unverified history.
    const latest = [...new Set(filed.map(f => f.cycleYear).filter((y): y is number => validYear(y) && y >= firstYear))]
      .filter(year => cycle(year)?.status === 'satisfied').sort((a, b) => a - b).at(-1);
    return openYearCycle(today, firstYear, latest, cycle, sources, p.id);
  }
  if (p.annualReturn.anchor === 'fiscal_year_end') {
    const md = parseMonthDay(s.fiscalYearEnd);
    const periodCycle = (period: string): DeadlineAssessment | null => {
      const due = addFiscalFilingMonths(period, p.annualReturn.months ?? 6);
      return due ? returnResult(s, today, p.id, [...sources, 'CRA-T2-FILING-MONTHS'], Number(period.slice(0, 4)), period, due, 'Ontario annual return for this actual taxation year; the prescribed T2 filing period is normally six months. A month-end taxation year uses the last day of the sixth month. Ontario and CRA submissions are separate.', { periodEnd: period }) : null;
    };
    const nextPeriod = (period: string) => (md ? nextOccurrence(md.month, md.day, period, true) : addFiscalFilingMonths(period, 12)) ?? '';
    let period = s.annualReturnPeriodEnd;
    if (period !== undefined || explicit !== undefined) {
      if (period && !parseComplianceDate(period)) return review('The actual reporting taxation-year end is invalid.', sources, p.id);
      if (!period && md) period = inYear(explicit!, md.month, md.day);
      if (!period) return review('An explicit cycle year needs the actual taxation-year end or a fiscal calendar.', sources, p.id);
      if (start && period < start) return { status: 'not_applicable', dueDate: null, profileId: p.id, sourceIds: sources, issues: [], basis: 'The selected reporting period predates recognition.' };
      return periodCycle(period) ?? review('The financial reporting cycle exceeds the supported date range.', sources, p.id);
    }
    const filedPeriods = [...new Set(filed.map(f => f.periodEnd).filter((end): end is string => Boolean(parseComplianceDate(end)) && (!start || end! >= start)))]
      .filter(end => periodCycle(end)?.status === 'satisfied').sort();
    const latest = filedPeriods.at(-1);
    const firstPeriod = start && md ? nextOccurrence(md.month, md.day, start) ?? undefined : undefined;
    if (latest) period = nextPeriod(latest);
    else if (firstPeriod && md) {
      // The current period is the earliest whose filing deadline has not
      // passed by more than the calendar-adjustment margin.
      const floor = currentCycleFloor(today), recent = inYear(Number(today.slice(0, 4)) - 2, md.month, md.day);
      period = recent > firstPeriod ? recent : firstPeriod;
      while (parseComplianceDate(period) && (periodCycle(period)?.dueDate ?? '') < floor) period = nextPeriod(period);
    } else return review('Supply an actual taxation-year end or recognition plus fiscal calendar; a future recurring year-end cannot replace an unfiled completed period.', sources, p.id);
    while (parseComplianceDate(period)) {
      const result = periodCycle(period);
      if (!result) break;
      if (result.status !== 'satisfied') {
        const missing: string[] = [];
        for (let earlier = firstPeriod ?? filedPeriods[0]; earlier && parseComplianceDate(earlier) && earlier < period; earlier = nextPeriod(earlier)) {
          if (periodCycle(earlier)?.status !== 'satisfied') missing.push(earlier);
        }
        return withHistory(result, 'annual_return', missing.map(end => Number(end.slice(0, 4))), missing);
      }
      period = nextPeriod(period);
    }
    return review('The financial reporting cycle exceeds the supported date range.', sources, p.id);
  }
  const completed = completions(s, today).filter(c => c.kind !== 'written_waiver');
  const first = start ? Number(start.slice(0, 4)) + 1 : undefined;
  const knownYears = completed.map(completionYear).filter(validYear);
  const societyCycle = (year: number): DeadlineAssessment | null => {
    const actual = completed.find(c => completionYear(c) === year);
    if (!actual && s.heldAgmYears?.includes(year)) return { ...review('An AGM is known for this year but its actual date is missing; obtain it before calculating the 30-day deadline.', sources, p.id), cycleYear: year };
    const extended = extensionFor(s, p.id, year, `${year}-12-31`);
    let anchor = actual?.date ?? `${year}-12-31`;
    let due: string | null = actual ? addComplianceDays(actual.date, 30) : `${year + 1}-01-31`;
    let basis = actual ? 'Annual report within 30 days after the actual held or valid deemed AGM for this calendar year.' : anchor > today ? 'If no AGM occurs by the end of this calendar year, the no-AGM report is due January 31 of the following year. An actual held/deemed AGM changes the anchor to 30 days after it.' : 'No AGM evidenced for this calendar year: report that fact by January 31 of the following year. Filing does not cure the missing AGM.';
    if (!actual && extended.date) { anchor = extended.date; due = addComplianceDays(extended.date, 30); basis = 'No AGM evidenced by the registrar-authorized extended deadline: the no-AGM report is due within 30 days after that deadline under s. 73(3).'; }
    if (!due || !parseComplianceDate(due)) return null;
    return returnResult(s, today, p.id, sources, year, anchor, due, basis, { earliestFiling: actual ? actual.date : addComplianceDays(anchor, 1) ?? anchor, issues: extended.issue ? [extended.issue] : [] });
  };
  if (explicit !== undefined) {
    if (first && explicit < first && !knownYears.includes(explicit)) return { status: 'not_applicable', dueDate: null, cycleYear: explicit, profileId: p.id, sourceIds: sources, issues: [], basis: 'No compulsory no-AGM report is inferred for the incorporation year.' };
    return societyCycle(explicit) ?? review('The reporting cycle exceeds the supported date range.', sources, p.id);
  }
  const filedYears = [...new Set(filed.map(f => f.cycleYear).filter((y): y is number => validYear(y) && (!first || y >= first || knownYears.includes(y))))];
  const historyStart = first ?? Math.min(...knownYears, ...filedYears);
  if (!validYear(historyStart)) return review('Supply the reporting year, actual AGM date or recognition date. A planned AGM cannot determine the annual-report deadline.', sources, p.id);
  const latest = filedYears.filter(year => societyCycle(year)?.status === 'satisfied').sort((a, b) => a - b).at(-1);
  return openYearCycle(today, Math.min(historyStart, ...(latest !== undefined ? [latest] : [])), latest, societyCycle, sources, p.id);
}
const CALENDAR_SOURCE_IDS: Record<string, string> = {
  bc_society: 'BC-IA-TIME', bc_company: 'BC-IA-TIME',
  federal_cbca: 'FED-IA-TIME', ontario_obca: 'ON-LEGISLATION-TIME',
};
const ANNUAL_CALENDAR_CAVEAT = 'This is a nominal calendar date. Review the applicable statutory holidays, locality, and filing-office or channel rules before treating the boundary as final.';

function applyAnnualCalendarReview(s: ComplianceSettings, today: string, obligation: AnnualDeadlineCalendarReview['obligation'], result: DeadlineAssessment): DeadlineAssessment {
  if (!result.dueDate || !result.profileId || result.status === 'not_applicable') return result;
  const nominalDueDate = result.dueDate;
  const sourceIds = [...new Set([...result.sourceIds, CALENDAR_SOURCE_IDS[result.profileId]].filter((id): id is string => Boolean(id)))];
  const matching = (Array.isArray(s.annualDeadlineCalendarReviews) ? s.annualDeadlineCalendarReviews : []).filter(item => item && item.profileId === result.profileId && item.obligation === obligation && item.cycleYear === result.cycleYear && item.nominalDueDate === nominalDueDate);
  const valid = matching.filter(item => item.verified === true && typeof item.evidenceRef === 'string' && item.evidenceRef.trim() && typeof item.calendarBasis === 'string' && item.calendarBasis.trim() && parseComplianceDate(item.reviewedDueDate) && item.reviewedDueDate >= nominalDueDate && parseComplianceDate(item.reviewedOn) && item.reviewedOn <= today);
  const uniqueDates = new Set(valid.map(item => item.reviewedDueDate));
  const calendar = matching.length === valid.length && uniqueDates.size === 1 ? valid.at(-1) : undefined;
  if (calendar) {
    return { ...result, dueDate: calendar.reviewedDueDate, nominalDueDate, sourceIds,
      calendarReviewStatus: 'reviewed', calendarEvidenceRef: calendar.evidenceRef,
      timingReviewRequired: false,
      status: ['satisfied', 'review_required'].includes(result.status) ? result.status : timed(calendar.reviewedDueDate, today),
      basis: `${result.basis} Calendar reviewed: ${calendar.calendarBasis} The reviewed deadline is ${calendar.reviewedDueDate}.`,
      ...(result.filedAt ? { late: result.filedAt > calendar.reviewedDueDate } : {}),
    };
  }
  const daysPast = result.status === 'overdue' && !result.filedAt ? daysBetweenDates(nominalDueDate, today) : 0;
  if (!matching.length && daysPast > CALENDAR_REVIEW_GRACE_DAYS) {
    // No review is recorded and the open boundary passed long enough ago that
    // no holiday or office-closure adjustment could still make it timely.
    return { ...result, nominalDueDate, sourceIds, calendarReviewStatus: 'unreviewed', timingReviewRequired: false, status: 'overdue',
      basis: `${result.basis} Overdue (calendar not reviewed): the nominal boundary ${nominalDueDate} passed ${daysPast} days ago and no calendar review is recorded. Holiday and office-closure adjustments move an annual boundary by a few days at most, so this cycle is overdue whatever the applicable calendar.`,
    };
  }
  const timingReviewRequired = result.filedAt ? result.filedAt > nominalDueDate : ['due', 'overdue'].includes(result.status);
  return { ...result, nominalDueDate, sourceIds, calendarReviewStatus: 'unreviewed', timingReviewRequired,
    status: ['due', 'overdue'].includes(result.status) ? 'review_required' : result.status,
    basis: `${result.basis} ${ANNUAL_CALENDAR_CAVEAT}`,
    issues: [...result.issues,
      ...(matching.length ? ['The calendar review is incomplete, invalid or contradictory; retain and reconcile its evidence.'] : []),
      ...(timingReviewRequired ? ['The nominal boundary has been reached or passed; legal overdue/late status requires the applicable calendar review.'] : []),
    ],
    ...(result.filedAt ? { late: result.filedAt <= nominalDueDate ? false : undefined } : {}),
  };
}

/** Attach actual completion without turning nominal date arithmetic into an
 * unqualified legal lateness conclusion. Other unresolved legal facts survive. */
export function withAnnualMeetingCompletion(result: DeadlineAssessment, completedOn: string): DeadlineAssessment {
  if (!parseComplianceDate(completedOn) || !result.dueDate) return result;
  const afterBoundary = completedOn > result.dueDate;
  const timingReviewRequired = afterBoundary && result.calendarReviewStatus !== 'reviewed';
  const otherReview = result.status === 'review_required' && !result.timingReviewRequired;
  return { ...result, status: otherReview ? 'review_required' : 'satisfied',
    late: timingReviewRequired ? undefined : afterBoundary,
    timingReviewRequired,
    issues: result.issues.filter(issue => !issue.startsWith('The nominal boundary has been reached or passed;'))
      .concat(timingReviewRequired ? ['Completion is recorded after the nominal date; whether it was legally late requires the applicable calendar review.'] : []),
  };
}

/** Act arithmetic plus a separately evidenced holiday/office-calendar review. */
export function assessAnnualMeetingDeadline(s: ComplianceSettings, today: string): DeadlineAssessment {
  const result = applyAnnualCalendarReview(s, today, 'annual_meeting', nominalAnnualMeetingDeadline(s, today));
  const completed = result.status === 'satisfied' ? completions(s, today).find(item => completionYear(item) === result.cycleYear) : undefined;
  return completed ? withAnnualMeetingCompletion(result, completed.date) : result;
}

export function assessAnnualReturnDeadline(s: ComplianceSettings, today: string): DeadlineAssessment {
  return applyAnnualCalendarReview(s, today, 'annual_return', nominalAnnualReturnDeadline(s, today));
}

/** The same open cycle is retained until matching filing evidence closes it. */
export function nextAnnualReportDueDate(s: ComplianceSettings, fromISO: string): string | null {
  const result = assessAnnualReturnDeadline(s, fromISO);
  return ['satisfied', 'not_applicable'].includes(result.status) ? null : result.dueDate;
}
export interface ComplianceHistoryNotice {
  key: 'agm-history' | 'annual-report-history';
  title: string;
  cycleYears: readonly number[];
  periodEnds?: readonly string[];
  basis: string;
  sourceIds: readonly string[];
}
/** Informational evidence gaps before the open cycles. Never a deadline to add. */
export function deriveComplianceHistoryNotices(s: ComplianceSettings, fromISO: string): ComplianceHistoryNotice[] {
  const today = complianceDateFromISO(fromISO);
  if (!today) return [];
  const wording = entityMeetingWording(s), profile = legalGovernanceProfile(s), notices: ComplianceHistoryNotice[] = [];
  const meeting = assessAnnualMeetingDeadline(s, today).historyNotVerified;
  if (meeting) notices.push({ key: 'agm-history', title: `${wording.annualMeetingTitle} history not verified`, cycleYears: meeting.cycleYears, basis: meeting.basis, sourceIds: profile?.annualMeeting.sourceIds ?? [] });
  const report = assessAnnualReturnDeadline(s, today).historyNotVerified;
  if (report) notices.push({ key: 'annual-report-history', title: `${profile?.annualReturn.label ?? 'Annual filing'} history not verified`, cycleYears: report.cycleYears, ...(report.periodEnds ? { periodEnds: report.periodEnds } : {}), basis: report.basis, sourceIds: profile?.annualReturn.sourceIds ?? [] });
  return notices;
}
export function deriveComplianceDeadlines(s: ComplianceSettings, fromISOOrTimestamp: string): DerivedDeadline[] {
  const fromISO = complianceDateFromISO(fromISOOrTimestamp);
  if (!fromISO) return [];
  const deadlines: DerivedDeadline[] = [], wording = entityMeetingWording(s), profile = legalGovernanceProfile(s);
  const meeting = assessAnnualMeetingDeadline(s, fromISO);
  if (meeting.dueDate && !['satisfied', 'not_applicable'].includes(meeting.status)) deadlines.push({ key: 'agm', title: wording.annualMeetingTitle, dueDate: meeting.dueDate, category: 'agm', deadlineCategory: 'Governance', basis: meeting.basis + (meeting.issues.length ? ` Review: ${meeting.issues.join(' ')}` : ''), sourceIds: meeting.sourceIds, cycleYear: meeting.cycleYear, status: meeting.status, plannedDate: meeting.plannedDate });
  else if (meeting.status === 'review_required') {
    const planned = nextAgmDate(s, fromISO);
    if (planned) deadlines.push({ key: 'agm', title: wording.annualMeetingTitle, dueDate: planned, category: 'agm', deadlineCategory: 'Governance', status: 'planned', basis: `Planned ${wording.annualMeeting} date. Statutory deadline remains unverified: ${meeting.basis}` });
  }
  const yearEnd = nextFiscalYearEnd(s, fromISO);
  if (yearEnd) deadlines.push({ key: 'fiscal-year-end', title: 'Fiscal Year End', dueDate: yearEnd, category: 'financial', deadlineCategory: 'Governance', cycleYear: Number(yearEnd.slice(0, 4)), basis: `Next fiscal-calendar year-end; prepare the statements required for the ${wording.annualMeeting}.` });
  const report = assessAnnualReturnDeadline(s, fromISO);
  if (report.dueDate && !['satisfied', 'not_applicable'].includes(report.status)) deadlines.push({ key: 'annual-report', title: profile?.annualReturn.label ?? 'Annual filing', dueDate: report.dueDate, category: 'annual-report', deadlineCategory: 'Governance', basis: report.basis + (report.issues.length ? ` Review: ${report.issues.join(' ')}` : ''), sourceIds: report.sourceIds, cycleYear: report.cycleYear, status: report.status });
  // BC Business Corporations Act Part 4.1 transparency register: BC companies only.
  if (profile?.id === 'bc_company') {
    for (const item of deriveTransparencyDeadlines({ recognitionDate: recognition(s), events: s.transparencyEvents ?? [] }, fromISO)) {
      deadlines.push({ key: item.key, title: item.title, dueDate: item.dueDate, category: 'transparency', deadlineCategory: 'Governance', basis: item.basis, sourceIds: item.key.startsWith('transparency-disposal') ? ['BC-BCA-TRANSPARENCY-ACCESS'] : ['BC-BCA-TRANSPARENCY'], cycleYear: item.cycleYear, status: item.status });
    }
  }
  return deadlines;
}

/** A deadline row already in the register, possibly created before titles and
 * statutory due dates changed. */
export interface ExistingDeadlineLike { title?: string; dueDate?: string; category?: string; sourceKey?: string }
type DerivedObligation = 'agm' | 'annual-report' | 'fiscal-year-end';
/** Stable identity of a derived deadline: obligation plus covered cycle. */
export function complianceDeadlineSourceKey(deadline: Pick<DerivedDeadline, 'key' | 'cycleYear' | 'dueDate'>): string {
  return `compliance:${deadline.key}:${deadline.cycleYear ?? Number(deadline.dueDate.slice(0, 4))}`;
}
const normalizeTitle = (title?: string) => String(title ?? '').toLowerCase().replace(/[‐-―-]/g, ' ').replace(/\s+/g, ' ').trim();
function existingObligation(row: ExistingDeadlineLike, s: ComplianceSettings): { key: DerivedObligation; cycleYear?: number } | undefined {
  const stored = /^compliance:(agm|annual-report|fiscal-year-end):(\d{1,4})$/.exec(row.sourceKey ?? '');
  if (stored) return { key: stored[1] as DerivedObligation, cycleYear: Number(stored[2]) };
  const title = normalizeTitle(row.title), category = normalizeTitle(row.category), profile = legalGovernanceProfile(s);
  // Current titles, the titles generated before this change ("Annual General
  // Meeting", "Annual Report", "Fiscal Year End") and their legacy categories.
  const meetingTitles = new Set(['annual general meeting', 'agm', 'annual meeting', 'annual meeting of shareholders', 'annual general meeting of shareholders', normalizeTitle(entityMeetingWording(s).annualMeetingTitle), normalizeTitle(profile?.annualMeeting.label)]);
  const reportTitles = new Set(['annual report', 'annual return', 'annual filing', 'bc company annual report', 'federal annual return', 'ontario annual return', normalizeTitle(profile?.annualReturn.label)]);
  if (meetingTitles.has(title) || (!title && category === 'agm')) return { key: 'agm' };
  if (reportTitles.has(title) || (!title && category === 'annual report')) return { key: 'annual-report' };
  if (title === 'fiscal year end') return { key: 'fiscal-year-end' };
  return undefined;
}
/** The cycle a legacy row most plausibly covers, reversing the Act's offset. */
function inferredCycleYear(key: DerivedObligation, dueDate: string, s: ComplianceSettings): number | undefined {
  if (!parseComplianceDate(dueDate)) return undefined;
  const year = Number(dueDate.slice(0, 4));
  const rule = key === 'annual-report' ? legalGovernanceProfile(s)?.annualReturn : undefined;
  if (!rule) return year;
  if (rule.anchor === 'fiscal_year_end') return Number(addCalendarMonths(dueDate, -(rule.months ?? 6))?.slice(0, 4) ?? year);
  if (rule.anchor === 'anniversary') return Number((rule.months ? addCalendarMonths(dueDate, -rule.months) : addComplianceDays(dueDate, -(rule.days ?? 0)))?.slice(0, 4) ?? year);
  // BC society: January 31 is the no-AGM report for the preceding year;
  // otherwise the report follows the AGM by 30 days.
  return dueDate.endsWith('-01-31') ? year - 1 : Number(addComplianceDays(dueDate, -(rule.days ?? 30))?.slice(0, 4) ?? year);
}
/** Whether "Add deadlines" would duplicate a row the register already holds.
 * Matching uses the obligation and its cycle, not the display title and due
 * date, so legacy rows and rows with an earlier calculated date still match. */
export function complianceDeadlineAlreadyTracked(deadline: DerivedDeadline, existing: readonly ExistingDeadlineLike[], s: ComplianceSettings): boolean {
  if (!['agm', 'annual-report', 'fiscal-year-end'].includes(deadline.key)) return existing.some(row => row.title === deadline.title && row.dueDate === deadline.dueDate);
  const cycleYear = deadline.cycleYear ?? Number(deadline.dueDate.slice(0, 4));
  return existing.some(row => {
    const obligation = existingObligation(row, s);
    if (!obligation || obligation.key !== deadline.key) return false;
    if (obligation.cycleYear !== undefined) return obligation.cycleYear === cycleYear;
    if (!row.dueDate) return false;
    if (row.dueDate === deadline.dueDate || inferredCycleYear(obligation.key, row.dueDate, s) === cycleYear) return true;
    // A meeting row may hold the planned date or the statutory deadline.
    return obligation.key === 'agm' && row.dueDate.slice(0, 4) === deadline.dueDate.slice(0, 4);
  });
}
