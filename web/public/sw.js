/* Frejsi service worker: the app is installable and opens offline after the first visit (plan §6).
 *
 * What is cached: the offline page, the manifest, the icons and Next's hashed static assets.
 * What is never cached: any page under a locale (they carry the signed-in person's name, space
 * names and roles, and a cache would outlive the session on a shared device) and anything under
 * /api/ (a glucose value is never served from a cache). Offline, every navigation gets the
 * offline page; online, pages come from the network as always.
 *
 * The worker is registered as /sw.js?v=<build version> (ServiceWorker.tsx, NEXT_PUBLIC_APP_VERSION):
 * a new build is a new worker URL, so the browser installs it, and its cache is named after the
 * version, so activate drops the previous build's offline page and icons. Nothing is bumped by hand.
 */
const VERSION = decodeURIComponent(
  (/[?&]v=([^&]*)/.exec(self.location.search || "") || [])[1] || "dev",
);
const CACHE = "frejsi-shell-" + VERSION;
const PRECACHE = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
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
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
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

function notificationUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin && /^\/(da|en)\/library\/[^/]+$/.test(url.pathname)
      ? url
      : null;
  } catch {
    return null;
  }
}
self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = event.data?.json();
  } catch {
    return;
  }
  if (
    !payload ||
    typeof payload.title !== "string" ||
    typeof payload.body !== "string" ||
    !notificationUrl(payload.data?.url)
  )
    return;
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: { url: payload.data.url },
      icon: "/icons/icon-192.png",
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = notificationUrl(event.notification.data?.url);
  if (!url) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = windows.find((w) => new URL(w.url).origin === url.origin);
      if (client) {
        const destination = await client.navigate(url.href);
        if (destination) await destination.focus();
        else await self.clients.openWindow(url.href);
      } else await self.clients.openWindow(url.href);
    })(),
  );
});
