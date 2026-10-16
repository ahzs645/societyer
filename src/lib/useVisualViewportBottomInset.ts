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

/** Devices with an on-screen keyboard (desktop pinch-zoom must not move dialogs). */
export function hasTouchScreen() {
  return typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
}

/**
 * Style for a centred (tablet/desktop) dialog while the keyboard is open:
 * fit the dialog inside the visible area above the keyboard instead of
 * centring it on the full screen, where its lower fields and footer sit
 * behind the keyboard.
 */
export function keyboardDialogStyle(frame: VisualViewportFrame, { centredByTransform }: { centredByTransform: boolean }, gap = 12) {
  if (frame.bottomInset <= 0 || frame.height <= 0) return null;
  const visibleTop = Math.max(0, window.innerHeight - frame.height - frame.bottomInset);
  const maxHeight = Math.max(160, frame.height - gap * 2);
  return {
    top: visibleTop + gap,
    bottom: "auto",
    maxHeight: `${maxHeight}px`,
    // Explicitly sized (resizable) dialogs keep their width but give up height.
    ...(centredByTransform ? { transform: "translateX(-50%)" } : { height: "auto" }),
  };
}

const TYPING_SELECTOR = [
  "input:not([type=button]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=reset]):not([type=file]):not([type=range]):not([type=color]):not([type=hidden])",
  "textarea",
  "select",
].join(", ");

/** Overlays whose own scroll areas must bring a focused field back into view. */
const OVERLAY_SCOPE = '[role="dialog"], .inspector, .drawer, .global-ai-shell, .kbar-backdrop, .calendar, .menu';

function isTyping(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && (element.isContentEditable || element.matches(TYPING_SELECTOR));
}

let keyboardTrackers = 0;
let stopKeyboardTracking: (() => void) | null = null;

function startKeyboardTracking(): () => void {
  const viewport = window.visualViewport;
  // Without a touch screen there is no on-screen keyboard; a pinch-zoomed
  // desktop window would otherwise read as one and lift every overlay.
  if (!viewport || !hasTouchScreen()) return () => {};
  const root = document.documentElement;
  let frame = 0;
  let lastVisible = Math.round(viewport.height);
  // Window size with no keyboard up. With `interactive-widget=resizes-content`
  // Android shrinks the window itself for the keyboard (an inset of 0), so a
  // much shorter window at the same width while typing means "keyboard".
  let baseline = { width: window.innerWidth, height: window.innerHeight };
  const clear = () => {
    root.style.removeProperty("--keyboard-inset");
    root.style.removeProperty("--visible-height");
    root.removeAttribute("data-keyboard-open");
  };
  const apply = () => {
    frame = 0;
    const active = document.activeElement;
    const typing = isTyping(active);
    const { innerWidth: width, innerHeight: height } = window;
    if (!typing || width !== baseline.width) baseline = { width, height };
    const inset = typing ? Math.max(0, Math.round(height - viewport.height - viewport.offsetTop)) : 0;
    const resized = typing && baseline.height - height > 120;
    const visible = Math.round(viewport.height);
    if (inset > 0 || resized) {
      root.style.setProperty("--keyboard-inset", `${inset}px`);
      root.style.setProperty("--visible-height", `${visible}px`);
      root.setAttribute("data-keyboard-open", "");
    } else {
      clear();
    }
    // The visible area shrank under a focused field inside an overlay: once
    // the overlay has re-laid out above the keyboard (CSS variables apply at
    // once, React-driven sheets on their next commit), scroll its own scroll
    // area so the field is not typed into blind.
    if ((inset > 0 || resized) && visible < lastVisible - 40 && isTyping(active) && active.closest(OVERLAY_SCOPE)) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        if (document.activeElement === active) active.scrollIntoView({ block: "nearest", inline: "nearest" });
      }));
    }
    lastVisible = visible;
  };
  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(apply);
  };
  viewport.addEventListener("resize", schedule);
  viewport.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  document.addEventListener("focusin", schedule);
  document.addEventListener("focusout", schedule);
  apply();
  return () => {
    window.cancelAnimationFrame(frame);
    viewport.removeEventListener("resize", schedule);
    viewport.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    document.removeEventListener("focusin", schedule);
    document.removeEventListener("focusout", schedule);
    clear();
  };
}

/**
 * Publishes the on-screen keyboard on the root element while a text field
 * has focus, for overlays that are positioned in CSS:
 *
 * - `--keyboard-inset`: layout-viewport px covered by the keyboard;
 * - `--visible-height`: height of the visible area above it;
 * - `[data-keyboard-open]` on <html>.
 *
 * Both variables are unset while no keyboard is up, so rules read them with
 * a fallback (`var(--keyboard-inset, 0px)`, `var(--visible-height, 100dvh)`).
 * Android with `interactive-widget=resizes-content` shrinks the layout
 * viewport instead, which reads as an inset of 0. When the visible area
 * shrinks, the focused field inside an overlay is scrolled back into view.
 *
 * Any number of components may call it; one listener serves them all.
 */
export function useKeyboardInsetTracking(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    keyboardTrackers += 1;
    if (keyboardTrackers === 1) stopKeyboardTracking = startKeyboardTracking();
    return () => {
      keyboardTrackers -= 1;
      if (keyboardTrackers === 0) {
        stopKeyboardTracking?.();
        stopKeyboardTracking = null;
      }
    };
  }, [enabled]);
}
