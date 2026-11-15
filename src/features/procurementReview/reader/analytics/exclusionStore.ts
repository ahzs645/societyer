/**
 * The buyers, suppliers and types someone last left out of the award
 * analysis, remembered in this browser per workspace and person (as "Our
 * work" is, in ourWorkStore.ts), so the next visit starts from them. The URL
 * is what the analysis reads; this is only the default when a link carries
 * no exclusions, so a shared link still shows the sender's choice.
 */
import { useCallback, useSyncExternalStore } from "react";
import { useSociety } from "../../../../hooks/useSociety";
import { useCurrentUserId } from "../../../../hooks/useCurrentUser";
import { normalizeExclusions, type Exclusion } from "../../lib/market";

const KEY = (societyId: string, userId: string) => `societyer.procurementExclusions.${societyId}.${userId}`;
const NONE: Exclusion[] = [];
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; exclusions: Exclusion[] }>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Exclusions from text (the URL or this browser); anything damaged or over the limits reads as none. */
export function parseExclusions(raw: string | null): Exclusion[] {
  if (!raw) return NONE;
  try {
    const list = normalizeExclusions(JSON.parse(raw));
    return list.length ? list : NONE;
  } catch {
    return NONE;
  }
}

function read(key: string): Exclusion[] {
  const raw = readRaw(key);
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.exclusions;
  const exclusions = parseExclusions(raw);
  cache.set(key, { raw, exclusions });
  return exclusions;
}

/** The remembered exclusions for this workspace and person, and a way to replace them. */
export function useRememberedExclusions(): { remembered: Exclusion[]; remember: (next: Exclusion[]) => void } {
  const society = useSociety();
  const userId = useCurrentUserId();
  const key = KEY(society?._id ?? "none", userId ?? "anonymous");
  const remembered = useSyncExternalStore(subscribe, () => read(key));
  const remember = useCallback(
    (next: Exclusion[]) => {
      try {
        if (next.length) window.localStorage.setItem(key, JSON.stringify(next));
        else window.localStorage.removeItem(key);
      } catch {
        /* A private window: the change lasts until the page reloads. */
        cache.set(key, { raw: readRaw(key), exclusions: next.length ? next : NONE });
      }
      for (const listener of listeners) listener();
    },
    [key],
  );
  return { remembered, remember };
}
