"use client";

import type { Trend } from "@frejsi/shared";
import { useTranslations } from "next-intl";

import styles from "./glucose.module.css";

/** Degrees to rotate the ↗ of the artboards for each trend; null draws a dash (design gap 4). */
const ROTATION: Record<Trend, number | null> = {
  "double-up": -45,
  "single-up": -45,
  "forty-five-up": 0,
  flat: 45,
  "forty-five-down": 90,
  "single-down": 135,
  "double-down": 135,
  "not-computable": null,
  "rate-out-of-range": null,
};

const DOUBLE = new Set<Trend>(["double-up", "double-down"]);

export interface TrendArrowProps {
  trend: Trend;
  /** Rendered size in px: 40 normal, 64/88 simpleMode, 30 preview, 18 inline. */
  size: number;
  /** simpleMode draws the arrow on a tinted circle (Nu-Simpel). */
  circled?: boolean;
}

/**
 * The trend arrow with the trend word as its accessible name. The arrow of the artboards
 * (`M10 30 L30 10 M16 10 H30 V24` in a 40 px box) rotated per trend; a double trend draws two.
 */
export function TrendArrow({ trend, size, circled = false }: TrendArrowProps) {
  const t = useTranslations("glucose.trend");
  const word = t(trend);
  const rotation = ROTATION[trend];
  const strokeWidth = circled ? 5 : 3.5;
  return (
    <svg
      className={styles.arrow}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label={word}
      data-trend={trend}
    >
      {circled && <circle cx="20" cy="20" r="19" className={styles.arrowCircle} />}
      {rotation === null ? (
        <path
          d={trend === "rate-out-of-range" ? "M12 16 H28 M12 24 H28" : "M12 20 H28"}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      ) : DOUBLE.has(trend) ? (
        <g transform={`rotate(${rotation} 20 20)`}>
          <path
            d="M6 30 L26 10 M14 10 H26 V22"
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M14 34 L34 14 M22 14 H34 V26"
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      ) : (
        <path
          d="M10 30 L30 10 M16 10 H30 V24"
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          transform={`rotate(${rotation} 20 20)`}
        />
      )}
    </svg>
  );
}
