"use client";

import { useEffect } from "react";

/** Registers `/sw.js` in production so the shell loads offline after the first visit (plan §6). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline support is a convenience; the app works without it.
    });
  }, []);
  return null;
}
