"use client";
import type { ParsedItem, ParsedMeal } from "@frejsi/shared/schemas/ai";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { PhotoPicker } from "../food/PhotoPicker";
import { BackButton } from "../ui/BackButton";
import { Button } from "../ui/Button";
import { Notice } from "../ui/Notice";
import { createSymptom } from "../symptoms/api";
import { parseText, estimatePhoto } from "./api";
import { MicButton } from "./MicButton";
import { ParsedItems, type ParsedSymptom } from "./ParsedItems";
import styles from "./say.module.css";

export function SayItSheet({
  spaceId,
  locale,
  active = true,
  onClose,
  onAdd,
  onSearch,
}: {
  active?: boolean;
  spaceId: string;
  locale: string;
  onClose: () => void;
  onAdd: (items: ParsedItem[]) => Promise<void>;
  onSearch: (query: string) => void;
}) {
  const t = useTranslations("say");
  const [text, setText] = useState("");
  const [meal, setMeal] = useState<ParsedMeal | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const panel = useRef<HTMLElement>(null);
  const pending = useRef(false);
  const live = useRef(true);
  const updateText = useCallback((value: string) => {
    if (pending.current) return;
    setText(value);
    setMeal(null);
    setFailed(false);
  }, []);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement;
    panel.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [active]);
  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await action();
    } catch {
      if (live.current) setFailed(true);
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }
  function show(answer: ParsedMeal) {
    if (live.current) {
      setMeal(answer);
      setVersion((v) => v + 1);
    }
  }
  /**
   * The feelings go through the symptoms route right away; the food goes to the meal draft, and
   * only when there is food. "jeg har ondt i maven" alone logs a symptom and no meal (plan §5).
   */
  async function add(items: ParsedItem[], symptoms: ParsedSymptom[]) {
    for (const symptom of symptoms)
      await createSymptom(spaceId, {
        kind: symptom.kind,
        ...(symptom.note ? { note: symptom.note } : {}),
      });
    if (items.length > 0) await onAdd(items);
    if (live.current) {
      setMeal(null);
      setText("");
    }
    if (items.length === 0) onClose();
  }
  return (
    <section
      hidden={!active}
      ref={panel}
      tabIndex={-1}
      className={styles.sheet}
      aria-label={t("title")}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) onClose();
      }}
    >
      <header className={styles.header}>
        <BackButton onClick={onClose} label={t("back")} disabled={busy} />
        <h2>{t("title")}</h2>
      </header>
      {active && <MicButton locale={locale} onTranscript={updateText} disabled={busy} />}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim())
            void run(async () => {
              show(await parseText(spaceId, text.trim()));
            });
        }}
      >
        <label className={styles.field}>
          {t("field")}
          <textarea
            maxLength={500}
            placeholder={t("placeholder")}
            value={text}
            disabled={busy}
            onChange={(event) => {
              updateText(event.target.value);
            }}
          />
        </label>
        <Button size="phone" type="submit" disabled={busy || !text.trim()}>
          {t("find")}
        </Button>
      </form>
      <fieldset disabled={busy} className={styles.photos}>
        <PhotoPicker
          onPhoto={(bytes) =>
            void run(async () => {
              const estimate = await estimatePhoto(spaceId, bytes);
              show({
                items: estimate.items.map((item) => ({ query: item.name, estimate: item })),
                unmatched: [],
              });
            })
          }
        />
      </fieldset>
      {failed && (
        <Notice role="status" tone="sunken">
          {t("unavailable")}
        </Notice>
      )}
      {meal && (
        <ParsedItems
          key={version}
          meal={meal}
          locale={locale}
          busy={busy}
          onSearch={onSearch}
          onAdd={(items, symptoms) => void run(() => add(items, symptoms))}
        />
      )}
    </section>
  );
}
