/* Frejsi service worker: the shell loads offline after the first visit (plan §6).
 *
 * Strategy: the shell routes, the manifest, the icons and the offline page are precached on
 * install; Next's hashed static assets are cached on first use; navigations go network first and
 * fall back to the cached route, then to the offline page. The API is never cached: a glucose
 * value is never served from a cache, and nothing under /api/ is stored here.
 */
const CACHE = "frejsi-shell-v1";
const PRECACHE = [
  "/da",
  "/en",
  "/da/now",
  "/en/now",
  "/da/soon",
  "/en/soon",
  "/da/welcome",
  "/en/welcome",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/offline.html"
];
const NEVER_CACHE = ["/api/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(
        PRECACHE.map((url) =>
          fetch(url, { credentials: "same-origin" }).then((response) => {
            // A redirect (not signed in) or an error is skipped; the route is cached on first use.
            if (response.ok && !response.redirected) return cache.put(url, response);
            return undefined;
          }),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((prefix) => url.pathname.startsWith(prefix))) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && !response.redirected) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(url.pathname, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(url.pathname).then((cached) => cached || caches.match("/offline.html")),
        ),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || PRECACHE.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
