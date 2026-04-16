import {
  Children,
  cloneElement,
  isValidElement,
  MouseEvent as ReactMouseEvent,
  ReactElement,
  ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { X, AlertTriangle, CheckCircle2, Info, Lock, Unlock } from "lucide-react";
import { Link } from "react-router-dom";
import { useConfirm } from "./Modal";
import { useInspectorPanel } from "./InspectorPanel";

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state__icon">{icon}</div>}
      <div className="empty-state__title">{title}</div>
      {children && <div style={{ marginBottom: 12 }}>{children}</div>}
      {action}
    </div>
  );
}

export type ErrorSummaryItem = {
  fieldId?: string;
  label: string;
  message: string;
};

export function ErrorSummary({
  title = "Fix the following before continuing",
  errors,
}: {
  title?: string;
  errors: ErrorSummaryItem[];
}) {
  if (errors.length === 0) return null;

  return (
    <div className="error-summary" role="alert" tabIndex={-1}>
      <div className="error-summary__title">{title}</div>
      <ul className="error-summary__list">
        {errors.map((error) => (
          <li key={`${error.fieldId ?? error.label}-${error.message}`}>
            {error.fieldId ? (
              <a href={`#${error.fieldId}`}>
                <strong>{error.label}:</strong> {error.message}
              </a>
            ) : (
              <span>
                <strong>{error.label}:</strong> {error.message}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "warn" | "danger" | "info" | "accent";
  children: ReactNode;
}) {
  const klass = tone === "neutral" ? "badge" : `badge badge--${tone}`;
  return <span className={klass}>{children}</span>;
}

export function Pill({
  tone = "neutral",
  size = "md",
  className,
  children,
}: {
  tone?: "neutral" | "success" | "warn" | "danger" | "info" | "accent";
  size?: "sm" | "md";
  className?: string;
  children: ReactNode;
}) {
  const classes = ["pill", `pill--${size}`];
  if (tone !== "neutral") classes.push(`pill--${tone}`);
  if (className) classes.push(className);
  return <span className={classes.join(" ")}>{children}</span>;
}

export function TintedIconTile({
  tone = "gray",
  size = "md",
  className,
  children,
}: {
  tone?: "blue" | "red" | "turquoise" | "gray" | "orange" | "purple" | "green" | "pink" | "yellow";
  size?: "sm" | "md" | "lg";
  className?: string;
  children: ReactNode;
}) {
  const classes = ["tinted-icon-tile", `tinted-icon-tile--${size}`, `icon-chip-${tone}`];
  if (className) classes.push(className);
  return <span className={classes.join(" ")}>{children}</span>;
}

export function MenuSectionLabel({ children }: { children: ReactNode }) {
  return <div className="menu__section-label">{children}</div>;
}

export function MenuRow({
  icon,
  label,
  hint,
  right,
  active = false,
  disabled = false,
  destructive = false,
  subtle = false,
  role,
  ariaSelected,
  onMouseEnter,
  onClick,
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  right?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  subtle?: boolean;
  role?: string;
  ariaSelected?: boolean;
  onMouseEnter?: () => void;
  onClick?: () => void;
}) {
  const classes = ["menu__item"];
  if (active) classes.push("is-active");
  if (disabled) classes.push("is-disabled");
  if (destructive) classes.push("menu__item--destructive");
  if (subtle) classes.push("menu__item--clear");

  return (
    <button
      type="button"
      role={role}
      aria-selected={ariaSelected}
      aria-disabled={disabled || undefined}
      className={classes.join(" ")}
      disabled={disabled}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <span className="menu__item-main">
        {icon && <span className="menu__item-icon">{icon}</span>}
        <span className="menu__item-label">
          {label}
          {hint && <span className="menu__item-hint"> · {hint}</span>}
        </span>
      </span>
      {right && <span className="menu__item-right">{right}</span>}
    </button>
  );
}

export function RecordChip({
  avatar,
  label,
  meta,
  tone = "gray",
  to,
  onClick,
  className,
}: {
  avatar?: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
  tone?: "blue" | "red" | "turquoise" | "gray" | "orange" | "purple" | "green" | "pink" | "yellow";
  to?: string;
  onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
  className?: string;
}) {
  const classes = ["record-chip"];
  if (to || onClick) classes.push("record-chip--interactive");
  if (className) classes.push(className);

  const content = (
    <>
      {avatar != null && (
        <TintedIconTile tone={tone} size="sm" className="record-chip__avatar">
          {avatar}
        </TintedIconTile>
      )}
      <span className="record-chip__content">
        <span className="record-chip__label">{label}</span>
        {meta && <span className="record-chip__meta">{meta}</span>}
      </span>
    </>
  );

  if (to) {
    return (
      <Link to={to} className={classes.join(" ")} onClick={onClick}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" className={classes.join(" ")} onClick={onClick}>
        {content}
      </button>
    );
  }

  return <span className={classes.join(" ")}>{content}</span>;
}

export function InspectorNote({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "danger";
  title?: ReactNode;
  children: ReactNode;
}) {
  const Icon = tone === "info" ? Info : AlertTriangle;

  return (
    <div className={`inspector-note inspector-note--${tone}`}>
      <div className="inspector-note__icon">
        <Icon size={14} />
      </div>
      <div className="inspector-note__content">
        {title && <div className="inspector-note__title">{title}</div>}
        <div className="inspector-note__body">{children}</div>
      </div>
    </div>
  );
}

export function Avatar({ label }: { label: string }) {
  return <span className="avatar">{label.slice(0, 2).toUpperCase()}</span>;
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const inspector = useInspectorPanel();
  const panelId = useId();
  const titleId = useStableDomId("drawer-title");
  const dialogRef = useDialogFocus<HTMLDivElement>(open, onClose);

  useEffect(() => {
    if (!open || !inspector) return;
    inspector.activate(panelId, onClose);
    return () => inspector.deactivate(panelId);
  }, [open, onClose, inspector, panelId]);

  if (!open) return null;
  if (inspector?.portalTarget) {
    return createPortal(
      <div
        className="inspector-panel"
        role="dialog"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="drawer__head inspector-panel__head">
          <h2 className="drawer__title" id={titleId}>{title}</h2>
          <div style={{ flex: 1 }} />
          <button className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Close drawer">
            <X />
          </button>
        </div>
        <div className="drawer__body inspector-panel__body">{children}</div>
        {footer && <div className="drawer__footer inspector-panel__footer">{footer}</div>}
      </div>,
      inspector.portalTarget,
    );
  }
  if (inspector) return null;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="drawer__head">
          <h2 className="drawer__title" id={titleId}>{title}</h2>
          <div style={{ flex: 1 }} />
          <button className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Close drawer">
            <X />
          </button>
        </div>
        <div className="drawer__body">{children}</div>
        {footer && <div className="drawer__footer">{footer}</div>}
      </div>
    </>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  id,
  children,
}: {
  label: string;
  hint?: string;
  error?: ReactNode;
  required?: boolean;
  id?: string;
  children: ReactNode;
}) {
  const generatedId = useStableDomId("field");
  const fieldId = id ?? getFirstChildId(children) ?? generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="field">
      <label className="field__label" htmlFor={fieldId}>
        {label}
        {required && <span className="field__required" aria-hidden="true"> *</span>}
      </label>
      {enhanceFieldChildren(children, fieldId, describedBy, Boolean(error))}
      {hint && <div className="field__hint" id={hintId}>{hint}</div>}
      {error && <div className="field__error" id={errorId}>{error}</div>}
    </div>
  );
}

export function LockedField({
  label,
  hint,
  reason,
  children,
}: {
  label: string;
  hint?: string;
  /** Why the field is locked — shown in the unlock confirmation. */
  reason: string;
  /** A render prop receiving the current locked state — your input must respect it (e.g. `disabled={locked}`). */
  children: (locked: boolean) => ReactNode;
}) {
  const [locked, setLocked] = useState(true);
  const confirm = useConfirm();
  const generatedId = useStableDomId("field");
  const fieldId = generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;

  const onUnlock = async () => {
    const ok = await confirm({
      title: "Unlock this field?",
      message: (
        <>
          <p style={{ margin: "0 0 8px" }}>Editing this field has legal consequences:</p>
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>{reason}</p>
        </>
      ),
      confirmLabel: "Unlock",
      tone: "warn",
    });
    if (ok) setLocked(false);
  };

  return (
    <div className="field">
      <div className="field__label-row">
        <label className="field__label" htmlFor={fieldId}>{label}</label>
        {locked ? (
          <button className="field__lock" onClick={onUnlock} type="button" title={reason}>
            <Lock /> Locked
          </button>
        ) : (
          <button
            className="field__lock field__lock--unlocked"
            onClick={() => setLocked(true)}
            type="button"
            title="Lock again"
          >
            <Unlock /> Editing
          </button>
        )}
      </div>
      {enhanceFieldChildren(children(locked), fieldId, hintId, false)}
      {hint && <div className="field__hint" id={hintId}>{hint}</div>}
    </div>
  );
}

export function Flag({
  level,
  children,
}: {
  level: "ok" | "warn" | "err";
  children: ReactNode;
}) {
  const Icon = level === "ok" ? CheckCircle2 : level === "warn" ? Info : AlertTriangle;
  return (
    <div className={`flag flag--${level}`}>
      <Icon />
      <div>{children}</div>
    </div>
  );
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

function getFirstChildId(children: ReactNode): string | undefined {
  let found: string | undefined;
  Children.forEach(children, (child) => {
    if (found || !isValidElement(child)) return;
    const props = child.props as { id?: string };
    if (props.id) found = props.id;
  });
  return found;
}

function enhanceFieldChildren(
  children: ReactNode,
  id: string,
  describedBy: string | undefined,
  invalid: boolean,
) {
  let applied = false;
  return Children.map(children, (child) => {
    if (applied || !isValidElement(child)) return child;
    const childProps = child.props as {
      id?: string;
      "aria-describedby"?: string;
      "aria-invalid"?: boolean;
    };
    const nextProps: Record<string, unknown> = {};
    if (!childProps.id) nextProps.id = id;
    if (describedBy) {
      nextProps["aria-describedby"] = [childProps["aria-describedby"], describedBy]
        .filter(Boolean)
        .join(" ");
    }
    if (invalid) nextProps["aria-invalid"] = true;
    applied = true;
    return cloneElement(child as ReactElement, nextProps);
  });
}
