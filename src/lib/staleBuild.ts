/**
 * Recovery for tabs left open across a deploy.
 *
 * Each build gives its lazily loaded pages new hashed file names and the old ones
 * are removed. A tab still running the previous build asks for a chunk that no
 * longer exists; the host's SPA fallback answers with index.html, so the browser
 * reports a failed dynamic import. Reloading picks up the new build. A short
 * session guard stops a reload loop when a chunk is genuinely broken.
 */

const RELOAD_GUARD_KEY = "societyer:stale-build-reload-at";
const RELOAD_GUARD_MS = 30_000;

const CHUNK_LOAD_PATTERNS = [
  /Failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Unable to preload CSS/i, // Vite CSS preload
  /Expected a JavaScript(-or-Wasm)? module script/i,
];

export function isStaleBuildError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return CHUNK_LOAD_PATTERNS.some((pattern) => pattern.test(message));
}

function readGuard(): number {
  try {
    return Number(window.sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
  } catch {
    return 0;
  }
}

/** Reloads once to load the new build. Returns false when a reload just happened, so callers can show a manual option. */
export function reloadForNewBuild(): boolean {
  if (typeof window === "undefined") return false;
  if (Date.now() - readGuard() < RELOAD_GUARD_MS) return false;
  try {
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // Storage unavailable: still reload; the worst case is one extra reload.
  }
  window.location.reload();
  return true;
}

/** Vite fires `vite:preloadError` when a lazy chunk or its CSS fails to load. */
export function installStaleBuildRecovery() {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadForNewBuild()) event.preventDefault();
  });
}
