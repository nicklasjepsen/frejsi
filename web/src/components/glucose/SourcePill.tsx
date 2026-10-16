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
  // The pill's wording for a phone header under 400 px, where the space name needs the room: the
  // dot and one word. The full text stays in the DOM for assistive technology.
  let short: string | undefined;
  // A manual space is never polled, so its status is never "connected" in the sensor's sense:
  // it is configured from the moment it is chosen.
  if (!sourceType || (status === "not-configured" && sourceType !== "manual")) {
    text = t("none");
    if (variant === "pill") short = t("noneShort");
  } else {
    const source = names(`${sourceType}.name`);
    if (variant === "pill") {
      // "Manuelt" alone: "forbundet" describes a connection nobody makes (plan §5).
      if (sourceType === "manual") text = source;
      else {
        text = t("connected", { source });
        short = t("connectedShort");
      }
    } else if (latest)
      text = t("lastReading", { source, time: formatClock(new Date(latest.ts), timeZone) });
    else text = t("noReading", { source });
  }
  const muted =
    (status === "not-configured" && sourceType !== "manual") || !sourceType || isStale(latest, now);

  return (
    <div className={styles.source} data-variant={variant} role="status">
      <span
        className={styles.dot}
        data-muted={muted ? "true" : undefined}
        data-testid="source-dot"
        aria-hidden="true"
      />
      <span className={styles.sourceText} data-part="full">
        {text}
      </span>
      {short !== undefined && (
        <span className={styles.sourceShort} data-part="short" aria-hidden="true">
          {short}
        </span>
      )}
    </div>
  );
}
