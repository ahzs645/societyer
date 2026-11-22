import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef } from "react";
import { useConfirm } from "@/components/Modal";

/**
 * Unsaved edits in panels that a page unmounts on navigation it controls
 * itself (meeting detail tabs). Each panel reports whether it holds unsaved
 * edits; the page asks before switching away (AUD-08). A full page exit is
 * still each panel's own `beforeunload` concern.
 */
type UnsavedPanelsRegistry = { report: (id: string, label: string | null) => void };

const UnsavedPanelsContext = createContext<UnsavedPanelsRegistry | null>(null);

export const UnsavedPanelsProvider = UnsavedPanelsContext.Provider;

/** Page side: the registry to provide, and a confirm that resolves true when it is fine to leave. */
export function useUnsavedPanels() {
  const confirm = useConfirm();
  const panels = useRef(new Map<string, string>());
  const asking = useRef(false);
  const registry = useMemo<UnsavedPanelsRegistry>(() => ({
    report: (id, label) => {
      if (label) panels.current.set(id, label);
      else panels.current.delete(id);
    },
  }), []);
  const confirmLeave = useCallback(async () => {
    const labels = [...new Set(panels.current.values())];
    if (!labels.length) return true;
    if (asking.current) return false;
    asking.current = true;
    try {
      return await confirm({
        title: "Discard unsaved changes?",
        message: `Your unsaved ${joinLabels(labels)} will be lost.`,
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        tone: "danger",
      });
    } finally {
      asking.current = false;
    }
  }, [confirm]);
  return { registry, confirmLeave };
}

/** Panel side: report unsaved edits while `dirty`; cleared on unmount. No-op outside a provider. */
export function useReportUnsaved(dirty: boolean, label: string) {
  const registry = useContext(UnsavedPanelsContext);
  const id = useId();
  useEffect(() => {
    if (!registry) return;
    registry.report(id, dirty ? label : null);
    return () => registry.report(id, null);
  }, [registry, id, dirty, label]);
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "changes";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
