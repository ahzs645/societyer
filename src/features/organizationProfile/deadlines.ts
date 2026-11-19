import { addCalendarMonths, addComplianceDays, parseComplianceDate } from "../../../shared/corporationSettings";

/**
 * Registry filing windows the organization profile previews under "Coming up".
 *
 * The home annual return and the annual meeting come from the compliance
 * engine (`corporationSettings.complianceDeadlines`), which holds the filing
 * evidence. This file adds only what the engine does not cover: when a
 * window opens, and the BC extra-provincial annual report, which runs off
 * the BC registration rather than the home Act.
 */

/** CBCA: the annual return is filed within 60 days after the anniversary date. */
export const CBCA_ANNUAL_RETURN_DAYS = 60;
/** BC Business Corporations Act: an extra-provincial company files its annual
 * report within 2 calendar months after each anniversary of its BC registration.
 * Two calendar months, not 60 days. */
export const BC_EXTRA_PROVINCIAL_REPORT_MONTHS = 2;

/** `overdue`: the window has closed and the filing isn't recorded as made. */
export type FilingWindow = { cycleYear: number; opens: string; due: string; overdue?: boolean };

/** The same month and day in another year; Feb 29 falls back to Feb 28. */
export function anniversaryInYear(dateISO: string | undefined, year: number): string | null {
  const parts = parseComplianceDate(dateISO);
  if (!dateISO || !parts) return null;
  return addCalendarMonths(dateISO, (year - parts.year) * 12);
}

type WindowRule = { days: number } | { months: number };

/**
 * The filing window to act on for an anniversary-anchored annual filing.
 *
 * With a last filing date, it is the first cycle that opened after that
 * filing: overdue (`overdue: true`) when its window has closed, otherwise
 * the current or next one. Without one, it is the latest cycle that has
 * opened (overdue once closed, until the next one opens), or the first one;
 * earlier cycles aren't guessed at.
 */
export function anniversaryFilingWindow(anchorISO: string | undefined, rule: WindowRule, today: string, lastFiledISO?: string): FilingWindow | null {
  const anchor = parseComplianceDate(anchorISO);
  if (!anchor || !parseComplianceDate(today)) return null;
  const windowFor = (year: number): FilingWindow | null => {
    const opens = anniversaryInYear(anchorISO, year);
    const due = opens && ("days" in rule ? addComplianceDays(opens, rule.days) : addCalendarMonths(opens, rule.months));
    return opens && due ? { cycleYear: year, opens, due } : null;
  };
  const filed = lastFiledISO && parseComplianceDate(lastFiledISO) ? lastFiledISO : undefined;
  let year = anchor.year + 1;
  if (filed) {
    // The first cycle that opened after the last filing.
    while (windowFor(year) && windowFor(year)!.opens <= filed) year += 1;
  } else {
    year = Math.max(year, Number(today.slice(0, 4)) - 1);
    // The latest cycle whose window has opened by today.
    while (windowFor(year + 1) && windowFor(year + 1)!.opens <= today) year += 1;
  }
  const window = windowFor(year);
  if (!window) return null;
  return window.due < today ? { ...window, overdue: true } : window;
}

/** The BC extra-provincial annual report window for a BC registration date. */
export function bcExtraProvincialReportWindow(registrationDate: string | undefined, today: string, lastFiledISO?: string) {
  return anniversaryFilingWindow(registrationDate, { months: BC_EXTRA_PROVINCIAL_REPORT_MONTHS }, today, lastFiledISO);
}

/** The CBCA annual return window for the corporation's anniversary. */
export function cbcaAnnualReturnWindow(anniversaryISO: string | undefined, today: string, lastFiledISO?: string) {
  return anniversaryFilingWindow(anniversaryISO, { days: CBCA_ANNUAL_RETURN_DAYS }, today, lastFiledISO);
}

/**
 * A due date recorded on a registration: still ahead ("upcoming"), passed
 * with no filing recorded for that cycle ("overdue"), or filed (a filing
 * recorded in the year up to it, or after it).
 */
export function recordedDueStatus(dueISO: string, today: string, lastFiledISO?: string): "upcoming" | "overdue" | "filed" {
  const cycleStart = addCalendarMonths(dueISO, -12);
  if (lastFiledISO && cycleStart && lastFiledISO > cycleStart) return "filed";
  return dueISO >= today ? "upcoming" : "overdue";
}
