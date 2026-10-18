/**
 * Client-side date presets for the financial reports toolbar. Fiscal presets
 * follow the books' fiscal year (`booksSettings.fiscalStartMonth`); the server
 * builds the actual columns (shared/booksReports.ts `buildReportPeriods`).
 */
import { addIsoDays, buildReportPeriods, fiscalYearOf, isIsoDate, type ReportFrequency } from "../../../../shared/booksReports";
import { formatDate } from "../../../lib/format";

export const RANGE_PRESETS = [
  "this-fy",
  "last-fy",
  "last-12",
  "ytd",
  "this-month",
  "last-month",
  "this-quarter",
  "fiscal-ytd",
  "custom",
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export type DateRange = { from: string; to: string };

export const PRESET_LABELS: Record<RangePreset, string> = {
  "this-fy": "This fiscal year",
  "last-fy": "Last fiscal year",
  "last-12": "Last 12 months",
  ytd: "Year to date (calendar)",
  "this-month": "This month",
  "last-month": "Last month",
  "this-quarter": "This quarter",
  "fiscal-ytd": "Fiscal year to date",
  custom: "Custom",
};

/** Presets each toolbar offers; the others still resolve (shown as Custom) so a range survives switching reports. */
export const STATEMENT_PRESETS: readonly RangePreset[] = ["this-fy", "last-fy", "last-12", "ytd", "custom"];
export const LEDGER_PRESETS: readonly RangePreset[] = ["this-month", "last-month", "this-quarter", "fiscal-ytd", "custom"];

export function isRangePreset(value: unknown): value is RangePreset {
  return typeof value === "string" && (RANGE_PRESETS as readonly string[]).includes(value);
}

/** First day of the month `offset` months from the month containing `iso`. */
function monthStart(iso: string, offset = 0) {
  const index = Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1 + offset;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

/** Last day of the month `offset` months from the month containing `iso`. */
function monthEnd(iso: string, offset = 0) {
  return addIsoDays(monthStart(iso, offset + 1), -1);
}

/** The date range a preset stands for on `today`. `custom` has no range of its own. */
export function presetRange(preset: Exclude<RangePreset, "custom">, today: string, fiscalStartMonth: number): DateRange {
  const fiscal = fiscalYearOf(today, fiscalStartMonth);
  switch (preset) {
    case "this-fy":
      return { from: fiscal.start, to: fiscal.end };
    case "last-fy": {
      const last = fiscalYearOf(addIsoDays(fiscal.start, -1), fiscalStartMonth);
      return { from: last.start, to: last.end };
    }
    case "last-12":
      return { from: monthStart(today, -11), to: today };
    case "ytd":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "this-month":
      return { from: monthStart(today), to: monthEnd(today) };
    case "last-month":
      return { from: monthStart(today, -1), to: monthEnd(today, -1) };
    case "this-quarter": {
      const offset = (Number(today.slice(5, 7)) - fiscalStartMonth + 12) % 12;
      const start = monthStart(today, -(offset % 3));
      return { from: start, to: monthEnd(start, 2) };
    }
    case "fiscal-ytd":
      return { from: fiscal.start, to: today };
  }
}

/** "Jan 1 – Jan 31, 2026", or both years when the range spans two. */
export function formatPeriodRange(start: string, end: string) {
  if (start === end) return formatDate(start);
  if (start.slice(0, 4) === end.slice(0, 4)) return `${formatDate(start, "MMM d")} – ${formatDate(end)}`;
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/** Why a range can't be reported, or null when it is fine. */
export function rangeProblem(range: DateRange) {
  if (!isIsoDate(range.from) || !isIsoDate(range.to)) return "Choose a start and end date.";
  if (range.from > range.to) return "The start date is after the end date.";
  return null;
}

/**
 * Check a statement range client-side (same rules as the server) so a range
 * with too many columns shows a message instead of a failed query.
 */
export function statementRangeProblem(range: DateRange, frequency: ReportFrequency, today: string, fiscalStartMonth: number) {
  const basic = rangeProblem(range);
  if (basic) return basic;
  try {
    buildReportPeriods({ ...range, frequency, today, fiscalStartMonth });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Choose a shorter range.";
  }
}
