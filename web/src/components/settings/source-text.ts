"use client";

import { useTranslations } from "next-intl";

import type { GlucoseSourceType } from "@frejsi/shared/schemas/glucose";
import { formatClock } from "@/lib/i18n/time";
import type { AppLocale } from "@/lib/i18n/routing";

import type { SourceView } from "./contracts";
import { formatDay, sameDay } from "./reading-time";

/**
 * The lines the Settings screens write about the configured source: the phone row and the card's
 * status line. Every word comes from a message; the only branch on a type is `manual`, which has
 * no connection to report (plan §4), and the region, which only a source that has one reports.
 */
export function useSourceText(
  source: SourceView | null,
  timezone: string,
  now: string,
  locale: AppLocale,
) {
  const t = useTranslations("settings");
  const sources = useTranslations("source");

  const timeOf = (iso: string) => formatClock(new Date(iso), timezone);
  const whenOf = (iso: string) => {
    const at = new Date(iso);
    const time = formatClock(at, timezone);
    return sameDay(at, new Date(now), timezone)
      ? t("source.today", { time })
      : t("source.onDate", { date: formatDay(at, timezone, locale), time });
  };

  /** "Glukosekilde" row on the phone: `{source} · forbundet · sidste måling 15:13`. */
  function phoneRow(): string {
    if (!source?.type) return t("source.notConfigured");
    const name = sources(`${source.type}.name`);
    if (source.type === "manual") {
      return source.lastReadingAt
        ? t("source.rowManual", { source: name, time: timeOf(source.lastReadingAt) })
        : t("source.rowManualNoReading", { source: name });
    }
    if (source.status === "disconnected") return t("source.rowDisconnected", { source: name });
    if (source.status === "connected" && source.lastReadingAt)
      return t("source.rowConnected", { source: name, time: timeOf(source.lastReadingAt) });
    if (source.status === "connected") return t("source.rowConnectedNoReading", { source: name });
    return t("source.notConfigured");
  }

  /** The second line of a card: the status for the selected one, else what the source is. */
  function cardLine(type: GlucoseSourceType): string {
    if (source?.type !== type) return sources(`${type}.description`);
    if (type === "manual") {
      return source.lastReadingAt
        ? t("source.cardManual", { when: whenOf(source.lastReadingAt) })
        : t("source.cardManualNoReading");
    }
    const region = source.region ? t(`source.region.${source.region}`) : null;
    if (source.status === "disconnected")
      return region ? t("source.cardDisconnected", { region }) : t("source.cardDisconnectedPlain");
    if (source.status !== "connected") return sources(`${type}.description`);
    if (!source.lastReadingAt)
      return region
        ? t("source.cardConnectedNoReading", { region })
        : t("source.cardConnectedNoReadingPlain");
    const when = whenOf(source.lastReadingAt);
    return region
      ? t("source.cardConnected", { when, region })
      : t("source.cardConnectedPlain", { when });
  }

  return { phoneRow, cardLine };
}
