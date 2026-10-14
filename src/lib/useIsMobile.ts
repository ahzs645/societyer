import { useEffect, useState } from "react";
import { mobileCardMediaQuery } from "./breakpoints";

/**
 * Shared hook: true when the viewport is narrow enough (phone) that data
 * tables need their mobile treatment — a single frozen first column with the
 * rest of the columns scrolling horizontally, and the selection column
 * dropped. RecordTable and the page-level mobile layouts share it so they agree.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia(mobileCardMediaQuery).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(mobileCardMediaQuery);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    // Sync once on mount in case the viewport changed before the listener attached.
    setIsMobile(mq.matches);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
