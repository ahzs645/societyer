import { useCallback, useRef } from "react";
import { useConfirm } from "@/components/Modal";

/**
 * Wrap a drawer/modal `onClose` so Escape, the backdrop and Cancel never
 * silently discard unsaved edits (ui-meetings F4). When `dirty` is true the
 * person confirms first; the returned function resolves to whether it closed.
 */
export function useDirtyCloseGuard(dirty: boolean, onClose: () => void, what = "changes") {
  const confirm = useConfirm();
  const asking = useRef(false);
  return useCallback(async () => {
    if (!dirty) {
      onClose();
      return true;
    }
    if (asking.current) return false;
    asking.current = true;
    try {
      const ok = await confirm({
        title: "Discard unsaved changes?",
        message: `Your unsaved ${what} will be lost.`,
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        tone: "danger",
      });
      if (ok) onClose();
      return ok;
    } finally {
      asking.current = false;
    }
  }, [confirm, dirty, onClose, what]);
}
