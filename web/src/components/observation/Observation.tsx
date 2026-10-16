"use client";
import { MealInsightView } from "@frejsi/shared/schemas/ai";
import { useTranslations } from "next-intl";
import type { LiveFeedView } from "@/lib/live/useLiveFeed";
import { useInsight } from "./useInsight";
import styles from "./observation.module.css";
export function Observation({
  spaceId,
  mealId,
  complete,
  size = "phone",
  fetch: fetchImpl,
  feed,
}: {
  spaceId: string;
  mealId: string;
  complete: boolean;
  size?: "phone" | "desktop";
  fetch?: typeof fetch;
  feed?: Pick<LiveFeedView, "subscribe">;
}) {
  const t = useTranslations("mealDetail.observation");
  const { value } = useInsight(
    `/api/spaces/${encodeURIComponent(spaceId)}/meals/${encodeURIComponent(mealId)}/insight`,
    MealInsightView,
    fetchImpl,
    feed,
    complete,
  );
  if (!value || !["ready", "pending"].includes(value.state)) return null;
  return (
    <section className={styles.card} data-size={size} data-verified="false" aria-label={t("badge")}>
      <div className={styles.heading}>
        <span className={styles.badge}>{t("badge")}</span>
        <span className={styles.caption}>{t(size === "desktop" ? "desktopNote" : "note")}</span>
      </div>
      <p>{value.state === "pending" ? t("pending") : value.text}</p>
    </section>
  );
}
