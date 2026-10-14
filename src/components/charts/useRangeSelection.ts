import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { daysBetween } from "./dates";
import { nearestIndex } from "./scales";
import type { DateRange } from "./types";

type IndexRange = { start: number; end: number };
type DragMode = "create" | "start" | "end" | "move";
type DragState = { mode: DragMode; anchor: number; originX: number; moved: boolean; offset: number; length: number; pointerId: number };

const EDGE_HIT_PX = 8;
const CLICK_SLOP_PX = 4;

function rangeToIndexes(dates: string[], range: DateRange | null | undefined): IndexRange | null {
  if (!range || dates.length === 0) return null;
  let start = dates.findIndex((date) => date >= range.start);
  let end = -1;
  for (let i = dates.length - 1; i >= 0; i -= 1) {
    if (dates[i] <= range.end) {
      end = i;
      break;
    }
  }
  if (start === -1 || end === -1 || end < start) return null;
  start = Math.max(0, start);
  return { start, end };
}

/**
 * Drag-to-select a date range across a time chart: press and drag to draw,
 * drag either edge to resize, drag inside to move. The minimum span is
 * enforced when the gesture ends. Keyboard growth lives in `grow`.
 */
export function useRangeSelection({
  dates,
  xs,
  selection,
  onRangeChange,
  minDays,
  enabled,
}: {
  dates: string[];
  xs: number[];
  selection: DateRange | null | undefined;
  onRangeChange?: (range: DateRange | null) => void;
  minDays: number;
  enabled: boolean;
}) {
  const [draft, setDraft] = useState<IndexRange | null>(null);
  const drag = useRef<DragState | null>(null);
  const committed = useMemo(() => rangeToIndexes(dates, selection), [dates, selection]);
  const shown = draft ?? committed;

  const enforceMin = useCallback(
    (range: IndexRange): IndexRange => {
      let { start, end } = range;
      const last = dates.length - 1;
      while (end < last && daysBetween(dates[start], dates[end]) + 1 < minDays) end += 1;
      while (start > 0 && daysBetween(dates[start], dates[end]) + 1 < minDays) start -= 1;
      return { start, end };
    },
    [dates, minDays],
  );

  const emit = useCallback(
    (range: IndexRange | null) => {
      if (!onRangeChange) return;
      if (!range) onRangeChange(null);
      else onRangeChange({ start: dates[range.start], end: dates[range.end] });
    },
    [dates, onRangeChange],
  );

  const hitTest = useCallback(
    (px: number): DragMode => {
      if (!committed) return "create";
      const x0 = xs[committed.start];
      const x1 = xs[committed.end];
      if (Math.abs(px - x0) <= EDGE_HIT_PX) return "start";
      if (Math.abs(px - x1) <= EDGE_HIT_PX) return "end";
      if (px > x0 && px < x1) return "move";
      return "create";
    },
    [committed, xs],
  );

  const localX = (event: ReactPointerEvent<Element>) => event.clientX - (event.currentTarget as Element).getBoundingClientRect().left;

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!enabled || event.button !== 0 || dates.length < 2) return;
      const px = localX(event);
      const index = nearestIndex(xs, px);
      const mode = hitTest(px);
      drag.current = {
        mode,
        anchor: mode === "start" ? committed!.end : mode === "end" ? committed!.start : index,
        originX: px,
        moved: false,
        offset: committed ? index - committed.start : 0,
        length: committed ? committed.end - committed.start : 0,
        pointerId: event.pointerId,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    },
    [committed, dates.length, enabled, hitTest, xs],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const state = drag.current;
      if (!state || state.pointerId !== event.pointerId) return;
      const px = localX(event);
      if (!state.moved && Math.abs(px - state.originX) < CLICK_SLOP_PX) return;
      state.moved = true;
      const index = nearestIndex(xs, px);
      if (state.mode === "move") {
        const last = dates.length - 1;
        const start = Math.max(0, Math.min(last - state.length, index - state.offset));
        setDraft({ start, end: start + state.length });
        return;
      }
      setDraft({ start: Math.min(state.anchor, index), end: Math.max(state.anchor, index) });
    },
    [dates.length, xs],
  );

  const finish = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>, cancelled: boolean) => {
      const state = drag.current;
      if (!state || state.pointerId !== event.pointerId) return;
      drag.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      const next = draft;
      setDraft(null);
      if (cancelled) return;
      if (!state.moved) {
        // A plain click outside the selection clears it.
        if (committed && state.mode === "create") emit(null);
        return;
      }
      if (next) emit(enforceMin(next));
    },
    [committed, draft, emit, enforceMin],
  );

  /** Keyboard: Shift+→ grows the end, Shift+← grows the start. */
  const grow = useCallback(
    (direction: -1 | 1, fromIndex: number) => {
      if (!enabled || dates.length < 2) return;
      const last = dates.length - 1;
      if (!committed) {
        if (direction === 1) {
          emit(enforceMin({ start: fromIndex, end: fromIndex }));
        } else {
          let start = fromIndex;
          while (start > 0 && daysBetween(dates[start], dates[fromIndex]) + 1 < minDays) start -= 1;
          emit(enforceMin({ start, end: fromIndex }));
        }
        return;
      }
      if (direction === 1) emit({ start: committed.start, end: Math.min(last, committed.end + 1) });
      else emit({ start: Math.max(0, committed.start - 1), end: committed.end });
    },
    [committed, dates, emit, enabled, enforceMin, minDays],
  );

  const cursorAt = useCallback(
    (px: number) => {
      if (!enabled) return undefined;
      const mode = hitTest(px);
      return mode === "start" || mode === "end" ? "ew-resize" : mode === "move" ? "grab" : "crosshair";
    },
    [enabled, hitTest],
  );

  return {
    range: shown,
    dragging: draft !== null,
    clear: () => emit(null),
    grow,
    cursorAt,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: ReactPointerEvent<SVGSVGElement>) => finish(event, false),
      onPointerCancel: (event: ReactPointerEvent<SVGSVGElement>) => finish(event, true),
    },
  };
}
