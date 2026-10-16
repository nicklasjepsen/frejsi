"use client";

import type { SpaceSettings } from "@frejsi/shared";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { localeHref, type AppLocale } from "@/lib/i18n/routing";

import type { SourceView } from "./contracts";
import { PageHeader } from "./controls";
import { SourceCards } from "./SourceCards";
import { settingsApi, type SettingsApi } from "./settings-client";
import styles from "./settings.module.css";

export interface SourcePickerProps {
  locale: AppLocale;
  spaceId: string;
  source: SourceView;
  timezone: string;
  now: string;
  api?: SettingsApi;
}

/**
 * `settings/source`, the phone page behind the "Glukosekilde" row (no artboard, design gap, derived
 * from the desktop cards): the three sources as radio cards with their buttons, and the vault
 * notice. Owners only; the page sends anyone else back to Settings.
 */
export function SourcePicker({
  locale,
  spaceId,
  source,
  timezone,
  now,
  api = settingsApi(),
}: SourcePickerProps) {
  const t = useTranslations("settings");
  const router = useRouter();
  const [current, setCurrent] = useState(source);

  const switched = (next: SpaceSettings) => {
    setCurrent({
      type: next.sourceType,
      region: null,
      status: next.sourceStatus,
      lastReadingAt: next.lastReadingAt,
      since: now,
    });
    router.push(localeHref(locale, "/settings"));
    router.refresh();
  };

  return (
    <div className={styles.page} data-testid="source-picker">
      <PageHeader
        backHref={localeHref(locale, "/settings")}
        backLabel={t("back")}
        title={t("sections.source")}
      />
      <p className={styles.lead}>{t("source.pickerLead")}</p>
      <SourceCards
        layout="radio"
        locale={locale}
        spaceId={spaceId}
        source={current}
        timezone={timezone}
        now={now}
        owner
        api={api}
        onSwitched={switched}
      />
    </div>
  );
}
