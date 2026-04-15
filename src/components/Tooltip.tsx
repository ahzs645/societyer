import { cloneElement, ReactElement, ReactNode, useEffect, useRef, useState } from "react";
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
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
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

  // Re-position on scroll/resize while visible.
  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

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
      show();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      children.props.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      children.props.onFocus?.(e);
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
              role="tooltip"
              className={`tooltip tooltip--${placement}`}
              style={{ top: pos.top, left: pos.left }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
