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

export type FilingWindow = { cycleYear: number; opens: string; due: string };

/** The same month and day in another year; Feb 29 falls back to Feb 28. */
export function anniversaryInYear(dateISO: string | undefined, year: number): string | null {
  const parts = parseComplianceDate(dateISO);
  if (!dateISO || !parts) return null;
  return addCalendarMonths(dateISO, (year - parts.year) * 12);
}

type WindowRule = { days: number } | { months: number };

/**
 * The current or next filing window for an anniversary-anchored annual filing:
 * the first anniversary after `anchorISO` whose window has not closed by
 * `today`, skipping a cycle already filed (`lastFiledISO` on or after it opened).
 */
export function anniversaryFilingWindow(anchorISO: string | undefined, rule: WindowRule, today: string, lastFiledISO?: string): FilingWindow | null {
  const anchor = parseComplianceDate(anchorISO);
  if (!anchor || !parseComplianceDate(today)) return null;
  const windowFor = (year: number): FilingWindow | null => {
    const opens = anniversaryInYear(anchorISO, year);
    const due = opens && ("days" in rule ? addComplianceDays(opens, rule.days) : addCalendarMonths(opens, rule.months));
    return opens && due ? { cycleYear: year, opens, due } : null;
  };
  let year = Math.max(anchor.year + 1, Number(today.slice(0, 4)) - 1);
  let window = windowFor(year);
  while (window && window.due < today) window = windowFor(++year);
  if (window && lastFiledISO && parseComplianceDate(lastFiledISO) && lastFiledISO >= window.opens) window = windowFor(year + 1);
  return window;
}

/** The BC extra-provincial annual report window for a BC registration date. */
export function bcExtraProvincialReportWindow(registrationDate: string | undefined, today: string, lastFiledISO?: string) {
  return anniversaryFilingWindow(registrationDate, { months: BC_EXTRA_PROVINCIAL_REPORT_MONTHS }, today, lastFiledISO);
}

/** The CBCA annual return window for the corporation's anniversary. */
export function cbcaAnnualReturnWindow(anniversaryISO: string | undefined, today: string, lastFiledISO?: string) {
  return anniversaryFilingWindow(anniversaryISO, { days: CBCA_ANNUAL_RETURN_DAYS }, today, lastFiledISO);
}
