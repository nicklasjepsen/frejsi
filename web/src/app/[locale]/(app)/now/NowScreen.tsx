"use client";

import { useTranslations } from "next-intl";

import {
  dayStart,
  formatBound,
  formatDayTitle,
  GlucoseChart,
  GlucoseValue,
  SourcePill,
  useNow,
} from "@/components/glucose";
import { HeaderSlot } from "@/components/shell/HeaderSlot";
import { SourceStatusBanner } from "@/components/shell/SourceStatusBanner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";
import { formatClock } from "@/lib/i18n/time";
import { useLiveFeed } from "@/lib/live/useLiveFeed";

import styles from "./now.module.css";

const SPARKLINE_HOURS = 3;
const DAY_START_HOUR = 6;
const WINDOW_HOURS = 24;

export interface NowScreenProps {
  spaceId: string;
  locale: AppLocale;
  simpleMode: boolean;
  /** The space's zone from the shell, until the feed's window carries it. */
  timeZone: string;
}

/**
 * Nu (Main, Nu-Desktop, Nu-Simpel, Nu-Simpel-Desktop): everything on it comes from `useLiveFeed`;
 * nothing here fetches. Phone and desktop are both in the DOM and CSS shows one, as the shell
 * does. The meal regions of the artboards are left out until v0.2.0 (plan decision 15); the last
 * meal card is a placeholder.
 */
export function NowScreen({ spaceId, locale, simpleMode, timeZone }: NowScreenProps) {
  const t = useTranslations("now");
  const g = useTranslations("glucose");
  const errors = useTranslations("errors.api");
  const feed = useLiveFeed(spaceId, { hours: WINDOW_HOURS });
  const now = useNow();

  const latest = feed.readings.at(-1) ?? null;
  const unit = feed.space?.glucoseUnit ?? "mmol";
  const zone = feed.space?.timezone ?? timeZone;
  const targetLow = feed.space?.targetLow ?? 4;
  const targetHigh = feed.space?.targetHigh ?? 10;
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
        <div className={styles.simpleActions}>
          <Button size="simple" href={localeHref(locale, "/soon/meals")}>
            {t("eatingNow")}
          </Button>
        </div>
      </div>
    );
  }

  const sparklineFrom = new Date(now.getTime() - SPARKLINE_HOURS * 60 * 60 * 1000);
  // Never before the feed's window: on the night daylight saving ends, yesterday's 06:00 can lie
  // up to 25 hours back, and that first hour would be drawn empty.
  const dayFrom = new Date(
    Math.max(
      dayStart(now, zone, DAY_START_HOUR).getTime(),
      now.getTime() - WINDOW_HOURS * 60 * 60 * 1000,
    ),
  );

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
          <div className={styles.desktopHead}>
            <h1>{t("title")}</h1>
            <p className={styles.date}>{formatDayTitle(now, zone, locale)}</p>
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
              </div>
            </Card>
            <Card className={styles.dayCard}>
              <div className={styles.chartHead}>
                <span className={styles.chartTitle}>{g("today")}</span>
                <span>{g("targetWithUnit", { ...bounds, unit: g(`unit.${unit}`) })}</span>
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
                label={g("chartToday", {
                  from: formatClock(dayFrom, zone),
                  to: formatClock(now, zone),
                })}
              />
            </Card>
          </div>
        </section>

        <section className={styles.lastMeal}>
          <p className={styles.label}>{t("lastMeal")}</p>
          <Card>
            <Notice>{t("lastMealSoon")}</Notice>
          </Card>
        </section>
      </div>
    </>
  );
}
