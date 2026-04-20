import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertTriangle, Info, X, AlertCircle } from "lucide-react";

export type ToastTone = "success" | "error" | "warn" | "info";

export type ToastAction = { label: string; onClick: () => void };

type Toast = {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  duration: number;
  action?: ToastAction;
  dedupeKey?: string;
};

type ToastOpts = {
  description?: string;
  action?: ToastAction;
  duration?: number;
  /** Suppresses duplicate toasts with the same key while one is visible —
   * replaces the existing toast's content and resets its timer instead. */
  dedupeKey?: string;
};

type ToastApi = {
  show: (t: Omit<Toast, "id" | "duration"> & { duration?: number }) => void;
  success: (title: string, descriptionOrOpts?: string | ToastOpts) => void;
  error: (title: string, descriptionOrOpts?: string | ToastOpts) => void;
  warn: (title: string, descriptionOrOpts?: string | ToastOpts) => void;
  info: (title: string, descriptionOrOpts?: string | ToastOpts) => void;
};

function normalize(arg?: string | ToastOpts): ToastOpts {
  if (arg == null) return {};
  if (typeof arg === "string") return { description: arg };
  return arg;
}

const ToastCtx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const idRef = useRef(1);
  const timersRef = useRef<Map<number, number>>(new Map());

  const remove = useCallback((id: number) => {
    const timers = timersRef.current;
    const t = timers.get(id);
    if (t) {
      window.clearTimeout(t);
      timers.delete(id);
    }
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);

  const show = useCallback<ToastApi["show"]>(
    ({ tone, title, description, duration, action, dedupeKey }) => {
      // Keep actionable toasts on screen a bit longer so the user can reach the Undo button.
      const d = duration ?? (action ? 8000 : tone === "error" ? 6000 : 3500);
      if (dedupeKey) {
        let matched: Toast | undefined;
        setItems((xs) => {
          matched = xs.find((x) => x.dedupeKey === dedupeKey);
          if (!matched) return xs;
          return xs.map((x) =>
            x.id === matched!.id
              ? { ...x, tone, title, description, action, duration: d }
              : x,
          );
        });
        if (matched) {
          const existing = timersRef.current.get(matched.id);
          if (existing) window.clearTimeout(existing);
          const handle = window.setTimeout(() => remove(matched!.id), d);
          timersRef.current.set(matched.id, handle);
          return;
        }
      }
      const id = idRef.current++;
      setItems((xs) => [...xs, { id, tone, title, description, duration: d, action, dedupeKey }]);
      const handle = window.setTimeout(() => remove(id), d);
      timersRef.current.set(id, handle);
    },
    [remove],
  );

  const api: ToastApi = {
    show,
    success: (title, o) => show({ tone: "success", title, ...normalize(o) }),
    error: (title, o) => show({ tone: "error", title, ...normalize(o) }),
    warn: (title, o) => show({ tone: "warn", title, ...normalize(o) }),
    info: (title, o) => show({ tone: "info", title, ...normalize(o) }),
  };

  useEffect(() => {
    return () => {
      timersRef.current.forEach((h) => window.clearTimeout(h));
      timersRef.current.clear();
    };
  }, []);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {createPortal(
        <div className="toast-stack" aria-live="polite">
          {items.map((t) => (
            <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} />
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const Icon =
    toast.tone === "success"
      ? CheckCircle2
      : toast.tone === "error"
        ? AlertCircle
        : toast.tone === "warn"
          ? AlertTriangle
          : Info;
  return (
    <div className={`toast toast--${toast.tone}`} role="status">
      <Icon className="toast__icon" />
      <div className="toast__body">
        <div className="toast__title">{toast.title}</div>
        {toast.description && <div className="toast__desc">{toast.description}</div>}
      </div>
      {toast.action && (
        <button
          className="toast__action"
          onClick={() => {
            toast.action!.onClick();
            onClose();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button className="toast__close" onClick={onClose} aria-label="Dismiss">
        <X size={12} />
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
