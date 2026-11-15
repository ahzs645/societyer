import { useRef, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { nearestIndex } from "./scales";
import type { TimeRow } from "./types";

/**
 * Choosing one point of a time chart to open what's behind it: a click that
 * isn't the end of a drag, or Enter on the point the arrow keys reached. On
 * touch the first tap only shows the point's values (as hovering does), so
 * reading a value never opens something; a second tap on it opens it.
 */
export function usePointSelect({ data, xs, active, setActive, coarse, onSelect, canSelect }: {
  data: TimeRow[];
  xs: number[];
  active: number | null;
  setActive: (index: number) => void;
  coarse: boolean;
  onSelect?: (row: TimeRow, index: number) => void;
  canSelect?: (row: TimeRow, index: number) => boolean;
}) {
  // Where the press began and which point was showing then.
  const press = useRef<{ x: number; shown: number | null } | null>(null);
  const selects = (index: number | null): index is number =>
    !!onSelect && index != null && index >= 0 && index < data.length && (canSelect?.(data[index], index) ?? true);
  const localX = (event: ReactMouseEvent<SVGSVGElement>) => event.clientX - event.currentTarget.getBoundingClientRect().left;
  return {
    enabled: !!onSelect,
    /** Whether the point under the pointer opens something, for the cursor. */
    activeSelects: selects(active),
    onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => {
      press.current = { x: localX(event), shown: active };
    },
    onClick: (event: ReactMouseEvent<SVGSVGElement>) => {
      const start = press.current;
      press.current = null;
      if (!onSelect) return;
      const px = localX(event);
      if (start && Math.abs(px - start.x) > 4) return;
      const index = nearestIndex(xs, px);
      if (coarse && start?.shown !== index) setActive(index);
      else if (selects(index)) onSelect(data[index], index);
    },
    /** Enter on the reached point; true when it was handled. */
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" || !selects(active)) return false;
      event.preventDefault();
      onSelect!(data[active], active);
      return true;
    },
  };
}
