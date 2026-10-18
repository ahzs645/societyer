import {
  createContext,
  CSSProperties,
  FocusEvent as ReactFocusEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertTriangle, Info, X, AlertCircle } from "lucide-react";
import { useKeyboardInsetTracking } from "../lib/useVisualViewportBottomInset";

export type ToastTone = "success" | "error" | "warn" | "info";

export type ToastAction = { label: string; onClick: () => void };

type Toast = {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  duration: number;
  action?: ToastAction;
  /** A second, non-undo choice shown before `action` (e.g. "Show"). */
  secondaryAction?: ToastAction;
  dedupeKey?: string;
};

/** A toast on screen; `leaving` while its exit plays (a swipe keeps its own slide). */
type StackedToast = Toast & { leaving?: "fade" | "swipe" };

type ToastOpts = {
  description?: string;
  action?: ToastAction;
  secondaryAction?: ToastAction;
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

/** Matches the exit transition on `.toast[data-leaving]`. */
const EXIT_MS = 180;
/** Space between toasts once the stack is fanned out (px). */
const STACK_GAP = 8;
/** A resumed toast always gets at least this long to be read again. */
const MIN_RESUME_MS = 1500;
/** Sideways travel before a touch drag counts as a swipe (px). */
const SWIPE_SLOP = 8;
/** Share of the toast's width a swipe must cover to dismiss it. */
const SWIPE_DISMISS_RATIO = 0.4;

function normalize(arg?: string | ToastOpts): ToastOpts {
  if (arg == null) return {};
  if (typeof arg === "string") return { description: arg };
  return arg;
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Where each toast sits in the stack: `depth` counts the toasts in front of
 * it (0 is the newest) and `offset` is how far the fanned-out list pushes
 * it from the edge. A leaving toast keeps its slot and its room until it is
 * removed, so the rest close up after its exit rather than sliding over it
 * while it fades. `count` is the toasts that are staying.
 */
function stackLayout(items: StackedToast[], heights: Record<number, number>) {
  const slots = new Map<number, { depth: number; offset: number }>();
  let depth = 0;
  let offset = 0;
  let front = 0;
  let count = 0;
  for (let index = items.length - 1; index >= 0; index--) {
    const toast = items[index];
    slots.set(toast.id, { depth, offset });
    const height = heights[toast.id] ?? 0;
    if (depth === 0) front = height;
    depth++;
    offset += height + STACK_GAP;
    if (!toast.leaving) count++;
  }
  return { slots, front, total: Math.max(0, offset - STACK_GAP), count };
}

/**
 * Dismiss timers that can all be held at once. While the stack is fanned
 * out every timer stops and remembers what it had left; a toast added in
 * the meantime waits with its full duration.
 */
function useDismissTimers(expire: RefObject<(id: number) => void>) {
  const handlesRef = useRef<Map<number, number>>(new Map());
  const deadlinesRef = useRef<Map<number, number>>(new Map());
  const remainingRef = useRef<Map<number, number>>(new Map());
  const pausedRef = useRef(false);

  return useMemo(() => {
    const clear = (id: number) => {
      const handle = handlesRef.current.get(id);
      if (handle) window.clearTimeout(handle);
      handlesRef.current.delete(id);
      deadlinesRef.current.delete(id);
      remainingRef.current.delete(id);
    };
    const schedule = (id: number, ms: number) => {
      clear(id);
      if (pausedRef.current) {
        remainingRef.current.set(id, ms);
        return;
      }
      handlesRef.current.set(id, window.setTimeout(() => expire.current?.(id), ms));
      deadlinesRef.current.set(id, Date.now() + ms);
    };
    const pauseAll = () => {
      if (pausedRef.current) return;
      pausedRef.current = true;
      const now = Date.now();
      handlesRef.current.forEach((handle, id) => {
        window.clearTimeout(handle);
        remainingRef.current.set(id, Math.max(0, (deadlinesRef.current.get(id) ?? now) - now));
      });
      handlesRef.current.clear();
      deadlinesRef.current.clear();
    };
    const resumeAll = () => {
      if (!pausedRef.current) return;
      pausedRef.current = false;
      const waiting = [...remainingRef.current];
      remainingRef.current.clear();
      waiting.forEach(([id, left]) => schedule(id, Math.max(MIN_RESUME_MS, left)));
    };
    const clearAll = () => {
      handlesRef.current.forEach((handle) => window.clearTimeout(handle));
      handlesRef.current.clear();
      deadlinesRef.current.clear();
      remainingRef.current.clear();
    };
    return { clear, schedule, pauseAll, resumeAll, clearAll };
  }, [expire]);
}

/**
 * Whether the stack is fanned out: a mouse over it, focus inside it, or a
 * tap on it (touch has no hover; a tap elsewhere folds it back).
 */
function useStackExpansion(stackRef: RefObject<HTMLDivElement>, activeCount: number, renderedCount: number) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tapped, setTapped] = useState(false);
  const lastPointerRef = useRef("mouse");

  // Removing the focused toast (Undo, close) fires no blur, and an emptied
  // stack is never "left": settle both whenever the toasts change.
  useEffect(() => {
    if (activeCount === 0) {
      setHovered(false);
      setTapped(false);
    }
    if (!stackRef.current?.contains(document.activeElement)) setFocused(false);
  }, [activeCount, renderedCount, stackRef]);

  useEffect(() => {
    if (!tapped) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!stackRef.current?.contains(event.target as Node | null)) setTapped(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [tapped, stackRef]);

  const handlers = {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      lastPointerRef.current = event.pointerType;
    },
    onPointerEnter: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "touch") setHovered(true);
    },
    onPointerLeave: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "touch") setHovered(false);
    },
    onFocus: () => setFocused(true),
    onBlur: (event: ReactFocusEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
    },
    onClick: (event: ReactMouseEvent<HTMLDivElement>) => {
      if (lastPointerRef.current !== "touch") return;
      if ((event.target as Element).closest("button, a")) return;
      setTapped((open) => !open);
    },
  };

  return { expanded: activeCount > 0 && (hovered || focused || tapped), handlers };
}

const ToastCtx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<StackedToast[]>([]);
  const [heights, setHeights] = useState<Record<number, number>>({});
  const idRef = useRef(1);
  const stackRef = useRef<HTMLDivElement>(null);
  const exitTimersRef = useRef<Map<number, number>>(new Map());
  const observerRef = useRef<ResizeObserver | null>(null);
  const dismissRef = useRef<(id: number) => void>(() => {});
  const timers = useDismissTimers(dismissRef);
  // Toasts sit above the on-screen keyboard (CSS reads the inset).
  useKeyboardInsetTracking();

  const forget = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
    setHeights((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  // Mark the toast as leaving, let its exit play, then drop it. Reduced
  // motion skips the exit.
  const dismiss = useCallback((id: number, how: "fade" | "swipe" = "fade") => {
    timers.clear(id);
    if (exitTimersRef.current.has(id)) return;
    if (prefersReducedMotion()) {
      forget(id);
      return;
    }
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, leaving: how } : x)));
    exitTimersRef.current.set(id, window.setTimeout(() => {
      exitTimersRef.current.delete(id);
      forget(id);
    }, EXIT_MS));
  }, [timers, forget]);

  useEffect(() => {
    dismissRef.current = dismiss;
  }, [dismiss]);

  // Real heights, so the collapsed peek and the fanned-out list line up
  // with toasts of any length (a description or a wrapped title).
  const observe = useCallback((element: HTMLElement) => {
    if (!observerRef.current) {
      observerRef.current = new ResizeObserver((entries) => {
        setHeights((current) => {
          let next = current;
          for (const entry of entries) {
            const id = Number((entry.target as HTMLElement).dataset.toastId);
            const height = Math.round(entry.borderBoxSize[0]?.blockSize ?? (entry.target as HTMLElement).offsetHeight);
            if (next[id] === height) continue;
            if (next === current) next = { ...current };
            next[id] = height;
          }
          return next;
        });
      });
    }
    observerRef.current.observe(element);
    return () => observerRef.current?.unobserve(element);
  }, []);

  const show = useCallback<ToastApi["show"]>(
    ({ tone, title, description, duration, action, secondaryAction, dedupeKey }) => {
      // Keep actionable toasts on screen a bit longer so the user can reach the Undo button.
      const d = duration ?? (action ? 8000 : tone === "error" ? 6000 : 3500);
      if (dedupeKey) {
        let matched: StackedToast | undefined;
        setItems((xs) => {
          matched = xs.find((x) => x.dedupeKey === dedupeKey && !x.leaving);
          if (!matched) return xs;
          return xs.map((x) =>
            x.id === matched!.id
              ? { ...x, tone, title, description, action, secondaryAction, duration: d }
              : x,
          );
        });
        if (matched) {
          timers.schedule(matched.id, d);
          return;
        }
      }
      const id = idRef.current++;
      setItems((xs) => [...xs, { id, tone, title, description, duration: d, action, secondaryAction, dedupeKey }]);
      timers.schedule(id, d);
    },
    [timers],
  );

  const api: ToastApi = {
    show,
    success: (title, o) => show({ tone: "success", title, ...normalize(o) }),
    error: (title, o) => show({ tone: "error", title, ...normalize(o) }),
    warn: (title, o) => show({ tone: "warn", title, ...normalize(o) }),
    info: (title, o) => show({ tone: "info", title, ...normalize(o) }),
  };

  const layout = useMemo(() => stackLayout(items, heights), [items, heights]);
  const { expanded, handlers } = useStackExpansion(stackRef, layout.count, items.length);

  // Fanned out, every toast holds on screen (an Undo is often still being
  // reached for); folding back gives each the time it had left.
  useEffect(() => {
    if (expanded) timers.pauseAll();
    else timers.resumeAll();
  }, [expanded, timers]);

  useEffect(() => {
    const exitTimers = exitTimersRef.current;
    return () => {
      timers.clearAll();
      exitTimers.forEach((handle) => window.clearTimeout(handle));
      exitTimers.clear();
      observerRef.current?.disconnect();
    };
  }, [timers]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {createPortal(
        <div
          ref={stackRef}
          className="toast-stack"
          aria-live="polite"
          data-expanded={expanded ? "true" : "false"}
          style={{
            "--toast-front-h": `${layout.front}px`,
            "--toast-stack-h": `${expanded ? layout.total : layout.front}px`,
          } as CSSProperties}
          {...handlers}
        >
          {items.map((t) => {
            const slot = layout.slots.get(t.id) ?? { depth: 0, offset: 0 };
            return (
              <ToastItem
                key={t.id}
                toast={t}
                depth={slot.depth}
                offset={slot.offset}
                height={heights[t.id]}
                observe={observe}
                onClose={(how) => dismiss(t.id, how)}
              />
            );
          })}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

/**
 * Touch swipe-to-dismiss: the toast follows a sideways drag and a release
 * past 40% of its width dismisses it; anything shorter springs back.
 * Vertical drags stay page scrolls (`touch-action: pan-y` on `.toast`).
 */
function useSwipeToDismiss(onSwipe: () => void) {
  const dragRef = useRef<{ pointerId: number; x: number; y: number; swiping: boolean } | null>(null);
  const swipedRef = useRef(false);

  const finish = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (!drag.swiping) return;
    const element = event.currentTarget;
    delete element.dataset.swiping;
    const dx = event.clientX - drag.x;
    if (!cancelled && Math.abs(dx) > element.offsetWidth * SWIPE_DISMISS_RATIO) {
      element.style.setProperty("--toast-swipe-x", `${Math.sign(dx) * 110}%`);
      onSwipe();
    } else {
      element.style.removeProperty("--toast-swipe-x");
    }
  };

  return {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      swipedRef.current = false;
      if (event.pointerType === "mouse" || (event.target as Element).closest("button, a")) return;
      dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, swiping: false };
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      if (!drag.swiping) {
        if (Math.abs(dx) < SWIPE_SLOP) return;
        if (Math.abs(event.clientY - drag.y) > Math.abs(dx)) {
          dragRef.current = null;
          return;
        }
        drag.swiping = true;
        swipedRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.dataset.swiping = "";
      }
      event.currentTarget.style.setProperty("--toast-swipe-x", `${dx}px`);
    },
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => finish(event, false),
    onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => finish(event, true),
    // The tap that ends a swipe must not also expand the stack.
    onClickCapture: (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!swipedRef.current) return;
      swipedRef.current = false;
      event.stopPropagation();
    },
  };
}

function ToastItem({
  toast,
  depth,
  offset,
  height,
  observe,
  onClose,
}: {
  toast: StackedToast;
  depth: number;
  offset: number;
  height?: number;
  observe: (element: HTMLElement) => () => void;
  onClose: (how?: "fade" | "swipe") => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => (ref.current ? observe(ref.current) : undefined), [observe]);
  const swipe = useSwipeToDismiss(() => onClose("swipe"));
  const Icon =
    toast.tone === "success"
      ? CheckCircle2
      : toast.tone === "error"
        ? AlertCircle
        : toast.tone === "warn"
          ? AlertTriangle
          : Info;
  return (
    <div
      ref={ref}
      className={`toast toast--${toast.tone}`}
      // Errors interrupt; everything else waits its turn.
      role={toast.tone === "error" ? "alert" : "status"}
      data-toast-id={toast.id}
      data-depth={depth}
      data-leaving={toast.leaving}
      style={{
        "--toast-depth": depth,
        "--toast-offset": `${offset}px`,
        ...(height === undefined ? {} : { "--toast-h": `${height}px` }),
      } as CSSProperties}
      {...swipe}
    >
      <Icon className="toast__icon" />
      <div className="toast__body">
        <div className="toast__title">{toast.title}</div>
        {toast.description && <div className="toast__desc">{toast.description}</div>}
      </div>
      {toast.secondaryAction && (
        <button
          className="toast__action"
          onClick={() => {
            toast.secondaryAction!.onClick();
            onClose();
          }}
        >
          {toast.secondaryAction.label}
        </button>
      )}
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
      <button className="toast__close" onClick={() => onClose()} aria-label="Dismiss">
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
