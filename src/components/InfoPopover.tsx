import { useCallback, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { ViewportPopover } from "./ViewportPopover";
import { Tooltip } from "./Tooltip";

/**
 * A small ⓘ button that opens the background a page or section would
 * otherwise spell out in a paragraph. Opens on tap/click (so it works on
 * touch), anchored to the button, and closes on outside tap or Escape.
 * Optional hover hints show the same content without moving keyboard focus.
 */
export function InfoPopover({ label = "About this page", children, hover = false }: { label?: string; children: ReactNode; hover?: boolean }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Tooltip content={children} disabled={!hover || open} delay={250}><button
        ref={anchorRef}
        type="button"
        className="info-popover__trigger"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <Info size={14} aria-hidden="true" />
      </button></Tooltip>
      <ViewportPopover open={open} onClose={close} anchorRef={anchorRef} label={label} className="info-popover">
        {children}
      </ViewportPopover>
    </>
  );
}
