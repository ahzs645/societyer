import { cloneElement, ReactElement, ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Placement = "top" | "bottom" | "left" | "right";

type Props = {
  content: ReactNode;
  children: ReactElement;
  placement?: Placement;
  /** ms before the tooltip appears. Default 350. */
  delay?: number;
  /** Hide on its own after N ms; 0 = sticky. Default 0. */
  duration?: number;
  disabled?: boolean;
};

export function Tooltip({ content, children, placement = "top", delay = 350, duration = 0, disabled }: Props) {
  const triggerRef = useRef<HTMLElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // Nudge that keeps the placed tooltip inside the viewport.
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const place = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 6;
    let top = 0;
    let left = 0;
    if (placement === "top") {
      top = r.top - gap;
      left = r.left + r.width / 2;
    } else if (placement === "bottom") {
      top = r.bottom + gap;
      left = r.left + r.width / 2;
    } else if (placement === "left") {
      top = r.top + r.height / 2;
      left = r.left - gap;
    } else {
      top = r.top + r.height / 2;
      left = r.right + gap;
    }
    setPos({ top, left });
    setShift({ x: 0, y: 0 });
  };

  const show = () => {
    if (disabled) return;
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => {
      place();
      setOpen(true);
      if (duration > 0) {
        closeTimer.current = window.setTimeout(() => setOpen(false), duration);
      }
    }, delay);
  };
  const hide = () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setOpen(false);
  };

  useEffect(() => {
    return () => {
      if (openTimer.current) window.clearTimeout(openTimer.current);
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, []);

  // Re-position on scroll/resize while visible; Esc dismisses it without
  // moving focus (the key still reaches the dialog or page underneath).
  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  // Keep the tooltip on screen: a trigger near an edge (or a 320px phone,
  // narrower than the tooltip's max width) would push it off the side.
  useLayoutEffect(() => {
    if (!open || !pos || !tipRef.current) return;
    const rect = tipRef.current.getBoundingClientRect();
    const margin = 8;
    const x = rect.left < margin
      ? margin - rect.left
      : rect.right > window.innerWidth - margin ? window.innerWidth - margin - rect.right : 0;
    const y = rect.top < margin
      ? margin - rect.top
      : rect.bottom > window.innerHeight - margin ? window.innerHeight - margin - rect.bottom : 0;
    if (x !== shift.x || y !== shift.y) setShift({ x: shift.x + x, y: shift.y + y });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos]);

  const cloned = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      (triggerRef as React.MutableRefObject<HTMLElement | null>).current = node;
      // forward ref if the child has one
      const childRef = (children as any).ref;
      if (typeof childRef === "function") childRef(node);
      else if (childRef) childRef.current = node;
    },
    onMouseEnter: (e: React.MouseEvent) => {
      children.props.onMouseEnter?.(e);
      // A tap fires a compatibility mouseenter; touch screens have no hover.
      if (!window.matchMedia("(hover: hover)").matches) return;
      show();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      children.props.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      children.props.onFocus?.(e);
      // Keyboard focus only: a dialog moving focus to (or back to) this
      // control after a click or tap must not leave a tooltip over it.
      if (!e.currentTarget.matches(":focus-visible")) return;
      show();
    },
    onBlur: (e: React.FocusEvent) => {
      children.props.onBlur?.(e);
      hide();
    },
  });

  return (
    <>
      {cloned}
      {open && pos
        ? createPortal(
            <div
              ref={tipRef}
              role="tooltip"
              className={`tooltip tooltip--${placement}`}
              style={{ top: pos.top + shift.y, left: pos.left + shift.x }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
