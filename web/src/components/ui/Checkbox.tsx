"use client";
import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./ui.module.css";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "children"> & {
  /** The visible text, which is also the box's accessible name. */
  label: ReactNode;
};

/** One labelled 44 px checkbox row with the accent box ("Favorit", "Send rettelsen …"). */
export function Checkbox({ label, className = "", ...props }: CheckboxProps) {
  return (
    <label className={`${styles.checkbox} ${className}`.trim()}>
      <input type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}
