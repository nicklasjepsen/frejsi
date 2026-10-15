"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";

import { PublicPage } from "./PublicPage";
import type { DeadInviteCode } from "./dead-link";
import styles from "./invite.module.css";
import pub from "./public.module.css";

/**
 * A link that is used, revoked or expired (design gap 23): what happened, who can send a new
 * one, and the way to sign in for someone who already has access. It knows the code and nothing
 * else: not the space, not the names, so a stale link reveals nothing to whoever holds it.
 * `ttlDays` is how long a link lives, from the auth core, so the expired line never drifts.
 */
export function InviteUnavailable({
  locale,
  code,
  ttlDays,
}: {
  locale: AppLocale;
  code: DeadInviteCode;
  ttlDays: number;
}) {
  const t = useTranslations("invite");
  return (
    <PublicPage>
      <div className={pub.hero}>
        <h1 className={pub.title}>{t("unavailable.title")}</h1>
        <p className={pub.lead}>{t(`unavailable.${code}`, { days: ttlDays })}</p>
      </div>
      <div>
        <Card className={styles.help}>{t("unavailable.whoCanHelp")}</Card>
        <div className={styles.again}>
          <Notice>{t("unavailable.alreadyIn")}</Notice>
          <Button href={localeHref(locale, "/welcome")} variant="secondary">
            {t("unavailable.login")}
          </Button>
        </div>
      </div>
    </PublicPage>
  );
}
