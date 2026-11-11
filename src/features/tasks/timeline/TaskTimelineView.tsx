/**
 * Tasks timeline: a task grid on the left (title, owner, status) and a
 * horizontally scrolling time area with a sticky date header. A task with a
 * start and a due date is a bar, a due date alone is a milestone, a start
 * date alone is a short open-ended bar; tasks with neither wait in "Not
 * scheduled" at the bottom.
 *
 * With tasks:write on a desktop, bars drag and their edges resize, and a
 * focused bar moves with the arrow keys (useTimelineInteractions). Changes
 * show at once and save with Undo (useTimelineSaving). Phones and readers
 * get a read-only view; a tap opens the drawer, where dates are edited.
 *
 * Only the rows and date ticks in view are rendered, so a few hundred tasks
 * stay smooth. Pure parts: timelineMath.ts (dates and pixels) and
 * timelineRows.ts (tasks in, rows out).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFilteredRecords } from "@/platform/record-engine";
import { useSociety } from "../../../hooks/useSociety";
import { organizationTodayISO } from "../../../lib/dateRanges";
import { useIsMobile } from "../../../lib/useIsMobile";
import type { TaskViewActions } from "../TaskMenus";
import type { TaskGroupBy, TaskRecord } from "../taskModel";
import {
  DAY_WIDTH,
  TIMELINE_SCALES,
  dayFromIso,
  dayToX,
  fitRange,
  fitScale,
  monthRangeLabel,
  openEndDays,
  scaleTicks,
  scheduleFromDates,
  taskSpan,
  timelineDomain,
  visibleDayRange,
  visibleRowRange,
  xToDay,
  yearOfDay,
  type TaskSchedule,
  type TimelineScale,
} from "./timelineMath";
import { buildTimelineRows, type TimelineGroupRow, type TimelineRow } from "./timelineRows";
import { GRID_MAX, GRID_MIN, TimelineGridLines, TimelineHeader, TimelineHint, TimelineLegend, TimelineToolbar } from "./TimelineChrome";
import { TIMELINE_HEADER_H, TimelineGroupRowView, TimelineTaskRowView } from "./TimelineRowViews";
import { useTimelineInteractions } from "./useTimelineInteractions";
import { useTimelineSaving } from "./useTimelineSaving";

const SCALE_KEY = "societyer:tasks:timeline-scale";
const GRID_KEY = "societyer:tasks:timeline-grid";
const ROW_H = 36;
/** Phone rows are touch targets. */
const ROW_H_PHONE = 44;
const GRID_DEFAULT = 340;
/** Phones show the title column only. */
const GRID_PHONE = 136;
/** Day ranges re-render in steps of this many days, not on every pixel scrolled. */
const DAY_BUCKET = 16;
const HELP_ID = "task-timeline-help";

type ViewWindow = { first: number; end: number; from: number; to: number };
type PendingScroll = { day: number; align: "start" | "center" | "third" };

function readStoredScale(): TimelineScale {
  try {
    const value = window.localStorage.getItem(SCALE_KEY);
    return TIMELINE_SCALES.find((scale) => scale === value) ?? "week";
  } catch {
    return "week";
  }
}

function readStoredGrid(): number {
  try {
    const value = Number(window.localStorage.getItem(GRID_KEY));
    return Number.isFinite(value) && value >= GRID_MIN && value <= GRID_MAX ? value : GRID_DEFAULT;
  } catch {
    return GRID_DEFAULT;
  }
}

function writeStored(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function TaskTimelineView({
  groupBy,
  actions,
  hasTasks,
}: {
  groupBy: TaskGroupBy;
  actions: TaskViewActions;
  /** Whether the register has tasks before search and filters. */
  hasTasks: boolean;
}) {
  const records = useFilteredRecords() as TaskRecord[];
  const society = useSociety();
  const isPhone = useIsMobile();
  const canEdit = actions.canManage && !isPhone;

  const [scale, setScaleState] = useState<TimelineScale>(readStoredScale);
  const [gridWidth, setGridWidth] = useState<number>(readStoredGrid);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [win, setWin] = useState<ViewWindow>({ first: 0, end: 40, from: 0, to: -1 });
  const [rangeLabel, setRangeLabel] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const today = dayFromIso(organizationTodayISO(society ?? null)) ?? Math.floor(Date.now() / 86_400_000);
  const currentYear = yearOfDay(today);
  const dayWidth = DAY_WIDTH[scale];
  const openDays = openEndDays(scale);
  const rowH = isPhone ? ROW_H_PHONE : ROW_H;
  const gridW = isPhone ? GRID_PHONE : gridWidth;

  const { tasks, commit } = useTimelineSaving(records, currentYear);
  const rows = useMemo(() => buildTimelineRows({ tasks, groupBy, toggled, openDays }), [tasks, groupBy, toggled, openDays]);
  const allSpans = useMemo(
    () => tasks.map((task) => taskSpan(scheduleFromDates(task.startDate, task.dueDate), openDays)),
    [tasks, openDays],
  );
  const scheduledCount = allSpans.filter((span) => span.kind !== "none").length;
  const domain = useMemo(() => timelineDomain(allSpans, today), [allSpans, today]);
  const origin = domain.start;
  const laneWidth = (domain.end - domain.start + 1) * dayWidth;
  const laneViewport = Math.max(0, viewport.width - gridW);

  const rowIndexByKey = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => { if (row.kind === "task") map.set(row.key, index); });
    return map;
  }, [rows]);
  const taskKeys = useMemo(() => rows.flatMap((row) => (row.kind === "task" ? [row.key] : [])), [rows]);

  const interaction = useTimelineInteractions(scrollRef, {
    rows, rowIndexByKey, taskKeys, canEdit, isPhone, openDays, origin, dayWidth, rowH, open: actions.open, commit,
  });
  const { preview, ghost, hint, hintRow, tabStopKey } = interaction;

  /* ------------------------------------------------------------ scrolling */

  // Where to scroll after the next render: today on first show, the same
  // centre day after a scale change, the fitted range after Fit.
  const pendingScrollRef = useRef<PendingScroll | null>({ day: today, align: "third" });
  const originRef = useRef(origin);
  const geometryRef = useRef({ origin, dayWidth, gridW, rowH, rowCount: rows.length });
  geometryRef.current = { origin, dayWidth, gridW, rowH, rowCount: rows.length };

  const readWindow = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const geometry = geometryRef.current;
    const lane = Math.max(0, element.clientWidth - geometry.gridW);
    const rowsInView = visibleRowRange(element.scrollTop - TIMELINE_HEADER_H, element.clientHeight, geometry.rowH, geometry.rowCount, 8);
    const days = visibleDayRange(element.scrollLeft, lane, geometry.origin, geometry.dayWidth, Math.ceil(lane / geometry.dayWidth / 2) + 2);
    const from = Math.floor(days.from / DAY_BUCKET) * DAY_BUCKET;
    const to = Math.ceil(days.to / DAY_BUCKET) * DAY_BUCKET;
    setWin((current) =>
      current.first === rowsInView.first && current.end === rowsInView.end && current.from === from && current.to === to
        ? current
        : { first: rowsInView.first, end: rowsInView.end, from, to },
    );
    const first = xToDay(element.scrollLeft, geometry.origin, geometry.dayWidth);
    const last = xToDay(element.scrollLeft + Math.max(lane - 1, 0), geometry.origin, geometry.dayWidth);
    setRangeLabel(monthRangeLabel(first, last));
  }, []);

  const scrollToDay = useCallback((day: number, align: PendingScroll["align"], smooth: boolean) => {
    const element = scrollRef.current;
    if (!element) return;
    const geometry = geometryRef.current;
    const lane = Math.max(0, element.clientWidth - geometry.gridW);
    const offset = align === "start" ? 8 : align === "center" ? lane / 2 : lane / 3;
    const left = Math.max(0, dayToX(day, geometry.origin, geometry.dayWidth) - offset);
    element.scrollTo({ left, behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto" });
  }, []);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const pending = pendingScrollRef.current;
    if (pending && element.clientWidth > 0) {
      pendingScrollRef.current = null;
      scrollToDay(pending.day, pending.align, false);
    } else if (originRef.current !== origin) {
      // The stretch grew at the start (a task moved earlier): keep the same days in view.
      element.scrollLeft += (originRef.current - origin) * dayWidth;
    }
    originRef.current = origin;
    readWindow();
  }, [origin, dayWidth, gridW, rowH, rows.length, viewport.width, viewport.height, readWindow, scrollToDay]);

  // The scroll area mounts only once there are tasks to show.
  const isEmpty = records.length === 0;
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => setViewport({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [isEmpty]);

  const frameRef = useRef<number | null>(null);
  const onScroll = () => {
    interaction.onScrolled();
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      readWindow();
    });
  };
  useEffect(() => () => { if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current); }, []);

  const changeScale = (next: TimelineScale, keep?: PendingScroll) => {
    if (next === scale) {
      if (keep) scrollToDay(keep.day, keep.align, true);
      return;
    }
    const element = scrollRef.current;
    const centre = element ? xToDay(element.scrollLeft + laneViewport / 2, origin, dayWidth) : today;
    pendingScrollRef.current = keep ?? { day: centre, align: "center" };
    setScaleState(next);
    writeStored(SCALE_KEY, next);
  };
  const fit = () => {
    const range = fitRange(allSpans, today);
    changeScale(fitScale(range, laneViewport), { day: range.start, align: "start" });
  };
  const page = (direction: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: direction * Math.max(laneViewport * 0.8, dayWidth), behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };
  const resizeGrid = (width: number, persist: boolean) => {
    const clamped = Math.round(Math.max(GRID_MIN, Math.min(GRID_MAX, width)));
    setGridWidth(clamped);
    if (persist) writeStored(GRID_KEY, String(clamped));
  };
  const toggleGroup = useCallback((row: TimelineGroupRow) => {
    setToggled((current) => ({ ...current, [row.toggleKey]: !row.collapsed }));
  }, []);

  /* ------------------------------------------------------------ render */

  if (isEmpty) {
    return (
      <div className="record-table__empty">
        <div className="record-table__empty-title">{hasTasks ? "No matching tasks" : "No tasks yet"}</div>
        <div className="record-table__empty-desc">
          {hasTasks ? "Change or clear the current search and filters." : "Use New task to add one, then give it dates."}
        </div>
      </div>
    );
  }

  const geometry = { origin, dayWidth };
  const ticks = win.to >= win.from ? scaleTicks(scale, win.from, win.to) : { major: [], minor: [] };
  const visible: { row: TimelineRow; index: number }[] = [];
  for (let index = win.first; index < Math.min(win.end, rows.length); index += 1) visible.push({ row: rows[index], index });
  // The focused row stays mounted when it scrolls out of view, so focus is not lost.
  const activeIndex = tabStopKey ? rowIndexByKey.get(tabStopKey) : undefined;
  if (activeIndex !== undefined && (activeIndex < win.first || activeIndex >= win.end)) visible.push({ row: rows[activeIndex], index: activeIndex });
  const hintSchedule: TaskSchedule | null = hintRow
    ? preview?.key === hintRow.key
      ? { start: preview.schedule.start ?? hintRow.schedule.start, due: preview.schedule.due ?? hintRow.schedule.due }
      : hintRow.schedule
    : null;

  return (
    <div className="task-timeline">
      <TimelineToolbar
        rangeLabel={rangeLabel}
        scale={scale}
        canFit={scheduledCount > 0}
        onPage={page}
        onToday={() => scrollToDay(today, "third", true)}
        onFit={fit}
        onScale={(next) => changeScale(next)}
      />
      <TimelineLegend />
      {scheduledCount === 0 && (
        <p className="task-timeline__note">None of these tasks has dates yet. Open “Not scheduled” to give them some.</p>
      )}
      <p id={HELP_ID} className="sr-only">
        {canEdit
          ? "Enter opens the task. Left and right arrows move it by a day; with Shift they change its length. Up and down move between tasks."
          : "Enter opens the task. Up and down move between tasks."}
      </p>

      <div
        ref={scrollRef}
        className={`task-timeline__scroll${canEdit ? " is-editable" : ""}${interaction.dragging ? " is-dragging" : ""}`}
        role="region"
        aria-label="Task timeline"
        onScroll={onScroll}
        {...interaction.handlers}
      >
        <div className="task-timeline__canvas" style={{ width: gridW + laneWidth }}>
          <TimelineHeader
            gridW={gridW}
            laneWidth={laneWidth}
            isPhone={isPhone}
            scale={scale}
            ticks={ticks}
            geometry={geometry}
            today={today}
            onResize={resizeGrid}
          />
          <div className="task-timeline__body" style={{ height: rows.length * rowH }}>
            <TimelineGridLines gridW={gridW} laneWidth={laneWidth} scale={scale} ticks={ticks} geometry={geometry} today={today} />
            {visible.map(({ row, index }) =>
              row.kind === "group" ? (
                <TimelineGroupRowView key={row.key} row={row} top={index * rowH} height={rowH} gridW={gridW} laneWidth={laneWidth} canEdit={canEdit} onToggle={toggleGroup} />
              ) : (
                <TimelineTaskRowView
                  key={row.key}
                  row={row}
                  top={index * rowH}
                  height={rowH}
                  gridW={gridW}
                  laneWidth={laneWidth}
                  origin={origin}
                  dayWidth={dayWidth}
                  today={today}
                  openDays={openDays}
                  currentYear={currentYear}
                  isPhone={isPhone}
                  canEdit={canEdit}
                  tabStop={row.key === tabStopKey}
                  preview={preview?.key === row.key ? preview.schedule : null}
                  ghostDay={ghost?.key === row.key ? ghost.day : null}
                  helpId={HELP_ID}
                />
              ),
            )}
          </div>
        </div>
      </div>

      {hint && hintRow && hintSchedule && (
        <TimelineHint task={hintRow.task} schedule={hintSchedule} today={today} currentYear={currentYear} left={hint.left} top={hint.top} above={hint.above} />
      )}
    </div>
  );
}
