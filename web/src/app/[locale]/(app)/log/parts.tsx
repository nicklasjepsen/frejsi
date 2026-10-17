"use client";
import { mealSlot } from "@frejsi/shared/meals/title";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { FoodPhoto } from "@/components/food/FoodPhoto";
import { PhotoPicker } from "@/components/food/PhotoPicker";
import { BolusTap } from "@/components/meal/BolusTap";
import { EatingInChips } from "@/components/meal/EatingInChips";
import { Notice } from "@/components/ui/Notice";

import type { LogController } from "./controller";
import styles from "./log.module.css";
import { formatClock, isSameLocalDay, withLocalTime } from "./time";

/**
 * The meal's time: the one set by hand, else now plus the "Spiser om" chip (re-read each minute,
 * so the header and the time field show the time the meal will get if saved now).
 */
export function useMealTime(controller: LogController): Date {
  const { ts, eatingIn } = controller.draft;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (ts) return;
    const timer = setInterval(() => {
      setNow(new Date());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, [ts]);
  return useMemo(
    () => (ts ? new Date(ts) : new Date(now.getTime() + (eatingIn ?? 0) * 60_000)),
    [ts, eatingIn, now],
  );
}

/** "Frokost" from the local hour (breakfast 05–11, lunch 11–14, dinner 17–21, else snack). */
export function useSlotLabel(at: Date, timeZone: string): string {
  const t = useTranslations("log.slot");
  return t(mealSlot(at, timeZone));
}

/** "I dag 12:10", or the date for a meal from another day. */
export function useWhenLabel(at: Date, timeZone: string): string {
  const t = useTranslations("log");
  const locale = useLocale();
  const time = formatClock(at, timeZone);
  if (isSameLocalDay(at, new Date(), timeZone)) return t("today", { time });
  const date = new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "long" }).format(
    at,
  );
  return t("onDay", { date, time });
}

/** "Spiser om": nu · 5 · 10 · 15 · 20 min, over the exact-time field (issue #191). */
export function EatingInField({
  controller,
  simpleMode,
}: {
  controller: LogController;
  simpleMode: boolean;
}) {
  return (
    <EatingInChips
      value={controller.draft.eatingIn}
      onChange={controller.chooseEatingIn}
      simple={simpleMode}
    />
  );
}

export function TimeField({
  controller,
  at,
  timeZone,
}: {
  controller: LogController;
  at: Date;
  timeZone: string;
}) {
  const t = useTranslations("log");
  return (
    <label className={styles.timeField}>
      {t("time")}
      <input
        type="time"
        value={formatClock(at, timeZone)}
        onChange={(event) => {
          const moved = withLocalTime(at, event.target.value, timeZone);
          if (moved) controller.setTs(moved.toISOString());
        }}
      />
    </label>
  );
}

export function PhotoField({ controller }: { controller: LogController }) {
  const preview = useMemo(
    () =>
      controller.photo && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(new Blob([new Uint8Array(controller.photo)], { type: "image/jpeg" }))
        : undefined,
    [controller.photo],
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  return (
    <div className={styles.photoField}>
      {controller.photo && (
        <div className={styles.photoPreview} data-testid="meal-photo-preview">
          <FoodPhoto src={preview} />
        </div>
      )}
      <PhotoPicker onPhoto={controller.setPhoto} />
    </div>
  );
}

export function Bolus({
  controller,
  timeZone,
  simpleMode,
}: {
  controller: LogController;
  timeZone: string;
  simpleMode: boolean;
}) {
  if (simpleMode) return null;
  return (
    <BolusTap
      bolusTs={controller.draft.bolusTs}
      timeZone={timeZone}
      onTap={controller.tapBolus}
      onUndo={controller.undoBolus}
      canUndo={controller.canUndoBolus}
    />
  );
}

/** Offline and failed save notices (design gap 6). */
export function SaveNotices({
  controller,
  online,
}: {
  controller: LogController;
  online: boolean;
}) {
  const t = useTranslations("log");
  return (
    <>
      {!online && (
        <Notice tone="sunken" role="status">
          {t("offline")}
        </Notice>
      )}
      {controller.saveFailed && <p role="alert">{t("saveFailed")}</p>}
    </>
  );
}
