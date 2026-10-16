"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { ChevronIcon } from "@/components/shell/icons";
import { BackButton } from "@/components/ui/BackButton";

import styles from "./settings.module.css";

/** mmol/L · mg/dL, Dansk · English (design: `SegmentedControl`). A radiogroup of buttons. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  size = "normal",
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  size?: "normal" | "small";
}) {
  return (
    <div role="radiogroup" aria-label={label} className={styles.segmented} data-size={size}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          disabled={disabled}
          className={styles.segment}
          onClick={() => {
            if (option.value !== value) onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** 52×32 with a 26 px knob; on = accent (design: `Switch`). */
export function Switch({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={styles.switch}
      onClick={() => {
        onChange(!checked);
      }}
    >
      <span className={styles.switchKnob} aria-hidden="true" />
    </button>
  );
}

/** One line of a settings list card: title, a secondary line, and a control or a chevron. */
export function Row({
  title,
  sub,
  href,
  control,
  testId,
}: {
  title: ReactNode;
  sub?: ReactNode;
  /** Makes the whole row a link with a trailing chevron. */
  href?: string;
  control?: ReactNode;
  testId?: string;
}) {
  const text = (
    <span className={styles.rowText}>
      <span className={styles.rowTitle}>{title}</span>
      {sub !== undefined && <span className={styles.rowSub}>{sub}</span>}
    </span>
  );
  if (href !== undefined) {
    return (
      <Link href={href} className={`${styles.row} ${styles.rowLink}`} data-testid={testId}>
        {text}
        <ChevronIcon />
      </Link>
    );
  }
  return (
    <div className={styles.row} data-testid={testId}>
      {text}
      {control !== undefined && <span className={styles.rowControl}>{control}</span>}
    </div>
  );
}

/** Phone sub-screen header: the 48 px back link, the centred serif title, a spacer (design: `PageHeader`). */
export function PageHeader({
  backHref,
  backLabel,
  title,
}: {
  backHref: string;
  backLabel: string;
  title: string;
}) {
  return (
    <header className={styles.pageHeader}>
      <BackButton href={backHref} label={backLabel} />
      <h1 className={styles.pageTitle}>{title}</h1>
      <span className={styles.backSpacer} aria-hidden="true" />
    </header>
  );
}
