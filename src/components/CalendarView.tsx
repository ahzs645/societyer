import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import type { ToneVariant } from "./ui";
import { calendarDate, calendarDateKey, calendarWeekDays } from "../lib/calendarDates";

export type CalendarLayout = "month" | "week" | "list";
/** "Agenda", not "List": pages put a List/Calendar view toggle next to this
 * group, and two same-named "List" buttons are ambiguous for screen readers. */
const CALENDAR_LAYOUT_LABELS: Record<CalendarLayout, string> = { month: "Month", week: "Week", list: "Agenda" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
/** Room left above a scrolled-to agenda day for the app's sticky top bar. */
const AGENDA_SCROLL_MARGIN = 72;
/** Below this width a seven-column month grid cannot show event labels, so the
 * calendar opens on Agenda and, if Month is chosen, renders compact day cells. */
export const CALENDAR_COMPACT_WIDTH = 560;

/** True while the element is narrower than the compact breakpoint. */
function useCompactWidth(ref: RefObject<HTMLElement>) {
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.innerWidth < CALENDAR_COMPACT_WIDTH);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < CALENDAR_COMPACT_WIDTH));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return compact;
}

type CalendarDayEvent = { id: string; label: string; tone?: ToneVariant };

/** A compact month cell: the date plus tone dots; tapping opens that day's agenda. */
function CompactCalendarDay({ day, rows, onOpen }: { day: Date; rows: CalendarDayEvent[]; onOpen: (day: Date) => void }) {
  const date = <span className="calendar-view__date">{day.getDate()}</span>;
  if (!rows.length) return date;
  const dayLabel = day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return <button type="button" className="calendar-view__day"
    aria-label={`${dayLabel}: ${rows.length} ${rows.length === 1 ? "event" : "events"}`}
    title={rows.map((row) => row.label).join("\n")} onClick={() => onOpen(day)}>
    {date}
    <span className="calendar-view__dots" aria-hidden="true">
      {rows.slice(0, 3).map((row) => <span key={row.id} className={`calendar-view__dot${row.tone ? ` calendar-view__dot--${row.tone}` : ""}`} />)}
      {rows.length > 3 && <span className="calendar-view__dot-more">+{rows.length - 3}</span>}
    </span>
  </button>;
}

function monthDays(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = calendarWeekDays(first)[0];
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export type CalendarEvent = { id: string; label: string; tone?: ToneVariant; date: string };

/**
 * Where the calendar opens (A6). Today's month when it has records (or there
 * are none at all); otherwise the month of the most recent record on or before
 * today, or of the first upcoming one. A historic workspace (minutes from
 * 2008–2019) used to open on an empty month with no way to find its records.
 */
export function calendarOpeningDate(datedKeys: readonly string[], today: Date = new Date()): Date | null {
  if (!datedKeys.length) return null;
  const sorted = [...datedKeys].sort();
  const todayKey = calendarDateKey(today);
  const monthPrefix = todayKey.slice(0, 7);
  if (sorted.some((key) => key.startsWith(monthPrefix))) return null;
  const past = sorted.filter((key) => key <= todayKey);
  const target = past.length ? past[past.length - 1] : sorted[0];
  return calendarDate(target);
}

/** Shared month/week/agenda presentation. Callers retain data, authorization and selection. */
export function CalendarView<T>({
  items, getDate, getLabel, getTone, getId, onSelect, initialMonth, layout, onLayoutChange,
}: {
  items: T[];
  getDate: (item: T) => string | null | undefined;
  getLabel: (item: T) => string;
  getTone?: (item: T) => ToneVariant | undefined;
  getId: (item: T) => string;
  onSelect?: (item: T) => void;
  initialMonth?: Date;
  layout?: CalendarLayout;
  onLayoutChange?: (layout: CalendarLayout) => void;
}) {
  const [anchor, setAnchorState] = useState(() => initialMonth ?? new Date());
  // Once the person navigates, the opening-month logic stays out of the way.
  const navigated = useRef(Boolean(initialMonth));
  const setAnchor = (next: Date) => {
    navigated.current = true;
    setAnchorState(next);
  };
  const [localLayout, setLocalLayout] = useState<CalendarLayout>("month");
  const rootRef = useRef<HTMLDivElement>(null);
  const compact = useCompactWidth(rootRef);
  // Month is the stored default, so on a narrow screen it only means "Month"
  // once the person picks it here; until then the calendar opens on Agenda.
  const [explicitLayout, setExplicitLayout] = useState(false);
  const storedMode = layout ?? localLayout;
  const mode: CalendarLayout = compact && storedMode === "month" && !explicitLayout ? "list" : storedMode;
  const compactMonth = compact && mode === "month";
  const changeLayout = (next: CalendarLayout) => {
    setExplicitLayout(true);
    if (onLayoutChange) onLayoutChange(next);
    else setLocalLayout(next);
  };
  const pendingDay = useRef<string | null>(null);
  const todayKey = calendarDateKey(new Date());
  const { byDay, undated } = useMemo(() => {
    const map = new Map<string, { item: T; label: string; tone?: ToneVariant; id: string }[]>();
    let missing = 0;
    for (const item of items) {
      const date = calendarDate(getDate(item));
      if (!date) { missing += 1; continue; }
      const key = calendarDateKey(date);
      const list = map.get(key) ?? [];
      list.push({ item, label: getLabel(item), tone: getTone?.(item), id: getId(item) });
      map.set(key, list);
    }
    return { byDay: map, undated: missing };
  }, [items, getDate, getLabel, getTone, getId]);
  const datedKeys = useMemo(() => [...byDay.keys()].sort(), [byDay]);
  const earliestKey = datedKeys[0];
  const latestKey = datedKeys[datedKeys.length - 1];
  // Records usually arrive after the first render; pick the opening month once
  // they do, unless the person has already moved the calendar.
  useEffect(() => {
    if (navigated.current || !datedKeys.length) return;
    navigated.current = true;
    const opening = calendarOpeningDate(datedKeys);
    if (opening) setAnchorState(opening);
  }, [datedKeys]);
  useEffect(() => {
    const key = pendingDay.current;
    if (mode !== "list" || !key) return;
    pendingDay.current = null;
    const section = rootRef.current?.querySelector<HTMLElement>(`[data-calendar-date="${key}"]`);
    const heading = section?.querySelector<HTMLElement>("h3");
    if (!section || !heading) return;
    // Bring the day to the top (below the app's sticky bar, via the
    // section's scroll margin) so its events show, not just its heading at
    // the bottom edge. When the whole agenda fits, keep the layout switch in
    // view too.
    const root = rootRef.current;
    const rootRect = root?.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    if (root && rootRect && sectionRect.bottom - rootRect.top <= window.innerHeight - AGENDA_SCROLL_MARGIN) {
      root.scrollIntoView({ block: "start" });
    } else {
      section.scrollIntoView({ block: "start" });
    }
    heading.focus({ preventScroll: true });
  }, [mode, anchor]);
  /** Compact month cells hand off to the agenda, scrolled to that day. */
  const openDay = (day: Date) => {
    pendingDay.current = calendarDateKey(day);
    setAnchor(day);
    changeLayout("list");
  };
  const jumpTo = (key: string | undefined) => {
    const date = key ? calendarDate(key) : null;
    if (date) setAnchor(date);
  };
  const days = mode === "week" ? calendarWeekDays(anchor) : monthDays(anchor);
  const listDays = days.filter((day) => day.getMonth() === anchor.getMonth() && (byDay.get(calendarDateKey(day))?.length ?? 0) > 0);
  const monthLabel = anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const title = mode === "week"
    ? `${days[0].toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} – ${days[6].toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
    : monthLabel;
  const period = mode === "week" ? "week" : "month";
  const move = (direction: number) => {
    if (mode === "week") {
      const next = new Date(anchor);
      next.setDate(next.getDate() + direction * 7);
      setAnchor(next);
    } else setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1));
  };
  const events = (day: Date, limit?: number) => {
    const rows = byDay.get(calendarDateKey(day)) ?? [];
    const visible = limit ? rows.slice(0, limit) : rows;
    return <div className="calendar-view__events">
      {visible.map((event) => <button key={event.id} type="button"
        className={`calendar-view__event${event.tone ? ` calendar-view__event--${event.tone}` : ""}`}
        title={event.label} onClick={() => onSelect?.(event.item)}>{event.label}</button>)}
      {rows.length > visible.length && <button type="button" className="calendar-view__more"
        aria-label={`Show all ${rows.length} events on ${calendarDateKey(day)}`}
        onClick={() => openDay(day)}>+{rows.length - visible.length} more</button>}
    </div>;
  };
  return <div ref={rootRef} className={`calendar-view calendar-view--${mode}${compactMonth ? " is-compact" : ""}`} style={{ scrollMarginTop: AGENDA_SCROLL_MARGIN }}>
    <div className="calendar-view__head">
      <div className="calendar-view__title" aria-live="polite">{title}</div>
      <div className="calendar-view__nav">
        <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Previous ${period}`} onClick={() => move(-1)}><ChevronLeft size={14} /></button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAnchor(new Date())}>Today</button>
        <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Next ${period}`} onClick={() => move(1)}><ChevronRight size={14} /></button>
      </div>
      {earliestKey && latestKey && <div className="calendar-view__jump" role="group" aria-label="Jump to records">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => jumpTo(earliestKey)} title={`Earliest record: ${earliestKey}`} aria-label={`Jump to earliest record (${earliestKey})`}>
          <ChevronsLeft size={14} aria-hidden="true" /> Earliest
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => jumpTo(latestKey)} title={`Latest record: ${latestKey}`} aria-label={`Jump to latest record (${latestKey})`}>
          Latest <ChevronsRight size={14} aria-hidden="true" />
        </button>
      </div>}
      <div className="record-table__segmented" role="group" aria-label="Calendar layout">
        {(["month", "week", "list"] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value}
          className={mode === value ? "is-active" : ""} onClick={() => changeLayout(value)}>{CALENDAR_LAYOUT_LABELS[value]}</button>)}
      </div>
    </div>
    {mode === "list" ? <div className="calendar-view__agenda" role="region" aria-label={`${monthLabel} events`}>
      {listDays.length === 0 && <p className="muted">No dated records this month.</p>}
      {listDays.map((day) => <section key={calendarDateKey(day)} data-calendar-date={calendarDateKey(day)} style={{ scrollMarginTop: AGENDA_SCROLL_MARGIN }}>
        <h3 className="calendar-view__date" tabIndex={-1}>{day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</h3>
        {events(day)}
      </section>)}
    </div> : <div className="calendar-view__scroll" role="region" aria-label={`${mode === "week" ? "Week" : "Month"} calendar`} tabIndex={0}>
      <div className="calendar-view__weekdays">{WEEKDAYS.map((day, index) => <div key={day} className="calendar-view__weekday">
        {compactMonth ? <abbr title={WEEKDAY_NAMES[index]}>{day.slice(0, 2)}</abbr> : day}
      </div>)}</div>
      <div className="calendar-view__grid">{days.map((day) => <div key={calendarDateKey(day)} data-calendar-date={calendarDateKey(day)}
        className={`calendar-view__cell${day.getMonth() === anchor.getMonth() ? "" : " is-outside"}${calendarDateKey(day) === todayKey ? " is-today" : ""}`}>
        {compactMonth ? <CompactCalendarDay day={day} rows={byDay.get(calendarDateKey(day)) ?? []} onOpen={openDay} /> : <>
          <div className="calendar-view__date">{mode === "week" ? day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : day.getDate()}</div>
          {events(day, mode === "month" ? 3 : undefined)}
        </>}
      </div>)}</div>
    </div>}
    {undated > 0 && <p className="muted calendar-view__undated">{undated} {undated === 1 ? "record without a valid date is" : "records without valid dates are"} not shown.</p>}
  </div>;
}
