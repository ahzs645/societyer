/**
 * Date-only values (`YYYY-MM-DD`: due dates, deadlines, renewal dates, as-of
 * dates) are calendar days, not instants. `new Date("2026-10-07")` parses as
 * UTC midnight, which is the evening of Oct 6 in Vancouver, so comparing it to
 * `Date.now()` marks items overdue a day early and shows "19 hours ago" for
 * something due today. Likewise `new Date().toISOString().slice(0, 10)` is the
 * UTC day, which is already "tomorrow" on a BC evening.
 *
 * Everything here works in the *local* calendar of the runtime (the user's
 * browser for the app and the local runtime; UTC on a hosted server).
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export type DateLike = string | number | Date | null | undefined;

/** True for a strict `YYYY-MM-DD` string. */
export function isDateOnly(value: unknown): value is string {
  return typeof value === "string" && DATE_ONLY.test(value);
}

/** `YYYY-MM-DD` of `date` in the local calendar. */
export function localDateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Today's date-only value in the local calendar (replaces `new Date().toISOString().slice(0, 10)`). */
export function todayDateOnly(now: Date | number = new Date()): string {
  return localDateKey(typeof now === "number" ? new Date(now) : now);
}

/** Parse a valid `YYYY-MM-DD` as local midnight; null for anything else (incl. Feb 30). */
export function parseDateOnly(value: unknown): Date | null {
  if (!isDateOnly(value)) return null;
  const [, y, m, d] = DATE_ONLY.exec(value)!;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.getFullYear() === Number(y) && date.getMonth() === Number(m) - 1 && date.getDate() === Number(d) ? date : null;
}

/**
 * The local calendar day a value falls on, as `YYYY-MM-DD`.
 * Date-only strings are returned unchanged (never shifted by time zone);
 * timestamps / ISO date-times use the local day of that instant.
 */
export function toDateOnly(value: DateLike): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    if (isDateOnly(value)) return parseDateOnly(value) ? value : null;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? localDateKey(parsed) : null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? localDateKey(date) : null;
}

/** Parse any date-ish value for display: date-only → local midnight, otherwise the instant. */
export function parseDateLike(value: DateLike): Date | null {
  if (value == null || value === "") return null;
  if (typeof value === "string" && isDateOnly(value)) return parseDateOnly(value);
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Whole calendar days from today to `value` (0 = today, 1 = tomorrow, -1 = yesterday); null if unparseable. */
export function daysUntilDate(value: DateLike, now: Date | number = new Date()): number | null {
  const key = toDateOnly(value);
  if (!key) return null;
  const target = parseDateOnly(key)!;
  const today = parseDateOnly(todayDateOnly(now))!;
  // Round: DST days are 23/25 hours long.
  return Math.round((target.getTime() - today.getTime()) / DAY_MS);
}

/**
 * Overdue check for a due date. Date-only values are overdue only once their
 * calendar day has passed (due today is not overdue). Full timestamps are
 * overdue once the instant has passed.
 */
export function isPastDue(value: DateLike, now: Date | number = new Date()): boolean {
  if (value == null || value === "") return false;
  if (typeof value === "string" && isDateOnly(value)) {
    const days = daysUntilDate(value, now);
    return days != null && days < 0;
  }
  const date = parseDateLike(value);
  if (!date) return false;
  return date.getTime() < (typeof now === "number" ? now : now.getTime());
}

/** Sort key for date-ish values: date-only and timestamps compare on one axis (local midnight for date-only). */
export function dateSortValue(value: DateLike): number {
  return parseDateLike(value)?.getTime() ?? Number.POSITIVE_INFINITY;
}

/** Compare two date-only strings (or date-ish values) by calendar day: <0, 0, >0. */
export function compareDateOnly(a: DateLike, b: DateLike): number {
  const left = toDateOnly(a) ?? "";
  const right = toDateOnly(b) ?? "";
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Human relative wording for a calendar day: "today", "tomorrow", "in 3 days", "2 weeks ago". */
export function relativeDateOnly(value: DateLike, now: Date | number = new Date()): string {
  const days = daysUntilDate(value, now);
  if (days == null) return "—";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  const abs = Math.abs(days);
  let amount: number;
  let unit: string;
  if (abs < 14) { amount = abs; unit = "day"; }
  else if (abs < 60) { amount = Math.round(abs / 7); unit = "week"; }
  else if (abs < 730) { amount = Math.round(abs / 30.4375); unit = "month"; }
  else { amount = Math.round(abs / 365.25); unit = "year"; }
  const phrase = `${amount} ${unit}${amount === 1 ? "" : "s"}`;
  return days > 0 ? `in ${phrase}` : `${phrase} ago`;
}

/** Add whole calendar days to a date-only value (local calendar, DST-safe). */
export function addDaysToDateOnly(value: string, days: number): string | null {
  const date = parseDateOnly(value);
  if (!date) return null;
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}
