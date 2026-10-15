import type { ReactNode } from "react";

import styles from "./ui.module.css";

/** A keyboard hint, as drawn next to the sidebar items and in the search field. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={styles.kbd}>{children}</kbd>;
}
