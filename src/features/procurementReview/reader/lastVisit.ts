/**
 * "New since your last visit": when this person last had the reader open in
 * this browser, per workspace, so the list can mark notices issued since. It
 * is a convenience, kept in localStorage and never sent anywhere; a private
 * window or blocked storage simply marks nothing.
 *
 * A visit is a stretch of use with no gap longer than VISIT_GAP: a reload, or
 * leaving for another page and coming back within it, continues the visit and
 * keeps its "previous visit". The previous visit is read once per page load
 * and then held for the life of the page, so rows don't stop being new while
 * the reader is open. On a first visit there is no previous one and nothing
 * is new.
 *
 * Notices carry the day they were issued (the source's issue or posting date),
 * usually without a time, so a notice is new when it was issued on or after
 * the day of the previous visit, in the source's zone. A notice issued that
 * morning, before the visit, can show as new once more; that is preferred to
 * missing one issued later the same day.
 */
import { useEffect, useMemo } from "react";
import { useSociety } from "../../../hooks/useSociety";
import { useCurrentUserId } from "../../../hooks/useCurrentUser";
import { sortableDate, zoneToday } from "../lib/notice";
import type { ListRow } from "./source";

const KEY_PREFIX = "societyer.procurementLastVisit";
/** A pause longer than this ends a visit. */
const VISIT_GAP = 60 * 60 * 1000;
/** How often an open reader says it is still in use. */
const HEARTBEAT = 5 * 60 * 1000;

type Stored = { v: 1; previous: number | null; seen: number };

const visitKey = (societyId: string, userId: string) => `${KEY_PREFIX}:${societyId}:${userId}`;

function read(key: string): Stored | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored> | null;
    if (!parsed || parsed.v !== 1 || typeof parsed.seen !== "number" || !Number.isFinite(parsed.seen)) return null;
    const previous = typeof parsed.previous === "number" && Number.isFinite(parsed.previous) ? parsed.previous : null;
    return { v: 1, previous, seen: parsed.seen };
  } catch {
    return null;
  }
}

function write(key: string, value: Stored) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private window or a full quota: the visit isn't remembered.
  }
}

/** The previous visit for each key, settled once per page load. */
const settled = new Map<string, number | null>();

function settle(key: string, now = Date.now()): number | null {
  if (settled.has(key)) return settled.get(key) ?? null;
  const stored = read(key);
  const previous = !stored ? null : now - stored.seen < VISIT_GAP ? stored.previous : stored.seen;
  settled.set(key, previous);
  write(key, { v: 1, previous, seen: now });
  return previous;
}

/**
 * When this person's previous visit ended (ms), or null on a first visit, in
 * a browser that can't remember, or before the workspace and person are known.
 * Stable for the life of the page.
 */
export function usePreviousVisit(): number | null {
  const society = useSociety() as { _id?: string } | null | undefined;
  const userId = useCurrentUserId();
  const key = society?._id && userId ? visitKey(String(society._id), String(userId)) : null;
  const previous = useMemo(() => (key ? settle(key) : null), [key]);
  useEffect(() => {
    if (!key) return;
    const touch = () => write(key, { v: 1, previous: settled.get(key) ?? null, seen: Date.now() });
    const onVisibility = () => { if (document.visibilityState === "hidden") touch(); };
    const timer = window.setInterval(touch, HEARTBEAT);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", touch);
    return () => {
      touch();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", touch);
    };
  }, [key]);
  return previous;
}

const ISSUED_KEYS = ["issueDate", "publishedAt", "postedDate"] as const;
const issued = new WeakMap<ListRow, string>();

/** The day a notice was issued (`YYYY-MM-DD`), from the source facts a row carries; "" when it doesn't say. */
export function issuedDay(row: ListRow): string {
  const cached = issued.get(row);
  if (cached !== undefined) return cached;
  let day = "";
  if (row.analyticsJson) {
    try {
      const facts = JSON.parse(row.analyticsJson) as Record<string, unknown> | null;
      for (const key of ISSUED_KEYS) {
        const value = facts && typeof facts === "object" ? facts[key] : undefined;
        const sortable = typeof value === "string" ? sortableDate(value) : "";
        if (sortable) { day = sortable.slice(0, 10); break; }
      }
    } catch {
      day = "";
    }
  }
  issued.set(row, day);
  return day;
}

/** Record keys of the rows issued since `previous` (empty without a previous visit). */
export function newSince(rows: readonly ListRow[], previous: number | null): ReadonlySet<string> {
  if (previous === null) return EMPTY;
  const since = zoneToday(previous);
  const keys = new Set<string>();
  for (const row of rows) {
    const day = issuedDay(row);
    if (day && day >= since) keys.add(row.recordKey);
  }
  return keys;
}

const EMPTY: ReadonlySet<string> = new Set();
