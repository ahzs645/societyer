import { ReactNode, useEffect, useState } from "react";
import { X, AlertTriangle, CheckCircle2, Info, Lock, Unlock } from "lucide-react";
import { useConfirm } from "./Modal";

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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal>
        <div className="drawer__head">
          <h2 className="drawer__title">{title}</h2>
          <div style={{ flex: 1 }} />
          <button className="btn btn--ghost btn--icon" onClick={onClose}>
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
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field__label">{label}</label>
      {children}
      {hint && <div className="field__hint">{hint}</div>}
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
        <label className="field__label">{label}</label>
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
      {children(locked)}
      {hint && <div className="field__hint">{hint}</div>}
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
