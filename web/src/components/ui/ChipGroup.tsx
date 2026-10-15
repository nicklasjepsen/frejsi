"use client";
import Link from "next/link";
import { useRef, type KeyboardEvent } from "react";

import kit from "./food-ui.module.css";
import styles from "./nav-ui.module.css";

export interface ChipOption {
  value: string;
  label: string;
  /** A link chip (a view switch that changes the URL); without it, a button. */
  href?: string;
}

export interface ChipGroupProps {
  /** The group's accessible name. */
  label: string;
  options: readonly ChipOption[];
  /** The pressed chip's value. */
  value: string;
  onChange?: (value: string) => void;
}

/**
 * A row of 38 px filter chips (touch.filterChip) with exactly one pressed, as a radiogroup:
 * "Uge · Dag · Måltider" (Historik-Desktop), "Kun denne gang · Sammen med de sidste 5 gange"
 * (Maaltid-Desktop). Arrow keys move between chips; one chip is in the tab order.
 */
export function ChipGroup({ label, options, value, onChange }: ChipGroupProps) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const move = (event: KeyboardEvent, index: number) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const nextIndex = (index + step + options.length) % options.length;
    const next = options[nextIndex];
    refs.current[nextIndex]?.focus();
    if (next && next.href === undefined) onChange?.(next.value);
  };
  return (
    <div role="radiogroup" aria-label={label} className={`${kit.theme} ${styles.chipGroup}`}>
      {options.map((option, index) => {
        const checked = option.value === value;
        const common = {
          role: "radio",
          "aria-checked": checked,
          tabIndex: checked ? 0 : -1,
          className: styles.chip,
          onKeyDown: (event: KeyboardEvent) => {
            move(event, index);
          },
        } as const;
        return option.href !== undefined ? (
          <Link
            key={option.value}
            href={option.href}
            {...common}
            ref={(el) => {
              refs.current[index] = el;
            }}
          >
            {option.label}
          </Link>
        ) : (
          <button
            key={option.value}
            type="button"
            {...common}
            ref={(el) => {
              refs.current[index] = el;
            }}
            onClick={() => {
              onChange?.(option.value);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
