"use client";
import type { GlucoseUnit } from "@frejsi/shared/schemas/glucose";
import { WeekHistoryView } from "@frejsi/shared/schemas/history";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { localDateOf } from "@/components/day/format";
import { ArrowNav } from "@/components/ui/ArrowNav";
import { ChipGroup } from "@/components/ui/ChipGroup";
import { PageHeader } from "@/components/ui/PageHeader";
import { Notice } from "@/components/ui/Notice";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";
import { useLiveFeed } from "@/lib/live/useLiveFeed";
import type { SocketFactory } from "@/lib/live/live-feed";
import { dateAfter, mondayOf, weekDateLabel } from "./dates";
import { WeekTiles } from "./WeekTiles";
import { WeekNumbersTiles } from "./WeekNumbersTiles";
import { WeekMealsTable } from "./WeekMealsTable";
import styles from "./history-week.module.css";

export interface HistoryWeekScreenProps {
  spaceId: string;
  locale: AppLocale;
  unit: GlucoseUnit;
  start: string;
  view: "uge" | "maaltider";
  /** Transport fakes for tests; production uses the browser and the shared feed. */
  fetch?: typeof fetch;
  socketFactory?: SocketFactory;
}
type State = { key: string } & (
  | { status: "loading" }
  | { status: "failed" }
  | { status: "refused"; code: "forbidden" | "not-found" }
  | { status: "ready"; week: WeekHistoryView }
);

export function HistoryWeekScreen({
  spaceId,
  locale,
  unit,
  start,
  view,
  fetch: fetchImpl,
  socketFactory,
}: HistoryWeekScreenProps) {
  const t = useTranslations("historyWeek");
  const errors = useTranslations("errors.api");
  const router = useRouter();
  const key = `${spaceId}:${start}`;
  const [state, setState] = useState<State>({ key, status: "loading" });
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const feed = useLiveFeed(spaceId, {
    readings: false,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
    ...(socketFactory ? { socketFactory } : {}),
  });
  const load = useCallback(async () => {
    const id = ++generation.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    let next: State = { key, status: "failed" };
    try {
      const response = await (fetchImpl ?? globalThis.fetch)(
        `/api/spaces/${encodeURIComponent(spaceId)}/history/week?${new URLSearchParams({ start })}`,
        {
          headers: { accept: "application/json" },
          signal: controller.signal,
        },
      );
      if (response.status === 403 || response.status === 404) {
        next = {
          key,
          status: "refused",
          code: response.status === 403 ? "forbidden" : "not-found",
        };
      } else if (response.ok) {
        const parsed = WeekHistoryView.safeParse(await response.json());
        if (parsed.success && parsed.data.weekStart === start)
          next = { key, status: "ready", week: parsed.data };
      }
    } catch {
      // A failed read has a visible retry. Aborted and superseded reads never replace a week.
    }
    if (id === generation.current && !controller.signal.aborted) setState(next);
  }, [fetchImpl, key, spaceId, start]);
  useEffect(() => {
    void load();
    return () => {
      ++generation.current;
      pending.current?.abort();
    };
  }, [load]);
  const week = state.key === key && state.status === "ready" ? state.week : null;
  const current =
    week !== null && start >= mondayOf(localDateOf(new Date(week.now), week.timezone));
  const { subscribe } = feed;
  useEffect(() => {
    const refresh = () => {
      if (current) void load();
    };
    const offs = [
      subscribe("meal.created", refresh),
      subscribe("meal.updated", refresh),
      subscribe("meal.deleted", refresh),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [subscribe, current, load]);
  const weekHref = useCallback(
    (date: string) => localeHref(locale, `/history/week?start=${date}&view=${view}`),
    [locale, view],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (target instanceof Element &&
          target.closest(
            'a, button, input, textarea, select, [contenteditable="true"], [role="radiogroup"], table',
          ))
      )
        return;
      if (!week) return;
      if (event.key === "ArrowLeft" || (event.key === "ArrowRight" && !current)) {
        event.preventDefault();
        router.push(weekHref(dateAfter(start, event.key === "ArrowLeft" ? -7 : 7)));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [current, router, start, week, weekHref]);
  const refused =
    state.key === key && state.status === "refused"
      ? state.code
      : feed.error === "forbidden" || feed.error === "not-found"
        ? feed.error
        : null;
  if (refused)
    return (
      <div className={styles.page}>
        <Notice role="alert">{errors(refused)}</Notice>
      </div>
    );
  if (state.key === key && state.status === "failed")
    return (
      <div className={styles.page}>
        <Notice role="alert">{t("loadFailed")}</Notice>
        <button
          className={styles.retry}
          type="button"
          onClick={() => {
            void load();
          }}
        >
          {t("retry")}
        </button>
      </div>
    );
  if (!week)
    return (
      <div
        className={`${styles.page} ${styles.loading}`}
        aria-busy="true"
        aria-label={t("loading")}
      />
    );
  const dayDate = current ? localDateOf(new Date(week.now), week.timezone) : start;
  const showTiles = view === "uge" || week.meals.length === 0;
  return (
    <div className={styles.page} data-view={view}>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle", { week: week.isoWeek, dates: weekDateLabel(start, locale) })}
        trailing={
          <Link className={styles.phoneDay} href={localeHref(locale, "/history")}>
            {t("day")}
          </Link>
        }
      />
      <div className={styles.toolbar}>
        <div className={styles.views}>
          <ChipGroup
            label={t("viewLabel")}
            value={view}
            options={[
              {
                value: "uge",
                label: t("week"),
                href: localeHref(locale, `/history/week?start=${start}&view=uge`),
              },
              {
                value: "dag",
                label: t("day"),
                href: localeHref(locale, `/history?date=${dayDate}`),
              },
              {
                value: "maaltider",
                label: t("meals"),
                href: localeHref(locale, `/history/week?start=${start}&view=maaltider`),
              },
            ]}
          />
        </div>
        <div className={styles.arrows}>
          <ArrowNav
            previous={{ label: t("previous"), href: weekHref(dateAfter(start, -7)) }}
            next={{ label: t("next"), href: weekHref(dateAfter(start, 7)), disabled: current }}
          />
        </div>
      </div>
      {showTiles ? (
        <WeekTiles week={week} locale={locale} />
      ) : (
        <WeekMealsTable
          week={week}
          unit={unit}
          onOpen={(id) => {
            router.push(localeHref(locale, `/meal/${encodeURIComponent(id)}`));
          }}
        />
      )}
      <WeekNumbersTiles week={week} unit={unit} locale={locale} />
    </div>
  );
}
