"use client";
import { AiUsage, WeekInsightView } from "@frejsi/shared/schemas/ai";
import type { Role } from "@frejsi/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { localDateOf } from "@/components/day/format";
import type { LiveFeedView } from "@/lib/live/useLiveFeed";

export interface NowAi {
  enabled: boolean;
  provider: string | null;
  ready: boolean;
}
export function useNowAi(
  spaceId: string,
  enabled: boolean,
  provider: string | null,
  role: Role,
  simpleMode: boolean,
  subscribe: LiveFeedView["subscribe"],
  loaded: boolean,
  now: Date,
  zone: string,
): NowAi {
  const [state, setState] = useState<NowAi>({ enabled, provider, ready: false });
  const generation = useRef(0);
  const date = localDateOf(now, zone);
  const load = useCallback(async () => {
    if (role === "viewer") return;
    const id = ++generation.current;
    try {
      const response = await fetch(`/api/spaces/${encodeURIComponent(spaceId)}/ai`);
      if (!response.ok) throw new Error("ai-unavailable");
      const usage = AiUsage.parse(await response.json());
      let ready = false;
      if (usage.enabled && !simpleMode) {
        const monday = new Date(`${date}T12:00:00Z`);
        monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
        const week = await fetch(
          `/api/spaces/${encodeURIComponent(spaceId)}/history/week/insight?start=${monday.toISOString().slice(0, 10)}`,
        );
        const parsed = week.ok ? WeekInsightView.safeParse(await week.json()) : null;
        ready = parsed?.success === true && parsed.data.state === "ready";
      }
      if (id === generation.current)
        setState({ enabled: usage.enabled, provider: usage.provider ?? null, ready });
    } catch {
      if (id === generation.current) setState({ enabled: false, provider: null, ready: false });
    }
  }, [spaceId, role, simpleMode, date]);
  useEffect(() => {
    setState({ enabled, provider, ready: false });
    if (enabled && loaded) void load();
    return () => {
      ++generation.current;
    };
  }, [enabled, provider, loaded, load]);
  useEffect(() => {
    if (role === "viewer") return;
    const offs = (["space.updated", "insight.created", "insight.updated"] as const).map((type) =>
      subscribe(type, () => {
        void load();
      }),
    );
    return () => {
      offs.forEach((off) => {
        off();
      });
    };
  }, [subscribe, role, load]);
  return state;
}
