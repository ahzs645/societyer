import { useEffect, useState } from "react";
import { mobileCardMediaQuery } from "./breakpoints";

/**
 * Shared hook: true when the viewport is narrow enough that data tables
 * should render as a stacked card list instead of a wide HTML table.
 * Both DataTable and RecordTable use this so they flip at the same point.
 */
export function useIsMobileCards(): boolean {
  const [isMobileCards, setIsMobileCards] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia(mobileCardMediaQuery).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(mobileCardMediaQuery);
    const onChange = (e: MediaQueryListEvent) => setIsMobileCards(e.matches);
    mq.addEventListener("change", onChange);
    // Sync once on mount in case the viewport changed before the listener attached.
    setIsMobileCards(mq.matches);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isMobileCards;
}
