"use client";
import type { GlucoseUnit } from "@frejsi/shared/schemas/glucose";
import { WeekHistoryView } from "@frejsi/shared/schemas/history";
import { dayRange } from "@frejsi/shared/meals/day-range";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { localDateOf } from "@/components/day/format";
import { PeriodHeader } from "@/components/history/PeriodHeader";
import { SymptomDetailCard } from "@/components/history/SymptomDetailCard";
import { useSymptomRange } from "@/components/history/useSymptomRange";
import { useDesktop } from "@/components/meal-detail/useDesktop";
import { useKindLabel } from "@/components/symptoms/kinds";
import { ArrowNav } from "@/components/ui/ArrowNav";
import { Chip } from "@/components/ui/Chip";
import { ChipGroup } from "@/components/ui/ChipGroup";
import { PageHeader } from "@/components/ui/PageHeader";
import { Notice } from "@/components/ui/Notice";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";
import { useLiveFeed } from "@/lib/live/useLiveFeed";
import type { SocketFactory } from "@/lib/live/live-feed";
import { dateAfter, mondayOf, weekDateLabel } from "./dates";
import { WeekObservation } from "@/components/observation/WeekObservation";
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
  aiEnabled?: boolean;
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
  aiEnabled = false,
}: HistoryWeekScreenProps) {
  const t = useTranslations("historyWeek");
  const history = useTranslations("history");
  const errors = useTranslations("errors.api");
  const router = useRouter();
  const desktop = useDesktop();
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
    // Establish the cursor first: a meal committed before it is included in this snapshot;
    // later events refresh it, including while the first read is in flight.
    if (!feed.loaded) return;
    void load();
    return () => {
      ++generation.current;
      pending.current?.abort();
    };
  }, [feed.loaded, load]);
  const week = state.key === key && state.status === "ready" ? state.week : null;
  const current =
    week !== null && start >= mondayOf(localDateOf(new Date(week.now), week.timezone));
  const { subscribe } = feed;
  // The week's symptoms (plan §5): seven local days in one read, again on every symptom event.
  const weekBounds = week
    ? {
        from: dayRange(week.weekStart, week.timezone)[0].toISOString(),
        to: dayRange(dateAfter(week.weekStart, 6), week.timezone)[1].toISOString(),
      }
    : { from: "", to: "" };
  const symptomRange = useSymptomRange(
    spaceId,
    weekBounds.from,
    weekBounds.to,
    subscribe,
    week !== null,
  );
  const symptoms = symptomRange.status === "ready" ? symptomRange.symptoms : [];
  const labelOf = useKindLabel(locale, symptomRange.kinds);
  const [symptomsOnly, setSymptomsOnly] = useState(false);
  const [activeSymptomId, setActiveSymptomId] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => {
      if (!week || current) void load();
    };
    const revalidate = () => {
      // Hide protected data immediately, including an old week, while the API checks access.
      setState({ key, status: "loading" });
      router.refresh();
      void load();
    };
    const offs = [
      subscribe("meal.created", refresh),
      subscribe("meal.updated", refresh),
      subscribe("meal.deleted", refresh),
      subscribe("member.updated", revalidate),
      subscribe("member.removed", revalidate),
      subscribe("space.updated", revalidate),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [subscribe, current, key, load, router, week]);
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
  const dates = weekDateLabel(start, locale);
  const previous = { label: t("previous"), href: weekHref(dateAfter(start, -7)) };
  const next = { label: t("next"), href: weekHref(dateAfter(start, 7)), disabled: current };
  const symptomsChip = (
    <Chip
      pressed={symptomsOnly}
      data-testid="symptoms-filter"
      onClick={() => {
        setSymptomsOnly((value) => !value);
      }}
    >
      {history("symptomsFilter")}
    </Chip>
  );
  // The week carries 30-minute bucket averages, not readings: the detail shows none here; the
  // tile's link opens the day, where the readings around the symptom are.
  const activeSymptom = symptoms.find((symptom) => symptom.id === activeSymptomId) ?? null;
  return (
    <div className={styles.page} data-view={view}>
      {/* The phone reads like the day view: the title with the Day link, then the week between
          the arrows. The desktop keeps Historik-Desktop: subtitle, chips and ArrowNav. */}
      <div className={styles.top}>
        <PageHeader
          title={t("title")}
          {...(desktop ? { subtitle: t("subtitle", { week: week.isoWeek, dates }) } : {})}
          trailing={
            !desktop && (
              <Link className={styles.phoneDay} href={localeHref(locale, "/history")}>
                {t("day")}
              </Link>
            )
          }
        />
        <div className={styles.toolbar}>
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
          {desktop && showTiles && symptomsChip}
          {desktop && (
            <div className={styles.arrows}>
              <ArrowNav previous={previous} next={next} />
            </div>
          )}
        </div>
        {!desktop && (
          <PeriodHeader
            heading={t("weekHeading", { week: week.isoWeek })}
            line={dates}
            previous={previous}
            next={next}
            {...(showTiles ? { filter: symptomsChip } : {})}
          />
        )}
      </div>
      {showTiles ? (
        <>
          <WeekTiles
            week={week}
            locale={locale}
            desktop={desktop}
            symptoms={symptoms}
            onlyWithSymptoms={symptomsOnly}
            onSymptomTap={setActiveSymptomId}
            symptomLabel={labelOf}
          />
          {activeSymptom && (
            <SymptomDetailCard
              locale={locale}
              timeZone={week.timezone}
              symptom={activeSymptom}
              spaceKinds={symptomRange.kinds}
              onClose={() => {
                setActiveSymptomId(null);
              }}
            />
          )}
        </>
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
      {aiEnabled && (
        <WeekObservation
          spaceId={spaceId}
          start={start}
          feed={feed}
          {...(fetchImpl ? { fetch: fetchImpl } : {})}
        />
      )}
    </div>
  );
}
