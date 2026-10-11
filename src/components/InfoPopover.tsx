import { useCallback, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { ViewportPopover } from "./ViewportPopover";

/**
 * A small ⓘ button that opens the background a page or section would
 * otherwise spell out in a paragraph. Opens on tap/click (so it works on
 * touch), anchored to the button, and closes on outside tap or Escape.
 */
export function InfoPopover({ label = "About this page", children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="info-popover__trigger"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Info size={14} aria-hidden="true" />
      </button>
      <ViewportPopover open={open} onClose={close} anchorRef={anchorRef} label={label} className="info-popover">
        {children}
      </ViewportPopover>
    </>
  );
}
