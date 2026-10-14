import { useCallback, useEffect, useRef, useState } from "react";

/** Width of an element, tracked with ResizeObserver. 0 until measured. */
export function useElementWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    setWidth(Math.floor(node.getBoundingClientRect().width));
    if (typeof ResizeObserver === "undefined") return;
    observer.current = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      setWidth((prev) => (prev === next ? prev : next));
    });
    observer.current.observe(node);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, width] as const;
}

function useMediaQuery(query: string) {
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener?.("change", onChange);
    return () => list.removeEventListener?.("change", onChange);
  }, [query]);
  return matches;
}

/** True on touch-first devices, where drag-to-select would fight scrolling. */
export function useCoarsePointer() {
  return useMediaQuery("(pointer: coarse)");
}

/** Hidden-series state shared by a chart and its legend. */
export function useSeriesVisibility(keys: string[]) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const toggle = useCallback(
    (key: string, isolate: boolean) => {
      setHidden((prev) => {
        if (isolate) {
          const onlyThis = keys.every((k) => (k === key ? !prev.has(k) : prev.has(k)));
          // Alt-click on the already isolated series shows everything again.
          return onlyThis ? new Set() : new Set(keys.filter((k) => k !== key));
        }
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else if (keys.filter((k) => !next.has(k)).length > 1) next.add(key);
        return next;
      });
    },
    [keys],
  );
  return { hidden, toggle };
}
