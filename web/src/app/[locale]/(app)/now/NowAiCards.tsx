"use client";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/Card";
import { QuickLinkCard } from "@/components/ui/QuickLinkCard";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";
import type { NowAi } from "./useNowAi";
import styles from "./now.module.css";

export function NowAiCards({ ai, locale }: { ai: NowAi; locale: AppLocale }) {
  const t = useTranslations("now");
  const providers = useTranslations("settings.ai.providers");
  const provider =
    ai.provider === "anthropic" || ai.provider === "azure-openai" || ai.provider === "ollama"
      ? providers(ai.provider)
      : "";
  return (
    <div className={styles.aiCards} data-testid="now-ai-cards">
      {ai.enabled && (
        <QuickLinkCard
          href={localeHref(locale, "/history/week#opsummering")}
          icon="◷"
          title={t("weekTitle")}
          subtitle={t(ai.ready ? "weekReady" : "weekPending")}
        />
      )}
      <Card className={styles.aiStatus}>
        <strong>{t("status")}</strong>
        <div className={styles.aiStatusRow}>
          <span>{t("aiHelp")}</span>
          <span>{ai.enabled ? t("aiOn", { provider }) : t("aiOff")}</span>
        </div>
      </Card>
    </div>
  );
}
