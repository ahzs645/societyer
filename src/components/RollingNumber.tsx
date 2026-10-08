import { CSSProperties, useEffect, useRef, useState } from "react";

/**
 * Odometer-style number (after Rare UI's animated counter): when the value
 * changes, each digit rolls up or down to its new face instead of swapping.
 *
 * The real characters stay in the DOM (transparent), so text selection,
 * copy/paste, screen readers and text-based tests see the plain number; the
 * rolling 0–9 strip is drawn by a CSS pseudo-element (see .rolling-number in
 * _chrome-stat.scss), which never shows up in textContent. Non-numeric values
 * ("—", "12%", "$1,200") roll only their digits. The first render is static,
 * and prefers-reduced-motion turns the roll off in CSS.
 */
export function RollingNumber({ value, className }: { value: number | string; className?: string }) {
  const text = typeof value === "number" ? value.toLocaleString() : value;
  const mounted = useRef(false);
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    if (mounted.current) setAnimate(true);
    mounted.current = true;
  }, [text]);

  // Right-align digit columns so a place gained/lost (9 → 10) happens at the
  // front and existing columns keep their identity.
  const chars = [...text];
  return (
    <span className={`rolling-number${animate ? " is-animated" : ""}${className ? ` ${className}` : ""}`}>
      {chars.map((ch, i) => {
        const key = chars.length - i;
        return /\d/.test(ch) ? (
          <span key={key} className="rolling-number__digit" style={{ "--digit": ch } as CSSProperties}>
            {ch}
          </span>
        ) : (
          <span key={key}>{ch}</span>
        );
      })}
    </span>
  );
}
