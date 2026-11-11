/**
 * Pointer and keyboard handling for the timeline, delegated to its scroll
 * container so rows carry no handlers of their own (and stay memoised).
 *
 * - Click or Enter on a bar or title opens the task.
 * - With editing on (tasks:write, not a phone): drag a bar to move it, drag
 *   an edge to change the start or due date, drag a milestone to move its
 *   due date; click a day in a "Not scheduled" row to set its due date.
 *   Touch never drags; a tap opens the task.
 * - ← / → move a focused bar a day and Shift+← / Shift+→ change its length;
 *   the change saves once the keys rest. Escape cancels a drag or nudge.
 * - ↑ / ↓ / Home / End move between tasks (one roving tab stop).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { TaskRecord } from "../taskModel";
import { daysFromPixels, draggedSchedule, keyboardSchedule, taskSpan, xToDay, type DragMode, type TaskSchedule } from "./timelineMath";
import type { TimelineRow, TimelineTaskRow } from "./timelineRows";
import { TIMELINE_HEADER_H } from "./TimelineRowViews";

/** Pointer travel before a press on a bar becomes a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;
/** Arrow-key nudges save once the keys rest this long (or the bar loses focus). */
const KEY_COMMIT_MS = 700;
/** Room the hover card needs below a bar before it flips above. */
const HINT_ROOM_PX = 110;
const HINT_MAX_WIDTH_PX = 288;

export type TimelinePreview = { key: string; schedule: TaskSchedule };
export type TimelineHintPlace = { key: string; left: number; top: number; above: boolean };

export type TimelineInteractionContext = {
  rows: TimelineRow[];
  rowIndexByKey: Map<string, number>;
  /** Task rows in order, for ↑ / ↓. */
  taskKeys: string[];
  canEdit: boolean;
  isPhone: boolean;
  openDays: number;
  origin: number;
  dayWidth: number;
  rowH: number;
  open: (task: TaskRecord) => void;
  commit: (row: TimelineTaskRow, next: TaskSchedule, message: string) => void;
};

type Drag = { key: string; mode: DragMode; startX: number; delta: number; moved: boolean; pointerId: number; element: HTMLElement };

function closestData(target: EventTarget | null, attribute: string): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(`[${attribute}]`) : null;
}

export function useTimelineInteractions(scrollRef: RefObject<HTMLDivElement | null>, context: TimelineInteractionContext) {
  const [preview, setPreview] = useState<TimelinePreview | null>(null);
  const [ghost, setGhost] = useState<{ key: string; day: number } | null>(null);
  const [hint, setHint] = useState<TimelineHintPlace | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Handlers read the latest rows and settings through a ref, so a drag
  // that outlives a render never works on stale rows.
  const latest = useRef(context);
  latest.current = context;
  const taskRow = useCallback((key: string | undefined): TimelineTaskRow | null => {
    if (!key) return null;
    const index = latest.current.rowIndexByKey.get(key);
    const row = index === undefined ? undefined : latest.current.rows[index];
    return row?.kind === "task" ? row : null;
  }, []);

  const tabStopKey = activeKey && context.rowIndexByKey.has(activeKey) ? activeKey : context.taskKeys[0] ?? null;

  const dragRef = useRef<Drag | null>(null);
  const suppressClickRef = useRef(false);

  const placeHint = (key: string, rect: { left: number; top: number; bottom: number }) => {
    const above = rect.bottom + HINT_ROOM_PX > window.innerHeight;
    setHint({ key, left: Math.max(8, Math.min(rect.left, window.innerWidth - HINT_MAX_WIDTH_PX - 8)), top: above ? rect.top - 6 : rect.bottom + 6, above });
  };

  const dayAt = (lane: HTMLElement, clientX: number) =>
    xToDay(clientX - lane.getBoundingClientRect().left, latest.current.origin, latest.current.dayWidth);

  /* ------------------------------------------------------------ pointer */

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bar = closestData(event.target, "data-bar");
    if (!bar || !latest.current.canEdit || event.pointerType === "touch" || event.button !== 0) return;
    const row = taskRow(bar.dataset.bar);
    if (!row || row.span.kind === "none") return;
    const handle = closestData(event.target, "data-handle")?.dataset.handle;
    const mode: DragMode = handle === "start" || handle === "end" ? handle : "move";
    dragRef.current = { key: row.key, mode, startX: event.clientX, delta: 0, moved: false, pointerId: event.pointerId, element: bar };
    bar.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag) {
      const dx = event.clientX - drag.startX;
      if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      const firstMove = !drag.moved;
      drag.moved = true;
      const delta = daysFromPixels(dx, latest.current.dayWidth);
      // Re-render only when the bar crosses into another day.
      if (delta === drag.delta && !firstMove) return;
      drag.delta = delta;
      const row = taskRow(drag.key);
      const next = row ? draggedSchedule(row.span, drag.mode, delta) : null;
      if (next) setPreview({ key: drag.key, schedule: next });
      const rect = drag.element.getBoundingClientRect();
      placeHint(drag.key, { left: event.clientX - 20, top: rect.top, bottom: rect.bottom });
      return;
    }
    if (!latest.current.canEdit || event.pointerType === "touch") return;
    const lane = closestData(event.target, "data-schedule-lane");
    if (!lane) {
      if (ghost) setGhost(null);
      return;
    }
    const day = dayAt(lane, event.clientX);
    const key = lane.dataset.scheduleLane ?? "";
    if (!ghost || ghost.key !== key || ghost.day !== day) setGhost({ key, day });
  };

  const endDrag = (cancel: boolean) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
    setPreview(null);
    setHint(null);
    if (!drag.moved) return; // a plain click: let it open the task
    suppressClickRef.current = true;
    if (cancel || drag.delta === 0) return;
    const row = taskRow(drag.key);
    const next = row ? draggedSchedule(row.span, drag.mode, drag.delta) : null;
    if (row && next) latest.current.commit(row, next, drag.mode === "move" ? "Task moved" : "Dates changed");
  };

  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const lane = closestData(event.target, "data-schedule-lane");
    if (lane && latest.current.canEdit) {
      const row = taskRow(lane.dataset.scheduleLane);
      if (!row) return;
      setGhost(null);
      latest.current.commit(row, { start: null, due: dayAt(lane, event.clientX) }, "Due date set");
      return;
    }
    const target = closestData(event.target, "data-bar") ?? closestData(event.target, "data-open-task");
    const row = taskRow(target?.dataset.bar ?? target?.dataset.openTask);
    if (row) latest.current.open(row.task);
  };

  const onPointerOver = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current || event.pointerType === "touch" || latest.current.isPhone) return;
    const bar = closestData(event.target, "data-bar");
    const key = bar?.dataset.bar;
    if (bar && key && hint?.key !== key) placeHint(key, bar.getBoundingClientRect());
  };
  const onPointerOut = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) return;
    const bar = closestData(event.target, "data-bar");
    if (bar && !(event.relatedTarget instanceof Node && bar.contains(event.relatedTarget)) && document.activeElement !== bar) setHint(null);
  };
  const onPointerLeave = () => {
    if (ghost) setGhost(null);
  };

  /* ------------------------------------------------------------ keyboard */

  const keyTimerRef = useRef<number | null>(null);
  const keyPreviewRef = useRef<TimelinePreview | null>(null);
  const flushKeys = useCallback((cancel = false) => {
    if (keyTimerRef.current !== null) window.clearTimeout(keyTimerRef.current);
    keyTimerRef.current = null;
    const pending = keyPreviewRef.current;
    keyPreviewRef.current = null;
    if (!pending) return;
    setPreview(null);
    const row = taskRow(pending.key);
    if (!cancel && row) latest.current.commit(row, pending.schedule, "Dates changed");
  }, [taskRow]);
  // Leaving the view saves a nudge still waiting.
  useEffect(() => () => flushKeys(), [flushKeys]);

  const pendingFocusRef = useRef<string | null>(null);
  const focusRow = (key: string) => {
    const element = scrollRef.current;
    const index = latest.current.rowIndexByKey.get(key);
    if (!element || index === undefined) return;
    const { rowH } = latest.current;
    const top = TIMELINE_HEADER_H + index * rowH;
    if (top < element.scrollTop + TIMELINE_HEADER_H) element.scrollTop = top - TIMELINE_HEADER_H;
    else if (top + rowH > element.scrollTop + element.clientHeight) element.scrollTop = top + rowH - element.clientHeight;
    pendingFocusRef.current = key;
    setActiveKey(key);
  };
  // After ↑ / ↓ re-renders the rows, focus the new one and bring its bar into view.
  useEffect(() => {
    const key = pendingFocusRef.current;
    if (!key) return;
    pendingFocusRef.current = null;
    const target = scrollRef.current?.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (dragRef.current) { endDrag(true); event.preventDefault(); }
      else if (keyPreviewRef.current) { flushKeys(true); event.preventDefault(); }
      return;
    }
    const key = closestData(event.target, "data-focus-key")?.dataset.focusKey;
    if (!key) return;
    const { taskKeys } = latest.current;
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      const index = taskKeys.indexOf(key);
      if (index === -1) return;
      event.preventDefault();
      const nextIndex = event.key === "Home" ? 0
        : event.key === "End" ? taskKeys.length - 1
        : Math.max(0, Math.min(taskKeys.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      if (nextIndex !== index) {
        flushKeys();
        focusRow(taskKeys[nextIndex]);
      }
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (!latest.current.canEdit || !closestData(event.target, "data-bar") || event.altKey || event.metaKey || event.ctrlKey) return;
    const row = taskRow(key);
    if (!row) return;
    event.preventDefault();
    const pending = keyPreviewRef.current?.key === key ? keyPreviewRef.current.schedule : null;
    const base = pending ? taskSpan(pending, latest.current.openDays) : row.span;
    const next = keyboardSchedule(base, event.key === "ArrowLeft" ? -1 : 1, event.shiftKey);
    if (!next) return;
    keyPreviewRef.current = { key, schedule: next };
    setPreview({ key, schedule: next });
    if (keyTimerRef.current !== null) window.clearTimeout(keyTimerRef.current);
    keyTimerRef.current = window.setTimeout(() => flushKeys(), KEY_COMMIT_MS);
  };

  const onFocus = (event: ReactFocusEvent<HTMLDivElement>) => {
    const target = closestData(event.target, "data-focus-key");
    const key = target?.dataset.focusKey;
    if (!target || !key) return;
    if (key !== activeKey) setActiveKey(key);
    if (target.hasAttribute("data-bar") && !latest.current.isPhone) placeHint(key, target.getBoundingClientRect());
  };
  const onBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (!closestData(event.target, "data-bar")) return;
    setHint(null);
    if (keyPreviewRef.current) flushKeys();
  };

  /** The view scrolled: a hover card no longer sits on its bar (except while dragging). */
  const onScrolled = () => {
    if (!dragRef.current && hint) setHint(null);
  };

  return {
    preview,
    ghost,
    hint,
    hintRow: hint ? taskRow(hint.key) : null,
    tabStopKey,
    dragging: Boolean(preview && dragRef.current),
    onScrolled,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: () => endDrag(false),
      onPointerCancel: () => endDrag(true),
      onPointerOver,
      onPointerOut,
      onPointerLeave,
      onClick,
      onKeyDown,
      onFocus,
      onBlur,
    },
  };
}
