"use client";

import { DayHistoryView, type DayHistoryMeal } from "@frejsi/shared/schemas/history";
import { useCallback, useEffect, useRef, useState } from "react";

import type { FeedEventType } from "@/lib/live/live-feed";

import { localDateOf } from "@/components/day/format";

export type NowHistoryState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; day: DayHistoryView; markers: DayHistoryMeal[] };

type Subscribe = (type: FeedEventType, handler: () => void) => () => void;

/** How often the hook checks whether the space's day has turned or a failed read needs a retry. */
export const DAY_RECHECK_MS = 30_000;

/**
 * The events after which the day is read again (plan §7: "refetch on `meal.*` events"), and
 * `pump.meals`: a meal the pump record made, linked or removed (v0.7.0 plan §6). It travels in the
 * glucose group, so only an owner's or a carer's feed delivers it.
 */
export const NOW_HISTORY_REFRESH_ON: FeedEventType[] = [
  "meal.created",
  "meal.updated",
  "meal.deleted",
  "space.updated",
  "pump.meals",
];

/** Owner/carer-only Now metadata. Live readings remain exclusively in useLiveFeed. */
export function useNowHistory(
  spaceId: string,
  subscribe: Subscribe | undefined,
  enabled: boolean,
  fromDate: string,
): NowHistoryState {
  // Scoped to the space it was read for: another space's meals are never shown, not even while
  // the new space's first read is out or after it failed.
  const [state, setState] = useState<{ spaceId: string; state: NowHistoryState }>({
    spaceId,
    state: { status: "loading" },
  });
  const latest = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  /** Retry a failed read on the next timer tick. */
  const lastFailed = useRef(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    const id = ++latest.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    let next: NowHistoryState = { status: "failed" };
    try {
      const read = async (date?: string) => {
        const query = new URLSearchParams({ readings: "0", ...(date ? { date } : {}) });
        const response = await fetch(
          `/api/spaces/${encodeURIComponent(spaceId)}/history/day?${query.toString()}`,
          {
            headers: { accept: "application/json" },
            credentials: "same-origin",
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error("history-read-failed");
        return DayHistoryView.parse(await response.json());
      };
      const day = await read();
      // Before 06:00 the curve still begins yesterday; the table remains today's meals only.
      const previous = fromDate < day.date ? await read(fromDate) : null;
      next = { status: "ready", day, markers: [...day.meals, ...(previous?.meals ?? [])] };
    } catch {
      // The screen shows the existing meal-read error; the recheck tries again.
    }
    if (id !== latest.current) return;
    inFlight.current = null;
    lastFailed.current = next.status === "failed";
    setState({ spaceId, state: next });
  }, [spaceId, enabled, fromDate]);

  // Wait for the feed cursor; it closes the initial meal-read race.
  useEffect(() => {
    void load();
    return () => {
      ++latest.current;
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [load]);

  const current: NowHistoryState =
    enabled && state.spaceId === spaceId ? state.state : { status: "loading" };
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
    const offs = NOW_HISTORY_REFRESH_ON.map((type) => subscribe(type, refresh));
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
