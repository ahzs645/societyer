/**
 * Date-only (`YYYY-MM-DD`) arithmetic for chart axes. Calendar days are
 * handled in UTC so adding days never trips over a DST change.
 */

const DAY_MS = 86_400_000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function dayMs(date: string): number {
  const match = DATE_ONLY.exec(date);
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  return dayKey(dayMs(date) + days * DAY_MS);
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((dayMs(b) - dayMs(a)) / DAY_MS);
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** First day of the month `months` away from `date`'s month. */
export function addMonths(date: string, months: number): string {
  const d = new Date(dayMs(date));
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return dayKey(target.getTime());
}

export function endOfMonth(date: string): string {
  const d = new Date(dayMs(date));
  return dayKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

/** Month keys (`YYYY-MM`) from `start` to `end`, inclusive. */
export function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let cursor = startOfMonth(start);
  const last = monthKey(end);
  while (monthKey(cursor) <= last && out.length < 1200) {
    out.push(monthKey(cursor));
    cursor = addMonths(cursor, 1);
  }
  return out;
}

const monthShort = new Intl.DateTimeFormat("en-CA", { month: "short", timeZone: "UTC" });
const dayLong = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const dayShort = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
const monthLong = new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });

/** "Apr 5, 2026" */
export function formatDay(date: string): string {
  const ms = dayMs(date);
  return Number.isFinite(ms) ? dayLong.format(ms) : date;
}

/** "Apr 5" */
export function formatDayShort(date: string): string {
  const ms = dayMs(date);
  return Number.isFinite(ms) ? dayShort.format(ms) : date;
}

/** "Apr" (or "Apr 2026" with `withYear`) for `YYYY-MM` or `YYYY-MM-DD`. */
export function formatMonth(date: string, withYear = false): string {
  const ms = dayMs(date.length === 7 ? `${date}-01` : date);
  if (!Number.isFinite(ms)) return date;
  const label = monthShort.format(ms);
  return withYear ? `${label} ${date.slice(0, 4)}` : label;
}

/** "April 2026" */
export function formatMonthLong(date: string): string {
  const ms = dayMs(date.length === 7 ? `${date}-01` : date);
  return Number.isFinite(ms) ? monthLong.format(ms) : date;
}

/** "Apr 3 – May 20, 2026" (years shown when they differ). */
export function formatRange(start: string, end: string): string {
  if (start.slice(0, 4) === end.slice(0, 4)) return `${formatDayShort(start)} – ${formatDay(end)}`;
  return `${formatDay(start)} – ${formatDay(end)}`;
}
