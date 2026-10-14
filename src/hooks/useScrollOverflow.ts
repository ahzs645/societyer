import { useEffect, useState, type RefObject } from "react";

export type ScrollOverflow = "none" | "start" | "end" | "both";

/**
 * Which edge of a sideways-scrolling row has content out of sight, so the
 * row can fade that edge ("swipe for more") and leave a row that fits alone.
 */
export function useScrollOverflow(ref: RefObject<HTMLElement | null>, deps: readonly unknown[] = []): ScrollOverflow {
  const [overflow, setOverflow] = useState<ScrollOverflow>("none");
  useEffect(() => {
    const list = ref.current;
    if (!list) return;
    const measure = () => {
      const max = list.scrollWidth - list.clientWidth;
      const atStart = list.scrollLeft <= 1;
      const atEnd = list.scrollLeft >= max - 1;
      setOverflow(max <= 1 ? "none" : atStart ? "end" : atEnd ? "start" : "both");
    };
    measure();
    list.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(list);
    return () => {
      list.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return overflow;
}
