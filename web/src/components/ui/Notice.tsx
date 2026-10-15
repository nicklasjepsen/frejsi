import type { HTMLAttributes, ReactNode } from "react";

import styles from "./ui.module.css";

/** A muted paragraph, optionally on the sunken surface. */
export function Notice({
  children,
  tone = "plain",
  ...rest
}: { children: ReactNode; tone?: "plain" | "sunken" } & HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p {...rest} data-tone={tone} className={styles.notice}>
      {children}
    </p>
  );
}
