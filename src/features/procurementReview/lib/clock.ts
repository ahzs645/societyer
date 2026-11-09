import { useEffect, useSyncExternalStore } from "react";

/** One shared source-zone clock. Source deadlines have minute precision; midnight and visibility also refresh. */
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
const minute = (at: number) => Math.floor(at / 60_000);
const refresh = () => { now = Date.now(); for (const listener of listeners) listener(); };
/**
 * Focus, visibility and a page's first subscriber only move the clock when the
 * minute has changed. Every new `now` is new query arguments (`asOf`), so
 * re-reading the same minute must not re-subscribe the page's queries.
 */
const catchUp = () => { if (minute(Date.now()) !== minute(now)) refresh(); };
function schedule() {
  timer = setTimeout(() => { refresh(); schedule(); }, 60_000 - Date.now() % 60_000 + 10);
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) { catchUp(); schedule(); document.addEventListener("visibilitychange", catchUp); window.addEventListener("focus", catchUp); }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { clearTimeout(timer); document.removeEventListener("visibilitychange", catchUp); window.removeEventListener("focus", catchUp); }
  };
}
/** While nothing listens the clock isn't ticking: a page opening later starts from the current minute rather than rendering twice. */
function snapshot() {
  if (!listeners.size && minute(Date.now()) !== minute(now)) now = Date.now();
  return now;
}
export function useProcurementClock() { return useSyncExternalStore(subscribe, snapshot, () => now); }
/** Refresh exactly after a known source instant, even between minute ticks. */
export function useProcurementDeadline(boundary: number | null | undefined) {
  useEffect(() => {
    if (!boundary || boundary <= Date.now()) return;
    const timer = setTimeout(refresh, Math.min(2_147_483_647, boundary - Date.now() + 5));
    return () => clearTimeout(timer);
  }, [boundary]);
}
