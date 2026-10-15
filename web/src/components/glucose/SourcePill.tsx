"use client";

import type { GlucoseSourceType, Reading, SourceStatus } from "@frejsi/shared";
import { useTranslations } from "next-intl";

import { formatClock } from "@/lib/i18n/time";

import { isStale } from "./format";
import styles from "./glucose.module.css";

export interface SourcePillProps {
  status: SourceStatus;
  /** The display name comes from `source.<type>.name`; a new source adds a string, not a branch. */
  sourceType: GlucoseSourceType | null;
  /** The latest reading, for "sidste måling 15:13" and for the muted dot after 15 minutes. */
  latest: Reading | null;
  now: Date;
  timeZone: string;
  /** `pill`: "Dexcom Share forbundet" (Nu phone header); `line`: "Dexcom Share · sidste måling 15:13" (Nu-Desktop). */
  variant: "pill" | "line";
}

/**
 * The source status (design README `SourceStatus`): a dot and one line. The dot is the accent
 * while readings arrive and turns muted after 15 minutes without one (plan §9). While the source
 * is disconnected the banner speaks instead and this renders nothing.
 */
export function SourcePill({
  status,
  sourceType,
  latest,
  now,
  timeZone,
  variant,
}: SourcePillProps) {
  const t = useTranslations("glucose.source");
  const names = useTranslations("source");
  if (status === "disconnected") return null;

  let text: string;
  if (status === "not-configured" || !sourceType) {
    text = t("none");
  } else {
    const source = names(`${sourceType}.name`);
    if (variant === "pill") text = t("connected", { source });
    else if (latest)
      text = t("lastReading", { source, time: formatClock(new Date(latest.ts), timeZone) });
    else text = t("noReading", { source });
  }
  const muted = status === "not-configured" || !sourceType || isStale(latest, now);

  return (
    <div className={styles.source} data-variant={variant} role="status">
      <span
        className={styles.dot}
        data-muted={muted ? "true" : undefined}
        data-testid="source-dot"
        aria-hidden="true"
      />
      <span>{text}</span>
    </div>
  );
}
