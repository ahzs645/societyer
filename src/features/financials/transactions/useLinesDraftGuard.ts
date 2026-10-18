import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "../../../components/Toast";
import { isTypingTarget } from "../../../lib/shortcutsRegistry";
import { TRANSACTION_PANEL_SELECTOR } from "./transactionHotkeyTarget";

/**
 * Keeps the transaction panel on its row while split lines are being edited
 * and not saved: `hold()` refuses (with a toast) and returns true, for the
 * panel's own ways off the row (previous / next, review-and-advance, other
 * transactions). ↑ / ↓ / J / K from the panel, which RecordTableScope turns
 * into row steps, are held the same way. Capture phase, so this runs before
 * the table's own listener.
 */
export function useLinesDraftGuard() {
  const toast = useToast();
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const hold = useCallback(() => {
    if (!dirtyRef.current) return false;
    toast.warn("Save or cancel the line items first", {
      description: "This transaction's split isn't saved yet.",
      dedupeKey: "transaction-panel-lines-draft",
    });
    return true;
  }, [toast]);

  useEffect(() => {
    if (!dirty) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key !== "arrowdown" && key !== "arrowup" && key !== "j" && key !== "k") return;
      const target = event.target instanceof Element ? event.target : null;
      if (isTypingTarget(target) || target?.closest('[role="menu"], [role="listbox"], [role="tablist"]')) return;
      const fromNowhere = !target || target === document.body || target === document.documentElement;
      if (!fromNowhere && !target?.closest(TRANSACTION_PANEL_SELECTOR)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) hold();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [dirty, hold]);

  return { hold, setDirty };
}
