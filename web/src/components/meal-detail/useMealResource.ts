"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { LiveFeedView } from "@/lib/live/useLiveFeed";

import { MealDetailError } from "./api";

export type MealResource<T> =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "not-found" }
  | { status: "ready"; data: T };

/**
 * One meal read for this screen: once on mount, again on a `meal.updated` for this meal (plan
 * §8), and `onDeleted` on a `meal.deleted` for it. A failed refresh keeps what is on screen; a 404
 * (the meal is gone, or belongs to another space) is its own state. `subscribe` is the one from
 * `useLiveFeed`, so the screen keeps a single feed.
 */
export function useMealResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  mealId: string,
  subscribe: LiveFeedView["subscribe"] | undefined,
  onDeleted: () => void,
): { state: MealResource<T>; retry: () => void } {
  const [state, setState] = useState<MealResource<T>>({ status: "loading" });
  const latest = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const deletedRef = useRef(onDeleted);
  deletedRef.current = onDeleted;

  const refresh = useCallback(async () => {
    const id = ++latest.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    let next: MealResource<T>;
    try {
      next = { status: "ready", data: await loadRef.current(controller.signal) };
    } catch (error) {
      if (controller.signal.aborted) return;
      next =
        error instanceof MealDetailError && error.status === 404
          ? { status: "not-found" }
          : { status: "failed" };
    }
    if (id !== latest.current) return;
    inFlight.current = null;
    setState((current) =>
      next.status === "failed" && current.status === "ready" ? current : next,
    );
  }, []);

  useEffect(() => {
    setState({ status: "loading" });
    void refresh();
    return () => {
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [refresh, mealId]);

  useEffect(() => {
    if (!subscribe) return;
    const offUpdated = subscribe("meal.updated", (envelope) => {
      if (envelope.payload.mealId === mealId) void refresh();
    });
    const offDeleted = subscribe("meal.deleted", (envelope) => {
      if (envelope.payload.mealId === mealId) deletedRef.current();
    });
    return () => {
      offUpdated();
      offDeleted();
    };
  }, [subscribe, mealId, refresh]);

  return {
    state,
    retry: () => {
      setState({ status: "loading" });
      void refresh();
    },
  };
}
