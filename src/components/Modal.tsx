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
import { X, AlertTriangle } from "lucide-react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Max width in px, default 480. */
  width?: number;
  /** Prevent closing on backdrop click. */
  dismissOnBackdrop?: boolean;
};

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 480,
  dismissOnBackdrop = true,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <>
      <div
        className="modal-backdrop"
        onClick={() => dismissOnBackdrop && onClose()}
      />
      <div className="modal" role="dialog" aria-modal style={{ maxWidth: width }}>
        <div className="modal__head">
          <h2 className="modal__title">{title}</h2>
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
          width={420}
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
          width={460}
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
