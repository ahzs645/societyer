/** Recent Ask queries per table, remembered in this browser only. */
const KEY_PREFIX = "societyer.nlFilter.recent:";
const MAX = 5;

export function readRecentQueries(scope: string): string[] {
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + scope);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecentQuery(scope: string, query: string): string[] {
  const clean = query.trim();
  if (!clean) return readRecentQueries(scope);
  const next = [clean, ...readRecentQueries(scope).filter((entry) => entry.toLowerCase() !== clean.toLowerCase())].slice(0, MAX);
  try {
    window.localStorage.setItem(KEY_PREFIX + scope, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode, blocked): recents just aren't kept.
  }
  return next;
}
