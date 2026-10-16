import { useLayoutEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = "a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex='-1'])";

/**
 * Marks the control a dialog focuses when it opens. React never renders the
 * `autoFocus` prop as an attribute, so `[autofocus]` alone matches nothing;
 * put `data-autofocus` on the target instead (autoFocus keeps working too).
 */
export const AUTOFOCUS_SELECTOR = "[data-autofocus]:not([disabled]), [autofocus]:not([disabled])";

export function getDialogFocusables(root: HTMLElement | null) {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.tabIndex >= 0 && !element.closest("[inert]") &&
      element.getAttribute("aria-hidden") !== "true" && element.getClientRects().length > 0,
  );
}

/**
 * Move focus to the control after (or before) `from`, as Tab would from there,
 * within its dialog or the page. Popups that close on Tab use it so the key
 * still moves on instead of dropping focus at the end of <body>.
 */
export function focusAdjacentTo(from: HTMLElement | null, backwards = false) {
  if (!from?.isConnected) return;
  const root = from.closest<HTMLElement>('dialog,[role="dialog"]') ?? document.body;
  const focusable = getDialogFocusables(root);
  const index = focusable.indexOf(from);
  if (index < 0 || focusable.length === 0) {
    from.focus({ preventScroll: true });
    return;
  }
  focusable[(index + (backwards ? -1 : 1) + focusable.length) % focusable.length]?.focus({ preventScroll: true });
}

const TEXT_ENTRY_SELECTOR = [
  "textarea:not([readonly]):not([disabled])",
  "input:not([readonly]):not([disabled]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=reset]):not([type=file]):not([type=range]):not([type=color]):not([type=hidden])",
].join(", ");

/**
 * Escape while typing in a panel's field leaves the field instead of closing
 * the panel: fields that save on blur (a transaction note) save, and text not
 * yet submitted (a checklist step) stays on screen. A second Escape closes.
 *
 * Focus moves to the field's dialog (or nowhere) after the field's own
 * Escape handling has rendered, so a field that resets itself on Escape
 * commits the reset value, not the abandoned one. Returns true when the key
 * was taken.
 */
export function leaveTextFieldOnEscape(target: EventTarget | null, container: Element | null): boolean {
  if (!(target instanceof HTMLElement) || !container?.contains(target)) return false;
  if (!target.isContentEditable && !target.matches(TEXT_ENTRY_SELECTOR)) return false;
  window.setTimeout(() => {
    if (document.activeElement !== target && !target.contains(document.activeElement)) return;
    const dialog = target.parentElement?.closest<HTMLElement>('dialog,[role="dialog"]');
    if (dialog?.hasAttribute("tabindex")) dialog.focus({ preventScroll: true });
    else (document.activeElement as HTMLElement | null)?.blur();
  }, 0);
  return true;
}

type DialogFocusOptions = {
  /** Esc in a text field first leaves the field (see leaveTextFieldOnEscape). */
  escapeLeavesTextField?: boolean;
};

/** Keep dialog keyboard handling with the nearest overlay, including portals. */
export function useDialogFocus<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  initialFocus?: string,
  { escapeLeavesTextField = false }: DialogFocusOptions = {},
) {
  const ref = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // The control that opened the dialog, read during the opening render:
  // React commits `autoFocus` children before any effect runs, so by the
  // time an effect looks, focus already sits inside the dialog and the
  // opener is gone. Re-renders while open (and StrictMode's re-run effects)
  // keep the first value.
  const openerRef = useRef<{ open: boolean; element: HTMLElement | null }>({ open: false, element: null });
  if (open && !openerRef.current.open) {
    const active = typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    openerRef.current = { open: true, element: active && !ref.current?.contains(active) ? active : null };
  } else if (!open && openerRef.current.open) {
    openerRef.current = { open: false, element: null };
  }

  useLayoutEffect(() => {
    if (!open) return;
    // A stand-in that held focus while this dialog's chunk loaded (the
    // command palette's loading field) is gone by now and has handed focus
    // back to the real opener; take that instead.
    if (!openerRef.current.element?.isConnected) {
      const active = document.activeElement;
      openerRef.current.element = active instanceof HTMLElement && !ref.current?.contains(active) ? active : null;
    }
    const previous = openerRef.current.element;
    const timer = window.setTimeout(() => {
      const root = ref.current;
      if (!root) return;
      // 1. A `data-autofocus` marker in the content.
      const marked = root.querySelector<HTMLElement>(AUTOFOCUS_SELECTOR);
      if (marked) {
        marked.focus({ preventScroll: true });
        return;
      }
      // 2. An `autoFocus` child already took focus during the commit; keep it.
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== root && root.contains(active)) return;
      // 3. The dialog's own default target, then its first control.
      const fallback = initialFocus ? root.querySelector<HTMLElement>(initialFocus) : null;
      (fallback ?? getDialogFocusables(root)[0] ?? root).focus({ preventScroll: true });
    }, 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !ref.current) return;
      const target = event.target instanceof Element ? event.target : null;
      const overlay = target?.closest('dialog,[role="dialog"]') ?? target?.closest('[role="listbox"],[role="menu"]');
      // A nested calendar, menu, or modal can live outside its parent's DOM.
      // Its own handler owns Escape and Tab while it has keyboard focus.
      if (overlay && overlay !== ref.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (escapeLeavesTextField && leaveTextFieldOnEscape(event.target, ref.current)) return;
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
          ? document.activeElement.closest('dialog,[role="dialog"],[role="listbox"],[role="menu"]') : null;
        if (activeOverlay && !activeOverlay.contains(previous)) { observer.disconnect(); window.clearTimeout(expiry); return; }
        if (previous.closest("[inert]")) return;
        observer.disconnect();
        window.clearTimeout(expiry);
        previous.focus({ preventScroll: true });
      }
      observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["inert"], childList: true });
      window.requestAnimationFrame(restore);
    };
  }, [open, initialFocus, escapeLeavesTextField]);
  return ref;
}
