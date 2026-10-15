"use client";
import { useTranslations } from "next-intl";

import styles from "./library.module.css";

/**
 * Bibliotek-Telefon's 44 px circle: an outlined accent button on an unverified food (the explicit
 * tick a carer makes), a filled tint with a check (`role=img`) once the food is verified.
 */
export function VerifyCircle({
  name,
  verified,
  busy = false,
  onVerify,
}: {
  name: string;
  verified: boolean;
  busy?: boolean;
  onVerify: () => void;
}) {
  const t = useTranslations("library");
  if (verified) {
    return (
      <span
        className={styles.verifyCircle}
        data-verified="true"
        role="img"
        aria-label={t("verified")}
      >
        <Check />
      </span>
    );
  }
  return (
    <button
      type="button"
      className={styles.verifyCircle}
      data-verified="false"
      aria-label={t("verify", { name })}
      aria-busy={busy}
      disabled={busy}
      onClick={onVerify}
    />
  );
}

function Check() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m5 12.5 4.5 4.5L19 7.5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
