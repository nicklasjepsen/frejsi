"use client";

import type { DayView } from "@frejsi/shared/schemas/meal";
import { useCallback, useEffect, useRef, useState } from "react";

import type { FeedEventType } from "@/lib/live/live-feed";

import { fetchDay } from "./api";

export type DayState =
  { status: "loading" } | { status: "failed" } | { status: "ready"; day: DayView };

type Subscribe = (type: FeedEventType, handler: () => void) => () => void;

/** The events after which the day is read again (plan §7: "refetch on `meal.*` events"). */
const REFRESH_ON: FeedEventType[] = [
  "meal.created",
  "meal.updated",
  "meal.deleted",
  "space.updated",
];

/**
 * Today's meals for Nu: read once, again on every `meal.*` event the live feed delivers and when
 * the window regains focus. A failed refresh keeps the day already on screen. `subscribe` is the
 * one from `useLiveFeed`, so the screen keeps a single feed.
 */
export function useDay(spaceId: string, subscribe: Subscribe | undefined): DayState {
  const [state, setState] = useState<DayState>({ status: "loading" });
  const latest = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const id = ++latest.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    let next: DayState = { status: "failed" };
    try {
      next = { status: "ready", day: await fetchDay(spaceId, { signal: controller.signal }) };
    } catch {
      // Shown as "could not be loaded"; the next event or focus tries again.
    }
    if (id !== latest.current) return;
    inFlight.current = null;
    setState((current) =>
      next.status === "failed" && current.status === "ready" ? current : next,
    );
  }, [spaceId]);

  useEffect(() => {
    void load();
    return () => {
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [load]);

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

  return state;
}
