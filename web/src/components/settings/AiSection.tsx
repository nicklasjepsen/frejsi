"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import type { AiProviderId, AiUsage, UpdateSpaceSettingsRequest } from "@frejsi/shared/schemas/ai";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/Button";
import { useDialogScrollLock } from "@/lib/ui/useScrollLock";
import { Row, Switch } from "./controls";
import { PushRow } from "./PushRow";
import styles from "./settings.module.css";

export function AiSection({
  spaceId,
  subject,
  enabled,
  provider,
  usage,
  owner,
  busy,
  onChange,
}: {
  spaceId: string;
  subject: string;
  enabled: boolean;
  provider: AiProviderId | undefined;
  usage: AiUsage | null;
  owner: boolean;
  busy: boolean;
  onChange: (patch: UpdateSpaceSettingsRequest) => void;
}) {
  const t = useTranslations("settings");
  const picker = useRef<HTMLDialogElement>(null);
  useDialogScrollLock(picker);
  const selected = usage?.providers.find((p) => p.id === provider && p.configured)?.id;
  const available = selected ?? usage?.providers.find((p) => p.configured)?.id;
  const chips = () => (
    <div className={styles.providerChips}>
      {usage?.providers.map((p) => (
        <div className={styles.providerOption} key={p.id}>
          <Chip
            className={styles.providerChip}
            pressed={p.id === provider}
            disabled={!owner || busy || !p.configured}
            onClick={() => {
              onChange({ aiProvider: p.id });
              picker.current?.close();
            }}
          >
            {t(`ai.providers.${p.id}`)}
          </Chip>
          {!p.configured ? (
            <span className={styles.providerCaption}>{t("ai.unconfigured")}</span>
          ) : !p.capabilities.embed ? (
            <span className={styles.providerCaption}>{t("ai.noEmbed")}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
  return (
    <section id="ai" className={styles.section} data-testid="ai-section">
      <h2 className={styles.sectionTitle}>{t("sections.ai")}</h2>
      <p className={`${styles.lead} ${styles.desktopOnly}`}>{t("ai.desktopLead")}</p>
      <Card className={styles.list}>
        <Row
          title={t("sections.ai")}
          sub={`${t("ai.lead")} · ${enabled && provider ? t(`ai.providers.${provider}`) : t("ai.off")}`}
          testId="ai-row"
          control={
            <Switch
              label={t("sections.ai")}
              checked={enabled}
              disabled={!owner || busy || (!enabled && !available)}
              onChange={(aiEnabled) => {
                onChange(
                  aiEnabled && !selected && available
                    ? { aiEnabled, aiProvider: available }
                    : { aiEnabled },
                );
              }}
            />
          }
        />
        <div className={styles.phoneOnly}>
          <p className={styles.aiPhoneNotice}>
            {t("ai.phoneNotice", { cap: usage?.dailyCap ?? 50 })}
          </p>
        </div>
        {!usage?.providers.some((p) => p.configured) && <Notice>{t("ai.notConfigured")}</Notice>}
        <div className={styles.phoneOnly}>
          <Row
            title={t("ai.provider")}
            sub={provider ? t(`ai.providers.${provider}`) : t("ai.off")}
            control={
              <Button
                variant="secondary"
                disabled={!owner || busy}
                onClick={() => picker.current?.showModal()}
              >
                {t("ai.change")}
              </Button>
            }
          />
        </div>
        <div className={`${styles.aiDesktop} ${styles.desktopOnly}`}>
          <span className={styles.lead}>{t("ai.provider")}</span>
          {chips()}
          <Notice tone="sunken">
            <strong>{t("ai.readingsLead")}</strong> {t("ai.readingsNotice")}
          </Notice>
          <Notice tone="sunken">
            <strong>{t("ai.actionLead")}</strong> {t("ai.actionNotice")}
          </Notice>
          <Notice tone="sunken">
            <strong>{t("ai.capLead", { cap: usage?.dailyCap ?? 50 })}</strong>{" "}
            {t("ai.capNotice", { n: usage?.callsToday ?? 0 })}
          </Notice>
        </div>
        {enabled && usage?.pushPublicKey && (
          <PushRow spaceId={spaceId} subject={subject} publicKey={usage.pushPublicKey} />
        )}
      </Card>
      <dialog className={styles.providerSheet} ref={picker} aria-label={t("ai.provider")}>
        <h2 className={styles.sectionTitle}>{t("ai.provider")}</h2>
        {chips()}
        <Button variant="secondary" onClick={() => picker.current?.close()}>
          {t("ai.close")}
        </Button>
      </dialog>
    </section>
  );
}
