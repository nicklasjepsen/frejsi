"use client";
import { dayRange } from "@frejsi/shared/meals/day-range";
import type { SymptomView } from "@frejsi/shared/schemas/symptom";
import { useCallback, useEffect, useState } from "react";
import { localDateOf } from "@/components/day/format";
import { useLiveFeed } from "@/lib/live/useLiveFeed";
import { loadSymptoms } from "./api";

export type SymptomsLoad =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; symptoms: SymptomView[] };

/** One clock for every mount: a fresh arrow function per render would refetch without end. */
export const DEFAULT_NOW = (): Date => new Date();

/** Today's bounds in the space's zone, decided at each load so the list follows the calendar. */
export function todayBounds(now: Date, timeZone: string): { from: string; to: string } {
  const [from, to] = dayRange(localDateOf(now, timeZone), timeZone);
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * The space's symptoms of the current local day, reloaded on every symptom event of the live
 * feed (events only, never readings: the hook serves a viewer's screens too). `refresh` reloads
 * by hand after an own write, so the list never waits for the feed's latency.
 */
export function useSymptoms(
  spaceId: string,
  timeZone: string,
  now: () => Date = DEFAULT_NOW,
): SymptomsLoad & { refresh: () => void } {
  const { subscribe } = useLiveFeed(spaceId, { readings: false });
  const [load, setLoad] = useState<SymptomsLoad>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);
  useEffect(() => {
    let live = true;
    const { from, to } = todayBounds(now(), timeZone);
    void loadSymptoms(spaceId, from, to)
      .then((symptoms) => {
        if (live) setLoad({ status: "ready", symptoms });
      })
      .catch(() => {
        if (live) setLoad({ status: "failed" });
      });
    return () => {
      live = false;
    };
  }, [spaceId, timeZone, now, version]);
  useEffect(() => {
    const off = ["symptom.created", "symptom.updated", "symptom.deleted"].map((type) =>
      subscribe(type as "symptom.created", refresh),
    );
    return () => {
      for (const unsubscribe of off) unsubscribe();
    };
  }, [subscribe, refresh]);
  return { ...load, refresh };
}
