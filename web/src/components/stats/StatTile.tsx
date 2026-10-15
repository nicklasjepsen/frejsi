import type { ReactNode } from "react";

import styles from "./stats.module.css";

export interface StatTileProps {
  label: string;
  value: ReactNode;
  footnote?: ReactNode;
  /** `meal`: value 22 px (Maaltid); `week`: 26 px (Historik-Desktop "Ugens tal"). */
  size?: "meal" | "week";
}

/** Label 12 muted, value 22–26 at 700 tabular, footnote 12 muted (design README `StatTile`). */
export function StatTile({ label, value, footnote, size = "meal" }: StatTileProps) {
  return (
    <div className={styles.tile} data-size={size}>
      <span className={styles.label} data-part="label">
        {label}
      </span>
      <span className={styles.value} data-part="value">
        {value}
      </span>
      {footnote !== undefined && (
        <span className={styles.footnote} data-part="footnote">
          {footnote}
        </span>
      )}
    </div>
  );
}

/** The 3-up (meal) or 2-up (week) grid of tiles. */
export function StatGrid({ columns, children }: { columns: 2 | 3; children: ReactNode }) {
  return (
    <div className={styles.grid} data-columns={columns}>
      {children}
    </div>
  );
}
