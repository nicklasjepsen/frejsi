"use client";

import type { Role } from "@frejsi/shared";
import { DayView } from "@frejsi/shared/schemas/meal";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { DayList, DayTotal, formatAskList, formatDayDate, localDateOf } from "@/components/day";
import { PeopleView } from "@/components/people/contract";
import { Notice } from "@/components/ui/Notice";
import type { AppLocale } from "@/lib/i18n/routing";
import { formatClock } from "@/lib/i18n/time";
import type { SocketFactory } from "@/lib/live/live-feed";
import { useLiveFeed } from "@/lib/live/useLiveFeed";

import styles from "./today.module.css";

export interface TodayScreenProps {
  spaceId: string;
  locale: AppLocale;
  /** The member's role: the "ser med" notice and the members read behind it are for a viewer only. */
  role: Role;
  /** Tests only: the network and the socket. */
  fetch?: typeof fetch;
  socketFactory?: SocketFactory;
}

/** How often the screen checks whether a failed read needs a retry or the day has turned. */
export const RECHECK_MS = 30_000;

type DayState =
  | { status: "loading" }
  | { status: "failed" }
  /** 403 or 404: this member may no longer read the space; nothing of it stays on screen. */
  | { status: "refused"; code: "forbidden" | "not-found" }
  | { status: "ready"; day: DayView };

/**
 * I dag (Historik-Viewer): the space's meals and carbs today, for every role. It reads `day` (and
 * `members`, for a viewer's notice) and listens to the live feed without readings, so the only
 * routes it calls are `day`, `members`, `negotiate` and `events`; nothing of glucose is fetched or
 * drawn (plan §7, task 8). The notice explains the viewer's view to the viewer; an owner or carer
 * who opens the page is not told what they can see as »ser med«.
 * The day is fetched again on every `meal.*` and `space.updated` event (the timezone may have
 * changed), when the feed has its cursor, on focus, after a failed read and when the space's day
 * turns at midnight; the latter two are checked every 30 seconds.
 */
export function TodayScreen({
  spaceId,
  locale,
  role,
  fetch: fetchImpl,
  socketFactory,
}: TodayScreenProps) {
  const t = useTranslations("today");
  const errors = useTranslations("errors.api");
  const request = useCallback(
    (path: string, signal?: AbortSignal) =>
      (fetchImpl ?? globalThis.fetch)(`/api/spaces/${spaceId}/${path}`, {
        headers: { accept: "application/json" },
        ...(signal ? { signal } : {}),
      }),
    [fetchImpl, spaceId],
  );
  const feed = useLiveFeed(spaceId, {
    readings: false,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
    ...(socketFactory ? { socketFactory } : {}),
  });

  const [state, setState] = useState<DayState>({ status: "loading" });
  const [owners, setOwners] = useState<string[]>([]);
  const latestRequest = useRef(0);
  /** The read in flight, if any, and when it started: the recheck replaces one that stalls. */
  const inFlight = useRef<{ controller: AbortController; startedAt: number } | null>(null);
  const lastFailed = useRef(false);

  const loadDay = useCallback(async () => {
    const id = ++latestRequest.current;
    inFlight.current?.controller.abort();
    const controller = new AbortController();
    inFlight.current = { controller, startedAt: Date.now() };
    let next: DayState = { status: "failed" };
    try {
      const response = await request("day", controller.signal);
      if (response.status === 403 || response.status === 404) {
        next = { status: "refused", code: response.status === 403 ? "forbidden" : "not-found" };
      } else if (response.ok) {
        const parsed = DayView.safeParse(await response.json());
        if (parsed.success) next = { status: "ready", day: parsed.data };
      }
    } catch {
      // Shown as "could not be loaded"; the recheck tries again.
    }
    if (id !== latestRequest.current) return;
    inFlight.current = null;
    lastFailed.current = next.status === "failed";
    // A failed refresh keeps the day already on screen; a refusal never does.
    setState((current) =>
      next.status === "failed" && current.status === "ready" ? current : next,
    );
  }, [request]);

  useEffect(() => {
    void loadDay();
    return () => {
      inFlight.current?.controller.abort();
      inFlight.current = null;
    };
  }, [loadDay]);

  // Once the feed knows its cursor, everything after it arrives as events: one more read closes
  // the gap between the first read and the cursor.
  useEffect(() => {
    if (feed.loaded) void loadDay();
  }, [feed.loaded, loadDay]);

  const { subscribe } = feed;
  useEffect(() => {
    const refresh = () => void loadDay();
    const offs = [
      subscribe("meal.created", refresh),
      subscribe("meal.updated", refresh),
      subscribe("meal.deleted", refresh),
      subscribe("space.updated", refresh),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [subscribe, loadDay]);

  const shownDay = state.status === "ready" ? state.day : null;
  useEffect(() => {
    const timer = setInterval(() => {
      const turned = shownDay && localDateOf(new Date(), shownDay.timezone) !== shownDay.date;
      const pending = inFlight.current;
      const stalled = pending !== null && Date.now() - pending.startedAt >= RECHECK_MS;
      if (stalled || (pending === null && (lastFailed.current || turned))) void loadDay();
    }, RECHECK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [shownDay, loadDay]);

  useEffect(() => {
    const onFocus = () => void loadDay();
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadDay();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadDay]);

  const isViewer = role === "viewer";
  useEffect(() => {
    if (!isViewer) return;
    const cancelled = { current: false };
    void (async () => {
      try {
        const response = await request("members");
        if (!response.ok) return;
        const parsed = PeopleView.safeParse(await response.json());
        if (!parsed.success || cancelled.current) return;
        setOwners(parsed.data.members.filter((m) => m.role === "owner").map((m) => m.name));
      } catch {
        // The notice then goes without names.
      }
    })();
    return () => {
      cancelled.current = true;
    };
  }, [request, isViewer]);

  const notice = isViewer ? (
    <Notice tone="sunken" data-testid="today-notice">
      {owners.length > 0
        ? t("notice", { owners: formatAskList(owners, locale) })
        : t("noticeNoOwners")}
    </Notice>
  ) : null;

  // The feed is refused too when the member was removed or the space is gone.
  const refusal =
    state.status === "refused"
      ? state.code
      : feed.error === "forbidden" || feed.error === "not-found"
        ? feed.error
        : null;
  if (refusal !== null || state.status === "refused") {
    return (
      <div className={styles.page} data-testid="today">
        <Notice tone="sunken" role="alert">
          {errors(refusal ?? "forbidden")}
        </Notice>
      </div>
    );
  }

  if (state.status === "loading") {
    return <div className={styles.page} aria-busy="true" data-testid="today-loading" />;
  }

  if (state.status === "failed") {
    return (
      <div className={styles.page} data-testid="today">
        <Notice tone="sunken" role="alert">
          {t("loadFailed")}
        </Notice>
        {notice}
      </div>
    );
  }

  const { day } = state;
  return (
    <div className={styles.page} data-testid="today">
      <header className={styles.head}>
        <h1 className={styles.date}>{t("dateLine", { date: formatDayDate(day.date, locale) })}</h1>
        <DayTotal carbs={day.totalCarbs} suffix={t("totalSuffix")} />
        {day.lastMealAt && (
          <p className={styles.summary} data-testid="day-summary">
            {t("summary", {
              count: day.mealCount,
              time: formatClock(new Date(day.lastMealAt), day.timezone),
            })}
          </p>
        )}
      </header>
      <DayList meals={day.meals} timeZone={day.timezone} />
      {notice}
    </div>
  );
}
