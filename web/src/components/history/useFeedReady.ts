"use client";
import { useEffect, useState } from "react";

/** Read the snapshot after the cursor, closing the initial read/subscribe gap. A feed outage
 * must not block history: fall back after one second, and refresh if the cursor arrives later. */
export function useFeedReady(loaded: boolean) {
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    if (loaded) return;
    const timer = setTimeout(() => {
      setFallback(true);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [loaded]);
  return { ready: loaded || fallback, lateCursor: loaded && fallback };
}
