"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/Button";

import type { CreatedInviteView } from "./contract";
import styles from "./people.module.css";
import { QrCode } from "./QrCode";

/**
 * What the owner gets once an invitation exists (Personer-Desktop): the QR code, who should scan
 * it, the validity line, the link itself and "Kopiér link". The link is shown this once; the
 * list names the invite by its hash from then on.
 */
export function InviteResult({
  result,
  caption,
  doneLabel,
  onDone,
}: {
  result: CreatedInviteView;
  caption: string;
  doneLabel: string;
  onDone: () => void;
}) {
  const t = useTranslations("people.invite");
  const [copied, setCopied] = useState(false);

  const copy = () => {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard) return;
    clipboard.writeText(result.url).then(
      () => {
        setCopied(true);
      },
      () => {
        setCopied(false);
      },
    );
  };

  return (
    <div className={styles.result} data-testid="invite-result">
      <div className={styles.qrBox}>
        <QrCode value={result.url} label={t("qr")} size={96} />
      </div>
      <div className={styles.resultText}>
        <p>{caption}</p>
        <p className={styles.validity}>{t("validity")}</p>
        <code className={styles.link} data-testid="invite-link" aria-label={t("link")}>
          {result.url}
        </code>
        <div className={styles.resultActions}>
          <Button variant="secondary" onClick={copy}>
            {t("copyLink")}
          </Button>
          <Button variant="secondary" onClick={onDone}>
            {doneLabel}
          </Button>
        </div>
        <span role="status" className={styles.status}>
          {copied ? t("copied") : ""}
        </span>
      </div>
    </div>
  );
}
