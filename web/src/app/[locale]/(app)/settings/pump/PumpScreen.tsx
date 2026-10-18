"use client";

import type { PumpSettingsView } from "@frejsi/shared/schemas/pump";
import { useTranslations } from "next-intl";

import { PageHeader } from "@/components/settings/controls";
import { PumpSourceCard } from "@/components/settings/PumpSourceCard";
import styles from "@/components/settings/settings.module.css";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";

export interface PumpScreenProps {
  locale: AppLocale;
  spaceId: string;
  pump: PumpSettingsView;
  timezone: string;
  now: string;
  owner: boolean;
}

/** `settings/pump` on the phone: the back link, the title, the lead and the card at touch size. */
export function PumpScreen({ locale, spaceId, pump, timezone, now, owner }: PumpScreenProps) {
  const settings = useTranslations("settings");
  const t = useTranslations("pumpSettings");
  return (
    <div className={styles.page} data-testid="pump-page">
      <PageHeader
        backHref={localeHref(locale, "/settings")}
        backLabel={settings("back")}
        title={t("title")}
      />
      <p className={styles.lead}>{t("lead")}</p>
      <PumpSourceCard
        layout="page"
        locale={locale}
        spaceId={spaceId}
        pump={pump}
        timezone={timezone}
        now={now}
        owner={owner}
      />
    </div>
  );
}
