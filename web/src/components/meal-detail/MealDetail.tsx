"use client";

import type { GlucoseUnit } from "@frejsi/shared/schemas/glucose";
import type { MealCurveView } from "@frejsi/shared/schemas/history";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";

import { useNow } from "@/components/glucose/useNow";
import { Button, PageHeader } from "@/components/ui";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";
import { useLiveFeed } from "@/lib/live/useLiveFeed";

import { fetchMealCurve } from "./api";
import { CurveCard } from "./CurveCard";
import { liveCurve } from "./live";
import { DesktopMealHeader, PhoneMealHeader } from "./MealHeader";
import { MealItems } from "./MealItems";
import { MealTiles } from "./MealTiles";
import styles from "./meal-detail.module.css";
import { useDesktop } from "./useDesktop";
import { useMealResource, type MealResource } from "./useMealResource";

export interface MealDetailProps {
  spaceId: string;
  mealId: string;
  locale: AppLocale;
  /** The space's IANA zone: every clock on the screen is in it. */
  timeZone: string;
  unit: GlucoseUnit;
  /** Forces a layout (tests); otherwise 1280 px and up is desktop, as in the shell. */
  layout?: "phone" | "desktop";
}

/** Where "Ret" and `E` go until the edit sheet lands (task 7): v0.2.0's reopen path. */
export const editHref = (locale: AppLocale, mealId: string) =>
  localeHref(locale, `/log?${new URLSearchParams({ meal: mealId }).toString()}`);

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Måltid for an owner or carer (Maaltid-Telefon, Maaltid-Desktop): the meal on top, the curve
 * from one hour before to four hours after with the same dish's earlier curves behind, the three
 * tiles and the items. Read once from `GET meals/[id]/curve`; then the live feed's readings grow
 * the curve and the tiles are recomputed on the client. The feed is opened without its readings
 * window, so the screen calls `curve`, `negotiate` and `events` and nothing else (plan §8). The
 * curve is read again once the feed has its cursor, on `meal.updated` and on `space.updated`.
 */
export function MealDetail({ spaceId, mealId, locale, timeZone, unit, layout }: MealDetailProps) {
  const router = useRouter();
  const feed = useLiveFeed(spaceId, { readings: false });
  const desktop = useDesktop(layout);
  const toNow = useCallback(() => {
    router.push(localeHref(locale, "/now"));
  }, [router, locale]);
  const load = useCallback(
    (signal: AbortSignal) => fetchMealCurve(spaceId, mealId, signal),
    [spaceId, mealId],
  );
  const { state, retry } = useMealResource(load, mealId, feed, {
    onDeleted: toNow,
    // The unit and the timezone come from the server page: render it again.
    onSpaceUpdated: () => {
      router.refresh();
    },
  });
  const edit = editHref(locale, mealId);

  useEffect(() => {
    if (!desktop || state.status !== "ready") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "e" || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      event.preventDefault();
      router.push(edit);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [desktop, state.status, router, edit]);

  const size = desktop ? "desktop" : "phone";
  return (
    <div className={styles.screen} data-layout={size} data-testid="meal-detail">
      {state.status === "ready" ? (
        <Ready
          view={state.data}
          live={feed.readings}
          size={size}
          locale={locale}
          timeZone={timeZone}
          unit={unit}
          editHref={edit}
        />
      ) : (
        <NotReady state={state} size={size} locale={locale} retry={retry} />
      )}
    </div>
  );
}

function Ready({
  view,
  live,
  size,
  locale,
  timeZone,
  unit,
  editHref,
}: {
  view: MealCurveView;
  live: Parameters<typeof liveCurve>[1];
  size: "phone" | "desktop";
  locale: AppLocale;
  timeZone: string;
  unit: GlucoseUnit;
  editHref: string;
}) {
  const clock = useNow();
  const curve = liveCurve(view, live, clock);
  const tiles = (
    <MealTiles
      stats={curve.stats}
      mealTs={view.meal.ts}
      target={view.target}
      unit={unit}
      timeZone={timeZone}
      size={size}
    />
  );
  const card = (
    <CurveCard
      view={view}
      readings={curve.readings}
      now={curve.now}
      unit={unit}
      timeZone={timeZone}
      size={size}
    />
  );
  if (size === "phone") {
    return (
      <>
        <PhoneMealHeader
          meal={view.meal}
          timeZone={timeZone}
          editHref={editHref}
          backHref={localeHref(locale, "/now")}
        />
        {card}
        {tiles}
        <MealItems items={view.meal.items} size="phone" />
      </>
    );
  }
  return (
    <div className={styles.columns}>
      <section className={styles.side}>
        <DesktopMealHeader meal={view.meal} timeZone={timeZone} editHref={editHref} />
        <MealItems items={view.meal.items} total={view.meal.totalCarbs} size="desktop" />
        {tiles}
      </section>
      <section className={styles.main}>{card}</section>
    </div>
  );
}

/** Loading keeps the card and tile heights (design gap 6); a failure or a gone meal says so. */
function NotReady({
  state,
  size,
  locale,
  retry,
}: {
  state: Exclude<MealResource<unknown>, { status: "ready" }>;
  size: "phone" | "desktop";
  locale: AppLocale;
  retry: () => void;
}) {
  const t = useTranslations("mealDetail");
  // The phone screen covers the tab bar, so it keeps its way back while there is no meal.
  const back = size === "phone" && (
    <div className={styles.metaHeader}>
      <PageHeader variant="meta" meta="" backHref={localeHref(locale, "/now")} />
    </div>
  );
  if (state.status === "loading") {
    return (
      <div className={styles.skeleton} aria-busy="true" aria-label={t("loading")}>
        {back}
        <div className={styles.curveCard} data-size={size} data-testid="curve-card-skeleton" />
        <div className={styles.tiles} data-testid="meal-tiles-skeleton" />
      </div>
    );
  }
  return (
    <div className={styles.message} role="status">
      {back}
      <p>{state.status === "not-found" ? t("notFound") : t("failed")}</p>
      {state.status === "failed" ? (
        <Button variant="secondary" onClick={retry}>
          {t("retry")}
        </Button>
      ) : (
        <Button variant="secondary" href={localeHref(locale, "/now")}>
          {t("toNow")}
        </Button>
      )}
    </div>
  );
}
