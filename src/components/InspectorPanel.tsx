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

type InspectorContextValue = {
  activePanelId: string | null;
  portalTarget: HTMLDivElement | null;
  setPortalTarget: (node: HTMLDivElement | null) => void;
  activate: (id: string, onClose: () => void) => void;
  deactivate: (id: string) => void;
  closeActive: () => void;
};

const InspectorContext = createContext<InspectorContextValue | null>(null);

export function InspectorProvider({ children }: { children: ReactNode }) {
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);
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
  }, []);

  const closeActive = useCallback(() => {
    activeCloseRef.current?.();
  }, []);

  const value = useMemo(
    () => ({
      activePanelId,
      portalTarget,
      setPortalTarget,
      activate,
      deactivate,
      closeActive,
    }),
    [activePanelId, portalTarget, activate, deactivate, closeActive],
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
        <div className="inspector__portal" ref={inspector.setPortalTarget} />
      </aside>
    </div>
  );
}
