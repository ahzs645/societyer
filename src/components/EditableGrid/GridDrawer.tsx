import { useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useDialogFocus } from "../../lib/useDialogFocus";

/**
 * A wide slide-over for spreadsheet editing. Unlike `Drawer`, it never docks
 * into the (narrow, user-sized) inspector column: a grid needs the width.
 * Full-screen below the phone breakpoint, like every drawer.
 */
export function GridDrawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "wide",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** "wide" ≈ 1100px; "full" uses nearly the whole viewport. */
  size?: "wide" | "full";
}) {
  const titleId = `grid-drawer-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const dialogRef = useDialogFocus<HTMLDivElement>(open, onClose);
  if (!open) return null;
  return createPortal(
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div
        className={`drawer drawer--grid${size === "full" ? " drawer--grid-full" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="drawer__head">
          <div className="grid-drawer__heading">
            <h2 className="drawer__title" id={titleId}>{title}</h2>
            {subtitle && <div className="grid-drawer__subtitle">{subtitle}</div>}
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Close drawer">
            <X />
          </button>
        </div>
        <div className="drawer__body grid-drawer__body">{children}</div>
        {footer && <div className="drawer__footer">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}
