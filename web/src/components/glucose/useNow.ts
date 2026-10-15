"use client";

import { useEffect, useState } from "react";

import { AGE_TICK_MS } from "./format";

/**
 * The clock the age line is computed from, re-read every 30 s (plan §9) so "for 3 min. siden"
 * becomes "for 4 min. siden" without a new reading. Starts at the first client render: the server
 * never renders an age because the feed is not loaded there.
 */
export function useNow(intervalMs: number = AGE_TICK_MS): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}
