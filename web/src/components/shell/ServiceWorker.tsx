"use client";

import { useEffect } from "react";

/**
 * `/sw.js?v=<version>`: the worker names its cache after the version, so a release installs a new
 * worker that drops the previous build's offline page and icons (public/sw.js). The version is the
 * one `/api/health` reports: `NEXT_PUBLIC_APP_VERSION`, the tag at release, `dev` otherwise.
 */
function serviceWorkerUrl(version: string): string {
  return `/sw.js?v=${encodeURIComponent(version)}`;
}

/** Registers the service worker in production so the shell loads offline after the first visit (plan §6). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register(serviceWorkerUrl(process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"))
      .catch(() => {
        // Offline support is a convenience; the app works without it.
      });
  }, []);
  return null;
}
