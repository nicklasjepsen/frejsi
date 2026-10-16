"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import type { LiveFeedView } from "@/lib/live/useLiveFeed";
export function useInsight<T>(
  url: string,
  schema: z.ZodType<T>,
  fetchImpl?: typeof fetch,
  feed?: Pick<LiveFeedView, "subscribe">,
  refreshKey?: boolean,
) {
  const [entry, setEntry] = useState<{ url: string; value: T } | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const id = ++generation.current;
    try {
      const response = await (fetchImpl ?? globalThis.fetch)(url);
      const parsed = response.ok ? schema.safeParse(await response.json()) : null;
      if (id === generation.current) setEntry(parsed?.success ? { url, value: parsed.data } : null);
    } catch {
      if (id === generation.current) setEntry(null);
    }
  }, [url, schema, fetchImpl]);
  useEffect(() => {
    void load();
    return () => {
      ++generation.current;
    };
  }, [load, refreshKey]);
  useEffect(() => {
    if (!feed) return;
    const clear = () => {
      setEntry(null);
      void load();
    };
    const offs = [
      feed.subscribe("insight.created", (event) => {
        if (
          url.includes(`/meals/${encodeURIComponent(event.payload.subjectKey)}/`) ||
          url.includes(`start=${event.payload.subjectKey}`)
        )
          void load();
      }),
      feed.subscribe("insight.updated", () => {
        void load();
      }),
      feed.subscribe("meal.updated", clear),
      feed.subscribe("space.updated", clear),
      feed.subscribe("member.updated", clear),
      feed.subscribe("member.removed", clear),
    ];
    return () => {
      offs.forEach((off) => {
        off();
      });
    };
  }, [feed, load, url]);
  return { value: entry?.url === url ? entry.value : null, load };
}
