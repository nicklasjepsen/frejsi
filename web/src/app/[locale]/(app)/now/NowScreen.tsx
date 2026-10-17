"use client";

import type { Role } from "@frejsi/shared/schemas/index";
import { mealStats } from "@frejsi/shared/stats";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { localDateOf } from "@/components/day/format";
import { MealCard, useDay } from "@/components/day";
import { FoodSymbol } from "@/components/food/FoodSymbol";
import { PhotoTile } from "@/components/food/PhotoTile";
import {
  ChartLegend,
  dayStart,
  formatBound,
  formatDayTitle,
  GlucoseChart,
  GlucoseValue,
  readingsAround,
  SourcePill,
  useNow,
  useAgeText,
} from "@/components/glucose";
import { SymptomDetailCard } from "@/components/history/SymptomDetailCard";
import { useSymptomRange } from "@/components/history/useSymptomRange";
import { ManualReadingButton, ManualReadingSheet, useManualReading } from "@/components/manual";
import { FeelButton } from "@/components/symptoms/FeelButton";
import { useKindLabel } from "@/components/symptoms/kinds";
import { HeaderSlot } from "@/components/shell/HeaderSlot";
import { SourceStatusBanner } from "@/components/shell/SourceStatusBanner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { QuickLinkCard } from "@/components/ui/QuickLinkCard";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";
import { useLiveFeed } from "@/lib/live/useLiveFeed";

import styles from "./now.module.css";
import { NowMealsTable } from "./NowMealsTable";
import { useNowHistory } from "./useNowHistory";
import { useNowAi } from "./useNowAi";
import { NowAiCards } from "./NowAiCards";
import { NowSearch } from "./NowSearch";
import { useNowFoods } from "./useNowFoods";

const SPARKLINE_HOURS = 3;
const DAY_START_HOUR = 6;
const WINDOW_HOURS = 24;
/** The "Min mad" tiles on Nu-Simpel-Desktop: two rows of four. */
const MY_FOOD_TILES = 8;

const mealHref = (locale: AppLocale, id: string) =>
  localeHref(locale, `/meal/${encodeURIComponent(id)}`);

export interface NowScreenProps {
  spaceId: string;
  locale: AppLocale;
  simpleMode: boolean;
  /** The space's zone from the shell, until the feed's window carries it. */
  timeZone: string;
  /** The member's role; a viewer has no entry point (the API refuses the write anyway). */
  role?: Role;
  aiEnabled?: boolean;
  aiProvider?: string | null;
}

/**
 * Nu on phone, desktop and simpleMode. The feed owns live readings; day and history metadata
 * refresh through that same feed's meal events. Viewers use their separate today route.
 */
export function NowScreen({
  spaceId,
  locale,
  simpleMode,
  timeZone,
  role = "owner",
  aiEnabled = false,
  aiProvider = null,
}: NowScreenProps) {
  const t = useTranslations("now");
  const g = useTranslations("glucose");
  const chart = useTranslations("chart");
  const categories = useTranslations("foodCategory");
  const ageText = useAgeText();
  const errors = useTranslations("errors.api");
  const meals = useTranslations("eat.now");
  const router = useRouter();
  const feed = useLiveFeed(spaceId, { hours: WINDOW_HOURS });
  const now = useNow();
  const ai = useNowAi(
    spaceId,
    aiEnabled,
    aiProvider,
    role,
    simpleMode,
    feed.subscribe,
    feed.loaded,
    now,
    timeZone,
  );
  const manual = useManualReading();
  const zone = feed.space?.timezone ?? timeZone;
  // Never before the feed's window: on the night daylight saving ends, yesterday's 06:00 can lie
  // up to 25 hours back, and that first hour would be drawn empty.
  const dayFrom = new Date(
    Math.max(
      dayStart(now, zone, DAY_START_HOUR).getTime(),
      now.getTime() - WINDOW_HOURS * 60 * 60 * 1000,
    ),
  );
  const day = useDay(spaceId, feed.subscribe, feed.loaded);
  const history = useNowHistory(
    spaceId,
    feed.subscribe,
    feed.loaded && !simpleMode,
    localDateOf(dayFrom, zone),
  );
  // A snapshot can contain an early peak outside the feed window (e.g. after a DST change).
  // Merge peaks instead of replacing it with a statistic from a potentially partial window.
  const historyMeals =
    history.status === "ready"
      ? history.day.meals.map((meal) => {
          const peak = mealStats(feed.readings, meal, history.day.target, now).peak;
          const saved = meal.stats.peak;
          const newerPeak =
            peak &&
            (!saved || peak.mmol > saved.mmol || (peak.mmol === saved.mmol && peak.ts < saved.ts));
          return newerPeak ? { ...meal, stats: { ...meal.stats, peak } } : meal;
        })
      : [];
  const foods = useNowFoods(spaceId, simpleMode, feed.subscribe, feed.loaded);
  const lastMeal = day.status === "ready" ? (day.day.meals[0] ?? null) : null;
  const mealZone = day.status === "ready" ? day.day.timezone : timeZone;
  // The day's symptoms for the desktop curve (v0.6.0 plan §5): the curve's day, read again on
  // every symptom event. A viewer never mounts this screen; the route refuses it anyway.
  const symptomsFrom = dayFrom.toISOString();
  const symptomsTo = new Date(dayFrom.getTime() + WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const symptomRange = useSymptomRange(
    spaceId,
    symptomsFrom,
    symptomsTo,
    feed.subscribe,
    feed.loaded && !simpleMode && role !== "viewer",
  );
  const symptoms = symptomRange.status === "ready" ? symptomRange.symptoms : [];
  const kindLabel = useKindLabel(locale, symptomRange.kinds);
  const [activeSymptomId, setActiveSymptomId] = useState<string | null>(null);
  const activeSymptom = symptoms.find((symptom) => symptom.id === activeSymptomId) ?? null;

  // From the feed, not the window: a reading older than 24 hours still shows, with its age.
  const latest = feed.latest;
  const unit = feed.space?.glucoseUnit ?? "mmol";
  const targetLow = feed.space?.targetLow ?? 4;
  const targetHigh = feed.space?.targetHigh ?? 10;
  // Finger-pricks are typed in only where the source is Manuelt, by an owner or a carer, and never
  // in simpleMode (plan decision 7); the route refuses the others whatever this says.
  const canEnter = !simpleMode && role !== "viewer" && feed.space?.sourceType === "manual";
  const bounds = {
    low: formatBound(targetLow, unit, locale),
    high: formatBound(targetHigh, unit, locale),
  };

  if (feed.error) {
    return (
      <div className={styles.page}>
        <Notice tone="sunken" role="alert">
          {errors(feed.error)}
        </Notice>
      </div>
    );
  }

  if (!feed.loaded) {
    // Nothing of glucose is drawn before the window has arrived: no number, no stale age.
    return <div className={styles.page} aria-busy="true" data-testid="now-loading" />;
  }

  if (simpleMode) {
    return (
      <div className={styles.simple} data-testid="now-simple">
        <p className={styles.simpleLabel}>{t("simpleTitle")}</p>
        <GlucoseValue reading={latest} unit={unit} now={now} size="simple" showUnit={false} />
        {lastMeal && (
          <div className={styles.simpleMeal}>
            {/* The meal's symbol on the card (plan §7, decision 5: no curve in simpleMode). */}
            {lastMeal.symbol !== undefined && (
              <span
                className={styles.simpleSymbol}
                {...(lastMeal.symbol === "unknown"
                  ? { "aria-hidden": true }
                  : { role: "img", "aria-label": categories(`names.${lastMeal.symbol}`) })}
              >
                <FoodSymbol symbol={lastMeal.symbol} size={32} strokeWidth={2} />
              </span>
            )}
            <MealCard
              meal={lastMeal}
              timeZone={mealZone}
              variant="simple"
              locale={locale}
              role={role}
            />
          </div>
        )}
        <div className={styles.simpleActions}>
          <Button size="simple" href={localeHref(locale, "/eat")}>
            {t("eatingNow")}
          </Button>
          <FeelButton locale={locale} simple />
          {ai.enabled && (
            <Button size="simple" variant="secondary" href={localeHref(locale, "/ask")}>
              {t("askAdult")}
            </Button>
          )}
        </div>
        {foods.myFood.length > 0 && (
          <section className={styles.myFood} data-testid="my-food">
            <h2 className={styles.myFoodTitle}>{meals("myFood")}</h2>
            <div className={styles.myFoodGrid}>
              {foods.myFood.slice(0, MY_FOOD_TILES).map((food) => (
                <PhotoTile
                  key={food.id}
                  title={food.name}
                  {...(food.photo ? { thumbUrl: food.photo.thumbUrl } : {})}
                  verified={food.verified}
                  size={140}
                  onClick={() => {
                    router.push(
                      localeHref(
                        locale,
                        `/eat?${new URLSearchParams({ food: food.id }).toString()}`,
                      ),
                    );
                  }}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  const sparklineFrom = new Date(now.getTime() - SPARKLINE_HOURS * 60 * 60 * 1000);
  const latestDayReading = feed.readings.reduce<typeof feed.latest>((latest, reading) => {
    const ts = new Date(reading.ts).getTime();
    return ts >= dayFrom.getTime() && ts <= now.getTime() && (!latest || reading.ts > latest.ts)
      ? reading
      : latest;
  }, null);

  return (
    <>
      <HeaderSlot>
        <SourcePill
          status={feed.sourceStatus}
          sourceType={feed.space?.sourceType ?? null}
          latest={latest}
          now={now}
          timeZone={zone}
          variant="pill"
        />
      </HeaderSlot>
      <div className={styles.page} data-testid="now">
        <SourceStatusBanner
          status={feed.sourceStatus}
          since={feed.sourceSince}
          sourceType={feed.space?.sourceType ?? null}
          timeZone={zone}
        />

        <section className={styles.phone} data-testid="now-phone">
          <p className={styles.label}>{t("title")}</p>
          <GlucoseValue reading={latest} unit={unit} now={now} size="phone" />
          {canEnter && (
            <div className={styles.manualAction}>
              <ManualReadingButton size="phone" onClick={manual.show} />
            </div>
          )}
          <Card className={styles.chartCard}>
            <div className={styles.chartHead}>
              <span className={styles.chartTitle}>{g("last3h")}</span>
              <span>{g("target", bounds)}</span>
            </div>
            <GlucoseChart
              readings={feed.readings}
              from={sparklineFrom}
              to={now}
              targetLow={targetLow}
              targetHigh={targetHigh}
              unit={unit}
              timeZone={zone}
              variant="sparkline"
              label={g("chartLast3h")}
            />
          </Card>
        </section>

        <section className={styles.desktop} data-testid="now-desktop">
          <div className={styles.desktopTop}>
            <div className={styles.desktopHead}>
              <h1>{t("title")}</h1>
              <p className={styles.date}>{formatDayTitle(now, zone, locale)}</p>
            </div>
            <div className={styles.desktopSearch}>
              <NowSearch locale={locale} />
            </div>
            <Button href={localeHref(locale, "/log")}>{meals("logMeal")}</Button>
          </div>
          <div className={styles.desktopRow}>
            <Card className={styles.glucoseCard}>
              <p className={styles.label}>{t("glucoseCard")}</p>
              <GlucoseValue reading={latest} unit={unit} now={now} size="desktop" layout="split" />
              <div className={styles.statusLine}>
                <SourcePill
                  status={feed.sourceStatus}
                  sourceType={feed.space?.sourceType ?? null}
                  latest={latest}
                  now={now}
                  timeZone={zone}
                  variant="line"
                />
                {canEnter && <ManualReadingButton size="desktop" onClick={manual.show} />}
              </div>
            </Card>
            <Card className={styles.dayCard}>
              <div className={styles.chartHead}>
                <span className={styles.chartTitle}>{g("today")}</span>
                <ChartLegend
                  variant="day"
                  target={{ low: targetLow, high: targetHigh }}
                  unit={unit}
                />
              </div>
              <GlucoseChart
                readings={feed.readings}
                from={dayFrom}
                to={now}
                targetLow={targetLow}
                targetHigh={targetHigh}
                unit={unit}
                timeZone={zone}
                variant="day"
                meals={(history.status === "ready" ? history.markers : []).map(
                  ({ id: mealId, ts, bolusTs, symbol }) => ({
                    mealId,
                    ts,
                    ...(bolusTs ? { bolusTs } : {}),
                    ...(symbol !== undefined ? { symbol } : {}),
                  }),
                )}
                onMealTap={(id) => {
                  router.push(mealHref(locale, id));
                }}
                symptoms={symptoms.map((symptom) => ({
                  id: symptom.id,
                  ts: symptom.ts,
                  kind: symptom.kind,
                  label: kindLabel(symptom.kind),
                }))}
                onSymptomTap={setActiveSymptomId}
              />
              {latestDayReading && (
                <p className={styles.chartCaption} data-testid="chart-caption">
                  {chart("lastReading", { age: ageText(latestDayReading.ts, now) })}
                </p>
              )}
              {activeSymptom && (
                <SymptomDetailCard
                  locale={locale}
                  timeZone={zone}
                  symptom={activeSymptom}
                  spaceKinds={symptomRange.kinds}
                  readings={readingsAround(
                    activeSymptom.ts,
                    feed.readings,
                    unit,
                    locale,
                    g(`unit.${unit}`),
                    (ts) => ageText(ts, now),
                  )}
                  onClose={() => {
                    setActiveSymptomId(null);
                  }}
                />
              )}
            </Card>
          </div>
          <div className={styles.desktopRow}>
            <div className={styles.mealsColumn}>
              {(day.status === "failed" || history.status === "failed") && (
                <Notice tone="sunken">{meals("mealsFailed")}</Notice>
              )}
              {day.status === "ready" && (
                <NowMealsTable
                  meals={history.status === "ready" ? historyMeals : day.day.meals}
                  historyMeals={historyMeals}
                  unit={unit}
                  totalCarbs={
                    history.status === "ready" ? history.day.totalCarbs : day.day.totalCarbs
                  }
                  timeZone={history.status === "ready" ? history.day.timezone : mealZone}
                  hrefFor={(meal) => mealHref(locale, meal.id)}
                  onOpen={(href) => {
                    router.push(href);
                  }}
                />
              )}
            </div>
            <div className={styles.sideColumn}>
              {foods.unverified > 0 && (
                <aside aria-label={meals("unverifiedLabel", { count: foods.unverified })}>
                  <QuickLinkCard
                    href={localeHref(locale, "/library?filter=unverified")}
                    icon={foods.unverified}
                    title={meals("unverifiedTitle")}
                    subtitle={
                      ai.enabled && foods.askedBy
                        ? t("askedPhoto", { child: foods.askedBy })
                        : meals("unverifiedSubtitle")
                    }
                  />
                </aside>
              )}
              <NowAiCards ai={ai} locale={locale} />
            </div>
          </div>
        </section>

        <section className={styles.lastMeal} data-testid="last-meal">
          <p className={styles.label}>{t("lastMeal")}</p>
          {day.status === "failed" && <Notice tone="sunken">{meals("mealsFailed")}</Notice>}
          {day.status === "ready" &&
            (lastMeal ? (
              <MealCard
                meal={lastMeal}
                timeZone={mealZone}
                variant="card"
                locale={locale}
                role={role}
              />
            ) : (
              <p className={styles.noMeals}>{meals("noMeals")}</p>
            ))}
        </section>

        <div className={styles.logAction}>
          <Button size="phone" href={localeHref(locale, "/log")}>
            {meals("logMeal")}
          </Button>
          {/* "Jeg har det…" under the primary action (plan §5); a viewer has no way to log. */}
          {role !== "viewer" && <FeelButton locale={locale} />}
        </div>
        {/* After the primary action, so "Log et måltid" is on the first screen of an iPhone. */}
        {ai.enabled && foods.askedBy && (
          <div className={styles.phoneReview}>
            <QuickLinkCard
              href={localeHref(locale, "/library?filter=unverified")}
              icon={foods.unverified}
              title={meals("unverifiedTitle")}
              subtitle={t("askedPhoto", { child: foods.askedBy })}
            />
          </div>
        )}
        {canEnter && manual.open && (
          <ManualReadingSheet
            spaceId={spaceId}
            unit={unit}
            timeZone={zone}
            now={now}
            onStored={feed.addReading}
            onClose={manual.hide}
          />
        )}
      </div>
    </>
  );
}
