import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import styles from "./public.module.css";

/**
 * The chrome of a page a visitor sees before signing in (design README "Navigation model": the
 * invite landing has no navigation at all): the wordmark, the page, and the one footer line the
 * design gives every footer (`app.footer`, the same as the shell's), so the promise reads one
 * way everywhere. Welcome shares it; nothing else does. No shell, no tabs, no sidebar, no session.
 */
export function PublicPage({ children }: { children: ReactNode }) {
  const t = useTranslations("app");
  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <div className={styles.wordmark} data-testid="wordmark">
          Frejsi
        </div>
        <main className={styles.main}>{children}</main>
        <p className={styles.footer}>{t("footer")}</p>
      </div>
    </div>
  );
}
