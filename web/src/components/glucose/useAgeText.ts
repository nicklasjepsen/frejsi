"use client";

import { useTranslations } from "next-intl";

import { ageOf } from "./format";

/** "for 3 min. siden" for a reading's `ts` at `now`, from the `glucose.age.*` messages. */
export function useAgeText(): (ts: string, now: Date) => string {
  const t = useTranslations("glucose");
  return (ts, now) => {
    const age = ageOf(ts, now);
    switch (age.kind) {
      case "justNow":
        return t("age.justNow");
      case "minutes":
        return t("age.minutes", { minutes: age.minutes });
      case "hours":
        return age.minutes === 0
          ? t("age.wholeHours", { hours: age.hours })
          : t("age.hours", { hours: age.hours, minutes: age.minutes });
      default:
        return t("age.overADay");
    }
  };
}
