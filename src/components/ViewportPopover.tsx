import { useLayoutEffect, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useDialogFocus } from "../lib/useDialogFocus";

/** Anchor mixed form controls to their trigger without clipping narrow screens. */
export function ViewportPopover({ open, onClose, anchorRef, label, className, children }: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  label: string;
  className: string;
  children: ReactNode;
}) {
  const ref = useDialogFocus<HTMLDivElement>(open, onClose);
  const [placement, setPlacement] = useState<CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const panel = ref.current?.getBoundingClientRect();
      if (!anchor || !panel) return;
      const margin = 8;
      const left = Math.max(margin, Math.min(anchor.right - panel.width, window.innerWidth - panel.width - margin));
      const below = anchor.bottom + 4;
      const top = below + panel.height <= window.innerHeight - margin ? below : Math.max(margin, anchor.top - panel.height - 4);
      const next = { left, top, visibility: "visible" as const };
      setPlacement((current) => current.left === left && current.top === top && current.visibility === "visible" ? current : next);
    };
    place();
    const observer = new ResizeObserver(place);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const onDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || ref.current?.contains(event.target) || anchorRef.current?.contains(event.target)) return;
      // Nested portalled Select/DatePicker controls own their outside handling.
      if (event.target instanceof Element && event.target.closest(".menu,.calendar")) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, anchorRef, onClose, ref]);
  if (!open) return null;
  return <div ref={ref} className={className} role="dialog" aria-label={label} tabIndex={-1}
    style={{ ...placement, position: "fixed", right: "auto", maxWidth: "calc(100vw - 16px)", maxHeight: "calc(100dvh - 16px)", minWidth: "min(240px, calc(100vw - 16px))", overflowY: "auto" }}>{children}</div>;
}
