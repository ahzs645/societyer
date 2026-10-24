import { useEffect, useSyncExternalStore } from "react";

/** One shared source-zone clock. Source deadlines have minute precision; midnight and visibility also refresh. */
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
const refresh = () => { now = Date.now(); for (const listener of listeners) listener(); };
function schedule() {
  timer = setTimeout(() => { refresh(); schedule(); }, 60_000 - Date.now() % 60_000 + 10);
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) { now = Date.now(); schedule(); document.addEventListener("visibilitychange", refresh); window.addEventListener("focus", refresh); }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { clearTimeout(timer); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); }
  };
}
export function useProcurementClock() { return useSyncExternalStore(subscribe, () => now, () => now); }
/** Refresh exactly after a known source instant, even between minute ticks. */
export function useProcurementDeadline(boundary: number | null | undefined) {
  useEffect(() => {
    if (!boundary || boundary <= Date.now()) return;
    const timer = setTimeout(refresh, Math.min(2_147_483_647, boundary - Date.now() + 5));
    return () => clearTimeout(timer);
  }, [boundary]);
}
