"use client";

import type { GlucoseSourceType, SourceStatus } from "@frejsi/shared";
import { useTranslations } from "next-intl";

import { formatClock } from "@/lib/i18n/time";

import styles from "./shell.module.css";

export interface SourceStatusBannerProps {
  status: SourceStatus;
  /** ISO timestamp of the `source.status` event that set `disconnected`. */
  since: string | null;
  /** The source's type; its display name is the message `source.<type>.name` (plan §9). */
  sourceType: GlucoseSourceType | null;
  /**
   * The space's timezone for `{time}` (`ShellSpace.timezone`). Required: the only correct zone is
   * the space's, and a fallback to the runtime's would differ between server and browser.
   */
  timeZone: string;
}

/**
 * "Ingen forbindelse til {source} siden {time}" for owners and carers while the source is
 * disconnected (plan §9, decision 20); "Ingen forbindelse til {source}" when the time of the
 * disconnection is not known; nothing otherwise. The component knows only the type, so a new
 * source adds a string and no branch here.
 */
export function SourceStatusBanner({
  status,
  since,
  sourceType,
  timeZone,
}: SourceStatusBannerProps) {
  const t = useTranslations("source");
  if (status !== "disconnected" || !sourceType) return null;

  const source = t(`${sourceType}.name`);
  const text = since
    ? t("disconnected", { source, time: formatClock(new Date(since), timeZone) })
    : t("disconnectedNoTime", { source });

  return (
    <div role="status" className={styles.banner}>
      <span className={styles.bannerDot} aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
