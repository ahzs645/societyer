import { useCallback, useEffect, useState } from "react";

const STORAGE_PREFIX = "hidden-suggestions:";

function storageKey(key: string) {
  return STORAGE_PREFIX + key;
}

function read(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function write(key: string, set: Set<string>) {
  try {
    localStorage.setItem(storageKey(key), JSON.stringify([...set]));
  } catch {
    // ignore quota / disabled-storage errors
  }
}

/**
 * Per-user, per-list memory of suggestions the user dismissed via the ✕ on
 * an autocomplete option. Keyed by a stable string (e.g. `"meeting-location"`).
 * Stored in localStorage so it survives reloads.
 */
export function useHiddenSuggestions(key: string) {
  const [hidden, setHidden] = useState<Set<string>>(() => read(key));

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey(key)) return;
      setHidden(read(key));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  const hide = useCallback((value: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      next.add(value.toLowerCase());
      write(key, next);
      return next;
    });
  }, [key]);

  const isHidden = useCallback((value: string) => hidden.has(value.toLowerCase()), [hidden]);

  return { hidden, hide, isHidden };
}

/** True for things that look like URLs — used to keep one-off meeting join
 * links out of the venue suggestion list. */
export function looksLikeLink(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^[a-z]+:\/\//i.test(trimmed)) return true;
  return false;
}
