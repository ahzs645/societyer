// Bump this whenever the caching strategy changes so older caches (which may
// hold stale build chunks under stable asset filenames) are purged on activate.
const CACHE_VERSION = "societyer-pwa-v3";

// Everything is resolved against the worker's own scope rather than "/", so a
// build served from a subdirectory caches its own shell instead of the host's
// root. `scope` always ends in a slash.
const SCOPE = new URL(self.registration.scope);
const scoped = (path) => new URL(path, SCOPE).pathname;

const INDEX_URL = scoped("index.html");
const APP_SHELL = [scoped("."), INDEX_URL, scoped("favicon.svg"), scoped("manifest.webmanifest")];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // A single missing entry rejects the whole addAll and leaves the worker
      // uninstalled, so each shell URL is cached independently.
      .then((cache) => Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "societyer:skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE.pathname)) return;
  if (url.pathname.startsWith(scoped("api/"))) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_VERSION).then((cache) => cache.put(INDEX_URL, copy));
          }
          return response;
        })
        // Offline: serve the cached shell so the SPA can boot and read its
        // local workspace. Without the final Response the browser shows its own
        // network-error page instead of the app.
        .catch(() =>
          caches
            .match(INDEX_URL)
            .then((cached) => cached ?? new Response("Societyer is offline and has no cached copy of the app yet.", {
              status: 503,
              headers: { "content-type": "text/plain; charset=utf-8" },
            })),
        ),
    );
    return;
  }

  const isBuildAsset = url.pathname.startsWith(scoped("assets/"));
  if (isBuildAsset || APP_SHELL.includes(url.pathname)) {
    // Network-first for build assets. The Pages build uses stable filenames
    // (e.g. /assets/react-vendor.js, /assets/Documents.js), so a cache-first
    // strategy can serve a stale chunk from a previous deploy alongside a
    // freshly fetched lazy chunk. When the two come from different builds their
    // minified cross-chunk imports no longer line up and the app crashes with
    // errors like "X is not a function". Preferring the network keeps every
    // chunk coherent for online users; the cache is only an offline fallback.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => {
            if (cached) return cached;
            return Response.error();
          }),
        ),
    );
  }
});
