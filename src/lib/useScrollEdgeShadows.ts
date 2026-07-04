import { useCallback, useEffect, useState } from "react";

// Tracks whether a horizontally-scrollable element has more content off either
// edge, so a caller can show "there's more →" fade shadows. Without this cue a
// frozen-first-column table (especially on a phone, where the frozen column
// eats most of the width) looks truncated rather than scrollable.
//
// Returns a callback `ref` to attach to the scroll container. A callback ref
// (rather than a passed-in RefObject) is deliberate: the container often mounts
// a render or two after this hook first runs — e.g. behind a loading state —
// and a callback ref re-fires exactly when the node attaches, so the observers
// bind to the real element instead of silently no-op'ing on a null ref.
export type ScrollEdges = { left: boolean; right: boolean };

export function useScrollEdgeShadows(): {
  edges: ScrollEdges;
  ref: (node: HTMLElement | null) => void;
} {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [edges, setEdges] = useState<ScrollEdges>({ left: false, right: false });

  useEffect(() => {
    if (!node) return;
    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = node;
      setEdges({
        left: scrollLeft > 0,
        // -1 to absorb sub-pixel rounding when scrolled fully to the end.
        right: scrollLeft + clientWidth < scrollWidth - 1,
      });
    };
    update();
    // The container's own client width never changes as the inner table grows
    // to its max-content width, so observing only the container misses the
    // moment it becomes scrollable. Observe the content too, and re-check next
    // frame once layout has settled.
    const raf = requestAnimationFrame(update);
    node.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => {
      cancelAnimationFrame(raf);
      node.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [node]);

  const ref = useCallback((next: HTMLElement | null) => setNode(next), []);

  return { edges, ref };
}
