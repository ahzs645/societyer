import { useLayoutEffect, useRef, useState } from "react";

/**
 * Sliding active pill for the mobile bottom nav (after Rare UI's gooey nav):
 * one shared highlight glides between tabs instead of each tab switching its
 * own background on and off. Rendered inside `.bottom-nav`; it measures the
 * sibling `.bottom-nav__item.is-active` whenever `activeKey` changes or the
 * bar resizes, and fades out when no tab matches the current route.
 */
export function BottomNavIndicator({ activeKey }: { activeKey: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const nav = ref.current?.parentElement;
    if (!nav) return;
    const measure = () => {
      const active = nav.querySelector<HTMLElement>(".bottom-nav__item.is-active");
      if (!active) {
        setBox(null);
        return;
      }
      setBox({ left: active.offsetLeft, width: active.offsetWidth });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(nav);
    return () => observer?.disconnect();
  }, [activeKey]);

  // Skip the slide on the very first placement so the pill doesn't fly in
  // from the left edge on page load.
  const animate = placed.current;
  if (box) placed.current = true;

  return (
    <span
      ref={ref}
      className={`bottom-nav__indicator${box ? " is-visible" : ""}${animate ? " is-animated" : ""}`}
      style={box ? { transform: `translateX(${box.left}px)`, width: box.width } : undefined}
      aria-hidden="true"
    />
  );
}
