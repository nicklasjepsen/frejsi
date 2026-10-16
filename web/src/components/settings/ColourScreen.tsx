"use client";

// Values come from the pure modules by path, never from the shared index: a client bundle must not
// pull in the Prisma client or App Insights that the index exports (plan §2; see routing.ts).
import type { ApiErrorCode, GlucoseUnit } from "@frejsi/shared";
import { Accent, Theme } from "@frejsi/shared/schemas/settings";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { GlucoseValue } from "@/components/glucose/GlucoseValue";
import { useNow } from "@/components/glucose/useNow";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";
import { useLiveFeed } from "@/lib/live/useLiveFeed";
import { applyTheme } from "@/lib/theme/theme";

import type { UserSettingsPatch } from "./contracts";
import { PageHeader, Row, SegmentedControl } from "./controls";
import type { SettingsData } from "./load-settings";
import { useServerState } from "./server-state";
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
 * seen at once; the shell follows on the refresh. The same screen holds light or dark: one's own
 * choice switches the whole document before the save answers (and back if it is refused); for
 * another member it is only stored, and their devices follow at their next sign-in or page. A
 * viewer's preview never mounts a glucose reading (plan task 9, §2).
 */
export function ColourScreen({ locale, data, api = settingsApi() }: ColourScreenProps) {
  const t = useTranslations("settings");
  const accents = useTranslations("accent");
  const errors = useTranslations("errors.api");
  const router = useRouter();

  // The server's people, with this screen's own writes layered on until the next refresh.
  const [people, setPeople] = useServerState(data, (d) => d.people);
  const [selectedId, setSelectedId] = useState(data.me.userId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorCode | null>(null);

  const selected = people.find((p) => p.userId === selectedId) ?? data.me;
  const isMe = selected.userId === data.me.userId;
  const canSeeGlucose = data.role !== "viewer";

  async function save(patch: UserSettingsPatch, revert?: () => void) {
    setBusy(true);
    setError(null);
    try {
      const next = await api.patchPerson(data.spaceId, selected.userId, isMe, patch);
      setPeople((current) =>
        current.map((p) => (p.userId === selected.userId ? { ...p, ...next } : p)),
      );
      router.refresh();
    } catch (failure) {
      revert?.();
      setError(failureCode(failure));
    } finally {
      setBusy(false);
    }
  }

  async function pick(accent: Accent) {
    if (accent === selected.accent) return;
    await save({ accent });
  }

  async function pickTheme(theme: Theme) {
    if (theme === selected.theme) return;
    const previous = selected.theme;
    if (isMe) applyTheme(theme);
    await save({ theme }, () => {
      if (isMe) applyTheme(previous);
    });
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

      <Card className={styles.list}>
        <Row
          title={t("colour.theme")}
          sub={t("colour.themeLead")}
          testId="theme-row"
          control={
            <SegmentedControl
              label={t("colour.themeFor", { name: selected.name })}
              value={selected.theme}
              options={Theme.options.map((theme) => ({
                value: theme,
                label: t(`colour.themeOptions.${theme}`),
              }))}
              onChange={(theme) => void pickTheme(theme)}
              disabled={busy}
            />
          }
        />
      </Card>

      {error && (
        <Notice tone="sunken" role="alert">
          {errors(error)}
        </Notice>
      )}

      <Card className={styles.preview} data-accent={selected.accent} data-testid="colour-preview">
        <p className={styles.previewTitle}>{t("colour.previewFor", { name: selected.name })}</p>
        <div className={styles.previewBand}>
          {canSeeGlucose && (
            <PreviewReading spaceId={data.spaceId} unit={data.space?.glucoseUnit ?? "mmol"} />
          )}
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
 * The glucose part of the preview: the latest reading from `useLiveFeed`, through `GlucoseValue`
 * so its age is always shown with it, or "Ingen målinger endnu" once the feed knows there is none.
 * Nothing before the feed has loaded or when it is refused. Not mounted for a viewer at all, and
 * the API sends a viewer no glucose data either.
 */
function PreviewReading({ spaceId, unit }: { spaceId: string; unit: GlucoseUnit }) {
  const feed = useLiveFeed(spaceId, { hours: 1 });
  const now = useNow();
  if (!feed.loaded || feed.error) return null;
  return (
    <GlucoseValue
      reading={feed.latest}
      unit={feed.space?.glucoseUnit ?? unit}
      now={now}
      size="preview"
    />
  );
}
