"use client";
import type { CreateSymptomRequest, Severity, SpaceSymptomKind, SymptomKind } from "@frejsi/shared";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ChipGroup } from "@/components/ui/ChipGroup";
import { Notice } from "@/components/ui/Notice";
import type { AppLocale } from "@/lib/i18n/routing";
import { ALL_KINDS, useKindLabel } from "./kinds";
import styles from "./symptoms.module.css";
import { instantOfLocalTime, localClock } from "./time";

export interface SymptomSheetProps {
  locale: AppLocale;
  timeZone: string;
  spaceKinds: readonly SpaceSymptomKind[];
  /** The tile the sheet was opened from, preselected. */
  initialKind?: SymptomKind | undefined;
  busy: boolean;
  failed: boolean;
  now?: () => Date;
  onSave: (body: CreateSymptomRequest) => void;
  onClose: () => void;
}

const SEVERITIES: Severity[] = ["light", "medium", "strong"];

/**
 * "Mere…": the optional second step of the picker (plan §5). Kind chips, severity chips, a note
 * and a time field; nothing is required beyond the kind. Never shown in simpleMode.
 */
export function SymptomSheet({
  locale,
  timeZone,
  spaceKinds,
  initialKind,
  busy,
  failed,
  now = () => new Date(),
  onSave,
  onClose,
}: SymptomSheetProps) {
  const t = useTranslations("symptoms");
  const labelOf = useKindLabel(locale, spaceKinds);
  const [kind, setKind] = useState<SymptomKind>(initialKind ?? "stomach-ache");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [note, setNote] = useState("");
  const [time, setTime] = useState(() => localClock(now(), timeZone));
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  const instant = instantOfLocalTime(time, timeZone, now());
  return (
    <section
      ref={panel}
      tabIndex={-1}
      className={styles.sheet}
      aria-labelledby="symptom-sheet-title"
      data-testid="symptom-sheet"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) onClose();
      }}
    >
      <h2 id="symptom-sheet-title">{t("sheetTitle")}</h2>
      <ChipGroup
        label={t("kind")}
        options={ALL_KINDS(spaceKinds).map((value) => ({ value, label: labelOf(value) }))}
        value={kind}
        onChange={(value) => {
          setKind(value);
        }}
      />
      <ChipGroup
        label={t("severity")}
        options={SEVERITIES.map((value) => ({ value, label: t(`severities.${value}`) }))}
        value={severity}
        onChange={(value) => {
          setSeverity(value as Severity);
        }}
      />
      <label className={styles.field}>
        {t("note")}
        <textarea
          maxLength={500}
          placeholder={t("notePlaceholder")}
          value={note}
          disabled={busy}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </label>
      <label className={styles.field}>
        {t("time")}
        <input
          type="time"
          value={time}
          disabled={busy}
          onChange={(event) => {
            setTime(event.target.value);
          }}
        />
      </label>
      {failed && (
        <Notice role="alert" tone="sunken">
          {t("saveFailed")}
        </Notice>
      )}
      <div className={styles.actions}>
        <Button variant="secondary" size="phone" onClick={onClose} disabled={busy}>
          {t("cancel")}
        </Button>
        <Button
          size="phone"
          disabled={busy || !instant}
          onClick={() => {
            if (!instant) return;
            onSave({
              kind,
              ts: instant.toISOString(),
              ...(severity ? { severity } : {}),
              ...(note.trim() ? { note: note.trim() } : {}),
            });
          }}
        >
          {t("save")}
        </Button>
      </div>
    </section>
  );
}
