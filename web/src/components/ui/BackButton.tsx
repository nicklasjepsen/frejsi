"use client";
import Link from "next/link";

import styles from "./back-button.module.css";

export interface BackButtonProps {
  /** The accessible name ("Tilbage"); drawn next to the chevron when `showLabel` is set. */
  label: string;
  /** A link to this path; without it, a button that calls `onClick`. */
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  showLabel?: boolean;
  /** simpleMode: 56 px with a 32 px chevron. */
  size?: "normal" | "simple";
  className?: string;
}

/**
 * The back control of every phone sub-screen and sheet: one 48 px target (56 px in simpleMode)
 * with a 28 px chevron in the text colour on the sunken surface, so it is easy to see and to hit
 * with a thumb at the top of the screen; a quieter 40 px from 1280 px. A link when going back is
 * a destination, a button when it is an action (closing a sheet, stepping back in a flow).
 */
export function BackButton({
  label,
  href,
  onClick,
  disabled = false,
  showLabel = false,
  size = "normal",
  className,
}: BackButtonProps) {
  const classes = className ? `${styles.back} ${className}` : styles.back;
  const content = (
    <>
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <path
          d="M17 6 L9 14 L17 22"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {showLabel && <span className={styles.label}>{label}</span>}
    </>
  );
  if (href !== undefined) {
    return (
      <Link
        href={href}
        className={classes}
        aria-label={label}
        data-size={size}
        data-label={showLabel || undefined}
      >
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={classes}
      aria-label={label}
      data-size={size}
      data-label={showLabel || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {content}
    </button>
  );
}
