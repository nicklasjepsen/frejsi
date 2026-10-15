"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Kbd } from "@/components/ui";

import styles from "./library.module.css";

/**
 * The tint strip over the table when rows are selected (Bibliotek-Desktop): "2 valgt · Godkend
 * valgte (V) · Fjern fra biblioteket". Removing asks once, inline: it cannot be undone.
 */
export function BatchBar({
  count,
  busy,
  onVerify,
  onRemove,
}: {
  count: number;
  busy: boolean;
  onVerify: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("library.batch");
  const [confirming, setConfirming] = useState(false);
  return (
    <div className={styles.batchBar} role="region" aria-label={t("selected", { count })}>
      <strong>{t("selected", { count })}</strong>
      {confirming ? (
        <>
          <span>{t("confirmRemove", { count })}</span>
          <button
            type="button"
            className={styles.destructive}
            disabled={busy}
            onClick={() => {
              setConfirming(false);
              onRemove();
            }}
          >
            {t("confirmYes")}
          </button>
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              setConfirming(false);
            }}
          >
            {t("cancel")}
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className={styles.batchVerify}
            disabled={busy}
            aria-keyshortcuts="V"
            onClick={onVerify}
          >
            {t("verify")} <Kbd>V</Kbd>
          </button>
          <button
            type="button"
            className={styles.destructive}
            disabled={busy}
            onClick={() => {
              setConfirming(true);
            }}
          >
            {t("remove")}
          </button>
        </>
      )}
    </div>
  );
}
