"use client";

import { useSyncExternalStore } from "react";

const DESKTOP = "(min-width: 1280px)";

/** 1280 px and up is desktop, as in the shell; `forced` pins a layout (tests). */
export function useDesktop(forced?: "phone" | "desktop"): boolean {
  const matches = useSyncExternalStore(
    (notify) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const query = window.matchMedia(DESKTOP);
      query.addEventListener("change", notify);
      return () => {
        query.removeEventListener("change", notify);
      };
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(DESKTOP).matches,
    () => false,
  );
  return forced ? forced === "desktop" : matches;
}
