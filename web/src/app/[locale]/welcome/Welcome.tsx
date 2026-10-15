"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";

import { PasskeyIcon } from "../invite/PasskeyIcon";
import { PublicPage } from "../invite/PublicPage";
import { navigate } from "../invite/navigate";
import { CeremonyError, signInWithPasskey } from "../invite/passkey-client";
import pub from "../invite/public.module.css";

import styles from "./welcome.module.css";

/**
 * The returning sign-in (spec §2b, design gap 23): "Log ind" runs task 5's discoverable-credential
 * login and lands on the locale's front page, which sends the role to its home (Nu, or the viewer's
 * day). Below it, the text that a first visit needs an invitation link. A passkey the server does
 * not know gets its own line: it is most often a new device, and the way back is an owner.
 */
export function Welcome({ locale }: { locale: AppLocale }) {
  const t = useTranslations("welcome");
  const root = useTranslations();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const messageFor = (error: unknown): string => {
    if (error instanceof CeremonyError) {
      if (error.kind === "cancelled") return root("passkey.cancelled");
      if (error.kind === "unsupported") return root("passkey.unsupported");
      if (error.code === "forbidden") return t("failed");
    }
    return root("passkey.failed");
  };

  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await signInWithPasskey();
      navigate(localeHref(locale, "/"));
    } catch (error) {
      setFailure(messageFor(error));
      setBusy(false);
    }
  };

  return (
    <PublicPage footer={root("invite.footer")}>
      <div className={pub.hero}>
        <h1 className={pub.title}>{t("title")}</h1>
        <p className={pub.lead}>{t("body")}</p>
      </div>
      <div className={styles.column}>
        <div className={pub.actions}>
          {busy && (
            <p role="status" className={pub.status}>
              {root("passkey.working")}
            </p>
          )}
          {failure && (
            <p role="alert" className={pub.alert}>
              {failure}
            </p>
          )}
          <Button size="phone" onClick={() => void signIn()} disabled={busy} aria-busy={busy}>
            <PasskeyIcon />
            {t("login")}
          </Button>
        </div>
        <Card className={styles.firstTime}>
          <h2 className={styles.firstTimeTitle}>{t("firstTimeTitle")}</h2>
          <Notice>{t("firstTimeBody")}</Notice>
        </Card>
      </div>
    </PublicPage>
  );
}
