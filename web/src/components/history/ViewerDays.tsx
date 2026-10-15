"use client";
import { DayView } from "@frejsi/shared/schemas/meal";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { DayList, DayTotal, formatAskList } from "@/components/day";
import { PeopleView } from "@/components/people/contract";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLiveFeed } from "@/lib/live/useLiveFeed";
import { dayHeading, shiftDate } from "./dates";
import type { HistoryProps } from "./HistoryScreen";
import { DayLoading, OlderDays } from "./OlderDays";
import { useToday } from "./useToday";
import { useFeedReady } from "./useFeedReady";
import { useDays } from "./useDays";
import styles from "./history.module.css";

/** This branch only parses DayView and mounts meal-only components, on both screen sizes. */
export function ViewerDays({
  spaceId,
  locale,
  today: initialToday,
  fetch: fetchImpl,
  socketFactory,
}: HistoryProps) {
  const t = useTranslations("history");
  const router = useRouter();
  const dayCopy = useTranslations("today");
  const errors = useTranslations("errors.api");
  const { days, load, refreshAll, refused } = useDays(spaceId, "day", DayView, fetchImpl);
  const zone = Object.values(days).find((entry) => entry.status === "ready");
  const today = useToday(initialToday, zone?.status === "ready" ? zone.day.timezone : undefined);
  const previousToday = useRef(today);
  const feed = useLiveFeed(spaceId, {
    readings: false,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
    ...(socketFactory ? { socketFactory } : {}),
  });
  const { ready, lateCursor } = useFeedReady(feed.loaded);
  const [owners, setOwners] = useState<string[]>([]);
  useEffect(() => {
    if (!ready) return;
    if (previousToday.current !== today) {
      void load(previousToday.current, true);
      previousToday.current = today;
    }
    void load(today);
    void load(shiftDate(today, -1));
  }, [load, today, ready]);
  useEffect(() => {
    if (lateCursor) void refreshAll();
  }, [lateCursor, refreshAll]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await (fetchImpl ?? globalThis.fetch)(
          `/api/spaces/${encodeURIComponent(spaceId)}/members`,
          { signal: controller.signal },
        );
        if (!response.ok) return;
        const people = PeopleView.parse(await response.json());
        if (!controller.signal.aborted)
          setOwners(people.members.filter((m) => m.role === "owner").map((m) => m.name));
      } catch {
        /* The existing notice has a no-owner variant. */
      }
    })();
    return () => {
      controller.abort();
    };
  }, [spaceId, fetchImpl]);
  const { subscribe } = feed;
  useEffect(() => {
    const refresh = () => {
      void load(today, true);
    };
    const membershipChanged = () => {
      void refreshAll();
      router.refresh();
    };
    const offs = [
      subscribe("meal.created", refresh),
      subscribe("meal.updated", refresh),
      subscribe("meal.deleted", refresh),
      subscribe("member.updated", membershipChanged),
      subscribe("member.removed", membershipChanged),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [subscribe, load, today, refreshAll, router]);
  const dates = Object.keys(days).sort().reverse();
  const oldest = dates.at(-1) ?? today;
  let emptyRun = 0;
  // Walk a contiguous run from today; a failed or pending read cannot count as an empty day.
  for (let date = today; days[date]?.status === "ready"; date = shiftDate(date, -1)) {
    const entry = days[date];
    if (entry?.status !== "ready") break;
    emptyRun = entry.day.mealCount === 0 ? emptyRun + 1 : 0;
  }
  const loadOlder = useCallback(() => {
    void load(shiftDate(oldest, -1));
  }, [load, oldest]);
  if (refused || feed.error === "forbidden" || feed.error === "not-found")
    return (
      <Notice tone="sunken" role="alert">
        {errors("forbidden")}
      </Notice>
    );
  return (
    <div className={`${styles.page} ${styles.viewer}`} data-testid="viewer-days">
      <PageHeader title={t("earlierDays")} />
      {dates.length === 0 && <DayLoading />}
      {dates.map((date) => {
        const entry = days[date];
        return (
          <section className={styles.viewerDay} data-date={date} key={date}>
            <h2>{dayHeading(date, locale)}</h2>
            {entry?.status === "ready" ? (
              <>
                <DayTotal carbs={entry.day.totalCarbs} suffix={t("totalSuffix")} />
                <DayList meals={entry.day.meals} timeZone={entry.day.timezone} />
              </>
            ) : entry?.status === "loading" ? (
              <DayLoading />
            ) : (
              <Notice tone="sunken" role="alert">
                {t("loadFailed")}{" "}
                <button type="button" onClick={() => void load(date)}>
                  {t("retry")}
                </button>
              </Notice>
            )}
          </section>
        );
      })}
      <Notice tone="sunken">
        {owners.length
          ? dayCopy("notice", { owners: formatAskList(owners, locale) })
          : dayCopy("noticeNoOwners")}
      </Notice>
      <OlderDays
        load={loadOlder}
        done={emptyRun >= 7}
        disabled={dates.some((date) => days[date]?.status !== "ready")}
      />
    </div>
  );
}
