import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";

/**
 * Long text clamped to a few lines with a trailing "… more" that opens it in
 * place; "Show less" folds it again. Nothing is added when the text already
 * fits. Phones can clamp tighter (`phoneLines`, at the 760px breakpoint).
 * Tapping the clamped text opens it too, except on a link inside it. The fade
 * behind "more" uses `--expandable-bg` (the card's panel colour by default).
 */
export function ExpandableText({
  children,
  lines = 4,
  phoneLines,
  className,
  label = "text",
}: {
  children: ReactNode;
  lines?: number;
  phoneLines?: number;
  className?: string;
  /** What is being opened, for screen readers: "Show more of the description". */
  label?: string;
}) {
  const body = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const node = body.current;
    if (!node || open) return;
    const measure = () => setOverflows(node.scrollHeight - node.clientHeight > 1);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [open, children]);

  const clamped = overflows && !open;
  const expandFromText = (event: MouseEvent) => {
    if (!clamped || (event.target as HTMLElement).closest("a, button")) return;
    setOpen(true);
  };
  const style = { "--expandable-lines": lines, "--expandable-phone-lines": phoneLines ?? lines } as CSSProperties;
  return (
    <span className={`expandable-text${className ? ` ${className}` : ""}`} data-collapsed={!open || undefined} data-clamped={clamped || undefined} style={style}>
      <span ref={body} className="expandable-text__body" onClick={expandFromText}>{children}</span>
      {clamped && (
        <button type="button" className="expandable-text__more" aria-expanded={false} aria-label={`Show more of the ${label}`} onClick={() => setOpen(true)}>
          <span aria-hidden="true">… </span>more
        </button>
      )}
      {open && overflows && (
        <button type="button" className="expandable-text__less" aria-expanded onClick={() => setOpen(false)}>Show less</button>
      )}
    </span>
  );
}
