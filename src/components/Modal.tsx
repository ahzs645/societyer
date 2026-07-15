import {
  createContext,
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { X, AlertTriangle } from "lucide-react";
import { bottomSheetMediaQuery } from "../lib/breakpoints";

type ModalSize = "sm" | "md" | "lg" | "xl";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Named width token; defaults to "md" (var(--modal-w-md)). */
  size?: ModalSize;
  /** Escape hatch for custom pixel widths. Prefer `size` when possible. */
  width?: number;
  /** Prevent closing on backdrop click. */
  dismissOnBackdrop?: boolean;
  /**
   * Allow the user to drag the dialog frame's edges/corners to resize it, like
   * a native window. Defaults to `true` for the data-heavy `lg`/`xl` sizes and
   * `false` otherwise; pass explicitly to override.
   */
  resizable?: boolean;
  /**
   * Stable key under which the resized size is remembered (per-dialog) in
   * localStorage. Defaults to a slug of `title`; pass a fixed key when the title
   * is dynamic so the remembered size doesn't fragment.
   */
  resizeKey?: string;
};

const MODAL_WIDTH_VARS: Record<ModalSize, string> = {
  sm: "var(--modal-w-sm)",
  md: "var(--modal-w-md)",
  lg: "var(--modal-w-lg)",
  xl: "var(--modal-w-xl)",
};

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
  width,
  dismissOnBackdrop = true,
  resizable,
  resizeKey,
}: ModalProps) {
  const titleId = useStableDomId("modal-title");
  const dialogRef = useDialogFocus<HTMLDivElement>(open, onClose);
  const stackSlot = useDialogStackSlot(open);
  // Default: everything but the small confirmation/quick-pick size is a form
  // worth resizing. Small `sm` dialogs (and the single-field Prompt below) stay
  // compact. Any call site can override with the explicit `resizable` prop.
  const wantResizable = resizable ?? size !== "sm";
  const resize = useResizableDialog({
    enabled: wantResizable,
    open,
    storageKey: resizeKey ?? slugifyTitle(title),
    elementRef: dialogRef,
  });

  if (!open) return null;
  const maxWidth = width != null ? `${width}px` : MODAL_WIDTH_VARS[size];
  const baseZ = 1000;
  const backdropZ = baseZ + stackSlot * 2 - 1;
  const modalZ = baseZ + stackSlot * 2;
  return createPortal(
    <>
      <div
        className="modal-backdrop"
        style={{ zIndex: backdropZ }}
        onClick={() => dismissOnBackdrop && onClose()}
      />
      <div
        className={`modal${resize.active ? " modal--resizable" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
        style={{ maxWidth, zIndex: modalZ, ...resize.style }}
      >
        {resize.handles}
        <div className="modal__head">
          <h2 className="modal__title" id={titleId}>{title}</h2>
          <button className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

// ---------------- ConfirmModal ---------------- //

type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger" | "warn";
};

type ConfirmState = ConfirmOptions & {
  resolve: (v: boolean) => void;
};

const ConfirmCtx = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...opts, resolve });
    });
  }, []);

  const close = (result: boolean) => {
    const s = stateRef.current;
    if (!s) return;
    s.resolve(result);
    setState(null);
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <Modal
          open
          onClose={() => close(false)}
          title={state.title}
          size="sm"
          footer={
            <>
              <button className="btn" onClick={() => close(false)}>
                {state.cancelLabel ?? "Cancel"}
              </button>
              <button
                className={`btn ${
                  state.tone === "danger"
                    ? "btn--danger"
                    : state.tone === "warn"
                      ? "btn--warn"
                      : "btn--accent"
                }`}
                onClick={() => close(true)}
                autoFocus
              >
                {state.confirmLabel ?? "Confirm"}
              </button>
            </>
          }
        >
          <div className="confirm-body">
            {state.tone === "danger" || state.tone === "warn" ? (
              <div className={`confirm-icon confirm-icon--${state.tone}`}>
                <AlertTriangle />
              </div>
            ) : null}
            <div>{state.message}</div>
          </div>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}

// ---------------- PromptModal ---------------- //

type PromptOptions = {
  title: string;
  message?: ReactNode;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  multiline?: boolean;
  required?: boolean;
};

type PromptState = PromptOptions & {
  resolve: (v: string | null) => void;
};

const PromptCtx = createContext<((opts: PromptOptions) => Promise<string | null>) | null>(null);

export function PromptProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PromptState | null>(null);
  const [draft, setDraft] = useState("");
  const stateRef = useRef(state);
  stateRef.current = state;

  const prompt = useCallback((opts: PromptOptions) => {
    setDraft(opts.defaultValue ?? "");
    return new Promise<string | null>((resolve) => {
      setState({ ...opts, resolve });
    });
  }, []);

  const close = (result: string | null) => {
    const s = stateRef.current;
    if (!s) return;
    s.resolve(result);
    setState(null);
  };

  const submit = () => {
    const s = stateRef.current;
    if (!s) return;
    if (s.required && !draft.trim()) return;
    close(draft);
  };

  return (
    <PromptCtx.Provider value={prompt}>
      {children}
      {state && (
        <Modal
          open
          onClose={() => close(null)}
          title={state.title}
          size="md"
          resizable={false}
          footer={
            <>
              <button className="btn" onClick={() => close(null)}>
                {state.cancelLabel ?? "Cancel"}
              </button>
              <button
                className="btn btn--accent"
                onClick={submit}
                disabled={state.required ? !draft.trim() : false}
              >
                {state.confirmLabel ?? "OK"}
              </button>
            </>
          }
        >
          {state.message && <div style={{ marginBottom: 10, color: "var(--text-secondary)" }}>{state.message}</div>}
          {state.multiline ? (
            <textarea
              autoFocus
              className="textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={state.placeholder}
              style={{ width: "100%", minHeight: 100 }}
            />
          ) : (
            <input
              autoFocus
              className="input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={state.placeholder}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              style={{ width: "100%" }}
            />
          )}
        </Modal>
      )}
    </PromptCtx.Provider>
  );
}

export function usePrompt() {
  const ctx = useContext(PromptCtx);
  if (!ctx) throw new Error("usePrompt must be used inside <PromptProvider>");
  return ctx;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function useStableDomId(prefix: string) {
  const id = useId();
  return `${prefix}-${id.replace(/:/g, "")}`;
}

/** Monotonic counter tracking how many dialogs are currently open. Each
 * mounting dialog grabs the next slot so nested modals stack correctly, even
 * when they render into the same portal root. */
let openDialogCount = 0;

export function useDialogStackSlot(open: boolean): number {
  const [slot, setSlot] = useState(0);
  useEffect(() => {
    if (!open) return;
    openDialogCount += 1;
    const current = openDialogCount;
    setSlot(current);
    return () => {
      openDialogCount = Math.max(0, openDialogCount - 1);
    };
  }, [open]);
  return slot;
}

function useDialogFocus<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => {
      const first = ref.current?.querySelector<HTMLElement>("[autofocus]") ?? getFocusable(ref.current)[0];
      (first ?? ref.current)?.focus();
    }, 0);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusable(ref.current);
      if (focusable.length === 0) {
        event.preventDefault();
        ref.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !ref.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, [open]);

  return ref;
}

function getFocusable(root: HTMLElement | null) {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.offsetParent !== null,
  );
}

// ---------------- Drag-to-resize dialog frame ---------------- //

type DialogRect = { left: number; top: number; width: number; height: number };

const RESIZE_DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
type ResizeDir = (typeof RESIZE_DIRS)[number];

const MIN_MODAL_W = 320;
const MIN_MODAL_H = 200;
const RESIZE_MARGIN = 8; // keep this many px between the dialog and the viewport edge
const RESIZE_STORAGE_PREFIX = "societyer:modal-size:";

const clampNum = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, Math.max(lo, hi)));

function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "dialog"
  );
}

function cursorForDir(dir: ResizeDir): string {
  if (dir === "n" || dir === "s") return "ns-resize";
  if (dir === "e" || dir === "w") return "ew-resize";
  if (dir === "ne" || dir === "sw") return "nesw-resize";
  return "nwse-resize";
}

function readStoredModalSize(key: string): { w: number; h: number } | null {
  try {
    const raw = window.localStorage.getItem(RESIZE_STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { w?: unknown; h?: unknown };
    if (typeof parsed.w === "number" && typeof parsed.h === "number") {
      return { w: parsed.w, h: parsed.h };
    }
  } catch {
    /* corrupt or unavailable storage — fall back to the default size */
  }
  return null;
}

function writeStoredModalSize(key: string, w: number, h: number) {
  try {
    window.localStorage.setItem(
      RESIZE_STORAGE_PREFIX + key,
      JSON.stringify({ w: Math.round(w), h: Math.round(h) }),
    );
  } catch {
    /* ignore quota/availability errors — remembering the size is best-effort */
  }
}

/** Apply a drag delta to the starting rect for the given handle, anchoring the
 * opposite edge and clamping to the min size and the viewport. */
function computeResizedRect(start: DialogRect, dir: ResizeDir, dx: number, dy: number): DialogRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const right = start.left + start.width;
  const bottom = start.top + start.height;
  let { left, top, width, height } = start;

  if (dir.includes("e")) {
    width = clampNum(start.width + dx, MIN_MODAL_W, vw - RESIZE_MARGIN - start.left);
  }
  if (dir.includes("s")) {
    height = clampNum(start.height + dy, MIN_MODAL_H, vh - RESIZE_MARGIN - start.top);
  }
  if (dir.includes("w")) {
    left = clampNum(start.left + dx, RESIZE_MARGIN, right - MIN_MODAL_W);
    width = right - left;
  }
  if (dir.includes("n")) {
    top = clampNum(start.top + dy, RESIZE_MARGIN, bottom - MIN_MODAL_H);
    height = bottom - top;
  }
  return { left, top, width, height };
}

function useResizableDialog(params: {
  enabled: boolean;
  open: boolean;
  storageKey: string;
  elementRef: RefObject<HTMLElement | null>;
}) {
  const { enabled, open, storageKey, elementRef } = params;
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(bottomSheetMediaQuery).matches,
  );
  const [rect, setRect] = useState<DialogRect | null>(null);
  const dragRef = useRef<{ dir: ResizeDir; startX: number; startY: number; start: DialogRect } | null>(
    null,
  );
  const storageKeyRef = useRef(storageKey);
  storageKeyRef.current = storageKey;

  const active = enabled && open && !isNarrow;

  // Track the bottom-sheet breakpoint; resizing is disabled below it.
  useEffect(() => {
    const mq = window.matchMedia(bottomSheetMediaQuery);
    const update = () => setIsNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // On open, measure the default-rendered dialog and switch to an explicit rect
  // (restoring any remembered size), before the browser paints — so there's no
  // visible jump from the centered default to the resizable frame.
  useLayoutEffect(() => {
    if (!active) {
      setRect(null);
      return;
    }
    const el = elementRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const stored = readStoredModalSize(storageKey);
    const w = clampNum(stored?.w ?? box.width, MIN_MODAL_W, vw - RESIZE_MARGIN * 2);
    const h = clampNum(stored?.h ?? box.height, MIN_MODAL_H, vh - RESIZE_MARGIN * 2);
    const left = clampNum((vw - w) / 2, RESIZE_MARGIN, vw - w - RESIZE_MARGIN);
    const top = clampNum((vh - h) / 2, RESIZE_MARGIN, vh - h - RESIZE_MARGIN);
    setRect({ left, top, width: w, height: h });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, storageKey]);

  const onPointerMove = useCallback((event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    setRect(
      computeResizedRect(drag.start, drag.dir, event.clientX - drag.startX, event.clientY - drag.startY),
    );
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    document.body.classList.remove("modal-resizing");
    document.body.style.removeProperty("cursor");
    window.removeEventListener("pointermove", onPointerMove);
    setRect((current) => {
      if (current) writeStoredModalSize(storageKeyRef.current, current.width, current.height);
      return current;
    });
  }, [onPointerMove]);

  const startResize = useCallback(
    (dir: ResizeDir) => (event: ReactPointerEvent) => {
      if (!rect) return;
      event.preventDefault();
      dragRef.current = { dir, startX: event.clientX, startY: event.clientY, start: rect };
      document.body.classList.add("modal-resizing");
      document.body.style.cursor = cursorForDir(dir);
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp, { once: true });
    },
    [rect, onPointerMove, onPointerUp],
  );

  // Safety net: drop listeners/cursor state if the dialog unmounts mid-drag.
  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.classList.remove("modal-resizing");
      document.body.style.removeProperty("cursor");
    };
  }, [onPointerMove, onPointerUp]);

  const style: CSSProperties = rect
    ? {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        maxWidth: "none",
        maxHeight: "none",
        transform: "none",
      }
    : {};

  const handles = active ? (
    <>
      {RESIZE_DIRS.map((dir) => (
        <div
          key={dir}
          className={`modal__resize modal__resize--${dir}`}
          onPointerDown={startResize(dir)}
          aria-hidden="true"
        />
      ))}
    </>
  ) : null;

  return { active: active && rect != null, style, handles };
}
