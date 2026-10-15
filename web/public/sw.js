/* Frejsi service worker: the app is installable and opens offline after the first visit (plan §6).
 *
 * What is cached: the offline page, the manifest, the icons and Next's hashed static assets.
 * What is never cached: any page under a locale (they carry the signed-in person's name, space
 * names and roles, and a cache would outlive the session on a shared device) and anything under
 * /api/ (a glucose value is never served from a cache). Offline, every navigation gets the
 * offline page; online, pages come from the network as always.
 */
const CACHE = "frejsi-shell-v2";
const PRECACHE = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png"
];
const NEVER_CACHE = ["/api/"];
const OFFLINE_PAGE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
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

function isStaticAsset(pathname) {
  return pathname.startsWith("/_next/static/") || PRECACHE.includes(pathname);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((prefix) => url.pathname.startsWith(prefix))) return;

  if (request.mode === "navigate") {
    // Network only; nothing personal is stored. Offline, the calm offline page.
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_PAGE)));
    return;
  }

  if (isStaticAsset(url.pathname)) {
    // Hashed, immutable and impersonal: cache first.
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
