import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ArrowLeft } from "lucide-react";

type HistoryEntry = { id: string; restore: () => void };

type InspectorContextValue = {
  activePanelId: string | null;
  portalTarget: HTMLDivElement | null;
  headerTarget: HTMLDivElement | null;
  setPortalTarget: (node: HTMLDivElement | null) => void;
  setHeaderTarget: (node: HTMLDivElement | null) => void;
  activate: (id: string, onClose: () => void) => void;
  deactivate: (id: string) => void;
  closeActive: () => void;
  /** Push the current panel onto the stack so a later `back()` can restore it. */
  pushHistory: (entry: HistoryEntry) => void;
  /** Pop the most recent history entry and invoke its restore callback. */
  back: () => void;
  historyDepth: number;
};

const InspectorContext = createContext<InspectorContextValue | null>(null);

export function InspectorProvider({ children }: { children: ReactNode }) {
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);
  const [headerTarget, setHeaderTarget] = useState<HTMLDivElement | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const activeCloseRef = useRef<(() => void) | null>(null);

  const activate = useCallback((id: string, onClose: () => void) => {
    activeCloseRef.current = onClose;
    setActivePanelId((current) => (current === id ? current : id));
  }, []);

  const deactivate = useCallback((id: string) => {
    setActivePanelId((current) => {
      if (current !== id) return current;
      activeCloseRef.current = null;
      return null;
    });
    // A full close drops any pending history — users don't expect Back to
    // survive an Escape/backdrop dismissal.
    setHistory([]);
  }, []);

  const closeActive = useCallback(() => {
    activeCloseRef.current?.();
  }, []);

  const pushHistory = useCallback((entry: HistoryEntry) => {
    setHistory((prev) => [...prev, entry]);
  }, []);

  const back = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      prev[prev.length - 1].restore();
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      activePanelId,
      portalTarget,
      headerTarget,
      setPortalTarget,
      setHeaderTarget,
      activate,
      deactivate,
      closeActive,
      pushHistory,
      back,
      historyDepth: history.length,
    }),
    [activePanelId, portalTarget, headerTarget, activate, deactivate, closeActive, pushHistory, back, history.length],
  );

  return (
    <InspectorContext.Provider value={value}>
      {children}
    </InspectorContext.Provider>
  );
}

export function useInspectorPanel() {
  return useContext(InspectorContext);
}

/** Renders a ← Back button inside the inspector header whenever the panel has
 * history to restore. Place inside any inspector body — it self-portals. */
export function InspectorBackButton() {
  const inspector = useInspectorPanel();
  if (!inspector || inspector.historyDepth === 0 || !inspector.headerTarget) return null;
  return createPortal(
    <button
      type="button"
      className="inspector__back"
      onClick={inspector.back}
      aria-label="Back"
    >
      <ArrowLeft size={14} />
      Back
    </button>,
    inspector.headerTarget,
  );
}

export function InspectorHost() {
  const inspector = useInspectorPanel();
  const isOpen = Boolean(inspector?.activePanelId);

  useEffect(() => {
    if (!isOpen || !inspector) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") inspector.closeActive();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspector, isOpen]);

  if (!inspector) return null;

  return (
    <div className={`inspector-host${isOpen ? " is-open" : ""}`}>
      {isOpen && (
        <button
          className="inspector-host__backdrop"
          onClick={inspector.closeActive}
          aria-label="Close inspector"
        />
      )}
      <aside className="inspector" aria-hidden={!isOpen}>
        <div className="inspector__header" ref={inspector.setHeaderTarget} />
        <div className="inspector__portal" ref={inspector.setPortalTarget} />
      </aside>
    </div>
  );
}
