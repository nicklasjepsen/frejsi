"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";

export type DayEntry<T> =
  { status: "loading" } | { status: "failed" } | { status: "ready"; day: T };

/** One cached read per calendar date; explicit refreshes replace only that date. */
export function useDays<T extends { date: string }>(
  spaceId: string,
  route: string,
  schema: z.ZodType<T>,
  fetchImpl?: typeof fetch,
) {
  const [days, setDays] = useState<Record<string, DayEntry<T>>>({});
  const [refused, setRefused] = useState(false);
  const cache = useRef<Record<string, DayEntry<T>>>({});
  const pending = useRef(
    new Map<string, { controller: AbortController; promise: Promise<void> }>(),
  );
  const denied = useRef(false);
  const load = useCallback(
    (date: string, refresh = false): Promise<void> => {
      if (denied.current) return Promise.resolve();
      const previous = pending.current.get(date);
      if (previous && !refresh) return previous.promise;
      if (cache.current[date]?.status === "ready" && !refresh) return Promise.resolve();
      previous?.controller.abort();
      const controller = new AbortController();
      const ignored = () => controller.signal.aborted || denied.current;
      const put = (entry: DayEntry<T>) => {
        cache.current = { ...cache.current, [date]: entry };
        setDays(cache.current);
      };
      if (cache.current[date]?.status !== "ready") put({ status: "loading" });
      const promise = (async () => {
        try {
          const response = await (fetchImpl ?? globalThis.fetch)(
            `/api/spaces/${encodeURIComponent(spaceId)}/${route}?${new URLSearchParams({ date })}`,
            { signal: controller.signal, headers: { accept: "application/json" } },
          );
          if (ignored()) return;
          if (response.status === 403 || response.status === 404) {
            denied.current = true;
            cache.current = {};
            setDays({});
            setRefused(true);
            return;
          }
          if (!response.ok) throw new Error("day read failed");
          const day = schema.parse(await response.json());
          if (day.date !== date) throw new Error("day mismatch");
          if (!ignored()) put({ status: "ready", day });
        } catch {
          if (!ignored()) put({ status: "failed" });
        } finally {
          if (pending.current.get(date)?.controller === controller) pending.current.delete(date);
        }
      })();
      pending.current.set(date, { controller, promise });
      return promise;
    },
    [fetchImpl, route, schema, spaceId],
  );
  const refreshAll = useCallback(
    () => Promise.all(Object.keys(cache.current).map((date) => load(date, true))),
    [load],
  );
  useEffect(() => {
    const requests = pending.current;
    return () => {
      for (const { controller } of requests.values()) controller.abort();
      requests.clear();
    };
  }, []);
  return { days, load, refreshAll, refused };
}
