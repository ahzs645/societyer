// Bump this whenever the caching strategy changes so older caches (which may
// hold stale build chunks under stable asset filenames) are purged on activate.
const CACHE_VERSION = "societyer-pwa-v2";
const APP_SHELL = ["/", "/index.html", "/favicon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put("/index.html", copy));
          return response;
        })
        .catch(() => caches.match("/index.html")),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || APP_SHELL.includes(url.pathname)) {
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
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request)),
    );
  }
});
