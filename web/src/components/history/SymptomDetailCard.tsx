"use client";
import type { SpaceSymptomKind, SymptomView } from "@frejsi/shared/schemas/symptom";
import { useTranslations } from "next-intl";
import { useEffect, useRef, type KeyboardEvent } from "react";

import { SymptomDetail } from "@/components/symptoms/SymptomDetail";
import { useKindLabel } from "@/components/symptoms/kinds";
import { Button } from "@/components/ui/Button";
import type { AppLocale } from "@/lib/i18n/routing";
import { formatClock } from "@/lib/i18n/time";

import styles from "./history.module.css";

export interface SymptomDetailCardProps {
  locale: AppLocale;
  timeZone: string;
  symptom: SymptomView;
  spaceKinds?: readonly SpaceSymptomKind[];
  /**
   * The readings around it, already formatted with their times by the screen that has them
   * (`readingsAround` in the glucose components). A viewer's screen passes none: nothing of
   * glucose is imported here.
   */
  readings?: readonly { ts: string; text: string }[];
  onClose: () => void;
}

/**
 * What a tap on a symptom marker or row opens (v0.6.0 plan §5): #199's `SymptomDetail` in a
 * dialog under the curve or the list, with "Luk". Focus moves in on open and back on close;
 * Escape closes.
 */
export function SymptomDetailCard({
  locale,
  timeZone,
  symptom,
  spaceKinds = [],
  readings,
  onClose,
}: SymptomDetailCardProps) {
  const t = useTranslations("symptoms");
  const labelOf = useKindLabel(locale, spaceKinds);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [symptom.id]);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };
  return (
    <div
      ref={panel}
      className={styles.symptomDetail}
      role="dialog"
      aria-label={`${labelOf(symptom.kind)} ${t("at", { time: formatClock(new Date(symptom.ts), timeZone) })}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-testid="symptom-detail-card"
    >
      <SymptomDetail
        locale={locale}
        timeZone={timeZone}
        symptom={symptom}
        spaceKinds={spaceKinds}
        {...(readings ? { readings } : {})}
      />
      <Button variant="secondary" onClick={onClose}>
        {t("close")}
      </Button>
    </div>
  );
}
