"use client";
import type { SymptomView } from "@frejsi/shared/schemas/symptom";
import { useCallback, useEffect, useState } from "react";
import { useLiveFeed } from "@/lib/live/useLiveFeed";
import { loadSymptoms } from "./api";

export type SymptomsLoad =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; symptoms: SymptomView[] };

/**
 * The space's symptoms in a range, reloaded on every symptom event of the live feed (events only,
 * never readings: the hook serves a viewer's screens too). `refresh` reloads by hand after an
 * own write, so the list never waits for the feed's latency.
 */
export function useSymptoms(
  spaceId: string,
  from: string,
  to: string,
): SymptomsLoad & { refresh: () => void } {
  const { subscribe } = useLiveFeed(spaceId, { readings: false });
  const [load, setLoad] = useState<SymptomsLoad>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);
  useEffect(() => {
    let live = true;
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
  }, [spaceId, from, to, version]);
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
