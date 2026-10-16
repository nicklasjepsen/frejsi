"use client";

// Values come from the pure modules by path, never from the shared index (see ConnectSourceForm).
import type { ApiErrorCode, SpaceSettings } from "@frejsi/shared";
import { GlucoseSourceType } from "@frejsi/shared/schemas/glucose";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";

import type { SourceView } from "./contracts";
import { failureCode, type SettingsApi } from "./settings-client";
import styles from "./settings.module.css";
import { useSourceText } from "./source-text";

export interface SourceCardsProps {
  locale: AppLocale;
  spaceId: string;
  source: SourceView | null;
  timezone: string;
  /** The server's clock, ISO, for "sidste måling i dag". */
  now: string;
  /** Owners choose and connect; carers see the cards and nothing to press. */
  owner: boolean;
  api: SettingsApi;
  /** Called with the server's answer after a switch, so the screen re-renders without a reload. */
  onSwitched: (settings: SpaceSettings) => void;
  layout?: "cards" | "radio";
}

/**
 * The glucose source cards (Indstillinger-Desktop `SourceCard`; the phone page derives its
 * `RadioCard`s from them): one per `GlucoseSourceType`, the selected one with the accent border.
 * A card is a name and two message keys; a source that needs a login links to its form, and
 * `manual` is chosen here, after a question when it replaces a source that fetches.
 */
export function SourceCards({
  locale,
  spaceId,
  source,
  timezone,
  now,
  owner,
  api,
  onSwitched,
  layout = "cards",
}: SourceCardsProps) {
  const t = useTranslations("settings");
  const sources = useTranslations("source");
  const errors = useTranslations("errors.api");
  const text = useSourceText(source, timezone, now, locale);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorCode | null>(null);

  const current = source?.type ?? null;
  // Nothing to ask about when no source is fetching: only a configured one is being given up.
  const replacesFetching = current !== null && current !== "manual";

  async function chooseManual() {
    setBusy(true);
    setError(null);
    try {
      onSwitched(await api.connectSource(spaceId, { type: "manual" }));
      setAsking(false);
    } catch (failure) {
      setError(failureCode(failure));
    } finally {
      setBusy(false);
    }
  }

  const formHref = (type: GlucoseSourceType) =>
    localeHref(locale, `/settings/source/connect?type=${type}`);

  return (
    <div className={styles.sourceCards} data-layout={layout}>
      {GlucoseSourceType.options.map((type) => {
        const selected = type === current;
        return (
          <div
            key={type}
            className={styles.sourceCard}
            data-selected={selected}
            data-layout={layout}
            data-testid={selected ? "source-card" : `source-card-${type}`}
          >
            <span className={styles.cardText}>
              <span className={styles.cardTitle}>{sources(`${type}.name`)}</span>
              <span className={styles.cardSub}>{text.cardLine(type)}</span>
            </span>
            {owner && type !== "manual" && (
              <Button
                variant="secondary"
                size={layout === "radio" ? "phone" : "desktop"}
                href={formHref(type)}
              >
                {selected ? t("source.changeLogin") : t("source.connect")}
              </Button>
            )}
            {owner && type === "manual" && !selected && (
              <Button
                variant="secondary"
                size={layout === "radio" ? "phone" : "desktop"}
                disabled={busy}
                onClick={() => {
                  setError(null);
                  if (replacesFetching) setAsking(true);
                  else void chooseManual();
                }}
              >
                {t("source.choose")}
              </Button>
            )}
          </div>
        );
      })}
      {asking && current && (
        <div
          className={styles.confirm}
          role="alertdialog"
          aria-label={t("source.manualConfirmYes")}
          data-testid="manual-confirm"
        >
          <p>{t("source.manualConfirm", { source: sources(`${current}.name`) })}</p>
          <div className={styles.actions}>
            <Button disabled={busy} onClick={() => void chooseManual()}>
              {t("source.manualConfirmYes")}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setAsking(false);
              }}
            >
              {t("connect.cancel")}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <Notice tone="sunken" role="alert">
          {errors(error)}
        </Notice>
      )}
      {current && (
        <Notice>
          {current === "manual"
            ? t("source.manualNote")
            : t("source.vaultNote", { source: sources(`${current}.name`) })}
        </Notice>
      )}
    </div>
  );
}
