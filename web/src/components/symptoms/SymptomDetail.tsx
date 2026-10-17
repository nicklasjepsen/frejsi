"use client";
import type { SpaceSymptomKind, SymptomView } from "@frejsi/shared";
import { useTranslations } from "next-intl";
import type { AppLocale } from "@/lib/i18n/routing";
import { formatClock } from "@/lib/i18n/time";
import { SymptomIcon } from "./icons";
import { useKindLabel } from "./kinds";
import styles from "./symptoms.module.css";

export interface SymptomDetailProps {
  locale: AppLocale;
  timeZone: string;
  symptom: SymptomView;
  spaceKinds?: readonly SpaceSymptomKind[];
  /**
   * The readings around it, already formatted by the glucose components of the screen that
   * shows the detail, each with its instant: a value is never shown without its time. A viewer's
   * screen passes none.
   */
  readings?: readonly { ts: string; text: string }[];
}

/** What a tap on a symptom marker shows (plan §5; the curve lane mounts it). */
export function SymptomDetail({
  locale,
  timeZone,
  symptom,
  spaceKinds = [],
  readings,
}: SymptomDetailProps) {
  const t = useTranslations("symptoms");
  const labelOf = useKindLabel(locale, spaceKinds);
  return (
    <div className={styles.detail} data-testid="symptom-detail">
      <h3>
        <SymptomIcon kind={symptom.kind} size={28} />
        <span>
          {labelOf(symptom.kind)} {t("at", { time: formatClock(new Date(symptom.ts), timeZone) })}
        </span>
      </h3>
      {symptom.severity && <p>{t(`severities.${symptom.severity}`)}</p>}
      {symptom.note && <p>{symptom.note}</p>}
      <p className={styles.muted}>{t("by", { name: symptom.byName })}</p>
      {symptom.resolvedTs && (
        <p className={styles.muted}>
          {t("resolved", { time: formatClock(new Date(symptom.resolvedTs), timeZone) })}
        </p>
      )}
      {readings && readings.length > 0 && (
        <ul className={styles.list} aria-label={t("readings")}>
          {readings.map((reading) => (
            <li key={reading.ts} className={styles.entry}>
              {formatClock(new Date(reading.ts), timeZone)} · {reading.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
