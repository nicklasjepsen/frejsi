"use client";

import type { Accent } from "@frejsi/shared";
import { useTranslations } from "next-intl";

import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";

import styles from "./shell.module.css";

/** A signed-in user who belongs to no space: removed from the last one. Kind, with the way back. */
export function NoSpace({ accent }: { accent: Accent }) {
  const t = useTranslations("shell");
  return (
    <div className={styles.shell} data-accent={accent} data-testid="no-space">
      <main className={styles.main}>
        <div className={styles.calmPage}>
          <h1>{t("noSpaceTitle")}</h1>
          <Card>
            <Notice>{t("noSpaceBody")}</Notice>
          </Card>
        </div>
      </main>
    </div>
  );
}
