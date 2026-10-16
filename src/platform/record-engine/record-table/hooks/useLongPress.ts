import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

/** How long a finger must rest on a row before it counts as a long-press. */
export const LONG_PRESS_MS = 480;
/** A finger that travels further than this is scrolling, not pressing. */
const MOVE_TOLERANCE_PX = 10;

/**
 * Touch long-press for list rows: holding a finger on a row starts selection
 * (the way phone lists do) instead of opening it. Only touch and pen count;
 * a mouse keeps its click and right-click. The click (and the Android
 * context menu) that the same press leaves behind are swallowed, so the row
 * does not also open. Spread the returned handlers on the row element.
 */
export function useLongPress(onLongPress: (() => void) | undefined) {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  // Set when a press fires; the click from lifting that finger is eaten.
  // The next finger down starts a fresh gesture and clears it.
  const swallowClickRef = useRef(false);
  const callbackRef = useRef(onLongPress);
  callbackRef.current = onLongPress;

  const cancel = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    startRef.current = null;
  };
  useEffect(() => cancel, []);

  const fire = () => {
    cancel();
    swallowClickRef.current = true;
    try {
      navigator.vibrate?.(12);
    } catch {
      // Vibration is a nicety; some browsers throw without a gesture.
    }
    callbackRef.current?.();
  };

  if (!onLongPress) return {};

  return {
    onPointerDown: (event: ReactPointerEvent) => {
      swallowClickRef.current = false;
      if (event.pointerType === "mouse" || !event.isPrimary) return;
      cancel();
      startRef.current = { x: event.clientX, y: event.clientY };
      timerRef.current = window.setTimeout(fire, LONG_PRESS_MS);
    },
    onPointerMove: (event: ReactPointerEvent) => {
      const start = startRef.current;
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClickCapture: (event: ReactMouseEvent) => {
      if (!swallowClickRef.current) return;
      swallowClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onContextMenuCapture: (event: ReactMouseEvent) => {
      // Android raises a context menu for the same press; selection wins.
      const pressing = timerRef.current !== null;
      if (!pressing && !swallowClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      if (pressing) fire();
    },
  };
}
