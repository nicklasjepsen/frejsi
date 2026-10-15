"use client";

import type { InviteView } from "@frejsi/shared";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { homePath } from "@/components/shell/nav";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";

import { PasskeyIcon } from "./PasskeyIcon";
import { PublicPage } from "./PublicPage";
import styles from "./invite.module.css";
import { navigate } from "./navigate";
import { CeremonyError, registerWithInvite } from "./passkey-client";
import pub from "./public.module.css";

const INVITE_CODES = new Set(["invite-expired", "invite-used", "invite-revoked"]);

function Check() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className={styles.check}>
      <path
        d="M4 10.5 L8 14.5 L16 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Line({ children }: { children: ReactNode }) {
  return (
    <div className={styles.line}>
      <Check />
      <div>{children}</div>
    </div>
  );
}

/**
 * The landing behind an invitation link (Invitation-Telefon, Invitation-Desktop): the greeting,
 * the role in the design's words, who invited, the reassurance lines and one button that runs
 * task 5's registration. The phone block and the desktop panel are both rendered; CSS shows one.
 * The token never appears in the DOM; it is in the URL already and goes only to the ceremony.
 */
export function InviteLanding({
  locale,
  token,
  view,
}: {
  locale: AppLocale;
  token: string;
  view: InviteView;
}) {
  const t = useTranslations("invite");
  const root = useTranslations();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const messageFor = (error: unknown): string => {
    if (error instanceof CeremonyError) {
      if (error.kind === "cancelled") return root("passkey.cancelled");
      if (error.kind === "unsupported") return root("passkey.unsupported");
      if (error.code && INVITE_CODES.has(error.code)) return root(`errors.api.${error.code}`);
    }
    return root("passkey.failed");
  };

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const { role } = await registerWithInvite(token);
      navigate(localeHref(locale, homePath(role)));
    } catch (error) {
      setFailure(messageFor(error));
      setBusy(false);
    }
  };

  const inviter = view.inviterName;
  const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;
  const expires = <p className={styles.expiry}>{t("expires", { days: view.daysLeft })}</p>;
  const feedback = (
    <>
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
    </>
  );

  return (
    <PublicPage footer={t("footer")}>
      <div className={pub.hero}>
        <Avatar name={view.spaceName} size={72} />
        <h1 className={pub.title}>
          {t("greeting", { name: view.name })}{" "}
          <br />
          {view.forExistingUser
            ? t("greetingDevice", { space: view.spaceName })
            : t("greetingSpace", { space: view.spaceName })}
        </h1>
        <p className={pub.lead} data-testid="invite-lead">
          {view.forExistingUser ? (
            t("deviceExplained", { inviter })
          ) : (
            <>
              {t.rich(`invitedAs.${view.role}`, { inviter, role: strong })}{" "}
              {t(`roleExplained.${view.role}`)}
            </>
          )}
        </p>
        {feedback}
      </div>

      <section className={pub.phoneOnly} aria-label={t("desktop.title")}>
        <Card className={styles.phoneCard}>
          <div className={styles.lines}>
            <Line>{t("phone.noPassword")}</Line>
            <Line>{t("phone.newPhone", { inviter })}</Line>
          </div>
        </Card>
        <div className={styles.spacer} />
        <div className={pub.actions}>
          <Button size="phone" onClick={() => void create()} disabled={busy} aria-busy={busy}>
            <PasskeyIcon />
            {t("phone.button")}
          </Button>
          {expires}
        </div>
      </section>

      <Card className={`${pub.desktopOnly} ${styles.panel}`} aria-label={t("desktop.title")}>
        <h2 className={styles.panelTitle}>{t("desktop.title")}</h2>
        <div className={styles.lines}>
          <Line>{t("desktop.noPassword")}</Line>
          <Line>{t("desktop.alsoPhone", { inviter })}</Line>
        </div>
        <div className={pub.actions}>
          <Button size="phone" onClick={() => void create()} disabled={busy} aria-busy={busy}>
            <PasskeyIcon size={22} />
            {t("desktop.button")}
          </Button>
          {expires}
        </div>
      </Card>
    </PublicPage>
  );
}
