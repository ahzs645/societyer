import { useLayoutEffect, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useDialogFocus } from "../lib/useDialogFocus";
import { isOutsidePointerEvent } from "../lib/floatingLayer";

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
      // The fixed phone bottom navigation covers the end of the viewport and sits
      // above page popovers, so it is the effective bottom edge when shown.
      const bottomNav = document.querySelector<HTMLElement>(".bottom-nav");
      const navTop = bottomNav && bottomNav.offsetParent !== null ? bottomNav.getBoundingClientRect().top : window.innerHeight;
      const limit = Math.min(window.innerHeight, navTop) - margin;
      // Decide on the natural height, not the capped one, so capping cannot flip the placement back and forth.
      const natural = Math.max(panel.height, ref.current?.scrollHeight ?? 0);
      const below = anchor.bottom + 4;
      const spaceBelow = limit - below;
      const spaceAbove = anchor.top - 4 - margin;
      let top: number;
      let maxHeight: number;
      if (natural <= spaceBelow) { top = below; maxHeight = spaceBelow; }
      else if (natural <= spaceAbove) { top = anchor.top - 4 - natural; maxHeight = spaceAbove; }
      else if (spaceBelow >= spaceAbove) { top = below; maxHeight = Math.max(120, spaceBelow); }
      else { top = margin; maxHeight = Math.max(120, spaceAbove); }
      const next = { left, top, maxHeight, visibility: "visible" as const };
      setPlacement((current) => current.left === left && current.top === top && current.maxHeight === maxHeight && current.visibility === "visible" ? current : next);
    };
    place();
    const observer = new ResizeObserver(place);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const onDown = (event: PointerEvent) => {
      // Nested portalled Select/DatePicker controls own their outside handling.
      if (!isOutsidePointerEvent(event, ref, anchorRef)) return;
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
    style={{ maxHeight: "calc(100dvh - 16px)", ...placement, position: "fixed", right: "auto", maxWidth: "calc(100vw - 16px)", minWidth: "min(240px, calc(100vw - 16px))", overflowY: "auto" }}>{children}</div>;
}
