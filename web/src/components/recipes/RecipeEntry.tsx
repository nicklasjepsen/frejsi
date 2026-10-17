"use client";
import type { RecipeParseRequest } from "@frejsi/shared/schemas/ai";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { photoUrl } from "@/components/estimate/api";
import { PhotoPicker } from "@/components/food/PhotoPicker";
import { MicButton } from "@/components/say/MicButton";
import { Button, Notice, TextInput } from "@/components/ui";
import type { AppLocale } from "@/lib/i18n/routing";

import styles from "./recipes.module.css";

export interface EntryInitial {
  text?: string | undefined;
  url?: string | undefined;
}

/**
 * The three ways in (plan §6): a photo, a URL or pasted text (with the Say sheet's microphone
 * dictating into the text field, decision 9). Each sends on its own explicit tap; nothing is
 * read before. The photo and the text are absent when AI is off: a URL still works.
 */
export function RecipeEntry({
  locale,
  aiAvailable,
  busy,
  initial,
  onSubmit,
}: {
  locale: AppLocale;
  aiAvailable: boolean;
  busy: boolean;
  initial: EntryInitial;
  onSubmit: (request: RecipeParseRequest, photoDataUrl?: string) => void;
}) {
  const t = useTranslations("recipe.entry");
  const [url, setUrl] = useState(initial.url ?? "");
  const [text, setText] = useState(initial.text ?? "");
  const urlId = useId();
  const validUrl = /^https:\/\/\S+$/.test(url.trim()) && url.trim().length <= 2000;
  return (
    <div className={styles.entry} aria-busy={busy}>
      <p className={styles.muted}>{t("lead")}</p>
      {aiAvailable && (
        <section className={styles.way}>
          <h2>{t("photo")}</h2>
          <PhotoPicker
            cameraOnly
            onPhoto={(bytes) => {
              const photoDataUrl = photoUrl(bytes);
              onSubmit({ photoDataUrl }, photoDataUrl);
            }}
            renderCapture={(open, preparing) => (
              <Button variant="secondary" disabled={busy || preparing} onClick={open}>
                {t("photo")}
              </Button>
            )}
          />
        </section>
      )}
      <form
        className={styles.way}
        onSubmit={(event) => {
          event.preventDefault();
          if (validUrl && !busy) onSubmit({ url: url.trim() });
        }}
      >
        <TextInput
          id={urlId}
          label={t("url")}
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder={t("urlPlaceholder")}
          value={url}
          maxLength={2000}
          onChange={(event) => {
            setUrl(event.target.value);
          }}
        />
        <div>
          <Button type="submit" variant="secondary" disabled={busy || !validUrl}>
            {t("fetch")}
          </Button>
        </div>
      </form>
      {aiAvailable ? (
        <form
          className={styles.way}
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim() && !busy) onSubmit({ text: text.trim().slice(0, 4000) });
          }}
        >
          <MicButton
            locale={locale}
            disabled={busy}
            onTranscript={(spoken) => {
              setText((current) => (current.trim() ? `${current.trim()}\n${spoken}` : spoken));
            }}
          />
          <label className={styles.field}>
            {t("text")}
            <textarea
              maxLength={4000}
              placeholder={t("textPlaceholder")}
              value={text}
              disabled={busy}
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
          </label>
          <div>
            <Button type="submit" variant="secondary" disabled={busy || !text.trim()}>
              {t("read")}
            </Button>
          </div>
        </form>
      ) : (
        <Notice tone="sunken">{t("aiOff")}</Notice>
      )}
      {busy && <p role="status">{t("busy")}</p>}
    </div>
  );
}
