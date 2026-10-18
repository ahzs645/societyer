import { RefObject, useEffect, useRef, useState } from "react";
import { bottomSheetMediaQuery } from "./breakpoints";

/**
 * Phones only use a bottom sheet for lists longer than this (or ones with a
 * search box). A couple of actions read better as a small popover anchored
 * to their trigger, like native context menus.
 */
export const SHEET_MIN_ITEMS = 6;

/**
 * A phone sheet listing more options than this gets a search field by
 * default (Select), so a province or category is a few letters away rather
 * than a long scroll. Pages opt out with `searchable={false}`.
 */
export const SHEET_SEARCH_MIN_ITEMS = 12;

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
 * A second, taller resting height for a sheet (iOS's medium and large
 * detents). The sheet's CSS gives both heights: its collapsed `height`, and
 * a `max-height` that the expanded state also uses as its height.
 */
export type SheetExpandDetent = {
  /** True while the sheet rests at its full height. */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** Where an upward drag may start (grabber, header); see `handle`. */
  handle: string;
};

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
 *
 * `expand` adds a full-height detent: an upward drag from `expand.handle`
 * grows the collapsed sheet to its `max-height`, and a downward drag on the
 * expanded sheet settles it back to the collapsed height (or, past half its
 * height, dismisses it). Content still scrolls normally in both states.
 */
export function useSheetDrag(
  sheetRef: RefObject<HTMLElement | null>,
  { enabled, onDismiss, handle, expand }: {
    enabled: boolean;
    onDismiss: () => void;
    handle?: string;
    expand?: SheetExpandDetent;
  },
) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const expandRef = useRef(expand);
  expandRef.current = expand;
  const expandHandle = expand?.handle;

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
    // "pull" moves the sheet down (dismiss, or collapse when expanded);
    // "grow" raises a collapsed sheet's top edge toward full height.
    let mode: "pull" | "grow" = "pull";
    let onExpandHandle = false;
    let startHeight = 0;
    let maxHeight = 0;

    const settle = (fn: () => void) => window.setTimeout(() => {
      if (!dragging && !closing) fn();
    }, 280);

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
      mode = "pull";
      onExpandHandle = Boolean(expandHandle) && (target === sheet || Boolean(target?.closest(expandHandle!)));
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
        // Upward movement is a normal content scroll, unless it starts on the
        // expand handle of a collapsed sheet.
        if (dy < -DRAG_SLOP) {
          if (!onExpandHandle || !expandRef.current || expandRef.current.expanded) {
            tracking = false;
            return;
          }
          mode = "grow";
          startHeight = sheet.offsetHeight;
          maxHeight = parseFloat(getComputedStyle(sheet).maxHeight) || window.innerHeight;
        } else if (dy < DRAG_SLOP) {
          return;
        }
        dragging = true;
        sheet.style.transition = "none";
        sheet.classList.add("is-sheet-dragging");
      }
      if (event.cancelable) event.preventDefault();
      const dt = Math.max(1, event.timeStamp - lastT);
      velocity = (touch.clientY - lastY) / dt;
      lastY = touch.clientY;
      lastT = event.timeStamp;
      if (mode === "grow") {
        // The CSS max-height caps the growth at full height.
        sheet.style.height = `${startHeight + Math.max(0, -dy - DRAG_SLOP)}px`;
        return;
      }
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

      const reduce = prefersReducedMotion();
      const detent = expandRef.current;
      if (mode === "grow") {
        const room = Math.max(1, maxHeight - startHeight);
        const grown = sheet.offsetHeight - startHeight;
        const commit = grown > room * 0.3 || (velocity < -DISMISS_VELOCITY && grown > 16);
        sheet.style.transition = reduce ? "" : `height 260ms ${SHEET_EASING}`;
        sheet.style.height = `${commit ? maxHeight : startHeight}px`;
        if (commit) detent?.onExpandedChange(true);
        // Hand the height back to the stylesheet once the spring settles.
        settle(() => {
          sheet.style.transition = "";
          sheet.style.height = "";
        });
        return;
      }

      const offset = Math.max(0, lastY - startY - DRAG_SLOP);
      if (detent?.expanded && offset <= sheet.offsetHeight * 0.5) {
        // Expanded: a short pull springs back, a longer one (or a flick)
        // settles at the collapsed height; only a long pull dismisses.
        const collapse = offset > 48 || (velocity > DISMISS_VELOCITY && offset > 24);
        reset(true);
        if (collapse) {
          if (!reduce) sheet.style.transition = `transform 260ms ${SHEET_EASING}, height 260ms ${SHEET_EASING}`;
          detent.onExpandedChange(false);
        }
        return;
      }
      const commit = offset > Math.min(DISMISS_DISTANCE, sheet.offsetHeight * 0.35)
        || (velocity > DISMISS_VELOCITY && offset > 24);
      if (!commit) {
        reset(true);
        return;
      }
      closing = true;
      if (reduce) {
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
        sheet.style.height = "";
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
      sheet.style.height = "";
      const bd = backdrop();
      if (bd) {
        bd.style.transition = "";
        bd.style.opacity = "";
      }
    };
  }, [enabled, sheetRef, handle, expandHandle]);
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
