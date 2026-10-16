"use client";

import type { Role } from "@frejsi/shared/schemas/index";
import { mealStats } from "@frejsi/shared/stats";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { localDateOf } from "@/components/day/format";
import { MealCard, useDay } from "@/components/day";
import { PhotoTile } from "@/components/food/PhotoTile";
import {
  ChartLegend,
  dayStart,
  formatBound,
  formatDayTitle,
  GlucoseChart,
  GlucoseValue,
  SourcePill,
  useNow,
  useAgeText,
} from "@/components/glucose";
import { ManualReadingButton, ManualReadingSheet, useManualReading } from "@/components/manual";
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
}: NowScreenProps) {
  const t = useTranslations("now");
  const g = useTranslations("glucose");
  const chart = useTranslations("chart");
  const ageText = useAgeText();
  const errors = useTranslations("errors.api");
  const meals = useTranslations("eat.now");
  const router = useRouter();
  const feed = useLiveFeed(spaceId, { hours: WINDOW_HOURS });
  const now = useNow();
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
          <Link
            href={mealHref(locale, lastMeal.id)}
            className={`${styles.simpleMeal} ${styles.mealLink}`}
          >
            <MealCard meal={lastMeal} timeZone={mealZone} variant="simple" />
          </Link>
        )}
        <div className={styles.simpleActions}>
          <Button size="simple" href={localeHref(locale, "/eat")}>
            {t("eatingNow")}
          </Button>
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
                  ({ id: mealId, ts, bolusTs }) => ({
                    mealId,
                    ts,
                    ...(bolusTs ? { bolusTs } : {}),
                  }),
                )}
                onMealTap={(id) => {
                  router.push(mealHref(locale, id));
                }}
              />
              {latestDayReading && (
                <p className={styles.chartCaption} data-testid="chart-caption">
                  {chart("lastReading", { age: ageText(latestDayReading.ts, now) })}
                </p>
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
            {foods.unverified > 0 && (
              <aside
                className={styles.sideColumn}
                aria-label={meals("unverifiedLabel", { count: foods.unverified })}
              >
                <QuickLinkCard
                  href={localeHref(locale, "/library?filter=unverified")}
                  icon={foods.unverified}
                  title={meals("unverifiedTitle")}
                  subtitle={meals("unverifiedSubtitle")}
                />
              </aside>
            )}
          </div>
        </section>

        <section className={styles.lastMeal} data-testid="last-meal">
          <p className={styles.label}>{t("lastMeal")}</p>
          {day.status === "failed" && <Notice tone="sunken">{meals("mealsFailed")}</Notice>}
          {day.status === "ready" &&
            (lastMeal ? (
              <Link href={mealHref(locale, lastMeal.id)} className={styles.mealLink}>
                <MealCard meal={lastMeal} timeZone={mealZone} variant="card" />
              </Link>
            ) : (
              <p className={styles.noMeals}>{meals("noMeals")}</p>
            ))}
        </section>

        <div className={styles.logAction}>
          <Button size="phone" href={localeHref(locale, "/log")}>
            {meals("logMeal")}
          </Button>
        </div>
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
