import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type HTMLAttributes, type PointerEvent as ReactPointerEvent } from "react";

type Bar = { length: number; offset: number; travel: number; range: number };
const emptyBar: Bar = { length: 0, offset: 0, travel: 0, range: 0 };
function bar(size: number, content: number, scroll: number): Bar {
  if (!size || content <= size + 1) return emptyBar;
  const track = Math.max(0, size - 8);
  const length = Math.min(track, Math.max(28, track * size / content));
  const range = content - size, travel = track - length;
  return { length, offset: Math.max(0, Math.min(range, scroll)) / range * travel, travel, range };
}

/** Native wheel/touch/keyboard scrolling, with draggable bars that never consume layout space. */
export const ScrollArea = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { viewportClassName?: string }>(
  function ScrollArea({ className = "", viewportClassName = "", children, onScroll, ...props }, forwardedRef) {
    const viewport = useRef<HTMLDivElement>(null);
    useImperativeHandle(forwardedRef, () => viewport.current!, []);
    const [geometry, setGeometry] = useState({ x: emptyBar, y: emptyBar });
    const [active, setActive] = useState(false);
    const timeout = useRef<ReturnType<typeof setTimeout>>();
    const drag = useRef<{ axis: "x" | "y"; pointer: number; coordinate: number; scroll: number; range: number; travel: number } | null>(null);
    const measure = useCallback(() => {
      const e = viewport.current;
      if (!e) return;
      const next = { x: bar(e.clientWidth, e.scrollWidth, e.scrollLeft), y: bar(e.clientHeight, e.scrollHeight, e.scrollTop) };
      setGeometry(prior => JSON.stringify(prior) === JSON.stringify(next) ? prior : next);
    }, []);
    const show = () => {
      setActive(true);
      clearTimeout(timeout.current);
      timeout.current = setTimeout(() => { if (!drag.current) setActive(false); }, 900);
    };
    useLayoutEffect(() => {
      const e = viewport.current;
      if (!e) return;
      const resize = new ResizeObserver(measure);
      const observe = () => { resize.disconnect(); resize.observe(e); for (const child of e.children) resize.observe(child); measure(); };
      const mutation = new MutationObserver(observe);
      mutation.observe(e, { childList: true }); observe();
      return () => { resize.disconnect(); mutation.disconnect(); clearTimeout(timeout.current); };
    }, [measure]);
    const startDrag = (axis: "x" | "y", event: ReactPointerEvent<HTMLDivElement>) => {
      const e = viewport.current, b = geometry[axis];
      if (!e || !b.travel) return;
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { axis, pointer: event.pointerId, coordinate: axis === "x" ? event.clientX : event.clientY, scroll: axis === "x" ? e.scrollLeft : e.scrollTop, range: b.range, travel: b.travel };
      show();
    };
    const move = (event: ReactPointerEvent<HTMLDivElement>) => {
      const d = drag.current, e = viewport.current;
      if (!d || !e || event.pointerId !== d.pointer) return;
      const coordinate = d.axis === "x" ? event.clientX : event.clientY;
      const scroll = d.scroll + (coordinate - d.coordinate) * d.range / d.travel;
      if (d.axis === "x") e.scrollLeft = scroll; else e.scrollTop = scroll;
    };
    const end = () => { drag.current = null; show(); };
    return <div className={`scroll-area ${className}${active ? " is-scrolling" : ""}`}>
      <div {...props} ref={viewport} className={`scroll-area__viewport ${viewportClassName}`} onScroll={event => { measure(); show(); onScroll?.(event); }}>{children}</div>
      {(["x", "y"] as const).map(axis => geometry[axis].range > 0 && <div key={axis} aria-hidden="true" className={`scroll-area__thumb scroll-area__thumb--${axis}`}
        style={axis === "x" ? { width: geometry.x.length, transform: `translateX(${geometry.x.offset}px)` } : { height: geometry.y.length, transform: `translateY(${geometry.y.offset}px)` }}
        onPointerDown={event => startDrag(axis, event)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={() => { if (drag.current) end(); }} />)}
    </div>;
  },
);
