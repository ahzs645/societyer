import { nextBcSocietyAgmDeadline } from "./agmEvidence";

/**
 * CORPORATION SETTINGS → COMPLIANCE DEADLINES (pure logic).
 *
 * Turns per-entity compliance configuration (AGM month/day + fiscal year-end +
 * anniversary/incorporation dates) into derived compliance dates and deadlines.
 *
 * Mirrors the YCN Corporation_Settings → deadlines idea: a small set of stored
 * settings is expanded into the concrete next-occurrence dates that drive an
 * entity's compliance calendar.
 *
 * Framework-free. All date math operates on 'YYYY-MM-DD' strings (no date-fns).
 * Careful with month lengths and leap years: invalid days (e.g. Feb 30) are
 * clamped down to the last valid day of that month.
 */

export interface ComplianceSettings {
  agmMonth?: number; /* 1-12 */
  agmDay?: number; /* 1-31 */
  fiscalYearEnd?: string; /* 'MM-DD' */
  incorporationDate?: string; /* ISO */
  anniversaryDate?: string; /* ISO */
  waivePrepFinancials?: boolean;
  jurisdictionCode?: string;
  entityType?: string;
  annualMeetingDate?: string;
  /**
   * Calendar years in which an AGM is evidenced (held AGM meeting records or the
   * profile's AGM fields). When supplied, the AGM deadline is cycle-aware: a
   * year without a held AGM is not skipped just because its planned month/day
   * passed (G-03). When omitted, the legacy "next month/day" behaviour applies.
   */
  heldAgmYears?: number[];
}

export interface DerivedDeadline {
  key: string;
  title: string;
  dueDate: string;
  category: string;
  /** The Deadlines register category (Governance/Tax/Payroll/Privacy/Other). */
  deadlineCategory: "Governance" | "Tax" | "Payroll" | "Privacy" | "Other";
  /** Short explanation of how the date was derived. */
  basis?: string;
}

// --- date helpers (operate on 'YYYY-MM-DD' string prefixes) ---------------

interface YmdParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

/** Days in a given (1-12) month for a given year, accounting for leap years. */
function daysInMonth(year: number, month: number): number {
  // month is 1-12; new Date(year, month, 0) gives last day of `month`.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Parse the 'YYYY-MM-DD' prefix of an ISO string into numeric parts. */
function parseISODate(iso: string): YmdParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return { year, month, day };
}

/** Parse a 'MM-DD' string into month/day numbers. */
function parseMonthDay(value: string): { month: number; day: number } | null {
  const match = /^(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return { month, day };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatISODate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

/** Clamp a desired day into the valid range for a given month/year. */
function clampDay(year: number, month: number, day: number): number {
  const max = daysInMonth(year, month);
  if (day < 1) return 1;
  return day > max ? max : day;
}

/** Compare two YmdParts; -1 if a<b, 0 if equal, 1 if a>b. */
function compareYmd(a: YmdParts, b: YmdParts): number {
  if (a.year !== b.year) return a.year < b.year ? -1 : 1;
  if (a.month !== b.month) return a.month < b.month ? -1 : 1;
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  return 0;
}

/**
 * Next occurrence of a (month, day) on/after `from`, rolling over to the next
 * year if the candidate in `from`'s year is strictly before `from`. The day is
 * clamped to the last valid day of the month for the chosen year (so Feb 30
 * becomes Feb 28/29 as appropriate).
 */
function nextMonthDayOnOrAfter(
  month: number,
  day: number,
  from: YmdParts,
): string {
  const candidateThisYear: YmdParts = {
    year: from.year,
    month,
    day: clampDay(from.year, month, day),
  };
  if (compareYmd(candidateThisYear, from) >= 0) {
    return formatISODate(candidateThisYear.year, candidateThisYear.month, candidateThisYear.day);
  }
  const nextYear = from.year + 1;
  const clampedNext = clampDay(nextYear, month, day);
  return formatISODate(nextYear, month, clampedNext);
}

// --- public derivations ----------------------------------------------------

/**
 * Next occurrence of (agmMonth, agmDay) on/after `fromISO`. Returns null when
 * either agmMonth or agmDay is missing. Handles year rollover and clamps an
 * invalid day (e.g. agmDay 31 in February) down to the last valid day.
 */
export function nextAgmDate(settings: ComplianceSettings, fromISO: string): string | null {
  if (typeof settings.agmMonth !== "number" || typeof settings.agmDay !== "number") {
    return null;
  }
  if (settings.agmMonth < 1 || settings.agmMonth > 12) return null;
  const from = parseISODate(fromISO);
  if (!from) return null;
  if (settings.heldAgmYears) {
    const today = formatISODate(from.year, from.month, from.day);
    if (isBcSocietySettings(settings)) {
      // BC Societies Act s.71: an AGM is due in every calendar year. A year
      // with no held AGM stays due until Dec 31 even after the planned date.
      return nextBcSocietyAgmDeadline(settings.heldAgmYears, today, { month: settings.agmMonth, day: settings.agmDay }).dueDate;
    }
    // Other entities: the current year's planned AGM stays due (and overdue)
    // until an AGM is evidenced for that year.
    const targetYear = settings.heldAgmYears.includes(from.year) ? from.year + 1 : from.year;
    return formatISODate(targetYear, settings.agmMonth, clampDay(targetYear, settings.agmMonth, settings.agmDay));
  }
  return nextMonthDayOnOrAfter(settings.agmMonth, settings.agmDay, from);
}

function isBcSocietySettings(settings: ComplianceSettings): boolean {
  return settings.entityType !== "corporation__business_" && (settings.jurisdictionCode ?? "CA-BC") === "CA-BC";
}

/**
 * Next fiscal year-end ('MM-DD') on/after `fromISO`. Returns null when
 * fiscalYearEnd is missing or malformed. Handles year rollover and clamps.
 */
export function nextFiscalYearEnd(settings: ComplianceSettings, fromISO: string): string | null {
  if (!settings.fiscalYearEnd) return null;
  const md = parseMonthDay(settings.fiscalYearEnd);
  if (!md) return null;
  const from = parseISODate(fromISO);
  if (!from) return null;
  return nextMonthDayOnOrAfter(md.month, md.day, from);
}

/** Registry deadlines use their own statutory anchor. A planned AGM is
 * not evidence an AGM occurred. Financial preparation waivers do not affect filing. */
export function nextAnnualReportDueDate(settings: ComplianceSettings, fromISO: string): string | null {
  const jurisdiction = settings.jurisdictionCode ?? "CA-BC";
  const company = settings.entityType === "corporation__business_";
  if (!company) return settings.annualMeetingDate ? offsetDate(settings.annualMeetingDate, 0, 30) : null;
  if (jurisdiction === "CA-ON-OBCA") {
    const yearEnd = nextFiscalYearEnd(settings, fromISO);
    return yearEnd ? offsetDate(yearEnd, 6, 0) : null;
  }
  const anchor = settings.anniversaryDate ?? settings.incorporationDate;
  if (!anchor) return null;
  const parsed = parseISODate(anchor);
  const from = parseISODate(fromISO);
  if (!parsed || !from) return null;
  const anniversary = nextMonthDayOnOrAfter(parsed.month, parsed.day, from);
  return jurisdiction === "CA-FED-CBCA" ? offsetDate(anniversary, 0, 60) : jurisdiction === "CA-BC" ? offsetDate(anniversary, 2, 0) : null;
}
function offsetDate(value: string, months: number, days: number): string {
  const p = parseISODate(value)!;
  const date = new Date(Date.UTC(p.year, p.month - 1 + months, 1));
  date.setUTCDate(Math.min(p.day, daysInMonth(date.getUTCFullYear(), date.getUTCMonth() + 1)));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Derive the concrete compliance deadlines for an entity, computed relative to
 * `fromISO`. Produces (at most) three deadlines — AGM, fiscal-year-end, and
 * annual-report — each only when its underlying date is non-null. Each deadline
 * carries a stable `key` and a `category` of 'agm' | 'financial' |
 * 'annual-report'.
 *
 * A financial preparation waiver never removes the separate registry filing deadline.
 */
export function deriveComplianceDeadlines(
  settings: ComplianceSettings,
  fromISO: string,
): DerivedDeadline[] {
  const deadlines: DerivedDeadline[] = [];

  const agmDate = nextAgmDate(settings, fromISO);
  if (agmDate) {
    deadlines.push({
      key: "agm",
      title: "Annual General Meeting",
      dueDate: agmDate,
      category: "agm",
      deadlineCategory: "Governance",
      basis: settings.heldAgmYears
        ? `Next AGM due; ${settings.heldAgmYears.includes(Number(fromISO.slice(0, 4))) ? "this year's AGM is on record" : "no AGM is on record for this calendar year yet"}.`
        : "Next planned AGM date.",
    });
  }

  const fyEnd = nextFiscalYearEnd(settings, fromISO);
  if (fyEnd) {
    deadlines.push({
      key: "fiscal-year-end",
      title: "Fiscal Year End",
      dueDate: fyEnd,
      category: "financial",
      deadlineCategory: "Governance",
      basis: "Close the books and prepare financial statements for the AGM.",
    });
  }

  {
    let annualReport = nextAnnualReportDueDate(settings, fromISO);
    let reportBasis = "Registry annual report due date.";
    // A past due date (the report for an AGM already held) is not the NEXT
    // deadline: the next report is due 30 days after the next AGM (BC Societies
    // Act s.73). Only applied when AGM history is known (cycle-aware mode).
    if (annualReport && settings.heldAgmYears && annualReport < fromISO.slice(0, 10) && agmDate && settings.entityType !== "corporation__business_") {
      annualReport = offsetDate(agmDate, 0, 30);
      reportBasis = "Due 30 days after the next AGM.";
    }
    if (annualReport) {
      deadlines.push({
        key: "annual-report",
        title: "Annual Report",
        dueDate: annualReport,
        category: "annual-report",
        deadlineCategory: "Governance",
        basis: reportBasis,
      });
    }
  }

  return deadlines;
}

/** Exposed for callers/tests that need leap-year awareness without re-deriving. */
export { isLeapYear, daysInMonth };
