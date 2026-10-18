"use client";
import type { SpaceSymptomKind, SymptomView } from "@frejsi/shared/schemas/symptom";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { SymptomDetail } from "@/components/symptoms/SymptomDetail";
import { deleteSymptom } from "@/components/symptoms/api";
import { useKindLabel } from "@/components/symptoms/kinds";
import symptomStyles from "@/components/symptoms/symptoms.module.css";
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
  /**
   * The space the symptom belongs to and whether this member may delete it (#220): an owner or
   * carer outside simpleMode. "Slet" shows only with both; the route refuses everyone else anyway.
   */
  spaceId?: string;
  mayDelete?: boolean;
  onClose: () => void;
}

/** "Ondt i maven" mid-sentence reads "ondt i maven"; a label like "ADHD" keeps its capitals. */
function midSentence(label: string): string {
  return /^\p{Lu}\p{Ll}/u.test(label)
    ? label.charAt(0).toLocaleLowerCase() + label.slice(1)
    : label;
}

/**
 * What a tap on a symptom marker or row opens (v0.6.0 plan §5): #199's `SymptomDetail` in a
 * dialog under the curve or the list, with "Luk". Focus moves in on open and back on close;
 * Escape closes. For an owner or carer it also has "Slet" with one question in the card (#220);
 * the route emits `symptom.deleted`, and the screens' symptom ranges drop the marker and the row.
 */
export function SymptomDetailCard({
  locale,
  timeZone,
  symptom,
  spaceKinds = [],
  readings,
  spaceId,
  mayDelete = false,
  onClose,
}: SymptomDetailCardProps) {
  const t = useTranslations("symptoms");
  const labelOf = useKindLabel(locale, spaceKinds);
  const panel = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // A screen keeps the card mounted when another marker or row is tapped: a question asked
  // about one symptom never carries over to the next.
  const [shownId, setShownId] = useState(symptom.id);
  if (shownId !== symptom.id) {
    setShownId(symptom.id);
    setConfirming(false);
    setFailed(false);
  }
  const deletable = mayDelete && spaceId !== undefined;
  const time = formatClock(new Date(symptom.ts), timeZone);
  const confirmDelete = async () => {
    if (!spaceId) return;
    setBusy(true);
    setFailed(false);
    try {
      await deleteSymptom(spaceId, symptom.id);
      onClose();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
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
      aria-label={`${labelOf(symptom.kind)} ${t("at", { time })}`}
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
      {confirming ? (
        <div className={symptomStyles.confirm}>
          <p>{t("deleteConfirm", { kind: midSentence(labelOf(symptom.kind)), time })}</p>
          <div className={symptomStyles.actions}>
            <Button variant="primary" disabled={busy} onClick={() => void confirmDelete()}>
              {t("delete")}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setFailed(false);
              }}
            >
              {t("deleteKeep")}
            </Button>
          </div>
          {failed && <p role="alert">{t("deleteFailed")}</p>}
        </div>
      ) : (
        <div className={symptomStyles.actions}>
          <Button variant="secondary" onClick={onClose}>
            {t("close")}
          </Button>
          {deletable && (
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(true);
              }}
            >
              {t("delete")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
