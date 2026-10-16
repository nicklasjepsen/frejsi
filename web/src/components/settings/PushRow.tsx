"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { currentPushEnabled, pushSupported, setPushEnabled } from "@/lib/push/subscribe";
import { Row, Switch } from "./controls";
import { Notice } from "@/components/ui/Notice";
import styles from "./settings.module.css";

export function PushRow({
  spaceId,
  subject,
  publicKey,
}: {
  spaceId: string;
  subject: string;
  publicKey: string;
}) {
  const t = useTranslations("settings.push");
  const [state, setState] = useState<
    "loading" | "on" | "off" | "denied" | "unsupported" | "failed"
  >("loading");
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let active = true;
    if (!pushSupported()) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    void currentPushEnabled(spaceId).then(
      (on) => {
        if (active) {
          setChecked(on);
          setState(on ? "on" : "off");
        }
      },
      () => {
        if (active) setState("failed");
      },
    );
    return () => {
      active = false;
    };
  }, [spaceId]);
  const title = (
    <>
      <span className={styles.phoneOnly}>{t("phone", { subject })}</span>
      <span className={styles.desktopOnly}>{t("desktop", { subject })}</span>
    </>
  );
  async function toggle(enabled: boolean) {
    setBusy(true);
    try {
      const result = await setPushEnabled(spaceId, publicKey, enabled);
      setState(result);
      if (result !== "denied") setChecked(result === "on");
    } catch {
      setState("failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div data-testid="push-row">
      <Row
        title={title}
        control={
          <Switch
            label={t("phone", { subject })}
            checked={checked}
            disabled={busy || state === "loading" || state === "unsupported" || state === "denied"}
            onChange={(on) => void toggle(on)}
          />
        }
      />
      {(state === "denied" || state === "unsupported" || state === "failed") && (
        <Notice role="status">{t(state)}</Notice>
      )}
    </div>
  );
}
