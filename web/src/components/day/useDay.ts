"use client";

import type { DayView } from "@frejsi/shared/schemas/meal";
import { useCallback, useEffect, useRef, useState } from "react";

import type { FeedEventType } from "@/lib/live/live-feed";

import { fetchDay } from "./api";
import { localDateOf } from "./format";

export type DayState =
  { status: "loading" } | { status: "failed" } | { status: "ready"; day: DayView };

type Subscribe = (type: FeedEventType, handler: () => void) => () => void;

/** How often the hook checks whether the space's day has turned or a failed read needs a retry. */
export const DAY_RECHECK_MS = 30_000;

/** The events after which the day is read again (plan §7: "refetch on `meal.*` events"). */
const REFRESH_ON: FeedEventType[] = [
  "meal.created",
  "meal.updated",
  "meal.deleted",
  "space.updated",
];

/**
 * Today's meals for Nu: read once, again when the feed has its cursor (a meal saved between the
 * first read and the cursor arrives as neither), on every `meal.*` event the feed delivers, when
 * the window regains focus, and when the space's day turns at midnight or a read failed (checked
 * every 30 seconds). A failed refresh keeps the day already on screen. `subscribe` and `loaded`
 * are the ones from `useLiveFeed`, so the screen keeps a single feed.
 */
export function useDay(
  spaceId: string,
  subscribe: Subscribe | undefined,
  loaded = false,
): DayState {
  // Scoped to the space it was read for: another space's meals are never shown, not even while
  // the new space's first read is out or after it failed.
  const [state, setState] = useState<{ spaceId: string; state: DayState }>({
    spaceId,
    state: { status: "loading" },
  });
  const latest = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  /** The last read failed, whether or not an older day is still on screen: the timer retries. */
  const lastFailed = useRef(false);

  const load = useCallback(async () => {
    const id = ++latest.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    let next: DayState = { status: "failed" };
    try {
      next = { status: "ready", day: await fetchDay(spaceId, { signal: controller.signal }) };
    } catch {
      // Shown as "could not be loaded" unless a day is on screen; the recheck tries again.
    }
    if (id !== latest.current) return;
    inFlight.current = null;
    lastFailed.current = next.status === "failed";
    setState((current) =>
      next.status === "failed" && current.spaceId === spaceId && current.state.status === "ready"
        ? current
        : { spaceId, state: next },
    );
  }, [spaceId]);

  // Again once `loaded` turns true: the feed's cursor is then known.
  useEffect(() => {
    void load();
    return () => {
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [load, loaded]);

  const current: DayState = state.spaceId === spaceId ? state.state : { status: "loading" };
  const shown = current.status === "ready" ? current.day : null;
  useEffect(() => {
    const timer = setInterval(() => {
      const turned = shown && localDateOf(new Date(), shown.timezone) !== shown.date;
      if (inFlight.current === null && (turned || lastFailed.current)) void load();
    }, DAY_RECHECK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [shown, load]);

  useEffect(() => {
    if (!subscribe) return;
    const refresh = () => void load();
    const offs = REFRESH_ON.map((type) => subscribe(type, refresh));
    return () => {
      for (const off of offs) off();
    };
  }, [subscribe, load]);

  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  return current;
}
