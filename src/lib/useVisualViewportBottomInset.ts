import { useEffect, useState } from "react";

/**
 * Height in px of the layout viewport covered by the on-screen keyboard —
 * the gap between the layout viewport's bottom and the visual viewport's
 * bottom. 0 when the keyboard is closed (or visualViewport is unsupported).
 *
 * Fixed-position elements anchor to the layout viewport, which iOS does NOT
 * shrink when the keyboard opens — so `bottom: 0` overlays (bottom sheets)
 * end up behind the keyboard. Offsetting them by this inset keeps them
 * visible, the same way Researcher keeps its cell pickers inside the
 * visible viewport on mobile.
 */
export function useVisualViewportBottomInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const next = window.innerHeight - viewport.height - viewport.offsetTop;
      setInset(Math.max(0, Math.round(next)));
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
