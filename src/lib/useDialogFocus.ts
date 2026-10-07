import { useLayoutEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = "a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex='-1'])";

export function getDialogFocusables(root: HTMLElement | null) {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.tabIndex >= 0 && !element.closest("[inert]") &&
      element.getAttribute("aria-hidden") !== "true" && element.getClientRects().length > 0,
  );
}

/** Keep dialog keyboard handling with the nearest overlay, including portals. */
export function useDialogFocus<T extends HTMLElement>(open: boolean, onClose: () => void, initialFocus?: string) {
  const ref = useRef<T | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Layout effects re-run while the dialog stays open (StrictMode, or a
    // Suspense boundary inside it re-revealing). Focus is already inside the
    // dialog then; keep returning to the control that opened it.
    const previous = active && ref.current?.contains(active) ? returnFocusRef.current : active;
    returnFocusRef.current = previous;
    const timer = window.setTimeout(() => {
      const initial = initialFocus ? ref.current?.querySelector<HTMLElement>(initialFocus) : null;
      (initial ?? ref.current?.querySelector<HTMLElement>("[autofocus]") ?? getDialogFocusables(ref.current)[0] ?? ref.current)?.focus({ preventScroll: true });
    }, 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !ref.current) return;
      const target = event.target instanceof Element ? event.target : null;
      const overlay = target?.closest('dialog,[role="dialog"]') ?? target?.closest('[role="listbox"]');
      // A nested calendar, menu, or modal can live outside its parent's DOM.
      // Its own handler owns Escape and Tab while it has keyboard focus.
      if (overlay && overlay !== ref.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      } else if (event.key === "Tab") {
        const focusable = getDialogFocusables(ref.current);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (!first) {
          event.preventDefault();
          ref.current.focus({ preventScroll: true });
        } else if (event.shiftKey && (active === first || !ref.current.contains(active))) {
          event.preventDefault();
          last.focus({ preventScroll: true });
        } else if (!event.shiftKey && (active === last || !ref.current.contains(active))) {
          event.preventDefault();
          first.focus({ preventScroll: true });
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      // Mobile inspector closure also clears the shell's inert state. Restore
      // after that commit, without stealing focus from a newly opened overlay.
      const observer = new MutationObserver(restore);
      const expiry = window.setTimeout(() => observer.disconnect(), 1000);
      function restore() {
        if (!previous?.isConnected) { observer.disconnect(); window.clearTimeout(expiry); return; }
        const activeOverlay = document.activeElement instanceof Element
          ? document.activeElement.closest('dialog,[role="dialog"],[role="listbox"]') : null;
        if (activeOverlay && !activeOverlay.contains(previous)) { observer.disconnect(); window.clearTimeout(expiry); return; }
        if (previous.closest("[inert]")) return;
        observer.disconnect();
        window.clearTimeout(expiry);
        previous.focus({ preventScroll: true });
      }
      observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["inert"], childList: true });
      window.requestAnimationFrame(restore);
    };
  }, [open, initialFocus]);
  return ref;
}
