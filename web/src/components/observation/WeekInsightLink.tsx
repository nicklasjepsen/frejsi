"use client";
import { WeekInsightView } from "@frejsi/shared/schemas/ai";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";
import type { LiveFeedView } from "@/lib/live/useLiveFeed";
import { useInsight } from "./useInsight";
import styles from "./observation.module.css";
export function WeekInsightLink({
  spaceId,
  start,
  locale,
  feed,
  fetch: fetchImpl,
}: {
  spaceId: string;
  start: string;
  locale: AppLocale;
  feed: Pick<LiveFeedView, "subscribe">;
  fetch?: typeof fetch;
}) {
  const t = useTranslations("history.observation");
  const { value } = useInsight(
    `/api/spaces/${encodeURIComponent(spaceId)}/history/week/insight?start=${start}`,
    WeekInsightView,
    fetchImpl,
    feed,
  );
  if (!value || value.state === "off") return null;
  return (
    <Link
      className={styles.link}
      href={localeHref(locale, `/history/week?start=${start}#opsummering`)}
    >
      <strong>{t("title")}</strong>
      <span>{t(value.state === "ready" ? "ready" : "pending")}</span>
    </Link>
  );
}
