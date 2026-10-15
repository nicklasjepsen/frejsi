import type { ReactNode } from "react";

import styles from "./public.module.css";

/**
 * The chrome of a page a visitor sees before signing in (design README "Navigation model": the
 * invite landing has no navigation at all): the wordmark, the page, an optional footer line.
 * Welcome shares it; nothing else does. No shell, no tabs, no sidebar, no session.
 */
export function PublicPage({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <div className={styles.wordmark} data-testid="wordmark">
          Frejsi
        </div>
        <main className={styles.main}>{children}</main>
        {footer && <p className={styles.footer}>{footer}</p>}
      </div>
    </div>
  );
}
