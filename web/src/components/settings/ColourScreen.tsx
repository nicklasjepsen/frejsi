"use client";

// Values come from the pure modules by path, never from the shared index: a client bundle must not
// pull in the Prisma client or App Insights that the index exports (plan §2; see routing.ts).
import type { ApiErrorCode } from "@frejsi/shared";
import { Accent } from "@frejsi/shared/schemas/settings";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";

import { PageHeader } from "./controls";
import type { SettingsData } from "./load-settings";
import { failureCode, settingsApi, type SettingsApi } from "./settings-client";
import styles from "./settings.module.css";

export interface ColourScreenProps {
  locale: AppLocale;
  data: SettingsData;
  api?: SettingsApi;
}

/**
 * Farve (Farve-Indstilling, design README "Per-person accent colour"): an owner picks for anyone
 * in the space, a person for themselves. The preview card carries `data-accent` so the choice is
 * seen at once; the shell follows on the refresh. A viewer's preview never mounts a glucose
 * reading (plan task 9, §2).
 */
export function ColourScreen({ locale, data, api = settingsApi() }: ColourScreenProps) {
  const t = useTranslations("settings");
  const accents = useTranslations("accent");
  const errors = useTranslations("errors.api");
  const router = useRouter();

  const [people, setPeople] = useState(data.people);
  const [selectedId, setSelectedId] = useState(data.me.userId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorCode | null>(null);

  const selected = people.find((p) => p.userId === selectedId) ?? data.me;
  const isMe = selected.userId === data.me.userId;
  const canSeeGlucose = data.role !== "viewer";

  async function pick(accent: Accent) {
    if (accent === selected.accent) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.patchPerson(data.spaceId, selected.userId, isMe, { accent });
      setPeople((current) =>
        current.map((p) => (p.userId === selected.userId ? { ...p, ...next } : p)),
      );
      router.refresh();
    } catch (failure) {
      setError(failureCode(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page} data-testid="colour" aria-busy={busy}>
      <PageHeader
        backHref={localeHref(locale, "/settings")}
        backLabel={t("back")}
        title={t("colour.title")}
      />
      <p className={styles.lead}>{t("colour.lead")}</p>

      {people.length > 1 && (
        <div role="radiogroup" aria-label={t("colour.people")} className={styles.chips}>
          {people.map((person) => (
            <button
              key={person.userId}
              type="button"
              role="radio"
              aria-checked={person.userId === selected.userId}
              className={styles.chip}
              onClick={() => {
                setSelectedId(person.userId);
              }}
            >
              <Avatar name={person.name} size={28} tone="member" />
              {person.userId === data.me.userId
                ? t("simpleMode.you", { name: person.name })
                : person.name}
            </button>
          ))}
        </div>
      )}

      <div role="radiogroup" aria-label={t("colour.swatches")} className={styles.swatches}>
        {Accent.options.map((accent) => (
          <button
            key={accent}
            type="button"
            role="radio"
            aria-checked={accent === selected.accent}
            aria-label={t("colour.pick", { colour: accents(accent), name: selected.name })}
            className={styles.swatchButton}
            disabled={busy}
            onClick={() => void pick(accent)}
          >
            <span className={styles.swatch} data-accent={accent} aria-hidden="true" />
            <span>{accents(accent)}</span>
          </button>
        ))}
      </div>

      {error && (
        <Notice tone="sunken" role="alert">
          {errors(error)}
        </Notice>
      )}

      <Card className={styles.preview} data-accent={selected.accent} data-testid="colour-preview">
        <p className={styles.previewTitle}>{t("colour.previewFor", { name: selected.name })}</p>
        <div className={styles.previewBand}>
          {canSeeGlucose && <PreviewReading connected={data.source?.status === "connected"} />}
        </div>
        <Button size="phone" disabled>
          {t("colour.eatingNow")}
        </Button>
      </Card>

      <Notice>{isMe ? t("colour.noteSelf") : t("colour.note", { name: selected.name })}</Notice>
    </div>
  );
}

/**
 * The glucose part of the preview. This is where `GlucoseValue`, fed by `useLiveFeed` (plan task
 * 8, issue #20), renders the latest reading with its age once that lane has landed; until then the
 * card shows the source status and nothing more, because a number never appears without its time.
 * Not mounted for a viewer at all.
 */
function PreviewReading({ connected }: { connected: boolean }) {
  const t = useTranslations("settings.colour");
  return (
    <p className={styles.previewStatus} data-testid="preview-reading">
      <span className={styles.dot} aria-hidden="true" />
      {connected ? t("connected") : t("noReadings")}
    </p>
  );
}
