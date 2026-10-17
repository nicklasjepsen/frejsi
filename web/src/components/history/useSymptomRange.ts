"use client";
import type { SpaceSymptomKind, SymptomView } from "@frejsi/shared/schemas/symptom";
import { useCallback, useEffect, useState } from "react";

import { loadSymptomKinds, loadSymptoms } from "@/components/symptoms/api";
import type { FeedEventType } from "@/lib/live/live-feed";

/**
 * The last instant before `iso`: the symptoms route includes both ends of its range, and a day's
 * bound is the next midnight, so a symptom logged exactly then belongs to the next day only.
 */
export function beforeInstant(iso: string): string {
  return new Date(Date.parse(iso) - 1).toISOString();
}

export type SymptomRangeState =
  { status: "loading" } | { status: "failed" } | { status: "ready"; symptoms: SymptomView[] };

type Subscribe = (type: FeedEventType, handler: () => void) => () => void;

/** The events after which the range is read again (plan §5: "refetch on `symptom.*` events"). */
export const SYMPTOM_REFRESH_ON: FeedEventType[] = [
  "symptom.created",
  "symptom.updated",
  "symptom.deleted",
];

/**
 * The space's symptoms between `from` and `to` (ISO instants, at most eight days), through the
 * symptoms route of #199 (`loadSymptoms`), read again on every `symptom.*` event of the screen's
 * live feed. The curves use this where `useSymptoms` (today only, with a feed of its own) does
 * not fit: a history day, a week, a meal's window, the desktop day. A viewer's screen may call
 * it: a symptom carries no glucose. The space's own kinds come along for the labels.
 */
export function useSymptomRange(
  spaceId: string,
  from: string,
  to: string,
  subscribe: Subscribe | undefined,
  enabled = true,
): SymptomRangeState & { kinds: SpaceSymptomKind[]; refresh: () => void } {
  const [state, setState] = useState<{ key: string; state: SymptomRangeState }>({
    key: "",
    state: { status: "loading" },
  });
  const [kinds, setKinds] = useState<SpaceSymptomKind[]>([]);
  const [version, setVersion] = useState(0);
  const key = `${spaceId}:${from}:${to}`;
  const refresh = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadSymptoms(spaceId, from, to)
      .then((symptoms) => {
        if (live) setState({ key, state: { status: "ready", symptoms } });
      })
      .catch(() => {
        if (live) setState({ key, state: { status: "failed" } });
      });
    return () => {
      live = false;
    };
  }, [spaceId, from, to, key, version, enabled]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadSymptomKinds(spaceId)
      .then((loaded) => {
        if (live) setKinds(loaded);
      })
      .catch(() => {
        // The six default kinds still have names; a custom kind shows its slug until the read works.
      });
    return () => {
      live = false;
    };
  }, [spaceId, enabled]);
  useEffect(() => {
    if (!subscribe || !enabled) return;
    const offs = SYMPTOM_REFRESH_ON.map((type) => subscribe(type, refresh));
    return () => {
      for (const off of offs) off();
    };
  }, [subscribe, refresh, enabled]);
  const current = enabled && state.key === key ? state.state : { status: "loading" as const };
  return { ...current, kinds, refresh };
}
