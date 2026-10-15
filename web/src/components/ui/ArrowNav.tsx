import Link from "next/link";

import styles from "./nav-ui.module.css";

export interface ArrowAction {
  /** The accessible name: "Forrige måltid", "Næste uge". */
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}

export interface ArrowNavProps {
  previous: ArrowAction;
  next: ArrowAction;
  /** The 13 px muted line between the arrows ("forrige / næste måltid"). */
  label?: string;
}

function Arrow({ action, glyph }: { action: ArrowAction; glyph: string }) {
  if (action.href !== undefined && !action.disabled) {
    return (
      <Link href={action.href} className={styles.arrow} aria-label={action.label}>
        <span aria-hidden="true">{glyph}</span>
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={styles.arrow}
      aria-label={action.label}
      disabled={action.disabled}
      onClick={action.onClick}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

/** Two 40×40 r10 arrow buttons with an optional label between (Maaltid-Desktop, Historik-Desktop). */
export function ArrowNav({ previous, next, label }: ArrowNavProps) {
  return (
    <div className={styles.arrowNav}>
      <Arrow action={previous} glyph="←" />
      {label !== undefined && (
        <span className={styles.navLabel} data-part="label">
          {label}
        </span>
      )}
      <Arrow action={next} glyph="→" />
    </div>
  );
}
