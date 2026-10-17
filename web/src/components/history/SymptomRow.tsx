"use client";
import type { SpaceSymptomKind, SymptomView } from "@frejsi/shared/schemas/symptom";
import { useTranslations } from "next-intl";

import { SymptomIcon } from "@/components/symptoms/icons";
import { useKindLabel } from "@/components/symptoms/kinds";
import type { AppLocale } from "@/lib/i18n/routing";
import { formatClock } from "@/lib/i18n/time";

import styles from "./history.module.css";

/**
 * A symptom in the day's list (v0.6.0 plan §5), between the meal rows: the diamond marker, the
 * kind's picture and "Ondt i maven kl. 14:30 · Jonas". A 44 px button that opens the detail.
 * Nothing of glucose: the viewer's list uses it too.
 */
export function SymptomRow({
  symptom,
  locale,
  timeZone,
  spaceKinds = [],
  onOpen,
}: {
  symptom: SymptomView;
  locale: AppLocale;
  timeZone: string;
  spaceKinds?: readonly SpaceSymptomKind[];
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("symptoms");
  const labelOf = useKindLabel(locale, spaceKinds);
  const time = formatClock(new Date(symptom.ts), timeZone);
  return (
    <button
      type="button"
      className={styles.symptomRow}
      data-testid="symptom-row"
      data-kind={symptom.kind}
      onClick={() => {
        onOpen(symptom.id);
      }}
    >
      <svg
        className={styles.symptomRowMarker}
        viewBox="0 0 10 10"
        width="10"
        height="10"
        aria-hidden="true"
        data-testid="symptom-marker"
        data-kind={symptom.kind}
      >
        <path d="M5 0 L10 5 L5 10 L0 5 Z" />
      </svg>
      <SymptomIcon kind={symptom.kind} size={28} />
      <span>{t("entry", { kind: labelOf(symptom.kind), time, name: symptom.byName })}</span>
    </button>
  );
}
