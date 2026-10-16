import { useEffect, useState } from "react";

export type VisualViewportFrame = {
  /** Layout-viewport px covered by the on-screen keyboard (0 when closed). */
  bottomInset: number;
  /** Height of the visible area (the visual viewport), in px. */
  height: number;
};

/**
 * Where the visible area sits while the on-screen keyboard is open.
 *
 * Fixed-position elements anchor to the layout viewport, which iOS does NOT
 * shrink when the keyboard opens — so `bottom: 0` overlays (bottom sheets)
 * end up behind the keyboard. Offsetting them by `bottomInset` keeps them
 * visible, the same way Researcher keeps its cell pickers inside the
 * visible viewport on mobile. Cap their height with `height` too: `100vh`
 * and `100dvh` stay the full screen while the keyboard is up, so a sheet
 * sized from them runs off the top of the screen.
 */
export function useVisualViewportFrame(enabled = true): VisualViewportFrame {
  const [frame, setFrame] = useState<VisualViewportFrame>({ bottomInset: 0, height: 0 });

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!enabled || !viewport) {
      setFrame({ bottomInset: 0, height: 0 });
      return;
    }
    const update = () => {
      const bottomInset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
      const height = Math.round(viewport.height);
      setFrame((current) => (current.bottomInset === bottomInset && current.height === height ? current : { bottomInset, height }));
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [enabled]);

  return frame;
}

/** Height in px of the layout viewport covered by the on-screen keyboard. */
export function useVisualViewportBottomInset(enabled = true): number {
  return useVisualViewportFrame(enabled).bottomInset;
}

/**
 * Style for a bottom sheet while the keyboard is open: sit on top of the
 * keyboard and fit the visible area, leaving a small gap at the top.
 */
export function keyboardSheetStyle(frame: VisualViewportFrame, topGap = 12): { bottom: number; maxHeight: string } | null {
  if (frame.bottomInset <= 0 || frame.height <= 0) return null;
  return { bottom: frame.bottomInset, maxHeight: `${Math.max(120, frame.height - topGap)}px` };
}
