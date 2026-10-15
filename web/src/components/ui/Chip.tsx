"use client";
import type { ButtonHTMLAttributes } from "react";
import styles from "./food-ui.module.css";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> & {
  pressed?: boolean;
  variant?: "default" | "unverified";
};
export function Chip({ pressed, variant = "default", className = "", ...props }: Props) {
  return (
    <button
      type="button"
      {...props}
      className={`${styles.theme} ${styles.chip} ${className}`}
      aria-pressed={pressed}
      data-variant={variant}
    />
  );
}
