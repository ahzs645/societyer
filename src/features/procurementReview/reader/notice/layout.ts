/**
 * How the notice page lays itself out, from its own width rather than the
 * window's: the same page shows at full width, in the list's right-hand pane
 * on a wide desktop (about 800px), and on a phone, and only its width says
 * which of those it is in.
 *
 * - wide: the content beside a sticky rail of facts and the buyer contact;
 * - stacked: one column, the key facts in a strip under the header, every
 *   detail laid out after the documents;
 * - narrow (phones): as stacked, under a compact app bar, the details folded
 *   at the end, and Classify and the buyer's site in a bar at the bottom.
 *
 * Measured before paint (a layout effect), so the page never shows in the
 * wrong layout first.
 */
import { useLayoutEffect, useState } from "react";

export type NoticeLayout = "wide" | "stacked" | "narrow";

/** Room for a readable main column (~36rem) beside the 18rem rail. */
const WIDE_MIN = 900;
/** Phones; matches the reader's phone breakpoint (--bp-bottom-sheet). */
const NARROW_MAX = 560;

export const layoutFor = (width: number): NoticeLayout => (width >= WIDE_MIN ? "wide" : width <= NARROW_MAX ? "narrow" : "stacked");

/** The layout for `node` (the page's root), following its width as it changes. */
export function useNoticeLayout(node: HTMLElement | null): NoticeLayout {
  const [layout, setLayout] = useState<NoticeLayout>(() => layoutFor(typeof window === "undefined" ? WIDE_MIN : window.innerWidth));
  useLayoutEffect(() => {
    if (!node) return;
    const measure = () => {
      const width = node.getBoundingClientRect().width;
      // A covered or not yet laid out page measures 0; keep the last layout.
      if (width > 0) setLayout(layoutFor(width));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return layout;
}
