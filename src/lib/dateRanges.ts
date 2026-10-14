/**
 * Named date ranges ("Last 30 days", "Fiscal year to date", …) shared by the
 * DateRangePicker and RecordTable date filters.
 *
 * Everything works on calendar dates (`YYYY-MM-DD`) in the organisation's own
 * calendar: callers pass `today` from `organizationTodayISO()` so an evening in
 * Vancouver is not already "tomorrow" in UTC. Presets are stored by id and
 * resolved each time they are used, so a saved "Last 30 days" view stays
 * relative instead of freezing the dates it was saved on.
 */
import { organizationTimeZone, type LegalEntityLike } from "../../shared/organizationDomain";
import { todayDateOnly } from "../../shared/dateOnly";

export type DateRangePresetId =
  | "today"
  | "last7"
  | "last30"
  | "last90"
  | "thisMonth"
  | "lastMonth"
  | "quarterToDate"
  | "yearToDate"
  | "fiscalYearToDate"
  | "lastFiscalYear"
  | "allTime";

export type DateRangeValue = {
  preset?: DateRangePresetId | "custom";
  /** Inclusive `YYYY-MM-DD`; omitted means open-ended. */
  start?: string;
  /** Inclusive `YYYY-MM-DD`; omitted means open-ended. */
  end?: string;
};

export type DateRangeContext = {
  /** Organisation-local today, `YYYY-MM-DD`. */
  today: string;
  /** `MM-DD` (or a full `YYYY-MM-DD`, whose month/day is used). */
  fiscalYearEnd?: string | null;
};

export type ResolvedDateRange = { start?: string; end?: string };

export type DateRangePreset = {
  id: DateRangePresetId;
  label: string;
  /** Needs a fiscal year end to be meaningful. */
  fiscal?: boolean;
};

export const DATE_RANGE_PRESETS: readonly DateRangePreset[] = [
  { id: "today", label: "Today" },
  { id: "last7", label: "Last 7 days" },
  { id: "last30", label: "Last 30 days" },
  { id: "last90", label: "Last 90 days" },
  { id: "thisMonth", label: "This month" },
  { id: "lastMonth", label: "Last month" },
  { id: "quarterToDate", label: "Quarter to date" },
  { id: "yearToDate", label: "Year to date" },
  { id: "fiscalYearToDate", label: "Fiscal year to date", fiscal: true },
  { id: "lastFiscalYear", label: "Last fiscal year", fiscal: true },
  { id: "allTime", label: "All time" },
];

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Organisation-local today (`YYYY-MM-DD`), falling back to the browser's calendar. */
export function organizationTodayISO(
  organization?: (LegalEntityLike & { timeZone?: string | null }) | null,
  now: Date = new Date(),
): string {
  const timeZone = organization ? organizationTimeZone(organization) : undefined;
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
      const pick = (type: string) => parts.find((part) => part.type === type)?.value;
      const iso = `${pick("year")}-${pick("month")}-${pick("day")}`;
      if (DATE_ONLY.test(iso)) return iso;
    } catch {
      // Unknown zone: fall through to the browser calendar.
    }
  }
  return todayDateOnly(now);
}

function parts(iso: string): [number, number, number] | null {
  const match = DATE_ONLY.exec(iso);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utc(year: number, month: number, day: number) {
  // Date.UTC rolls over out-of-range days/months, which the helpers rely on.
  return new Date(Date.UTC(year, month - 1, day));
}

export function addDays(iso: string, days: number): string {
  const p = parts(iso);
  if (!p) return iso;
  return fromUtc(utc(p[0], p[1], p[2] + days));
}

function endOfMonth(year: number, month: number): string {
  return fromUtc(utc(year, month + 1, 0));
}

/** Parse "MM-DD" / "YYYY-MM-DD" into a month/day pair, clamped to real dates. */
export function parseFiscalYearEnd(value?: string | null): { month: number; day: number } | null {
  if (!value) return null;
  const match = /^(?:\d{4}-)?(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

/** The fiscal year containing `today`: inclusive start and end dates. */
export function fiscalYearBounds(today: string, fiscalYearEnd?: string | null, offsetYears = 0): ResolvedDateRange | null {
  const fye = parseFiscalYearEnd(fiscalYearEnd);
  const p = parts(today);
  if (!fye || !p) return null;
  const endFor = (year: number) => {
    const last = Number(endOfMonth(year, fye.month).slice(8));
    return fromUtc(utc(year, fye.month, Math.min(fye.day, last)));
  };
  let endYear = p[0];
  if (today > endFor(endYear)) endYear += 1;
  endYear += offsetYears;
  const end = endFor(endYear);
  const start = addDays(endFor(endYear - 1), 1);
  return { start, end };
}

export function resolveDateRangePreset(preset: DateRangePresetId, context: DateRangeContext): ResolvedDateRange | null {
  const { today } = context;
  const p = parts(today);
  if (!p) return null;
  const [year, month] = p;
  switch (preset) {
    case "today":
      return { start: today, end: today };
    case "last7":
      return { start: addDays(today, -6), end: today };
    case "last30":
      return { start: addDays(today, -29), end: today };
    case "last90":
      return { start: addDays(today, -89), end: today };
    case "thisMonth":
      return { start: fromUtc(utc(year, month, 1)), end: endOfMonth(year, month) };
    case "lastMonth": {
      const first = utc(year, month - 1, 1);
      return { start: fromUtc(first), end: endOfMonth(first.getUTCFullYear(), first.getUTCMonth() + 1) };
    }
    case "quarterToDate": {
      const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
      return { start: fromUtc(utc(year, quarterStartMonth, 1)), end: today };
    }
    case "yearToDate":
      return { start: `${year}-01-01`, end: today };
    case "fiscalYearToDate": {
      const bounds = fiscalYearBounds(today, context.fiscalYearEnd);
      return bounds ? { start: bounds.start, end: today } : null;
    }
    case "lastFiscalYear":
      return fiscalYearBounds(today, context.fiscalYearEnd, -1);
    case "allTime":
      return {};
    default:
      return null;
  }
}

/** Resolve a stored range to concrete inclusive bounds; null when it cannot apply. */
export function resolveDateRange(value: DateRangeValue | null | undefined, context: DateRangeContext): ResolvedDateRange | null {
  if (!value) return null;
  if (value.preset && value.preset !== "custom") return resolveDateRangePreset(value.preset, context);
  const start = value.start && DATE_ONLY.test(value.start) ? value.start : undefined;
  const end = value.end && DATE_ONLY.test(value.end) ? value.end : undefined;
  if (!start && !end) return null;
  return start && end && start > end ? { start: end, end: start } : { start, end };
}

/** Whether a stored date or timestamp falls inside the inclusive range. */
export function isDateInRange(value: unknown, range: ResolvedDateRange): boolean {
  const day = toCalendarDate(value);
  if (!day) return false;
  if (range.start && day < range.start) return false;
  if (range.end && day > range.end) return false;
  return true;
}

/** The calendar date of a stored value: `YYYY-MM-DD` strings verbatim, timestamps in the browser's calendar. */
export function toCalendarDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string" && DATE_ONLY.test(value)) return value;
  const time = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(time)) return null;
  return todayDateOnly(new Date(time));
}

export function isDateRangeValue(value: unknown): value is DateRangeValue {
  return !!value && typeof value === "object" && !Array.isArray(value) && ("preset" in value || "start" in value || "end" in value);
}

const shortDate = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function formatCalendarDate(iso: string): string {
  const p = parts(iso);
  return p ? shortDate.format(utc(p[0], p[1], p[2])) : iso;
}

/** "Last 30 days", "Jan 1, 2026 – Mar 31, 2026", "From Jan 1, 2026". */
export function describeDateRange(value: DateRangeValue | null | undefined): string {
  if (!value) return "Any time";
  if (value.preset && value.preset !== "custom") {
    return DATE_RANGE_PRESETS.find((preset) => preset.id === value.preset)?.label ?? value.preset;
  }
  const { start, end } = value;
  if (start && end) return `${formatCalendarDate(start)} – ${formatCalendarDate(end)}`;
  if (start) return `From ${formatCalendarDate(start)}`;
  if (end) return `Until ${formatCalendarDate(end)}`;
  return "Any time";
}
