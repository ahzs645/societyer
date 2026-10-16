import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/**
 * One shared stack per overlay family. A layer that opens while others are
 * open takes the slot above the highest open one, so a calendar opened from
 * a date-range sheet, or a select opened inside a sheet, always paints (and
 * dims) above the layer it came from — even though every layer portals into
 * the same `document.body`.
 *
 * - `dialog`: Modal and its confirm/prompt variants (z 1000 + 2n).
 * - `floating`: menus, selects, calendars, range pickers and notification
 *   sheets (z-dropdown + 2n), which must clear the dialog band.
 */
type OverlayFamily = "dialog" | "floating";

const openSlots: Record<OverlayFamily, number[]> = { dialog: [], floating: [] };

function useStackSlot(open: boolean, family: OverlayFamily) {
  const [slot, setSlot] = useState(0);
  const slotRef = useRef(0);
  // A layout effect, so the first painted frame already has its slot.
  useLayoutEffect(() => {
    if (!open) return;
    const slots = openSlots[family];
    const mine = (slots.length ? Math.max(...slots) : 0) + 1;
    slots.push(mine);
    slotRef.current = mine;
    setSlot(mine);
    return () => {
      const index = slots.indexOf(mine);
      if (index >= 0) slots.splice(index, 1);
      slotRef.current = 0;
    };
  }, [open, family]);
  return { slot, slotRef };
}

export function useOverlayStackSlot(open: boolean, family: OverlayFamily): number {
  return useStackSlot(open, family).slot;
}

export type FloatingLayerStack = {
  /** z-index for the panel itself. */
  panel: CSSProperties | undefined;
  /** z-index for its dimming backdrop, just under the panel. */
  backdrop: CSSProperties | undefined;
  /**
   * True while this layer is the topmost open floating layer. Document-level
   * key handlers check it, so Esc closes only the layer on top (a select
   * opened from a sheet, not the sheet as well).
   */
  isTop: () => boolean;
};

/**
 * Stacking for a floating panel and its (sheet) backdrop. Each nested layer
 * gets its own band above the one it opened from, so its backdrop dims the
 * layer underneath and swallows taps meant to dismiss it.
 */
export function useFloatingLayerStack(open: boolean): FloatingLayerStack {
  const { slot, slotRef } = useStackSlot(open, "floating");
  const isTop = useCallback(() => {
    const mine = slotRef.current;
    const slots = openSlots.floating;
    return mine > 0 && mine === Math.max(...slots);
  }, [slotRef]);
  if (!slot) return { panel: undefined, backdrop: undefined, isTop };
  return {
    panel: { zIndex: `calc(var(--z-dropdown) + ${slot * 2})` },
    backdrop: { zIndex: `calc(var(--z-dropdown) + ${slot * 2 - 1})` },
    isTop,
  };
}
