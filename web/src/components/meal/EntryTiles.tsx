"use client";
import { useTranslations } from "next-intl";

import styles from "./meal.module.css";

/**
 * Log-Telefon's entry tiles. The drawn "Sig det" tile is v0.4.0 and is left out, not drawn
 * disabled (decision 30), so the row is 2-up: Scan · Vælg.
 */
export function EntryTiles({ onScan, onPick }: { onScan: () => void; onPick: () => void }) {
  const t = useTranslations("log.entry");
  return (
    <div className={styles.entryTiles}>
      <button type="button" className={styles.entryTile} onClick={onScan}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M7 8v8M10 8v8M13 8v8M16 8v8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <span>{t("scan")}</span>
      </button>
      <button type="button" className={styles.entryTile} onClick={onPick}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Zm0 13a3 3 0 0 1 3-3h11"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
        <span>{t("pick")}</span>
      </button>
    </div>
  );
}
