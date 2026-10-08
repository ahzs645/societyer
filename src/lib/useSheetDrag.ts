import { RefObject, useEffect, useRef, useState } from "react";
import { bottomSheetMediaQuery } from "./breakpoints";

/** iOS sheet curve (also what vaul / UIKit sheets use). */
export const SHEET_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

const DRAG_SLOP = 8;
/** Downward travel (px) that commits a dismiss on release. */
const DISMISS_DISTANCE = 96;
/** Fling speed (px/ms) that commits a dismiss even on a short drag. */
const DISMISS_VELOCITY = 0.45;

const NON_DRAG_TARGETS =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], [data-sheet-no-drag]";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** True when some scroller between the touch target and the sheet is not at
 * its top — the gesture belongs to that scroller, not to the sheet. */
function scrolledAncestor(target: Element | null, sheet: HTMLElement) {
  for (let el = target; el && el !== sheet.parentElement; el = el.parentElement) {
    if (el instanceof HTMLElement && el.scrollTop > 0) {
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") return true;
    }
    if (el === sheet) break;
  }
  return false;
}

/**
 * Swipe-down-to-dismiss for a bottom sheet (touch only). A drag starts from
 * anywhere on the sheet as long as the content under the finger is scrolled
 * to the top; the sheet follows the finger, the backdrop (the sheet's
 * previous sibling, when it is one) fades with it, and a long enough or fast
 * enough release slides the sheet out before calling `onDismiss`. Anything
 * shorter springs back.
 *
 * Desktop pointers are untouched: the hook only listens to touch events and
 * is inert while `enabled` is false.
 *
 * `handle` restricts where a drag may start (a selector matched against the
 * touch target; touches on the sheet element itself — its grabber
 * pseudo-element — also count). Use it for tall form sheets, where a swipe
 * in the body should only ever scroll.
 */
export function useSheetDrag(
  sheetRef: RefObject<HTMLElement | null>,
  { enabled, onDismiss, handle }: { enabled: boolean; onDismiss: () => void; handle?: string },
) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!enabled || !sheet) return;

    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let tracking = false;
    let dragging = false;
    let blocked = false;
    let closing = false;

    const backdrop = () => {
      const prev = sheet.previousElementSibling;
      return prev instanceof HTMLElement && /backdrop/.test(prev.className) ? prev : null;
    };

    const reset = (animate: boolean) => {
      const reduce = prefersReducedMotion();
      sheet.style.transition = animate && !reduce ? `transform 260ms ${SHEET_EASING}` : "";
      sheet.style.transform = "";
      const bd = backdrop();
      if (bd) {
        bd.style.transition = animate && !reduce ? `opacity 260ms ${SHEET_EASING}` : "";
        bd.style.opacity = "";
      }
      if (animate) {
        window.setTimeout(() => {
          if (!dragging && !closing) sheet.style.transition = "";
        }, 280);
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      if (closing || event.touches.length !== 1) {
        tracking = false;
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = lastY = touch.clientY;
      lastT = event.timeStamp;
      velocity = 0;
      tracking = true;
      dragging = false;
      const offHandle = Boolean(handle) && target !== sheet && !target?.closest(handle!);
      blocked = offHandle
        || Boolean(target?.closest(NON_DRAG_TARGETS))
        || scrolledAncestor(target, sheet);
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking || blocked || closing) return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (!dragging) {
        if (Math.abs(dx) > DRAG_SLOP && Math.abs(dx) > Math.abs(dy)) {
          tracking = false;
          return;
        }
        // Upward movement is a normal content scroll.
        if (dy < -DRAG_SLOP) {
          tracking = false;
          return;
        }
        if (dy < DRAG_SLOP) return;
        dragging = true;
        sheet.style.transition = "none";
        sheet.classList.add("is-sheet-dragging");
      }
      if (event.cancelable) event.preventDefault();
      const dt = Math.max(1, event.timeStamp - lastT);
      velocity = (touch.clientY - lastY) / dt;
      lastY = touch.clientY;
      lastT = event.timeStamp;
      const offset = Math.max(0, dy - DRAG_SLOP);
      sheet.style.transform = `translate3d(0, ${offset}px, 0)`;
      const bd = backdrop();
      if (bd) {
        bd.style.transition = "none";
        bd.style.opacity = String(Math.max(0, 1 - offset / Math.max(1, sheet.offsetHeight)));
      }
    };

    const onTouchEnd = () => {
      if (!dragging) {
        tracking = false;
        return;
      }
      dragging = false;
      tracking = false;
      sheet.classList.remove("is-sheet-dragging");
      // A drag that ends over a row must not also "tap" it.
      const swallowClick = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
      };
      sheet.addEventListener("click", swallowClick, { capture: true, once: true });
      window.setTimeout(() => sheet.removeEventListener("click", swallowClick, { capture: true }), 350);

      const offset = Math.max(0, lastY - startY - DRAG_SLOP);
      const commit = offset > Math.min(DISMISS_DISTANCE, sheet.offsetHeight * 0.35)
        || (velocity > DISMISS_VELOCITY && offset > 24);
      if (!commit) {
        reset(true);
        return;
      }
      closing = true;
      if (prefersReducedMotion()) {
        dismissRef.current();
        return;
      }
      sheet.style.transition = `transform 220ms ${SHEET_EASING}`;
      sheet.style.transform = `translate3d(0, ${sheet.offsetHeight + 24}px, 0)`;
      const bd = backdrop();
      if (bd) {
        bd.style.transition = `opacity 220ms ${SHEET_EASING}`;
        bd.style.opacity = "0";
      }
      window.setTimeout(() => dismissRef.current(), 200);
    };

    const onTouchCancel = () => {
      if (dragging) {
        sheet.classList.remove("is-sheet-dragging");
        reset(true);
      }
      dragging = false;
      tracking = false;
    };

    sheet.addEventListener("touchstart", onTouchStart, { passive: true });
    sheet.addEventListener("touchmove", onTouchMove, { passive: false });
    sheet.addEventListener("touchend", onTouchEnd);
    sheet.addEventListener("touchcancel", onTouchCancel);
    return () => {
      sheet.removeEventListener("touchstart", onTouchStart);
      sheet.removeEventListener("touchmove", onTouchMove);
      sheet.removeEventListener("touchend", onTouchEnd);
      sheet.removeEventListener("touchcancel", onTouchCancel);
      sheet.classList.remove("is-sheet-dragging");
      sheet.style.transition = "";
      sheet.style.transform = "";
      const bd = backdrop();
      if (bd) {
        bd.style.transition = "";
        bd.style.opacity = "";
      }
    };
  }, [enabled, sheetRef, handle]);
}

/** Tracks a media query (SSR-safe, follows resizes / rotation). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** True below the bottom-sheet breakpoint (phones). */
export function useIsBottomSheet(): boolean {
  return useMediaQuery(bottomSheetMediaQuery);
}
