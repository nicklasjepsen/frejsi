"use client";

import type { GlucoseUnit, Reading } from "@frejsi/shared/schemas/index";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { formatClock } from "@/lib/i18n/time";

import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { TextInput } from "../ui/TextInput";
import { ManualReadingError, postManualReading } from "./api";
import { parseTyped, resolveTime } from "./input";
import styles from "./manual.module.css";

export interface ManualReadingSheetProps {
  spaceId: string;
  /** The space's unit: the field takes what the meter shows, in this unit. */
  unit: GlucoseUnit;
  timeZone: string;
  now: Date;
  /** Called with the stored reading; the caller shows it at once. */
  onStored: (reading: Reading) => void;
  onClose: () => void;
}

type Problem = "value" | "time" | "failed" | null;

/**
 * "Indtast måling": a finger-prick value in the space's unit, "Nu" or a time within the last
 * day, and "Gem måling". It only ever sends the number, the unit and the time; the server
 * checks the role, the mode and the range again.
 */
export function ManualReadingSheet({
  spaceId,
  unit,
  timeZone,
  now,
  onStored,
  onClose,
}: ManualReadingSheetProps) {
  const t = useTranslations("manual");
  const errors = useTranslations("errors.api");
  const units = useTranslations("glucose.unit");
  const [text, setText] = useState("");
  const [atNow, setAtNow] = useState(true);
  const [hhmm, setHhmm] = useState(() => formatClock(now, timeZone));
  const [problem, setProblem] = useState<Problem>(null);
  const [apiCode, setApiCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement;
    if (typeof node?.showModal === "function") node.showModal();
    else node?.setAttribute("open", "");
    node?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      if (typeof node?.close === "function") node.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (locked.current) return;
    const value = parseTyped(text, unit);
    if (value === null) {
      setProblem("value");
      return;
    }
    let ts: string | undefined;
    if (!atNow) {
      const at = resolveTime(hhmm, now, timeZone);
      if (!at) {
        setProblem("time");
        return;
      }
      ts = at.toISOString();
    }
    locked.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const stored = await postManualReading(spaceId, { value, unit, ...(ts ? { ts } : {}) });
      onStored(stored);
      onClose();
    } catch (error) {
      const code = error instanceof ManualReadingError ? error.code : "internal";
      if (code === "validation") setProblem("value");
      else if (code === "reading-out-of-window") setProblem("time");
      else {
        setApiCode(code);
        setProblem("failed");
      }
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className={styles.sheet}
      aria-labelledby="manual-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      data-testid="manual-sheet"
    >
      <form className={styles.form} onSubmit={(event) => void save(event)} noValidate>
        <h2 id="manual-title" className={styles.title}>
          {t("title")}
        </h2>
        <TextInput
          label={t("value", { unit: units(unit) })}
          name="value"
          inputMode={unit === "mgdl" ? "numeric" : "decimal"}
          autoComplete="off"
          value={text}
          aria-invalid={problem === "value" ? true : undefined}
          onChange={(event) => {
            setText(event.target.value);
            if (problem === "value") setProblem(null);
          }}
        />
        {problem === "value" && (
          <p className={styles.error} role="alert">
            {t("invalidValue")}
          </p>
        )}
        <div className={styles.when}>
          <Chip
            pressed={atNow}
            onClick={() => {
              setAtNow(true);
              setHhmm(formatClock(now, timeZone));
              if (problem === "time") setProblem(null);
            }}
          >
            {t("now")}
          </Chip>
          <TextInput
            label={t("time")}
            name="time"
            type="time"
            value={atNow ? formatClock(now, timeZone) : hhmm}
            aria-invalid={problem === "time" ? true : undefined}
            onChange={(event) => {
              setAtNow(false);
              setHhmm(event.target.value);
              if (problem === "time") setProblem(null);
            }}
          />
        </div>
        {problem === "time" && (
          <p className={styles.error} role="alert">
            {t("invalidTime")}
          </p>
        )}
        {problem === "failed" && (
          <p className={styles.error} role="alert">
            {apiCode === "internal" ? t("failed") : errors(apiCode as never)}
          </p>
        )}
        <div className={styles.actions}>
          <Button type="submit" size="phone" disabled={busy}>
            {t("save")}
          </Button>
          <Button size="phone" variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
