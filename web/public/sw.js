/* Nænsom service worker: push notifications only (photo questions, docs/operations.md).
 *
 * It has no fetch handler on purpose. With one, every page load waits for the worker to start
 * before the request even leaves the phone: the load reports (/api/diag/load) showed 2.5-4 s on an
 * iPhone, and much longer when iOS had put the worker fully to sleep, against 0.3 s without it
 * (v0.7.7). Without a fetch handler the browser goes straight to the network, so nothing is
 * cached and no page or glucose value can ever be served from a cache.
 *
 * Registered as /sw.js?v=<build version> (ServiceWorker.tsx): a new build is a new worker, and
 * activate drops the caches earlier builds kept for their offline page and assets.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith("frejsi-shell-")).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
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
