"use client";
import type { FoodView } from "@frejsi/shared/schemas/food";
import { useCallback, useEffect, useMemo, useState } from "react";

import { FIXED_FILTERS, libraryApi, OWN_ORIGINS, type LibraryFilter } from "./api-client";

export type LoadStatus = "loading" | "ready" | "error";

const FIXED: ReadonlySet<string> = new Set(FIXED_FILTERS);

/** Counts from an unfiltered list, for a route that answers a bare `FoodView[]`. */
export function deriveCounts(foods: readonly FoodView[]): Record<string, number> {
  const counts: Record<string, number> = {
    all: foods.length,
    unverified: foods.filter((food) => !food.verified).length,
    own: foods.filter((food) => OWN_ORIGINS.has(food.origin)).length,
    favourites: foods.filter((food) => food.favourite).length,
  };
  for (const food of foods) {
    if (!OWN_ORIGINS.has(food.origin)) counts[food.origin] = (counts[food.origin] ?? 0) + 1;
  }
  return counts;
}

/**
 * The library's list state: what `GET foods` answered for the current filter and query, the
 * counts per filter, and local updates after a write so a tick or a save shows without reload.
 * A verified row stays in the "Ikke tjekket" list until the next load, so the check is seen.
 */
export function useLibrary(spaceId: string) {
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [foods, setFoods] = useState<FoodView[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>();
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStatus((current) => (current === "ready" ? current : "loading"));
    libraryApi
      .list(spaceId, { filter, q: query }, controller.signal)
      .then((list) => {
        setFoods(list.foods);
        if (list.counts) setCounts(list.counts);
        else if (filter === "all" && !query.trim()) setCounts(deriveCounts(list.foods));
        setStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error");
      });
    return () => {
      controller.abort();
    };
  }, [spaceId, filter, query, reloads]);

  /** Origin chips from the origins present: "Fra Open Food Facts", "Fra Frida". */
  const origins = useMemo(
    () =>
      Object.entries(counts ?? {})
        .filter(([key, count]) => !FIXED.has(key) && !OWN_ORIGINS.has(key) && count > 0)
        .map(([key]) => key),
    [counts],
  );

  const replace = useCallback((saved: FoodView, previous?: FoodView) => {
    setFoods((list) =>
      list.some((food) => food.id === saved.id)
        ? list.map((food) => (food.id === saved.id ? saved : food))
        : [saved, ...list],
    );
    setCounts((current) => {
      if (!current) return current;
      const next = { ...current };
      if (!previous) next.all = (next.all ?? 0) + 1;
      const was = previous ? (previous.verified ? 0 : 1) : 0;
      next.unverified = Math.max(0, (next.unverified ?? 0) - was + (saved.verified ? 0 : 1));
      return next;
    });
  }, []);

  const markVerified = useCallback(
    (ids: readonly string[]) => {
      const changed = foods.filter((food) => ids.includes(food.id) && !food.verified).length;
      setFoods((list) =>
        list.map((food) => (ids.includes(food.id) ? { ...food, verified: true } : food)),
      );
      setCounts((current) =>
        current
          ? { ...current, unverified: Math.max(0, (current.unverified ?? 0) - changed) }
          : current,
      );
    },
    [foods],
  );

  const removeIds = useCallback((ids: readonly string[]) => {
    setFoods((list) => list.filter((food) => !ids.includes(food.id)));
    setReloads((value) => value + 1);
  }, []);

  return {
    filter,
    setFilter,
    query,
    setQuery,
    status,
    foods,
    counts,
    origins,
    reload: () => {
      setReloads((value) => value + 1);
    },
    replace,
    markVerified,
    removeIds,
  };
}
export type LibraryState = ReturnType<typeof useLibrary>;
