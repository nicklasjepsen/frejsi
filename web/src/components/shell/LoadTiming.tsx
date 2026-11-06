"use client";

import { useEffect } from "react";

import { loadTimingQuery, loadTimingUrl, ms, type Fields } from "@/lib/diag/load-timing";

/**
 * Where a slow open spends its time. Once per page load (and once per restore from the back-forward
 * cache) the page asks `GET /api/diag/load?…` with the browser's own navigation timings, in whole
 * milliseconds from the moment the open began. The request itself is the report: App Insights
 * records every request's path and query, and the static web app's own logs do not reach it.
 *
 * Only numbers and a few fixed words go out: no URL, no space, no person, no glucose, no user
 * agent string. Off outside production.
 */
function platform(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1))
    return "ios";
  if (ua.includes("Android")) return "android";
  return "other";
}

function standalone(): number {
  const ios = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios || window.matchMedia("(display-mode: standalone)").matches ? 1 : 0;
}

function send(query: string): void {
  try {
    void fetch(loadTimingUrl(query), { keepalive: true, cache: "no-store" }).catch(() => undefined);
  } catch {
    // A report is never worth an error.
  }
}

export function LoadTiming() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    const facts = (): Fields => ({
      v: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
      os: platform(),
      pwa: standalone(),
      sw: "serviceWorker" in navigator && navigator.serviceWorker.controller ? 1 : 0,
      online: navigator.onLine ? 1 : 0,
    });
    const report = () => {
      const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
      // On a fresh load the page ran its scripts this long after the open began.
      send(loadTimingQuery(entry, { ...facts(), at: Math.round(performance.now()) }));
    };
    // `loadEventEnd` is set only once the load handlers have run: report on the next task.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const afterLoad = () => {
      timer = setTimeout(report, 0);
    };
    if (document.readyState === "complete") report();
    else window.addEventListener("load", afterLoad, { once: true });

    let hiddenAt: number | null = document.hidden ? performance.now() : null;
    const onVisibility = () => {
      if (document.hidden) hiddenAt = performance.now();
    };
    // A page restored from the back-forward cache makes no request of its own: say how long it slept.
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      const slept = hiddenAt === null ? undefined : ms(performance.now() - hiddenAt);
      send(
        loadTimingQuery(undefined, { ...facts(), type: "restore", ...(slept ? { slept } : {}) }),
      );
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("load", afterLoad);
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);
  return null;
}
