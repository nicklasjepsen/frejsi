"use client";
import { dayRange } from "@frejsi/shared/meals/day-range";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { FeedEventType } from "@/lib/live/live-feed";
import type { AppLocale } from "@/lib/i18n/routing";
import { SymptomDetailCard } from "./SymptomDetailCard";
import { SymptomRow } from "./SymptomRow";
import { SymptomsFailed } from "./SymptomsFailed";
import { beforeInstant, useSymptomRange } from "./useSymptomRange";
import styles from "./history.module.css";

type Subscribe = (type: FeedEventType, handler: () => void) => () => void;

/**
 * The viewer's symptoms of one day (v0.6.0 plan §5, decision 6): the rows under the meal list and
 * the detail a tap opens, without any reading. Nothing of glucose is imported here.
 */
export function ViewerSymptoms({
  spaceId,
  date,
  timeZone,
  locale,
  subscribe,
}: {
  spaceId: string;
  date: string;
  timeZone: string;
  locale: AppLocale;
  subscribe: Subscribe;
}) {
  const t = useTranslations("history");
  const [from, to] = useMemo(() => {
    const [start, end] = dayRange(date, timeZone);
    return [start.toISOString(), beforeInstant(end.toISOString())];
  }, [date, timeZone]);
  const range = useSymptomRange(spaceId, from, to, subscribe);
  const [activeId, setActiveId] = useState<string | null>(null);
  if (range.status === "failed") return <SymptomsFailed onRetry={range.refresh} />;
  if (range.status !== "ready" || range.symptoms.length === 0) return null;
  const active = range.symptoms.find((symptom) => symptom.id === activeId) ?? null;
  return (
    <>
      <ul className={styles.timeline} aria-label={t("symptomsLabel")} data-testid="viewer-symptoms">
        {range.symptoms.map((symptom) => (
          <li key={symptom.id}>
            <SymptomRow
              symptom={symptom}
              locale={locale}
              timeZone={timeZone}
              spaceKinds={range.kinds}
              onOpen={setActiveId}
            />
          </li>
        ))}
      </ul>
      {active && (
        <SymptomDetailCard
          locale={locale}
          timeZone={timeZone}
          symptom={active}
          spaceKinds={range.kinds}
          onClose={() => {
            setActiveId(null);
          }}
        />
      )}
    </>
  );
}
