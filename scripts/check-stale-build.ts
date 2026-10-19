import assert from "node:assert/strict";

// Minimal browser stand-ins: the helper only touches sessionStorage, location.reload and addEventListener.
const store = new Map<string, string>();
let reloads = 0;
const listeners = new Map<string, (event: Event) => void>();
Object.assign(globalThis, {
  window: {
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    location: { reload: () => void reloads++ },
    addEventListener: (type: string, listener: (event: Event) => void) => void listeners.set(type, listener),
  },
});

const { isStaleBuildError, reloadForNewBuild, installStaleBuildRecovery } = await import("../src/lib/staleBuild");

// The three browsers' wording for a missing lazy chunk, plus the MIME-type variant from Cloudflare's SPA fallback.
for (const message of [
  "Failed to fetch dynamically imported module: https://x.pages.dev/assets/AnnualCycle-O673QBtj.js",
  "error loading dynamically imported module: https://x/assets/A.js",
  "Importing a module script failed.",
  "Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of \"text/html\".",
]) assert.equal(isStaleBuildError(new TypeError(message)), true, message);
assert.equal(isStaleBuildError(new Error("Society membership not found.")), false);
assert.equal(isStaleBuildError(undefined), false);

// First failure reloads; a second one inside the guard window does not (no reload loop).
assert.equal(reloadForNewBuild(), true);
assert.equal(reloads, 1);
assert.equal(reloadForNewBuild(), false);
assert.equal(reloads, 1);

// vite:preloadError: reload and suppress Vite's rethrow only when a reload actually happens.
store.clear();
installStaleBuildRecovery();
let prevented = 0;
listeners.get("vite:preloadError")?.({ preventDefault: () => void prevented++ } as unknown as Event);
assert.equal(reloads, 2);
assert.equal(prevented, 1);
listeners.get("vite:preloadError")?.({ preventDefault: () => void prevented++ } as unknown as Event);
assert.equal(reloads, 2, "guarded: no second reload");
assert.equal(prevented, 1, "guarded: let the error reach the page boundary, which offers Reload");

console.log("Stale build recovery checks passed.");
