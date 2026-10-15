"use client";

import type { FoodView } from "@frejsi/shared/schemas/food";
import { useCallback, useEffect, useRef, useState } from "react";

import { libraryApi } from "@/components/library/api-client";
import { loadPickerFoods } from "@/components/simple/api";
import type { FeedEventType } from "@/lib/live/live-feed";

type Subscribe = (type: FeedEventType, handler: () => void) => () => void;

export interface NowFoods {
  /** simpleMode: the verified foods for the "Min mad" tiles, recently eaten first. */
  myFood: FoodView[];
  /** Everyone else: how many foods wait for a tick ("Fødevarer der ikke er tjekket"). */
  unverified: number;
}

const FOOD_EVENTS: FeedEventType[] = [
  "food.created",
  "food.updated",
  "food.verified",
  "food.deleted",
  "meal.created",
];

/**
 * The foods Nu shows next to the glucose: through `GET foods` only, which the route filters for a
 * simpleMode session. Read again when a food or meal event arrives. A failed read shows nothing
 * rather than a stale count.
 */
export function useNowFoods(
  spaceId: string,
  simpleMode: boolean,
  subscribe: Subscribe | undefined,
): NowFoods {
  const [foods, setFoods] = useState<NowFoods>({ myFood: [], unverified: 0 });
  const latest = useRef(0);

  const load = useCallback(async () => {
    const id = ++latest.current;
    let next: NowFoods = { myFood: [], unverified: 0 };
    try {
      if (simpleMode) {
        next = { myFood: await loadPickerFoods(spaceId), unverified: 0 };
      } else {
        const list = await libraryApi.list(spaceId, { filter: "unverified", q: "" });
        next = { myFood: [], unverified: list.counts?.unverified ?? list.foods.length };
      }
    } catch {
      // Nothing to show: the card and the tiles are extras on Nu.
    }
    if (id === latest.current) setFoods(next);
  }, [spaceId, simpleMode]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!subscribe) return;
    const refresh = () => void load();
    const offs = FOOD_EVENTS.map((type) => subscribe(type, refresh));
    return () => {
      for (const off of offs) off();
    };
  }, [subscribe, load]);

  return foods;
}
