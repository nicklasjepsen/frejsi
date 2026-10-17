"use client";

import type { GlucoseUnit } from "@frejsi/shared/schemas/glucose";
import type { MealCurveView } from "@frejsi/shared/schemas/history";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Observation } from "@/components/observation/Observation";
import type { LiveFeedView } from "@/lib/live/useLiveFeed";
import { useNow } from "@/components/glucose/useNow";
import { Button, PageHeader } from "@/components/ui";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";
import { useLiveFeed } from "@/lib/live/useLiveFeed";

import { fetchMealCurve } from "./api";
import { EditMealSheet } from "./EditMealSheet";
import { CompareSection } from "./CompareSection";
import { MealNav } from "./MealNav";
import { SaveAsDish } from "./SaveAsDish";
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
  aiEnabled?: boolean;
  /** Arrived on `?edit=1`: the sheet opens as soon as the meal is read, and closing it drops the flag. */
  edit?: boolean;
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Takes `edit` out of the address in place: no navigation, no server round trip, and the
 * browser's back still leads to the row the person came from. Next keeps `useSearchParams`
 * in step with the native call.
 */
function dropEditParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("edit")) return;
  url.searchParams.delete("edit");
  window.history.replaceState(window.history.state, "", url);
}

/**
 * Måltid for an owner or carer (Maaltid-Telefon, Maaltid-Desktop): the meal on top, the curve
 * from one hour before to four hours after with the same dish's earlier curves behind, the three
 * tiles and the items. Read once from `GET meals/[id]/curve`; then the live feed's readings grow
 * the curve and the tiles are recomputed on the client. The feed is opened without its readings
 * window, so the screen calls `curve`, `negotiate` and `events` and nothing else (plan §8). The
 * curve is read again once the feed has its cursor, on `meal.updated` and on `space.updated`.
 */
export function MealDetail({
  spaceId,
  mealId,
  locale,
  timeZone,
  unit,
  layout,
  aiEnabled = false,
  edit = false,
}: MealDetailProps) {
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
  const [editing, setEditing] = useState(edit);
  const closeSheet = useCallback(() => {
    setEditing(false);
    dropEditParam();
  }, []);
  const openMeal = useCallback(
    (id: string) => {
      router.push(localeHref(locale, `/meal/${encodeURIComponent(id)}`));
    },
    [router, locale],
  );
  const { state, retry, refresh } = useMealResource(load, mealId, feed, {
    onDeleted: toNow,
    // The unit and the timezone come from the server page: render it again.
    onSpaceUpdated: () => {
      router.refresh();
    },
  });
  // Another meal closes the sheet; the first render keeps what the address asked for.
  const shownMealId = useRef(mealId);
  useEffect(() => {
    if (shownMealId.current === mealId) return;
    shownMealId.current = mealId;
    setEditing(false);
  }, [mealId]);

  useLayoutEffect(() => {
    if (!desktop || editing || state.status !== "ready") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      const id =
        event.key === "ArrowLeft"
          ? state.data.neighbours.previousMealId
          : event.key === "ArrowRight"
            ? state.data.neighbours.nextMealId
            : undefined;
      if (event.key.toLowerCase() === "e") {
        event.preventDefault();
        setEditing(true);
      } else if (id) {
        event.preventDefault();
        openMeal(id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [desktop, state, editing, openMeal]);

  const size = desktop ? "desktop" : "phone";
  return (
    <div className={styles.screen} data-layout={size} data-testid="meal-detail">
      {state.status === "ready" ? (
        <Ready
          aiEnabled={aiEnabled}
          feed={feed}
          view={state.data}
          live={feed.readings}
          size={size}
          locale={locale}
          timeZone={timeZone}
          unit={unit}
          onEdit={() => {
            setEditing(true);
          }}
          onOpen={openMeal}
          spaceId={spaceId}
        />
      ) : (
        <NotReady state={state} size={size} locale={locale} retry={retry} />
      )}
      {editing && state.status === "ready" && (
        <EditMealSheet
          key={mealId}
          spaceId={spaceId}
          view={state.data}
          timeZone={timeZone}
          size={size}
          onClose={closeSheet}
          onSaved={refresh}
          onDeleted={toNow}
        />
      )}
    </div>
  );
}

function Ready({
  aiEnabled,
  feed,
  view,
  live,
  size,
  locale,
  timeZone,
  unit,
  onEdit,
  onOpen,
  spaceId,
}: {
  aiEnabled: boolean;
  feed: LiveFeedView;
  view: MealCurveView;
  live: Parameters<typeof liveCurve>[1];
  size: "phone" | "desktop";
  locale: AppLocale;
  timeZone: string;
  unit: GlucoseUnit;
  onEdit: () => void;
  onOpen: (id: string) => void;
  spaceId: string;
}) {
  const [together, setTogether] = useState(true);
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
      together={together}
      onTogetherChange={setTogether}
    />
  );
  const observation = aiEnabled ? (
    <Observation
      spaceId={spaceId}
      mealId={view.meal.id}
      complete={curve.stats.inRange.complete}
      size={size}
      feed={feed}
    />
  ) : null;
  const saveDish = (
    <SaveAsDish key={view.meal.id} spaceId={spaceId} meal={view.meal} locale={locale} />
  );
  if (size === "phone") {
    return (
      <>
        <PhoneMealHeader
          meal={view.meal}
          timeZone={timeZone}
          onEdit={onEdit}
          backHref={localeHref(locale, "/now")}
          saveDish={saveDish}
        />
        {card}
        {tiles}
        {observation}
        <MealItems items={view.meal.items} size="phone" />
      </>
    );
  }
  return (
    <>
      <MealNav view={view} locale={locale} timeZone={timeZone} onOpen={onOpen} />
      <div className={styles.columns}>
        <section className={styles.side}>
          <DesktopMealHeader
            meal={view.meal}
            timeZone={timeZone}
            onEdit={onEdit}
            saveDish={saveDish}
          />
          <MealItems items={view.meal.items} total={view.meal.totalCarbs} size="desktop" />
          {tiles}
        </section>
        <section className={styles.main}>
          {card}
          {together && (
            <CompareSection
              view={view}
              stats={curve.stats}
              unit={unit}
              timeZone={timeZone}
              now={clock}
              onOpen={onOpen}
            />
          )}
          {observation}
        </section>
      </div>
    </>
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
