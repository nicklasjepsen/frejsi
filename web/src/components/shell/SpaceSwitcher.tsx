"use client";

import type { Role } from "@frejsi/shared";
import { useTranslations } from "next-intl";

import { Avatar } from "@/components/ui/Avatar";
import type { AppLocale } from "@/lib/i18n/routing";

import { ChevronIcon } from "./icons";
import { switchSpace } from "./actions";
import styles from "./shell.module.css";

export interface SpaceSwitcherProps {
  locale: AppLocale;
  current: { id: string; name: string; subjectName: string };
  spaces: { id: string; name: string; role: Role }[];
  /** The compact phone form in the header (design gap 11: the phone switcher is not drawn). */
  compact?: boolean;
}

/**
 * The sidebar card "Almas rum · Skift rum" (Nu-Desktop) with the memberships below it. Plain
 * `<details>` and a form, so it works before hydration; the chosen space is remembered per device
 * by the `switchSpace` action.
 */
export function SpaceSwitcher({ locale, current, spaces, compact = false }: SpaceSwitcherProps) {
  const t = useTranslations("shell");
  const roles = useTranslations("roles");
  return (
    <details className={compact ? `${styles.switcher} ${styles.phoneSwitcher}` : styles.switcher}>
      <summary
        className={styles.switcherSummary}
        aria-label={t("currentSpace", { space: current.name })}
      >
        <Avatar name={current.subjectName} size={compact ? 36 : 32} />
        <span className={styles.switcherText}>
          <span className={compact ? styles.subjectName : styles.switcherSpace}>
            {compact ? current.subjectName : current.name}
          </span>
          {!compact && <span className={styles.switcherHint}>{t("switchSpace")}</span>}
        </span>
        {!compact && <ChevronIcon />}
      </summary>
      <form action={switchSpace}>
        <input type="hidden" name="locale" value={locale} />
        <ul className={styles.switcherList} aria-label={t("yourSpaces")}>
          {spaces.map((space) => (
            <li key={space.id}>
              <button
                type="submit"
                name="spaceId"
                value={space.id}
                className={styles.switcherOption}
                aria-current={space.id === current.id ? "true" : undefined}
              >
                <Avatar name={space.name} size={28} tone="member" />
                <span>{space.name}</span>
                <span className={styles.switcherRole}>{roles(space.role)}</span>
              </button>
            </li>
          ))}
        </ul>
      </form>
    </details>
  );
}
