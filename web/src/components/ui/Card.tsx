import type { HTMLAttributes, ReactNode } from "react";

import styles from "./ui.module.css";

/** A cream surface with a one-pixel hairline shadow (a border in the dark). */
export function Card({
  children,
  size = "normal",
  className,
  ...rest
}: { children: ReactNode; size?: "normal" | "simple" } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      data-size={size}
      className={className ? `${styles.card} ${className}` : styles.card}
    >
      {children}
    </div>
  );
}
