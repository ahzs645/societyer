/**
 * Pure date maths for the Tasks timeline: calendar days as whole numbers,
 * day ↔ pixel conversion, scale ticks, the fit range, and what a drag, an
 * edge resize or an arrow key does to a task's dates. No React, no DOM, so
 * scripts/check-task-timeline.ts can test it directly.
 *
 * A "day" is the number of whole days since 1970-01-01, counted in UTC, so a
 * daylight-saving change never shifts a bar by an hour or a day.
 */
import { isIsoDay } from "../../../../shared/taskSchedule";

export type TimelineScale = "day" | "week" | "month";
export const TIMELINE_SCALES: readonly TimelineScale[] = ["day", "week", "month"];
export const TIMELINE_SCALE_LABELS: Record<TimelineScale, string> = { day: "Day", week: "Week", month: "Month" };

/** Pixels per day at each scale (a week is 112px, a month about 120px). */
export const DAY_WIDTH: Record<TimelineScale, number> = { day: 36, week: 16, month: 4 };

const MS_PER_DAY = 86_400_000;
const DAY_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

/* ---------------------------------------------------------------- days */

/** "2026-03-04" (or a value starting with one) → day number; anything else → null. */
export function dayFromIso(value: string | null | undefined): number | null {
  const match = DAY_PREFIX.exec(value ?? "");
  if (!match || !isIsoDay(`${match[1]}-${match[2]}-${match[3]}`)) return null;
  return Math.round(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / MS_PER_DAY);
}

export function isoFromDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

function utcDate(day: number) {
  return new Date(day * MS_PER_DAY);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(day: number): number {
  // 1970-01-01 was a Thursday.
  return (((day + 4) % 7) + 7) % 7;
}

export function isWeekend(day: number): boolean {
  const weekday = weekdayOf(day);
  return weekday === 0 || weekday === 6;
}

/** The Monday on or before `day`. */
export function startOfWeek(day: number): number {
  return day - ((weekdayOf(day) + 6) % 7);
}

export function startOfMonth(day: number): number {
  const date = utcDate(day);
  return Math.round(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / MS_PER_DAY);
}

export function addMonths(day: number, months: number): number {
  const date = utcDate(day);
  return Math.round(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1) / MS_PER_DAY);
}

function startOfYear(day: number): number {
  return Math.round(Date.UTC(utcDate(day).getUTCFullYear(), 0, 1) / MS_PER_DAY);
}

/* ---------------------------------------------------------------- position */

/** Left edge, in pixels, of `day` on a timeline that starts at `originDay`. */
export function dayToX(day: number, originDay: number, dayWidth: number): number {
  return (day - originDay) * dayWidth;
}

/** The day under pixel `x` (any x inside a day's column maps to that day). */
export function xToDay(x: number, originDay: number, dayWidth: number): number {
  return originDay + Math.floor(x / dayWidth);
}

/** Whole days a pointer moved, snapped to the nearest day. */
export function daysFromPixels(dx: number, dayWidth: number): number {
  const days = Math.round(dx / dayWidth);
  return days === 0 ? 0 : days; // never -0
}

/** The day range in view, padded by `overscanDays` on each side. */
export function visibleDayRange(scrollLeft: number, laneWidth: number, originDay: number, dayWidth: number, overscanDays = 0) {
  const from = xToDay(Math.max(0, scrollLeft), originDay, dayWidth) - overscanDays;
  const to = xToDay(Math.max(0, scrollLeft) + Math.max(0, laneWidth), originDay, dayWidth) + overscanDays;
  return { from, to };
}

/** Rows to render for a vertical scroll position: [first, end). */
export function visibleRowRange(scrollTop: number, viewportHeight: number, rowHeight: number, count: number, overscan = 6) {
  const first = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewportHeight)) / rowHeight) + overscan);
  return { first, end: Math.max(first, end) };
}

/* ---------------------------------------------------------------- spans */

/** A task's dates as day numbers; null where the task has none (or only free text). */
export type TaskSchedule = { start: number | null; due: number | null };

export function scheduleFromDates(startDate: string | null | undefined, dueDate: string | null | undefined): TaskSchedule {
  return { start: isIsoDay(startDate) ? dayFromIso(startDate) : null, due: dayFromIso(dueDate) };
}

/**
 * How a task is drawn. `start` and `end` are inclusive days.
 * - bar: start and due date;
 * - milestone: only a due date (or a start after the due date, which the
 *   server refuses but older data could hold);
 * - open: only a start date, drawn `openEndDays` long with an open end;
 * - none: not scheduled.
 */
export type TaskSpan =
  | { kind: "bar"; start: number; end: number }
  | { kind: "milestone"; start: number; end: number }
  | { kind: "open"; start: number; end: number }
  | { kind: "none" };

/** How long an open-ended bar (start date only) is drawn at each scale. */
export function openEndDays(scale: TimelineScale): number {
  return scale === "day" ? 3 : scale === "week" ? 7 : 14;
}

export function taskSpan(schedule: TaskSchedule, openDays: number): TaskSpan {
  const { start, due } = schedule;
  if (start !== null && due !== null) {
    return start <= due ? { kind: "bar", start, end: due } : { kind: "milestone", start: due, end: due };
  }
  if (due !== null) return { kind: "milestone", start: due, end: due };
  if (start !== null) return { kind: "open", start, end: start + Math.max(1, openDays) - 1 };
  return { kind: "none" };
}

/* ---------------------------------------------------------------- ticks */

export type TimelineTick = {
  day: number;
  /** Days the tick covers. */
  days: number;
  label: string;
  /** Full date or period for a title or screen reader. */
  title: string;
  weekend?: boolean;
  /** Second line on the day scale: the weekday initial. */
  sub?: string;
};

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: string | undefined, options: Intl.DateTimeFormatOptions) {
  const key = `${locale ?? ""}|${JSON.stringify(options)}`;
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
    formatters.set(key, found);
  }
  return found;
}

export function formatDay(day: number, options: Intl.DateTimeFormatOptions, locale?: string): string {
  return formatter(locale, options).format(utcDate(day));
}

/**
 * Header ticks for the days `fromDay`…`toDay` (inclusive). `major` is the
 * upper row (months, or years on the month scale); `minor` the lower row
 * (days, weeks starting Monday, or months). Ticks that start before
 * `fromDay` but reach into it are included.
 */
export function scaleTicks(scale: TimelineScale, fromDay: number, toDay: number, locale?: string): { major: TimelineTick[]; minor: TimelineTick[] } {
  const minor: TimelineTick[] = [];
  const major: TimelineTick[] = [];
  if (toDay < fromDay) return { major, minor };
  if (scale === "day") {
    for (let day = fromDay; day <= toDay; day += 1) {
      minor.push({
        day,
        days: 1,
        label: formatDay(day, { day: "numeric" }, locale),
        sub: formatDay(day, { weekday: "narrow" }, locale),
        title: formatDay(day, { weekday: "long", month: "long", day: "numeric", year: "numeric" }, locale),
        weekend: isWeekend(day),
      });
    }
  } else if (scale === "week") {
    for (let day = startOfWeek(fromDay); day <= toDay; day += 7) {
      minor.push({
        day,
        days: 7,
        label: formatDay(day, { month: "short", day: "numeric" }, locale),
        title: `Week of ${formatDay(day, { month: "long", day: "numeric", year: "numeric" }, locale)}`,
      });
    }
  } else {
    for (let day = startOfMonth(fromDay); day <= toDay; day = addMonths(day, 1)) {
      minor.push({
        day,
        days: addMonths(day, 1) - day,
        label: formatDay(day, { month: "short" }, locale),
        title: formatDay(day, { month: "long", year: "numeric" }, locale),
      });
    }
  }
  if (scale === "month") {
    for (let day = startOfYear(fromDay); day <= toDay; ) {
      const next = Math.round(Date.UTC(utcDate(day).getUTCFullYear() + 1, 0, 1) / MS_PER_DAY);
      const label = formatDay(day, { year: "numeric" }, locale);
      major.push({ day, days: next - day, label, title: label });
      day = next;
    }
  } else {
    for (let day = startOfMonth(fromDay); day <= toDay; day = addMonths(day, 1)) {
      const label = formatDay(day, { month: "long", year: "numeric" }, locale);
      major.push({ day, days: addMonths(day, 1) - day, label, title: label });
    }
  }
  return { major, minor };
}

/* ---------------------------------------------------------------- ranges */

export type DayRange = { start: number; end: number };

/** Days covering every drawn span, with a little room either side. Nothing scheduled: the weeks around today. */
export function fitRange(spans: readonly TaskSpan[], today: number): DayRange {
  let start = Infinity;
  let end = -Infinity;
  for (const span of spans) {
    if (span.kind === "none") continue;
    start = Math.min(start, span.start);
    end = Math.max(end, span.end);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { start: today - 7, end: today + 21 };
  const pad = Math.max(2, Math.ceil((end - start + 1) * 0.05));
  return { start: start - pad, end: end + pad };
}

/** The most detailed scale that shows `range` in `laneWidth` pixels (month when none does). */
export function fitScale(range: DayRange, laneWidth: number): TimelineScale {
  const days = range.end - range.start + 1;
  return TIMELINE_SCALES.find((scale) => days * DAY_WIDTH[scale] <= laneWidth) ?? "month";
}

/**
 * The whole scrollable stretch: a year either side of today, widened to
 * every task, starting on the first of a month.
 */
export function timelineDomain(spans: readonly TaskSpan[], today: number): DayRange {
  const fit = fitRange(spans, today);
  const start = startOfMonth(Math.min(today - 365, fit.start) - 14);
  const end = addMonths(Math.max(today + 365, fit.end) + 14, 1) - 1;
  return { start, end };
}

/* ---------------------------------------------------------------- edits */

export type DragMode = "move" | "start" | "end";

/**
 * The dates after dragging a span by `delta` days.
 * - move: the bar (or milestone, or open bar) shifts as a whole;
 * - start: the left edge moves, never past the due date;
 * - end: the right edge moves, never before the start. On an open bar it
 *   gives the task a due date where the edge lands.
 * A milestone only moves. Returns null for an unscheduled task.
 */
export function draggedSchedule(span: TaskSpan, mode: DragMode, delta: number): TaskSchedule | null {
  switch (span.kind) {
    case "none":
      return null;
    case "milestone":
      return { start: null, due: span.end + delta };
    case "open":
      if (mode === "end") return { start: span.start, due: Math.max(span.start, span.end + delta) };
      return { start: span.start + delta, due: null };
    case "bar":
      if (mode === "start") return { start: Math.min(span.start + delta, span.end), due: span.end };
      if (mode === "end") return { start: span.start, due: Math.max(span.end + delta, span.start) };
      return { start: span.start + delta, due: span.end + delta };
  }
}

/**
 * Arrow keys on a focused bar: ← / → move it a day; Shift+← / Shift+→ make
 * it a day shorter or longer (its due date moves). A milestone has no
 * length, so Shift does nothing to it. Null when nothing changes.
 */
export function keyboardSchedule(span: TaskSpan, direction: -1 | 1, resize: boolean): TaskSchedule | null {
  if (span.kind === "none") return null;
  if (!resize) return draggedSchedule(span, "move", direction);
  if (span.kind === "milestone") return null;
  const next = draggedSchedule(span, "end", direction);
  if (!next || (span.kind === "bar" && next.due === span.end)) return null;
  return next;
}

/** The task's real dates in the shape a span edit returns, for comparing. */
export type DatePatch = { startDate?: string; dueDate?: string };

/** Only the dates that change, as "YYYY-MM-DD". A null in `next` means "leave as it is". */
export function schedulePatch(current: TaskSchedule, next: TaskSchedule): DatePatch {
  const patch: DatePatch = {};
  if (next.start !== null && next.start !== current.start) patch.startDate = isoFromDay(next.start);
  if (next.due !== null && next.due !== current.due) patch.dueDate = isoFromDay(next.due);
  return patch;
}

/** "Mar 3 – Mar 9", "Due Mar 3", "Starts Mar 3"; the year only when it is not `currentYear`. */
export function describeSchedule(schedule: TaskSchedule, currentYear: number, locale?: string): string {
  const label = (day: number) => {
    const year = utcDate(day).getUTCFullYear();
    return formatDay(day, { month: "short", day: "numeric", ...(year === currentYear ? {} : { year: "numeric" }) }, locale);
  };
  const { start, due } = schedule;
  if (start !== null && due !== null) return start === due ? label(due) : `${label(start)} – ${label(due)}`;
  if (due !== null) return `Due ${label(due)}`;
  if (start !== null) return `Starts ${label(start)}`;
  return "No dates";
}

export function yearOfDay(day: number): number {
  return utcDate(day).getUTCFullYear();
}

/** "March 2026", "March – April 2026" or "December 2026 – January 2027" for the days in view. */
export function monthRangeLabel(first: number, last: number, locale?: string): string {
  const sameYear = yearOfDay(first) === yearOfDay(last);
  const firstMonth = formatDay(first, { month: "long" }, locale);
  const lastMonth = formatDay(last, { month: "long" }, locale);
  if (sameYear && firstMonth === lastMonth) return formatDay(first, { month: "long", year: "numeric" }, locale);
  if (sameYear) return `${firstMonth} – ${lastMonth} ${yearOfDay(last)}`;
  return `${formatDay(first, { month: "long", year: "numeric" }, locale)} – ${formatDay(last, { month: "long", year: "numeric" }, locale)}`;
}
