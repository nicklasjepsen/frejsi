"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./history.module.css";

export interface PeriodAction {
  /** The accessible name: "Forrige dag", "Næste uge". */
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}

function Arrow({ action, glyph }: { action: PeriodAction; glyph: string }) {
  if (action.href !== undefined && !action.disabled) {
    return (
      <Link href={action.href} className={styles.periodArrow} aria-label={action.label}>
        <span aria-hidden="true">{glyph}</span>
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={styles.periodArrow}
      aria-label={action.label}
      disabled={action.disabled}
      onClick={action.onClick}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

/**
 * The phone's period header on Historik: the heading and its line centred between two round
 * 44 px arrows. The day view navigates in place (buttons), the week view by link; both read the
 * same. Hidden from 1280 px, where the toolbar's ArrowNav takes over. `filter` is the
 * "Symptomer" chip under the line (v0.6.0 plan §5).
 */
export function PeriodHeader({
  heading,
  line,
  previous,
  next,
  filter,
}: {
  heading: string;
  line: string;
  previous: PeriodAction;
  next: PeriodAction;
  filter?: ReactNode;
}) {
  return (
    <header className={styles.periodHeader}>
      <Arrow action={previous} glyph="‹" />
      <div>
        <h2>{heading}</h2>
        <p>{line}</p>
        {filter && <div className={styles.symptomFilter}>{filter}</div>}
      </div>
      <Arrow action={next} glyph="›" />
    </header>
  );
}
