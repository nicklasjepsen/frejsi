"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { LiveFeedView } from "@/lib/live/useLiveFeed";

import { MealDetailError } from "./api";

export type MealResource<T> =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "not-found" }
  | { status: "ready"; data: T };

export interface MealFeed {
  /** True once the feed has its cursor: anything committed after the first read arrives later. */
  loaded: boolean;
  subscribe: LiveFeedView["subscribe"];
}

/**
 * One meal read for this screen: on mount, again once the feed has its cursor (something
 * committed between the first read and the cursor would otherwise arrive as neither), on a
 * `meal.updated` for this meal (plan §8) and on `space.updated` (target, unit or timezone may have
 * changed; `onSpaceUpdated` reloads what the page passed in); `onDeleted` on a `meal.deleted` for
 * it. A failed refresh keeps what is on screen; a 404 (the meal is gone, or belongs to another
 * space) is its own state. The feed is the one from `useLiveFeed`, so the screen keeps one.
 */
export function useMealResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  mealId: string,
  feed: MealFeed,
  handlers: { onDeleted: () => void; onSpaceUpdated?: () => void },
): { state: MealResource<T>; retry: () => void; refresh: () => Promise<boolean> } {
  const { loaded, subscribe } = feed;
  const [state, setState] = useState<MealResource<T>>({ status: "loading" });
  const latest = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const refresh = useCallback(async () => {
    const id = ++latest.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    let next: MealResource<T>;
    try {
      next = { status: "ready", data: await loadRef.current(controller.signal) };
    } catch (error) {
      if (controller.signal.aborted) return false;
      next =
        error instanceof MealDetailError && error.status === 404
          ? { status: "not-found" }
          : { status: "failed" };
    }
    if (id !== latest.current) return false;
    inFlight.current = null;
    setState((current) =>
      next.status === "failed" && current.status === "ready" ? current : next,
    );
    return next.status === "ready";
  }, []);

  useEffect(() => {
    setState({ status: "loading" });
  }, [mealId]);

  // Again once `loaded` turns true: the feed's cursor is then known.
  useEffect(() => {
    void refresh();
    return () => {
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [refresh, mealId, loaded]);

  useEffect(() => {
    const offUpdated = subscribe("meal.updated", (envelope) => {
      if (envelope.payload.mealId === mealId) void refresh();
    });
    const offDeleted = subscribe("meal.deleted", (envelope) => {
      if (envelope.payload.mealId === mealId) handlersRef.current.onDeleted();
    });
    const offSpace = subscribe("space.updated", () => {
      handlersRef.current.onSpaceUpdated?.();
      void refresh();
    });
    return () => {
      offUpdated();
      offDeleted();
      offSpace();
    };
  }, [subscribe, mealId, refresh]);

  return {
    state,
    refresh,
    retry: () => {
      setState({ status: "loading" });
      void refresh();
    },
  };
}
