"use client";
import { DayHistoryView } from "@frejsi/shared/schemas/history";
import type { GlucoseUnit } from "@frejsi/shared/schemas/glucose";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowNav } from "@/components/ui/ArrowNav";
import { ChipGroup } from "@/components/ui/ChipGroup";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";
import type { SocketFactory } from "@/lib/live/live-feed";
import { useLiveFeed } from "@/lib/live/useLiveFeed";
import { dayHeading, shiftDate } from "./dates";
import { WeekInsightLink } from "@/components/observation/WeekInsightLink";
import { mondayOf } from "@/components/history-week/dates";
import { DaySection } from "./DaySection";
import { DayLoading, OlderDays } from "./OlderDays";
import { useToday } from "./useToday";
import { useFeedReady } from "./useFeedReady";
import { useDays } from "./useDays";
import styles from "./history.module.css";

export interface HistoryProps {
  spaceId: string;
  locale: AppLocale;
  today: string;
  initialDate: string;
  aiEnabled?: boolean;
  fetch?: typeof fetch;
  socketFactory?: SocketFactory;
}

export function HistoryScreen({
  spaceId,
  locale,
  today: initialToday,
  initialDate,
  unit,
  fetch: fetchImpl,
  socketFactory,
  aiEnabled = false,
}: HistoryProps & { unit: GlucoseUnit }) {
  const t = useTranslations("history");
  const router = useRouter();
  const errors = useTranslations("errors.api");
  // The day read supplies history. This option suppresses the hook's separate readings route;
  // pushed reading events still arrive for owners/carers through their authorised socket group.
  const feed = useLiveFeed(spaceId, {
    readings: false,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
    ...(socketFactory ? { socketFactory } : {}),
  });
  const { ready, lateCursor } = useFeedReady(feed.loaded);
  const { days, load, refreshAll, refused } = useDays(
    spaceId,
    "history/day",
    DayHistoryView,
    fetchImpl,
  );
  const zone = Object.values(days).find((entry) => entry.status === "ready");
  const today = useToday(initialToday, zone?.status === "ready" ? zone.day.timezone : undefined);
  const previousToday = useRef(today);
  const [active, setActive] = useState(initialDate);
  const [desktop, setDesktop] = useState(false);
  const scrollTarget = useRef<string | null>(null);
  const sections = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const update = () => {
      setDesktop(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    setActive(initialDate);
    scrollTarget.current = initialDate;
    void load(initialDate);
  }, [initialDate, load, ready]);
  useEffect(() => {
    if (lateCursor) void refreshAll();
  }, [lateCursor, refreshAll]);
  useEffect(() => {
    if (previousToday.current === today) return;
    const previous = previousToday.current;
    previousToday.current = today;
    if (sections.current.has(previous)) void load(previous, true);
    if (active === previous) {
      setActive(today);
      void load(today);
    }
  }, [today, active, load]);
  const navigate = useCallback(
    (date: string) => {
      if (date > today) return;
      const existing = sections.current.get(date);
      if (existing && date === active)
        existing.scrollIntoView({ behavior: "smooth", block: "start" });
      else scrollTarget.current = date;
      setActive(date);
      void load(date);
    },
    [load, today, active],
  );
  useEffect(() => {
    const date = scrollTarget.current;
    if (!date || !days[date]) return;
    sections.current.get(date)?.scrollIntoView({ behavior: "smooth", block: "start" });
    scrollTarget.current = null;
  }, [days, active]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        !desktop ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.defaultPrevented
      )
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("input,textarea,select,[contenteditable=true],[role=radiogroup]")
      )
        return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        navigate(shiftDate(active, event.key === "ArrowLeft" ? -1 : 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [desktop, active, navigate]);
  const { subscribe } = feed;
  useEffect(() => {
    const refresh = () => {
      if (sections.current.has(today)) void load(today, true);
    };
    const recheckAccess = () => {
      void refreshAll();
    };
    const refreshMembership = () => {
      recheckAccess();
      router.refresh();
    };
    const offs = [
      subscribe("meal.created", refresh),
      subscribe("meal.updated", refresh),
      subscribe("meal.deleted", refresh),
      subscribe("space.updated", () => {
        recheckAccess();
        router.refresh();
      }),
      subscribe("member.updated", refreshMembership),
      subscribe("member.removed", refreshMembership),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [subscribe, load, today, router, refreshAll]);
  const dates = Object.keys(days).sort().reverse();
  const oldest = dates.at(-1) ?? initialDate;
  const last = days[oldest];
  const done = last?.status === "ready" && !last.day.hasOlder;
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
    <div className={styles.page} data-testid="history" data-layout={desktop ? "desktop" : "phone"}>
      <div className={styles.top}>
        <PageHeader
          title={t("title")}
          {...(desktop ? { subtitle: dayHeading(active, locale) } : {})}
          trailing={
            !desktop && (
              <Link className={styles.weekLink} href={localeHref(locale, "/history/week")}>
                {t("theWeek")}
              </Link>
            )
          }
        />
        {desktop && (
          <div className={styles.controls}>
            <ChipGroup
              label={t("view")}
              value="day"
              options={[
                {
                  value: "week",
                  label: t("week"),
                  href: localeHref(locale, "/history/week?view=uge"),
                },
                { value: "day", label: t("day") },
                {
                  value: "meals",
                  label: t("meals"),
                  href: localeHref(locale, "/history/week?view=maaltider"),
                },
              ]}
            />
            <ArrowNav
              previous={{
                label: t("previousDay"),
                onClick: () => {
                  navigate(shiftDate(active, -1));
                },
              }}
              next={{
                label: t("nextDay"),
                disabled: active >= today,
                onClick: () => {
                  navigate(shiftDate(active, 1));
                },
              }}
            />
          </div>
        )}
      </div>
      {dates.length === 0 && <DayLoading />}
      {aiEnabled && (
        <WeekInsightLink
          spaceId={spaceId}
          start={mondayOf(today)}
          locale={locale}
          feed={feed}
          {...(fetchImpl ? { fetch: fetchImpl } : {})}
        />
      )}
      {dates.map((date) => {
        const entry = days[date];
        if (!entry) return null;
        return (
          <section
            key={date}
            className={styles.section}
            data-testid="history-day"
            data-date={date}
            data-active={date === active}
            hidden={desktop && date !== active}
            ref={(el) => {
              if (el) sections.current.set(date, el);
              else sections.current.delete(date);
            }}
          >
            {entry.status === "ready" ? (
              <DaySection
                day={entry.day}
                today={today}
                locale={locale}
                unit={unit}
                desktop={desktop}
                liveReadings={feed.readings}
                onNavigate={navigate}
              />
            ) : entry.status === "loading" ? (
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
      {!desktop && dates.length > 0 && (
        <OlderDays load={loadOlder} done={done} disabled={last?.status !== "ready"} />
      )}
    </div>
  );
}
